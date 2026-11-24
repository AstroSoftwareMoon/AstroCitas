import { describe, expect, it } from 'vitest';
import { SqlAdapter } from '../src/sql';
import { nodeSqliteDriver } from '../src/testing/node-sqlite-driver';
import { decodeHlc, encodeHlc, Hlc, outboxHook, serverAcceptPush, serverCursor, serverLogHook, serverPull, SyncEngine, type SyncTransport } from '../src/sync';
import { defaultHours } from '../src/presets';
import { localToUtc } from '../src/time';

const at = (h: number, m = 0) => localToUtc('2026-11-16', h * 60 + m, 'Europe/Madrid');

describe('HLC', () => {
  it('codifica ordenable y es monótono aunque el reloj retroceda', () => {
    let t = 1000;
    const h = new Hlc('a', () => t);
    const a = h.tick();
    t = 500; // el reloj del sistema retrocede
    const b = h.tick();
    expect(b > a).toBe(true);
    expect(decodeHlc(b)).toMatchObject({ wall: 1000, counter: 1, node: 'a' });
  });
  it('al recibir un HLC remoto del futuro, los siguientes son mayores', () => {
    const h = new Hlc('a', () => 1000);
    const remote = encodeHlc(5000, 3, 'b');
    h.receive(remote);
    expect(h.tick() > remote).toBe(true);
  });
});

async function world() {
  const serverHlc = new Hlc('server');
  const server = await SqlAdapter.open(nodeSqliteDriver(), { onChange: serverLogHook(serverHlc) });
  const transport: SyncTransport = {
    push: (device, changes) => serverAcceptPush(server, changes, device, serverHlc),
    pull: (device, since) => serverPull(server, since, device),
    snapshot: async () => {
      const cursor = await serverCursor(server);
      return { dump: await server.exportAll(), cursor, hlc: serverHlc.tick() };
    },
  };
  let online = true;
  const flaky: SyncTransport = {
    push: (...a) => (online ? transport.push(...a) : Promise.reject(new TypeError('Failed to fetch'))),
    pull: (...a) => (online ? transport.pull(...a) : Promise.reject(new TypeError('Failed to fetch'))),
    snapshot: () => (online ? transport.snapshot() : Promise.reject(new TypeError('Failed to fetch'))),
  };
  const device = async (name: string) => {
    const hlc = new Hlc(name);
    const db = await SqlAdapter.open(nodeSqliteDriver(), { onChange: outboxHook(hlc) });
    return { db, engine: new SyncEngine(db, hlc, flaky, name) };
  };
  // Datos iniciales en el servidor (p. ej. migrados desde el modo local)
  await server.saveBusiness({ name: 'Luna' });
  const ana = await server.saveStaff({ name: 'Ana', hours: defaultHours() });
  const svc = await server.saveService({ name: 'Corte', durationMin: 30 });
  const cli = await server.saveClient({ name: 'Lucía', phone: '600' });
  return { server, device, ana, svc, cli, setOnline: (v: boolean) => (online = v) };
}

