import { beforeEach, describe, expect, it } from 'vitest';
import { SqlAdapter } from '../src/sql';
import { nodeSqliteDriver } from '../src/testing/node-sqlite-driver';
import { ConflictError, ValidationError } from '../src/adapter';
import { defaultHours, setupBusiness } from '../src/presets';
import { localToUtc } from '../src/time';
import { parseCsv, toCsv } from '../src/backup';

const TZ = 'Europe/Madrid';
const MON = '2026-11-16';
const at = (h: number, m = 0) => localToUtc(MON, h * 60 + m, TZ);

let db: SqlAdapter;
let clock = at(8);
beforeEach(async () => {
  clock = at(8);
  db = await SqlAdapter.open(nodeSqliteDriver(), { now: () => clock++ });
});

async function base() {
  await db.saveBusiness({ name: 'Peluquería Luna', kind: 'peluqueria' });
  const ana = await db.saveStaff({ name: 'Ana', hours: defaultHours() });
  const corte = await db.saveService({ name: 'Corte', durationMin: 30, priceCents: 1500, bufferAfterMin: 10 });
  const cli = await db.saveClient({ name: 'Lucía García', phone: '+34 600 111 222' });
  return { ana, corte, cli };
}

describe('SqlAdapter (modo local)', () => {
  it('migra, guarda y lee con valores por defecto', async () => {
    const { ana, corte } = await base();
    const b = await db.getBusiness();
    expect(b?.timezone).toBe('Europe/Madrid');
    expect(b?.settings.slotStep).toBe(15);
    expect((await db.listStaff())[0]).toMatchObject({ id: ana.id, active: true, hours: defaultHours() });
    expect((await db.listServices())[0]).toMatchObject({ id: corte.id, bufferAfterMin: 10, priceCents: 1500 });
  });

  it('valida con mensajes claros', async () => {
    await expect(db.saveService({ name: '', durationMin: 30 })).rejects.toBeInstanceOf(ValidationError);
    await expect(db.saveService({ name: 'X', durationMin: 0 })).rejects.toThrow(/durationMin/);
  });

  it('impide la doble reserva (lógica y trigger SQL)', async () => {
    const { ana, corte, cli } = await base();
    const a1 = await db.saveAppointment({ clientId: cli.id, staffId: ana.id, serviceId: corte.id, startsAt: at(10), endsAt: at(10, 30) });
    expect(a1.status).toBe('booked');
    const err = await db
      .saveAppointment({ staffId: ana.id, serviceId: corte.id, startsAt: at(10, 15), endsAt: at(10, 45) }, { force: true })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.conflicts[0].kind).toBe('overlap');

    // Aunque alguien salte la lógica, el trigger lo bloquea.
    await expect(
      db.db.run(
        `INSERT INTO appointments (id, staff_id, service_id, starts_at, ends_at, created_at, updated_at) VALUES ('x', ?, ?, ?, ?, 0, 0)`,
        [ana.id, corte.id, at(10, 10), at(10, 20)],
      ),
    ).rejects.toThrow(/ASTRO_OVERLAP/);
  });

  it('avisos (buffer / fuera de horario) se pueden forzar', async () => {
    const { ana, corte } = await base();
    await db.saveAppointment({ staffId: ana.id, serviceId: corte.id, startsAt: at(10), endsAt: at(10, 30), bufferAfterMin: 10 });
    const p = { staffId: ana.id, serviceId: corte.id, startsAt: at(10, 30), endsAt: at(11) };
    expect((await db.checkAppointment(p)).map((c) => c.kind)).toEqual(['buffer']);
    await expect(db.saveAppointment(p)).rejects.toBeInstanceOf(ConflictError);
    await expect(db.saveAppointment(p, { force: true })).resolves.toMatchObject({ startsAt: at(10, 30) });
    const late = { staffId: ana.id, serviceId: corte.id, startsAt: at(22), endsAt: at(22, 30) };
    expect((await db.checkAppointment(late)).map((c) => c.kind)).toEqual(['outside_hours']);
  });

  it('cancelar libera el hueco y deshacer el borrado lo restaura', async () => {
    const { ana, corte } = await base();
    const a = await db.saveAppointment({ staffId: ana.id, serviceId: corte.id, startsAt: at(10), endsAt: at(10, 30) });
    await db.saveAppointment({ ...a, status: 'cancelled' });
    const b = await db.saveAppointment({ staffId: ana.id, serviceId: corte.id, startsAt: at(10), endsAt: at(10, 30) });
    await db.remove('appointments', b.id);
    expect(await db.listAppointments({ from: at(0), to: at(23) })).toHaveLength(0);
    await db.restore('appointments', b.id);
    expect(await db.listAppointments({ from: at(0), to: at(23) })).toHaveLength(1);
    expect(await db.listAppointments({ from: at(0), to: at(23), includeCancelled: true })).toHaveLength(2);
  });

  it('crea series recurrentes saltando conflictos', async () => {
    const { ana, corte } = await base();
    // ocupa el lunes dentro de 2 semanas
    await db.saveAppointment({ staffId: ana.id, serviceId: corte.id, startsAt: localToUtc('2026-11-30', 600, TZ), endsAt: localToUtc('2026-11-30', 630, TZ) });
    const r = await db.createSeries({ staffId: ana.id, serviceId: corte.id, startsAt: at(10), endsAt: at(10, 30) }, { freq: 'weekly', interval: 1, count: 4 });
    expect(r.created).toHaveLength(3);
    expect(r.skipped).toHaveLength(1);
    expect(new Set(r.created.map((a) => a.seriesId)).size).toBe(1);
  });

  it('busca clientes por nombre, teléfono y etiqueta; calcula estadísticas', async () => {
    const { ana, corte, cli } = await base();
    await db.saveClient({ name: 'Mateo López', tags: ['VIP'] });
    expect((await db.listClients({ search: 'luc' })).map((c) => c.name)).toEqual(['Lucía García']);
    expect((await db.listClients({ search: '600111' })).map((c) => c.name)).toEqual(['Lucía García']);
    expect((await db.listClients({ search: 'vip' })).map((c) => c.name)).toEqual(['Mateo López']);

    await db.saveAppointment({ clientId: cli.id, staffId: ana.id, serviceId: corte.id, startsAt: at(7), endsAt: at(7, 30), status: 'completed', paidCents: 1500 }, { force: true });
    await db.saveAppointment({ clientId: cli.id, staffId: ana.id, serviceId: corte.id, startsAt: at(6), endsAt: at(6, 30), status: 'no_show' }, { force: true });
    await db.saveAppointment({ clientId: cli.id, staffId: ana.id, serviceId: corte.id, startsAt: at(12), endsAt: at(12, 30) });
    const s = await db.clientStats(cli.id);
    expect(s).toMatchObject({ visits: 1, noShows: 1, upcoming: 1, totalSpentCents: 1500, lastVisitAt: at(7), nextVisitAt: at(12) });
  });

  it('exporta e importa sin perder datos (replace y merge)', async () => {
    await setupBusiness(db, { name: 'Demo', kind: 'barberia', withDemo: true, now: at(12) });
    const dump = await db.exportAll();
    expect(dump.data.appointments.length).toBeGreaterThan(20);

    const other = await SqlAdapter.open(nodeSqliteDriver());
    await other.importAll(JSON.parse(JSON.stringify(dump)));
    const again = await other.exportAll();
    expect(again.data).toEqual(dump.data);

    // merge: gana la versión más reciente
    const c = dump.data.clients[0]!;
    await other.saveClient({ ...c, name: 'Nombre nuevo' });
    await other.importAll(dump, { mode: 'merge' });
    expect((await other.getClient(c.id))?.name).toBe('Nombre nuevo');
  });

  it('rechaza una copia inválida sin tocar los datos', async () => {
    await base();
    const dump = await db.exportAll();
    (dump.data.services[0] as { durationMin: number }).durationMin = -5;
    await expect(db.importAll(dump)).rejects.toBeInstanceOf(ValidationError);
    expect(await db.listServices()).toHaveLength(1);
  });
});

describe('CSV', () => {
  it('ida y vuelta con comillas, ; y saltos de línea', () => {
    const rows = [{ nombre: 'Ana; "la jefa"', notas: 'línea1\nlínea2', tel: '+34 600' }];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
  it('detecta separador coma', () => {
    expect(parseCsv('name,phone\nLuis,600\n')).toEqual([{ name: 'Luis', phone: '600' }]);
  });
});
