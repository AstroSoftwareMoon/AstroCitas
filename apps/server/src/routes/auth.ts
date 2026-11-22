import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ensureMessagingDefaults, BusinessKind } from '@astrocitas/core';
import { API_VERSION } from '../config';
import { body, HttpError, requireUser, type App } from '../app';
import { hashPassword, newTotpSecret, passwordProblem, signAccess, totpUri, verifyPassword, verifyTotp } from '../security';
import { publicUser } from '../system';

const Email = z.string().trim().email('Email no válido').max(200);

async function tokens(app: App, userId: string, isAdmin: boolean, device: string) {
  return {
    accessToken: await signAccess(app.cfg.secret, { sub: userId, adm: isAdmin }),
    refreshToken: await app.sys.issueRefresh(userId, device),
    expiresIn: 15 * 60,
  };
}

async function session(app: App, userId: string, device: string) {
  const u = (await app.sys.userById(userId))!;
  return { ...(await tokens(app, u.id, !!u.is_admin, device)), user: publicUser(u), memberships: await app.sys.memberships(u.id) };
}

export function authRoutes(f: FastifyInstance, app: App) {
  f.get('/health', async () => ({ status: 'ok', version: app.cfg.version, db: app.store.dialect, uptime: Math.round(process.uptime()) }));

  f.get('/api/v1/version', async () => ({
    name: 'astrocitas',
    version: app.cfg.version,
    apiVersion: API_VERSION,
    db: app.store.dialect,
    setupRequired: (await app.sys.countUsers()) === 0,
    captcha: app.cfg.captcha,
  }));

  /** Primer arranque: crea el administrador y el primer negocio. Solo funciona si no hay usuarios. */
  f.post('/api/v1/setup', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    if ((await app.sys.countUsers()) > 0) throw new HttpError(409, 'El servidor ya está configurado');
    const b = z
      .object({ email: Email, password: z.string(), name: z.string().trim().max(120).default(''), businessName: z.string().trim().min(1).max(120), kind: BusinessKind.default('otro'), locale: z.enum(['es', 'en']).default('es') })
      .parse(body(req));
    const problem = passwordProblem(b.password);
    if (problem) throw new HttpError(400, problem);
    const user = await app.sys.createUser({ email: b.email, name: b.name, passwordHash: await hashPassword(b.password), isAdmin: true });
    const biz = await app.sys.createBusiness(b.businessName);
    await app.sys.setMembership(user.id, biz.id, 'owner');
    const db = await app.store.business(biz.id);
    await db.saveBusiness({ name: b.businessName, kind: b.kind, locale: b.locale });
    await ensureMessagingDefaults(db, b.locale);
    await app.sys.audit({ userId: user.id, businessId: biz.id, action: 'setup', ip: req.ip });
    return session(app, user.id, String(req.headers['user-agent'] ?? ''));
  });

  f.post('/api/v1/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ email: Email, password: z.string().min(1).max(500), totp: z.string().max(10).optional(), device: z.string().max(200).optional() }).parse(body(req));
    const u = await app.sys.userByEmail(b.email);
    // Verificar siempre (aunque no exista) para no filtrar qué emails existen por tiempos.
    const ok = await verifyPassword(u?.password_hash ?? '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE', b.password);
    if (!u || !ok || u.disabled) {
      await app.sys.audit({ action: 'login_failed', detail: { email: b.email }, ip: req.ip });
      throw new HttpError(401, 'Email o contraseña incorrectos');
    }
    if (u.totp_enabled) {
      if (!b.totp) throw new HttpError(401, 'Introduce el código de verificación', { totpRequired: true });
      if (!verifyTotp(u.totp_secret!, b.totp)) throw new HttpError(401, 'Código de verificación incorrecto', { totpRequired: true });
    }
    await app.sys.updateUser(u.id, { last_login_at: Date.now() });
    await app.sys.audit({ userId: u.id, action: 'login', ip: req.ip });
    return session(app, u.id, b.device ?? String(req.headers['user-agent'] ?? ''));
  });

  f.post('/api/v1/auth/refresh', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ refreshToken: z.string().min(10).max(200), device: z.string().max(200).optional() }).parse(body(req));
    const r = await app.sys.rotateRefresh(b.refreshToken, b.device ?? String(req.headers['user-agent'] ?? ''));
    if (!r) throw new HttpError(401, 'Sesión caducada: vuelve a iniciar sesión');
    const u = await app.sys.userById(r.userId);
    if (!u || u.disabled) throw new HttpError(401, 'Usuario desactivado');
    return {
      accessToken: await signAccess(app.cfg.secret, { sub: u.id, adm: !!u.is_admin }),
      refreshToken: r.token,
      expiresIn: 15 * 60,
      user: publicUser(u),
      memberships: await app.sys.memberships(u.id),
    };
  });

  f.post('/api/v1/auth/logout', async (req) => {
    const b = z.object({ refreshToken: z.string().max(200) }).parse(body(req));
    await app.sys.revokeRefresh(b.refreshToken);
    return { ok: true };
  });

  f.get('/api/v1/me', async (req) => {
    const c = await requireUser(app, req);
    const u = (await app.sys.userById(c.sub))!;
    return { user: publicUser(u), memberships: await app.sys.memberships(u.id) };
  });

  f.post('/api/v1/me/password', async (req) => {
    const c = await requireUser(app, req);
    const b = z.object({ current: z.string(), next: z.string() }).parse(body(req));
    const u = (await app.sys.userById(c.sub))!;
    if (!(await verifyPassword(u.password_hash, b.current))) throw new HttpError(400, 'La contraseña actual no es correcta');
    const problem = passwordProblem(b.next);
    if (problem) throw new HttpError(400, problem);
    await app.sys.updateUser(u.id, { password_hash: await hashPassword(b.next) });
    await app.sys.revokeAll(u.id);
    await app.sys.audit({ userId: u.id, action: 'password_changed', ip: req.ip });
    return { ok: true };
  });

  f.post('/api/v1/me/2fa/setup', async (req) => {
    const c = await requireUser(app, req);
    const u = (await app.sys.userById(c.sub))!;
    const secret = newTotpSecret();
    await app.sys.updateUser(u.id, { totp_secret: secret, totp_enabled: 0 });
    return { secret, uri: totpUri(secret, u.email) };
  });

  f.post('/api/v1/me/2fa/enable', async (req) => {
    const c = await requireUser(app, req);
    const { code } = z.object({ code: z.string() }).parse(body(req));
    const u = (await app.sys.userById(c.sub))!;
    if (!u.totp_secret || !verifyTotp(u.totp_secret, code)) throw new HttpError(400, 'Código incorrecto');
    await app.sys.updateUser(u.id, { totp_enabled: 1 });
    await app.sys.audit({ userId: u.id, action: '2fa_enabled', ip: req.ip });
    return { ok: true };
  });

  f.post('/api/v1/me/2fa/disable', async (req) => {
    const c = await requireUser(app, req);
    const { code } = z.object({ code: z.string() }).parse(body(req));
    const u = (await app.sys.userById(c.sub))!;
    if (!u.totp_enabled || !verifyTotp(u.totp_secret!, code)) throw new HttpError(400, 'Código incorrecto');
    await app.sys.updateUser(u.id, { totp_enabled: 0, totp_secret: null });
    await app.sys.audit({ userId: u.id, action: '2fa_disabled', ip: req.ip });
    return { ok: true };
  });
}