describe('sincronización', () => {
  it('instantánea inicial + cambios en ambos sentidos', async () => {
    const w = await world();
    const a = await w.device('movil');
    const b = await w.device('pc');
    await a.engine.sync();
    await b.engine.sync();
    expect((await a.db.listClients()).map((c) => c.name)).toEqual(['Lucía']);
    expect(await a.engine.pendingCount()).toBe(0);

    // El móvil crea una cita; el PC la recibe
    await a.db.saveAppointment({ staffId: w.ana.id, serviceId: w.svc.id, clientId: w.cli.id, startsAt: at(10), endsAt: at(10, 30) });
    expect(await a.engine.pendingCount()).toBeGreaterThan(0);
    await a.engine.sync();
    await b.engine.sync();
    expect(await b.db.listAppointments({ from: at(0), to: at(23) })).toHaveLength(1);
    expect(await w.server.listAppointments({ from: at(0), to: at(23) })).toHaveLength(1);

    // Cambios del servidor (p. ej. reserva online por RPC) llegan a los dispositivos
    await w.server.saveClient({ name: 'Mateo' });
    await a.engine.sync();
    expect((await a.db.listClients()).map((c) => c.name).sort()).toEqual(['Lucía', 'Mateo']);
  });

  it('LWW por campo: ediciones offline de campos distintos se combinan', async () => {
    const w = await world();
    const a = await w.device('movil');
    const b = await w.device('pc');
    await a.engine.sync();
    await b.engine.sync();
    const ca = (await a.db.getClient(w.cli.id))!;
    const cb = (await b.db.getClient(w.cli.id))!;
    await a.db.saveClient({ ...ca, phone: '611 222 333' });
    await b.db.saveClient({ ...cb, notes: 'Alergia al tinte' });
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();
    for (const d of [a, b]) {
      const c = (await d.db.getClient(w.cli.id))!;
      expect(c.phone).toBe('611 222 333');
      expect(c.notes).toBe('Alergia al tinte');
    }
    expect((await w.server.getClient(w.cli.id))!).toMatchObject({ phone: '611 222 333', notes: 'Alergia al tinte' });
  });

  it('mismo campo: gana el cambio más reciente (HLC)', async () => {
    const w = await world();
    const a = await w.device('movil');
    const b = await w.device('pc');
    await a.engine.sync();
    await b.engine.sync();
    await a.db.saveClient({ ...(await a.db.getClient(w.cli.id))!, name: 'Lucía G.' });
    await new Promise((r) => setTimeout(r, 5));
    await b.db.saveClient({ ...(await b.db.getClient(w.cli.id))!, name: 'Lucía García' });
    await b.engine.sync();
    await a.engine.sync();
    await b.engine.sync();
    expect((await a.db.getClient(w.cli.id))!.name).toBe('Lucía García');
    expect((await b.db.getClient(w.cli.id))!.name).toBe('Lucía García');
  });

  it('sin conexión: la cola espera y se envía al volver', async () => {
    const w = await world();
    const a = await w.device('movil');
    await a.engine.sync();
    w.setOnline(false);
    await a.db.saveClient({ name: 'Offline' });
    await a.engine.sync();
    expect(a.engine.status.state).toBe('offline');
    expect(a.engine.status.pending).toBeGreaterThan(0);
    w.setOnline(true);
    await a.engine.sync();
    expect(a.engine.status.state).toBe('idle');
    expect((await w.server.listClients()).map((c) => c.name)).toContain('Offline');
  });

  it('doble reserva offline: el servidor rechaza la segunda y el dispositivo adopta su estado', async () => {
    const w = await world();
    const a = await w.device('movil');
    const b = await w.device('pc');
    await a.engine.sync();
    await b.engine.sync();
    // Ambos reservan el mismo hueco sin conexión
    await a.db.saveAppointment({ staffId: w.ana.id, serviceId: w.svc.id, startsAt: at(11), endsAt: at(11, 30), notes: 'A' });
    const bAppt = await b.db.saveAppointment({ staffId: w.ana.id, serviceId: w.svc.id, startsAt: at(11), endsAt: at(11, 30), notes: 'B' });
    await a.engine.sync();
    await b.engine.sync();
    // El servidor solo tiene una
    const srv = await w.server.listAppointments({ from: at(0), to: at(23) });
    expect(srv.map((x) => x.notes)).toEqual(['A']);
    // El PC ha descartado la suya, ha recibido la del móvil y registra el conflicto
    const local = await b.db.listAppointments({ from: at(0), to: at(23) });
    expect(local.map((x) => x.notes)).toEqual(['A']);
    expect((await b.db.getRow('appointments', bAppt.id))!.deletedAt).not.toBeNull();
    const conflicts = await b.engine.conflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.reason).toBe('overlap');
    expect(b.engine.status.conflicts).toBe(1);
  });

  it('borrados se propagan (tombstones) y deshacer también', async () => {
    const w = await world();
    const a = await w.device('movil');
    const b = await w.device('pc');
    await a.engine.sync();
    await b.engine.sync();
    await a.db.remove('clients', w.cli.id);
    await a.engine.sync();
    await b.engine.sync();
    expect(await b.db.listClients()).toHaveLength(0);
    await b.db.restore('clients', w.cli.id);
    await b.engine.sync();
    await a.engine.sync();
    expect(await a.db.listClients()).toHaveLength(1);
  });
});

describe('motor: cambios durante una sincronización', () => {
  it('un cambio guardado mientras sincroniza se envía en la pasada encadenada', async () => {
    const w = await world();
    const a = await w.device('movil');
    await a.engine.sync();
    const first = a.engine.sync(); // pasada en curso
    await a.db.saveClient({ name: 'Durante' });
    const second = a.engine.sync(); // se encadena
    await Promise.all([first, second]);
    expect(await a.engine.pendingCount()).toBe(0);
    expect((await w.server.listClients()).map((c) => c.name)).toContain('Durante');
  });
});

describe('motor: escrituras durante la instantánea inicial', () => {
  it('lo que el usuario guarda mientras se importa la instantánea sí se envía', async () => {
    const w = await world();
    const a = await w.device('movil');
    const first = a.engine.sync(); // instantánea en curso
    await a.db.saveClient({ name: 'Mientras importa' });
    await first;
    await a.engine.sync();
    expect((await w.server.listClients()).map((c) => c.name)).toContain('Mientras importa');
  });
});
