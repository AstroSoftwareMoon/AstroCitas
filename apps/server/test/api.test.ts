import { afterEach, describe, expect, it } from 'vitest';
import * as OTPAuth from 'otpauth';
import { defaultHours, localToUtc } from '@astrocitas/core';
import { setupAdmin, testServer } from './helpers';
import { newer } from '../src/routes/admin';

const at = (h: number, m = 0) => localToUtc('2026-11-16', h * 60 + m, 'Europe/Madrid');
let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

for (const pg of [false, true]) {
  describe(`API (${pg ? 'PostgreSQL' : 'SQLite'})`, () => {
    it('health, versión, primer arranque y login', async () => {
      const { srv, call } = await testServer({ pg });
      close = srv.close;
      expect((await call('GET', '/health')).json).toMatchObject({ status: 'ok', db: pg ? 'postgres' : 'sqlite' });
      expect((await call('GET', '/api/v1/version')).json).toMatchObject({ apiVersion: 1, setupRequired: true });
      const s = await setupAdmin(call);
      expect(s.memberships).toHaveLength(1);
      expect((await call('POST', '/api/v1/setup', { email: 'x@y.es', password: 'otra-contraseña-larga', businessName: 'X' })).status).toBe(409);
      expect((await call('POST', '/api/v1/auth/login', { email: 'admin@luna.es', password: 'mal' })).status).toBe(401);
      const login = await call('POST', '/api/v1/auth/login', { email: 'ADMIN@luna.es', password: 'una-contraseña-larga' });
      expect(login.status).toBe(200);
      expect((await call('GET', '/api/v1/me', undefined, login.json.accessToken)).json.user.isAdmin).toBe(true);
      expect((await call('GET', '/api/v1/me')).status).toBe(401);
    });

    it('RPC de datos con la misma lógica que en local (huecos, solapes → 409)', async () => {
      const { srv, call } = await testServer({ pg });
      close = srv.close;
      const s = await setupAdmin(call);
      const bid = s.memberships[0]!.businessId;
      const rpc = (method: string, ...args: unknown[]) => call('POST', `/api/v1/b/${bid}/rpc`, { method, args }, s.accessToken);
      const staff = (await rpc('saveStaff', { name: 'Ana', hours: defaultHours() })).json.result;
      const svc = (await rpc('saveService', { name: 'Corte', durationMin: 30 })).json.result;
      const ok = await rpc('saveAppointment', { staffId: staff.id, serviceId: svc.id, startsAt: at(10), endsAt: at(10, 30) });
      expect(ok.status).toBe(200);
      const clash = await rpc('saveAppointment', { staffId: staff.id, serviceId: svc.id, startsAt: at(10, 15), endsAt: at(10, 45) }, { force: true });
      expect(clash.status).toBe(409);
      expect(clash.json.conflicts[0].kind).toBe('overlap');
      const list = await rpc('listAppointments', { from: at(0), to: at(23) });
      expect(list.json.result).toHaveLength(1);
      expect((await rpc('getMeta', 'x')).status).toBe(403);
      expect((await rpc('saveService', { name: '', durationMin: 0 })).status).toBe(400);
    });

    it('roles: recepción no edita servicios; profesional solo sus citas', async () => {
      const { srv, call } = await testServer({ pg });
      close = srv.close;
      const s = await setupAdmin(call);
      const bid = s.memberships[0]!.businessId;
      const rpcAs = (tok: string, method: string, ...args: unknown[]) => call('POST', `/api/v1/b/${bid}/rpc`, { method, args }, tok);
      const ana = (await rpcAs(s.accessToken, 'saveStaff', { name: 'Ana', hours: defaultHours() })).json.result;
      const leo = (await rpcAs(s.accessToken, 'saveStaff', { name: 'Leo', hours: defaultHours() })).json.result;
      const svc = (await rpcAs(s.accessToken, 'saveService', { name: 'Corte', durationMin: 30 })).json.result;

      const rec = await call('POST', `/api/v1/b/${bid}/members`, { email: 'recepcion@luna.es', role: 'reception' }, s.accessToken);
      expect(rec.json.tempPassword).toBeTruthy();
      const pro = await call('POST', `/api/v1/b/${bid}/members`, { email: 'ana@luna.es', role: 'professional', staffId: ana.id }, s.accessToken);
      const recTok = (await call('POST', '/api/v1/auth/login', { email: 'recepcion@luna.es', password: rec.json.tempPassword })).json.accessToken;
      const proTok = (await call('POST', '/api/v1/auth/login', { email: 'ana@luna.es', password: pro.json.tempPassword })).json.accessToken;

      expect((await rpcAs(recTok, 'saveService', { name: 'X', durationMin: 10 })).status).toBe(403);
      expect((await rpcAs(recTok, 'saveClient', { name: 'Lucía' })).status).toBe(200);
      expect((await rpcAs(recTok, 'remove', 'services', svc.id)).status).toBe(403);
      expect((await call('GET', `/api/v1/b/${bid}/members`, undefined, recTok)).status).toBe(403);

      expect((await rpcAs(proTok, 'saveAppointment', { staffId: ana.id, serviceId: svc.id, startsAt: at(11), endsAt: at(11, 30) })).status).toBe(200);
      expect((await rpcAs(proTok, 'saveAppointment', { staffId: leo.id, serviceId: svc.id, startsAt: at(11), endsAt: at(11, 30) })).status).toBe(403);
      const leoAppt = (await rpcAs(s.accessToken, 'saveAppointment', { staffId: leo.id, serviceId: svc.id, startsAt: at(12), endsAt: at(12, 30) })).json.result;
      expect((await rpcAs(proTok, 'remove', 'appointments', leoAppt.id)).status).toBe(403);
      expect((await rpcAs(proTok, 'listAppointments', { from: at(0), to: at(23) })).json.result).toHaveLength(2);

      // Auditoría de los cambios
      const audit = await call('GET', `/api/v1/b/${bid}/audit`, undefined, s.accessToken);
      expect(audit.json.entries.map((e: { action: string }) => e.action)).toContain('saveAppointment');
    });

    it('refresh rotatorio y detección de reutilización', async () => {
      const { srv, call } = await testServer({ pg });
      close = srv.close;
      const s = await setupAdmin(call);
      const r1 = await call('POST', '/api/v1/auth/refresh', { refreshToken: s.refreshToken });
      expect(r1.status).toBe(200);
      expect(r1.json.refreshToken).not.toBe(s.refreshToken);
      // Reutilizar el antiguo revoca todo
      expect((await call('POST', '/api/v1/auth/refresh', { refreshToken: s.refreshToken })).status).toBe(401);
      expect((await call('POST', '/api/v1/auth/refresh', { refreshToken: r1.json.refreshToken })).status).toBe(401);
    });
  });
}

