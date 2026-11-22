import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgDriver, SqlAdapter, toPgParams } from '../src/sql';
import { ConflictError } from '../src/adapter';
import { defaultHours, setupBusiness } from '../src/presets';
import { localToUtc } from '../src/time';
import { nodeSqliteDriver } from '../src/testing/node-sqlite-driver';

const at = (h: number, m = 0) => localToUtc('2026-11-16', h * 60 + m, 'Europe/Madrid');

describe('PostgreSQL (mismo repositorio que SQLite)', () => {
  it('traduce parámetros sin tocar literales', () => {
    expect(toPgParams("SELECT * FROM t WHERE a = ? AND b = '?' AND c = ?")).toBe("SELECT * FROM t WHERE a = $1 AND b = '?' AND c = $2");
  });

  it('migra, guarda, busca, impide solapes y exporta en un esquema por negocio', async () => {
    const driver = pgDriver(new PGlite(), 'b_test1');
    await driver.init();
    const db = await SqlAdapter.open(driver);
    await db.saveBusiness({ name: 'Taller Orión', kind: 'taller' });
    const s = await db.saveStaff({ name: 'Raúl', hours: defaultHours() });
    const svc = await db.saveService({ name: 'Cambio de aceite', durationMin: 45 });
    await db.saveClient({ name: 'Lucía García', phone: '+34 600 111 222', tags: ['VIP'] });
    expect((await db.listClients({ search: 'LUC' })).map((c) => c.name)).toEqual(['Lucía García']);
    expect((await db.listClients({ search: '600111' })).length).toBe(1);

    await db.saveAppointment({ staffId: s.id, serviceId: svc.id, startsAt: at(10), endsAt: at(10, 45) });
    await expect(db.saveAppointment({ staffId: s.id, serviceId: svc.id, startsAt: at(10, 30), endsAt: at(11) }, { force: true })).rejects.toBeInstanceOf(
      ConflictError,
    );
    // El trigger de PostgreSQL bloquea aunque se salte la lógica.
    await expect(
      db.db.run('INSERT INTO appointments (id, staff_id, service_id, starts_at, ends_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0)', [
        'x',
        s.id,
        svc.id,
        at(10, 10),
        at(10, 20),
      ]),
    ).rejects.toThrow(/ASTRO_OVERLAP/);

    expect((await db.clientStats('nope')).visits).toBe(0);
    await db.setMeta('k', { a: 1 });
    expect(await db.getMeta('k')).toEqual({ a: 1 });
    const dump = await db.exportAll();
    expect(dump.data.appointments).toHaveLength(1);
    expect(typeof dump.data.appointments[0]!.startsAt).toBe('number');

    // Reabrir no repite migraciones
    const again = await SqlAdapter.open(driver);
    expect((await again.listStaff()).length).toBe(1);
  });

  it('importa una copia completa generada en SQLite', async () => {
    const lite = await SqlAdapter.open(nodeSqliteDriver());
    await setupBusiness(lite, { name: 'Demo', kind: 'barberia', withDemo: true, now: at(12) });
    const dump = await lite.exportAll();
    const d = pgDriver(new PGlite(), 'b_import');
    await d.init();
    const db = await SqlAdapter.open(d);
    await db.importAll(dump);
    const back = await db.exportAll();
    expect(back.data).toEqual(dump.data);
  }, 60_000);
});
