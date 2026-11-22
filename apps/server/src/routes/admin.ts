import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ensureMessagingDefaults } from '@astrocitas/core';
import { body, HttpError, requireAdmin, requireMember, requireUser, type App } from '../app';
import { hashPassword, randomToken, seal, unseal } from '../security';
import { publicUser, slugify } from '../system';
import { PROVIDER_KINDS, ProviderSchemas, redact, sendVia, SECRET_FIELDS, type ProviderKind } from '../providers';

const Role = z.enum(['owner', 'reception', 'professional']);

// ---------- copias de seguridad en el servidor ----------

export function backupDir(app: App, businessId: string) {
  const d = join(app.cfg.dataDir, 'backups', businessId);
  mkdirSync(d, { recursive: true });
  return d;
}

export async function createServerBackup(app: App, businessId: string, keep = 14): Promise<string> {
  const db = await app.store.business(businessId);
  const dump = await db.exportAll();
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}.astrocitas`;
  const dir = backupDir(app, businessId);
  writeFileSync(join(dir, name), JSON.stringify(dump));
  const all = readdirSync(dir).filter((f) => f.endsWith('.astrocitas')).sort().reverse();
  for (const old of all.slice(keep)) unlinkSync(join(dir, old));
  return name;
}

// ---------- aviso de nuevas versiones ----------

let updateCache: { at: number; data: unknown } | null = null;
async function latestRelease(app: App) {
  if (!app.cfg.updateCheck) return { enabled: false };
  if (updateCache && Date.now() - updateCache.at < 6 * 3600_000) return updateCache.data;
  try {
    const r = await fetch('https://api.github.com/repos/AstroSoftwareMoon/AstroCitas/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'astrocitas-server' },
      signal: AbortSignal.timeout(5000),
    });
    const j = (await r.json()) as { tag_name?: string; html_url?: string; published_at?: string };
    const latest = (j.tag_name ?? '').replace(/^v/, '');
    const data = { enabled: true, current: app.cfg.version, latest, url: j.html_url, publishedAt: j.published_at, updateAvailable: !!latest && newer(latest, app.cfg.version) };
    updateCache = { at: Date.now(), data };
    return data;
  } catch {
    return { enabled: true, current: app.cfg.version, error: 'No se pudo comprobar' };
  }
}

export function newer(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

export function adminRoutes(f: FastifyInstance, app: App) {
  // ----- miembros del negocio (propietario) -----
  f.get<{ Params: { bid: string } }>('/api/v1/b/:bid/members', async (req) => {
    await requireMember(app, req, req.params.bid, ['owner']);
    return { members: await app.sys.businessMembers(req.params.bid) };
  });

  f.post<{ Params: { bid: string } }>('/api/v1/b/:bid/members', async (req) => {
    const { user } = await requireMember(app, req, req.params.bid, ['owner']);
    const b = z.object({ email: z.string().trim().email(), name: z.string().max(120).default(''), role: Role, staffId: z.string().nullable().default(null) }).parse(body(req));
    let u = await app.sys.userByEmail(b.email);
    let tempPassword: string | null = null;
    if (!u) {
      tempPassword = randomToken(9);
      u = await app.sys.createUser({ email: b.email, name: b.name, passwordHash: await hashPassword(tempPassword) });
    }
    await app.sys.setMembership(u.id, req.params.bid, b.role, b.staffId);
    await app.sys.audit({ userId: user.sub, businessId: req.params.bid, action: 'member_set', entity: 'user', entityId: u.id, detail: { role: b.role }, ip: req.ip });
    return { user: publicUser(u), tempPassword };
  });

  f.delete<{ Params: { bid: string; uid: string } }>('/api/v1/b/:bid/members/:uid', async (req) => {
    const { user } = await requireMember(app, req, req.params.bid, ['owner']);
    if (req.params.uid === user.sub) throw new HttpError(400, 'No puedes quitarte a ti mismo');
    await app.sys.removeMembership(req.params.uid, req.params.bid);
    await app.sys.audit({ userId: user.sub, businessId: req.params.bid, action: 'member_removed', entityId: req.params.uid, ip: req.ip });
    return { ok: true };
  });

  // ----- proveedores de mensajería (BYO) -----
  f.get<{ Params: { bid: string } }>('/api/v1/b/:bid/providers', async (req) => {
    await requireMember(app, req, req.params.bid, ['owner']);
    const rows = await app.sys.listProviders(req.params.bid);
    return {
      providers: PROVIDER_KINDS.map((kind) => {
        const r = rows.find((x) => x.kind === kind);
        return { kind, enabled: !!r?.enabled, configured: !!r, config: r ? redact(unseal(app.cfg.secret, r.config)) : null };
      }),
    };
  });

  f.put<{ Params: { bid: string; kind: string } }>('/api/v1/b/:bid/providers/:kind', async (req) => {
    const { user } = await requireMember(app, req, req.params.bid, ['owner']);
    const kind = z.enum(PROVIDER_KINDS as [ProviderKind, ...ProviderKind[]]).parse(req.params.kind);
    const b = z.object({ enabled: z.boolean().default(true), config: z.record(z.string(), z.unknown()) }).parse(body(req));
    // Los campos secretos enmascarados ('••••') conservan el valor guardado.
    const prev = await app.sys.getProvider(req.params.bid, kind);
    const prevCfg = prev ? unseal<Record<string, unknown>>(app.cfg.secret, prev.config) : {};
    const merged = Object.fromEntries(Object.entries(b.config).map(([k, v]) => [k, SECRET_FIELDS.has(k) && String(v).startsWith('••') ? prevCfg[k] : v]));
    const cfg = ProviderSchemas[kind].parse(merged);
    await app.sys.setProvider(req.params.bid, kind, seal(app.cfg.secret, cfg), b.enabled);
    await app.sys.audit({ userId: user.sub, businessId: req.params.bid, action: 'provider_set', entity: 'provider', entityId: kind, ip: req.ip });
    return { ok: true };
  });

  f.post<{ Params: { bid: string; kind: string } }>('/api/v1/b/:bid/providers/:kind/test', async (req) => {
    await requireMember(app, req, req.params.bid, ['owner']);
    const kind = z.enum(PROVIDER_KINDS as [ProviderKind, ...ProviderKind[]]).parse(req.params.kind);
    const { to } = z.object({ to: z.string().min(3) }).parse(body(req));
    const row = await app.sys.getProvider(req.params.bid, kind);
    if (!row) throw new HttpError(404, 'Proveedor no configurado');
    const channel = kind === 'whatsapp' ? 'whatsapp' : kind === 'twilio' ? 'sms' : 'email';
    try {
      const r = await sendVia(kind, unseal(app.cfg.secret, row.config), { channel, to, subject: 'AstroCitas · prueba', text: 'Mensaje de prueba de AstroCitas. ¡Funciona!' });
      return { ok: true, providerId: r.providerId };
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  });

  // ----- auditoría -----
  f.get<{ Params: { bid: string } }>('/api/v1/b/:bid/audit', async (req) => {
    await requireMember(app, req, req.params.bid, ['owner']);
    return { entries: await app.sys.listAudit(req.params.bid) };
  });

  // ----- copias de seguridad -----
  f.get<{ Params: { bid: string } }>('/api/v1/b/:bid/backups', async (req) => {
    await requireMember(app, req, req.params.bid, ['owner']);
    const dir = backupDir(app, req.params.bid);
    const schedule = (await app.sys.getSetting<{ hour: number; keep: number }>(`backup.schedule.${req.params.bid}`)) ?? { hour: 3, keep: 14 };
    return {
      schedule,
      backups: readdirSync(dir)
        .filter((x) => x.endsWith('.astrocitas'))
        .sort()
        .reverse()
        .map((name) => ({ name, size: statSync(join(dir, name)).size, date: statSync(join(dir, name)).mtimeMs })),
    };
  });

  f.post<{ Params: { bid: string } }>('/api/v1/b/:bid/backups', async (req) => {
    const { user } = await requireMember(app, req, req.params.bid, ['owner']);
    const name = await createServerBackup(app, req.params.bid);
    await app.sys.audit({ userId: user.sub, businessId: req.params.bid, action: 'backup_created', entityId: name, ip: req.ip });
    return { name };
  });

  f.put<{ Params: { bid: string } }>('/api/v1/b/:bid/backups/schedule', async (req) => {
    await requireMember(app, req, req.params.bid, ['owner']);
    const s = z.object({ hour: z.number().int().min(0).max(23), keep: z.number().int().min(1).max(365) }).parse(body(req));
    await app.sys.setSetting(`backup.schedule.${req.params.bid}`, s);
    return { ok: true };
  });

  f.get<{ Params: { bid: string; name: string } }>('/api/v1/b/:bid/backups/:name', async (req, reply) => {
    await requireMember(app, req, req.params.bid, ['owner']);
    if (!/^[\w.-]+\.astrocitas$/.test(req.params.name)) throw new HttpError(400, 'Nombre no válido');
    const data = readFileSync(join(backupDir(app, req.params.bid), req.params.name));
    return reply.header('Content-Disposition', `attachment; filename="${req.params.name}"`).type('application/json').send(data);
  });

  // ----- reserva pública y calendario .ics -----
  f.get<{ Params: { bid: string } }>('/api/v1/b/:bid/public', async (req) => {
    await requireMember(app, req, req.params.bid);
    const b = (await app.sys.businessById(req.params.bid))!;
    return {
      slug: b.slug,
      enabled: !!b.public_booking,
      bookingUrl: `${app.cfg.publicUrl}/b/${b.slug}`,
      widgetSnippet: `<script src="${app.cfg.publicUrl}/widget.js" data-astrocitas="${b.slug}" async></script>`,
      icsUrl: `${app.cfg.publicUrl}/ics/${b.id}/${b.ics_token}.ics`,
    };
  });

  f.put<{ Params: { bid: string } }>('/api/v1/b/:bid/public', async (req) => {
    const { user } = await requireMember(app, req, req.params.bid, ['owner']);
    const p = z.object({ enabled: z.boolean().optional(), slug: z.string().trim().min(2).max(40).optional(), rotateIcs: z.boolean().optional() }).parse(body(req));
    const patch: Parameters<typeof app.sys.updateBusiness>[1] = {};
    if (p.enabled !== undefined) patch.public_booking = p.enabled ? 1 : 0;
    if (p.slug) {
      const slug = slugify(p.slug);
      const other = await app.sys.businessBySlug(slug);
      if (other && other.id !== req.params.bid) throw new HttpError(409, 'Esa dirección ya está en uso');
      patch.slug = slug;
    }
    if (p.rotateIcs) patch.ics_token = randomToken(18);
    await app.sys.updateBusiness(req.params.bid, patch);
    await app.sys.audit({ userId: user.sub, businessId: req.params.bid, action: 'public_settings', detail: p, ip: req.ip });
    return { ok: true };
  });

  // ----- administración del servidor -----
  f.get('/api/v1/admin/users', async (req) => {
    requireAdmin(await requireUser(app, req));
    return { users: (await app.sys.listUsers()).map(publicUser) };
  });

  f.patch<{ Params: { uid: string } }>('/api/v1/admin/users/:uid', async (req) => {
    const me = await requireUser(app, req);
    requireAdmin(me);
    const p = z.object({ disabled: z.boolean().optional(), isAdmin: z.boolean().optional(), resetPassword: z.boolean().optional() }).parse(body(req));
    if (req.params.uid === me.sub && (p.disabled || p.isAdmin === false)) throw new HttpError(400, 'No puedes desactivarte ni quitarte el rol de administrador');
    let tempPassword: string | null = null;
    if (p.resetPassword) {
      tempPassword = randomToken(9);
      await app.sys.updateUser(req.params.uid, { password_hash: await hashPassword(tempPassword) });
      await app.sys.revokeAll(req.params.uid);
    }
    await app.sys.updateUser(req.params.uid, {
      ...(p.disabled !== undefined ? { disabled: p.disabled ? 1 : 0 } : {}),
      ...(p.isAdmin !== undefined ? { is_admin: p.isAdmin ? 1 : 0 } : {}),
    });
    if (p.disabled) await app.sys.revokeAll(req.params.uid);
    await app.sys.audit({ userId: me.sub, action: 'admin_user_update', entityId: req.params.uid, detail: { ...p, resetPassword: !!p.resetPassword }, ip: req.ip });
    return { ok: true, tempPassword };
  });

  f.get('/api/v1/admin/businesses', async (req) => {
    requireAdmin(await requireUser(app, req));
    return { businesses: await app.sys.listBusinesses() };
  });

  f.post('/api/v1/admin/businesses', async (req) => {
    const me = await requireUser(app, req);
    requireAdmin(me);
    const b = z.object({ name: z.string().trim().min(1).max(120), ownerEmail: z.string().email().optional(), locale: z.enum(['es', 'en']).default('es') }).parse(body(req));
    const biz = await app.sys.createBusiness(b.name);
    const db = await app.store.business(biz.id);
    await db.saveBusiness({ name: b.name, locale: b.locale });
    await ensureMessagingDefaults(db, b.locale);
    let tempPassword: string | null = null;
    let ownerId = me.sub;
    if (b.ownerEmail) {
      let u = await app.sys.userByEmail(b.ownerEmail);
      if (!u) {
        tempPassword = randomToken(9);
        u = await app.sys.createUser({ email: b.ownerEmail, name: '', passwordHash: await hashPassword(tempPassword) });
      }
      ownerId = u.id;
    }
    await app.sys.setMembership(ownerId, biz.id, 'owner');
    await app.sys.audit({ userId: me.sub, businessId: biz.id, action: 'business_created', ip: req.ip });
    return { business: biz, tempPassword };
  });

  f.get('/api/v1/admin/update', async (req) => {
    await requireUser(app, req);
    return latestRelease(app);
  });
}