describe('API (resto)', () => {
  it('2FA TOTP', async () => {
    const { srv, call } = await testServer();
    close = srv.close;
    const s = await setupAdmin(call);
    const setup = await call('POST', '/api/v1/me/2fa/setup', {}, s.accessToken);
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.json.secret) });
    expect((await call('POST', '/api/v1/me/2fa/enable', { code: '000000' }, s.accessToken)).status).toBe(400);
    expect((await call('POST', '/api/v1/me/2fa/enable', { code: totp.generate() }, s.accessToken)).status).toBe(200);
    const noCode = await call('POST', '/api/v1/auth/login', { email: 'admin@luna.es', password: 'una-contraseña-larga' });
    expect(noCode.status).toBe(401);
    expect(noCode.json.totpRequired).toBe(true);
    expect((await call('POST', '/api/v1/auth/login', { email: 'admin@luna.es', password: 'una-contraseña-larga', totp: totp.generate() })).status).toBe(200);
  });

  it('proveedores cifrados y enmascarados, copias de seguridad, ajustes públicos', async () => {
    const { srv, call } = await testServer();
    close = srv.close;
    const s = await setupAdmin(call);
    const bid = s.memberships[0]!.businessId;
    const put = await call('PUT', `/api/v1/b/${bid}/providers/resend`, { config: { apiKey: 're_1234567890abc', from: 'Luna <citas@luna.es>' } }, s.accessToken);
    expect(put.status).toBe(200);
    const get = await call('GET', `/api/v1/b/${bid}/providers`, undefined, s.accessToken);
    const resend = get.json.providers.find((p: { kind: string }) => p.kind === 'resend');
    expect(resend.config.apiKey).toBe('••••••••');
    // Guardar con el valor enmascarado conserva el secreto
    expect((await call('PUT', `/api/v1/b/${bid}/providers/resend`, { config: { ...resend.config, from: 'otro@luna.es' } }, s.accessToken)).status).toBe(200);
    const raw = await srv.app.sys.getProvider(bid, 'resend');
    expect(raw!.config).not.toContain('re_1234567890abc');

    const b = await call('POST', `/api/v1/b/${bid}/backups`, {}, s.accessToken);
    expect(b.json.name).toMatch(/\.astrocitas$/);
    expect((await call('GET', `/api/v1/b/${bid}/backups`, undefined, s.accessToken)).json.backups).toHaveLength(1);
    const pub = await call('GET', `/api/v1/b/${bid}/public`, undefined, s.accessToken);
    expect(pub.json.slug).toBe('peluqueria-luna');
    expect(pub.json.widgetSnippet).toContain('widget.js');
  });

  it('administración: negocios y usuarios', async () => {
    const { srv, call } = await testServer();
    close = srv.close;
    const s = await setupAdmin(call);
    const nb = await call('POST', '/api/v1/admin/businesses', { name: 'Barbería Orión', ownerEmail: 'leo@orion.es' }, s.accessToken);
    expect(nb.json.tempPassword).toBeTruthy();
    const users = await call('GET', '/api/v1/admin/users', undefined, s.accessToken);
    expect(users.json.users).toHaveLength(2);
    const leo = users.json.users.find((u: { email: string }) => u.email === 'leo@orion.es');
    const leoTok = (await call('POST', '/api/v1/auth/login', { email: 'leo@orion.es', password: nb.json.tempPassword })).json.accessToken;
    expect((await call('GET', '/api/v1/admin/users', undefined, leoTok)).status).toBe(403);
    expect((await call('GET', `/api/v1/b/${s.memberships[0]!.businessId}/members`, undefined, leoTok)).status).toBe(404);
    await call('PATCH', `/api/v1/admin/users/${leo.id}`, { disabled: true }, s.accessToken);
    expect((await call('GET', '/api/v1/me', undefined, leoTok)).status).toBe(401);
  });

  it('comparación de versiones', () => {
    expect(newer('0.2.0', '0.1.9')).toBe(true);
    expect(newer('0.1.0', '0.1.0')).toBe(false);
    expect(newer('1.0.0', '0.9.9')).toBe(true);
  });
});
