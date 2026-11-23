import { afterEach, describe, expect, it } from 'vitest';
import { defaultHours, Hlc, httpSyncTransport, localToUtc, outboxHook, ServerSession, SyncEngine, type StoredSession } from '@astrocitas/core';
import { SqlAdapter } from '@astrocitas/core/sql';
import { nodeSqliteDriver } from '@astrocitas/core/node';
import { setupAdmin, testServer } from './helpers';

const at = (h: number, m = 0) => localToUtc('2026-11-16', h * 60 + m, 'Europe/Madrid');
let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

for (const pg of [false, true]) {
  describe(`sincronización por HTTP (${pg ? 'PostgreSQL' : 'SQLite'})`, () => {
    it('dos dispositivos + cambios por RPC + doble reserva offline + permisos', async () => {
      const { srv, call } = await testServer({ pg });
      close = srv.close;
      const s = await setupAdmin(call);
      const bid = s.memberships[0]!.businessId;
      // fetch → fastify.inject (sin red)
      const fetchImpl = (async (url: string, init?: RequestInit) => {
        const u = new URL(url);
        const r = await srv.fastify.inject({ method: (init?.method ?? 'GET') as 'GET', url: u.pathname + u.search, payload: init?.body as string, headers: init?.headers as Record<string, string> });
        return new Response(r.body, { status: r.statusCode, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch;

      const device = async (name: string, email = 'admin@luna.es', password = 'una-contraseña-larga') => {
        let stored: StoredSession | null = null;
        const session = await ServerSession.login('http://srv.local', { email, password }, (st) => (stored = st), fetchImpl);
        void stored;
        const hlc = new Hlc(name);
        const db = await SqlAdapter.open(nodeSqliteDriver(), { onChange: outboxHook(hlc) });
        return { db, engine: new SyncEngine(db, hlc, httpSyncTransport(session), name) };
      };

      const rpc = (method: string, ...args: unknown[]) => call('POST', `/api/v1/b/${bid}/rpc`, { method, args }, s.accessToken).then((r) => r.json.result);
      const ana = await rpc('saveStaff', { name: 'Ana', hours: defaultHours() });
      const svc = await rpc('saveService', { name: 'Corte', durationMin: 30 });

      const a = await device('movil');
      const b = await device('pc');
      await a.engine.sync();
      await b.engine.sync();
      expect(a.engine.status.state).toBe('idle');
      expect((await a.db.listStaff()).map((x) => x.name)).toEqual(['Ana']);

      // Doble reserva sin conexión → solo una llega al servidor
      await a.db.saveAppointment({ staffId: ana.id, serviceId: svc.id, startsAt: at(10), endsAt: at(10, 30), notes: 'A' });
      await b.db.saveAppointment({ staffId: ana.id, serviceId: svc.id, startsAt: at(10), endsAt: at(10, 30), notes: 'B' });
      await a.engine.sync();
      await b.engine.sync();
      expect((await rpc('listAppointments', { from: at(0), to: at(23) })).map((x: { notes: string }) => x.notes)).toEqual(['A']);
      expect((await b.db.listAppointments({ from: at(0), to: at(23) })).map((x) => x.notes)).toEqual(['A']);
      expect(await b.engine.conflicts()).toHaveLength(1);

      // Un cambio hecho por la API (otro usuario / reserva online) llega a los dispositivos
      await rpc('saveClient', { name: 'Reserva online' });
      await a.engine.sync();
      expect((await a.db.listClients()).map((c) => c.name)).toContain('Reserva online');

      // Permisos: recepción no puede cambiar servicios ni por sincronización
      const rec = await call('POST', `/api/v1/b/${bid}/members`, { email: 'rec@luna.es', role: 'reception' }, s.accessToken);
      const r = await device('tablet-recepcion', 'rec@luna.es', rec.json.tempPassword);
      await r.engine.sync();
      const local = (await r.db.listServices())[0]!;
      await r.db.saveService({ ...local, priceCents: 1 });
      await r.engine.sync();
      expect((await rpc('listServices'))[0].priceCents).toBe(0);
      expect((await r.db.listServices())[0]!.priceCents).toBe(0);
      expect((await r.engine.conflicts())[0]!.reason).toBe('forbidden');
    });
  });
}
