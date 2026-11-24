import type { z } from 'zod';
import * as S from '../types';
import type { Appointment, Business, Client, EntityName, Input, MessageTemplate, OutboxMessage, ReminderRule, Service, Staff, TimeOff, WaitlistEntry } from '../types';
import {
  ConflictError,
  ValidationError,
  type AppointmentQuery,
  type ClientStats,
  type DataAdapter,
  type SaveOptions,
  type SeriesResult,
} from '../adapter';
import { findConflicts, type Conflict } from '../slots';
import { expandRecurrence, type RecurrenceRule } from '../recurrence';
import { BACKUP_FORMAT, BACKUP_VERSION, isBackupFile, type BackupFile } from '../backup';
import { SerialDb, type SqlDriver, type SqlValue } from './driver';
import { migrate, SCHEMA_VERSION } from './migrations';
import { entityToParams, rowToEntity, TABLES, upsertSql } from './tables';

export interface SqlAdapterOptions {
  now?: () => number;
  newId?: () => string;
  /**
   * Registro de cambios por campo (sincronización). Se ejecuta en la MISMA transacción que la escritura,
   * con el driver de esa transacción. No se llama para cambios aplicados desde otro dispositivo (applyRow).
   */
  onChange?: ChangeHook;
}

export type ChangeHook = (entity: EntityName, id: string, fields: Record<string, unknown>, tx: SqlDriver) => Promise<void>;

/** Campos que cambian entre dos versiones de una fila (sin el id). */
export function diffFields(entity: EntityName, before: Record<string, unknown> | null, after: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of TABLES[entity].cols) {
    if (c.field === 'id') continue;
    const a = after[c.field] ?? null;
    if (!before || JSON.stringify(before[c.field] ?? null) !== JSON.stringify(a)) out[c.field] = a;
  }
  return out;
}

const SCHEMAS: Record<EntityName, z.ZodType> = {
  business: S.Business,
  staff: S.Staff,
  services: S.Service,
  clients: S.Client,
  timeOff: S.TimeOff,
  appointments: S.Appointment,
  waitlist: S.WaitlistEntry,
  templates: S.MessageTemplate,
  reminderRules: S.ReminderRule,
  messages: S.OutboxMessage,
};

/** Orden de inserción que respeta claves foráneas. */
export const ENTITY_ORDER: EntityName[] = ['business', 'staff', 'services', 'clients', 'timeOff', 'appointments', 'waitlist', 'templates', 'reminderRules', 'messages'];

function parseOrThrow<T>(schema: z.ZodType, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new ValidationError(r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data as T;
}

/**
 * Implementación de DataAdapter sobre SQLite. Es el corazón del modo LOCAL y la reutiliza
 * el servidor autohospedado cuando usa SQLite: misma lógica, mismo esquema, mismas validaciones.
 */
export class SqlAdapter implements DataAdapter {
  readonly mode = 'local' as const;
  readonly db: SerialDb;
  private now: () => number;
  private newId: () => string;
  private hook?: ChangeHook;

  private constructor(driver: SqlDriver, opts: SqlAdapterOptions) {
    this.db = new SerialDb(driver);
    this.now = opts.now ?? Date.now;
    this.newId = opts.newId ?? (() => crypto.randomUUID());
    this.hook = opts.onChange;
  }

  static async open(driver: SqlDriver, opts: SqlAdapterOptions = {}): Promise<SqlAdapter> {
    const a = new SqlAdapter(driver, opts);
    if (a.db.dialect === 'sqlite') await a.db.exec('PRAGMA foreign_keys = ON');
    await migrate(a.db);
    return a;
  }

  // ---------- genéricos ----------

  private nocase(col: string) {
    return this.db.dialect === 'postgres' ? `lower(${col})` : `${col} COLLATE NOCASE`;
  }
  private get like() {
    return this.db.dialect === 'postgres' ? 'ILIKE' : 'LIKE';
  }

  private async listAll<T>(entity: EntityName, where = 'deleted_at IS NULL', params: SqlValue[] = [], order = ''): Promise<T[]> {
    const rows = await this.db.all(`SELECT * FROM ${TABLES[entity].table} WHERE ${where} ${order}`, params);
    return rows.map((r) => rowToEntity<T>(entity, r));
  }

  private async getById<T>(entity: EntityName, id: string): Promise<T | null> {
    const row = await this.db.get(`SELECT * FROM ${TABLES[entity].table} WHERE id = ?`, [id]);
    return row ? rowToEntity<T>(entity, row) : null;
  }

  /** Completa marcas de tiempo, valida con Zod y hace upsert. */
  private async prepare<T extends { id: string }>(entity: EntityName, input: Record<string, unknown>): Promise<T> {
    const now = this.now();
    const existing = input.id ? await this.getById<Record<string, unknown>>(entity, input.id as string) : null;
    const merged = {
      ...(existing ?? {}),
      ...input,
      id: (input.id as string) ?? this.newId(),
      createdAt: (existing?.createdAt as number) ?? now,
      updatedAt: now,
      deletedAt: (input.deletedAt as number | null | undefined) ?? null,
    };
    return parseOrThrow<T>(SCHEMAS[entity], merged);
  }

  private async write(entity: EntityName, value: Record<string, unknown>, tx?: SqlDriver, opts: { track?: boolean } = {}) {
    const sql = upsertSql(entity);
    const params = entityToParams(entity, value);
    const track = !!this.hook && opts.track !== false;
    const run = async (d: SqlDriver) => {
      const before = track ? ((await d.all(`SELECT * FROM ${TABLES[entity].table} WHERE id = ?`, [value.id as string]))[0] ?? null) : null;
      await d.run(sql, params);
      if (track) {
        const fields = diffFields(entity, before ? rowToEntity<Record<string, unknown>>(entity, before) : null, value);
        if (Object.keys(fields).length) await this.hook!(entity, value.id as string, fields, d);
      }
    };
    try {
      if (tx) await run(tx);
      else if (track) await this.db.transaction(run);
      else await this.db.run(sql, params);
    } catch (e) {
      if (String((e as Error)?.message ?? e).includes('ASTRO_OVERLAP')) {
        throw new ConflictError([{ kind: 'overlap', level: 'error' }]);
      }
      throw e;
    }
  }

  /** Lee una fila aunque esté borrada (para sincronización). */
  async getRow(entity: EntityName, id: string, tx?: SqlDriver): Promise<Record<string, unknown> | null> {
    const sql = `SELECT * FROM ${TABLES[entity].table} WHERE id = ?`;
    const rows = tx ? await tx.all(sql, [id]) : await this.db.all(sql, [id]);
    return rows[0] ? rowToEntity<Record<string, unknown>>(entity, rows[0]) : null;
  }

  /** Aplica una fila llegada de otro dispositivo: valida, escribe y NO la vuelve a registrar como cambio local. */
  async applyRow(entity: EntityName, row: Record<string, unknown>, tx?: SqlDriver): Promise<void> {
    const value = parseOrThrow<Record<string, unknown>>(SCHEMAS[entity], row);
    await this.write(entity, value, tx, { track: false });
  }

  private async save<T extends { id: string }>(entity: EntityName, input: Record<string, unknown>): Promise<T> {
    const value = await this.prepare<T>(entity, input);
    await this.write(entity, value as unknown as Record<string, unknown>);
    return value;
  }

  // ---------- negocio ----------

  async getBusiness(): Promise<Business | null> {
    const list = await this.listAll<Business>('business', 'deleted_at IS NULL', [], 'ORDER BY created_at LIMIT 1');
    return list[0] ?? null;
  }

  async saveBusiness(input: Input<typeof S.Business>): Promise<Business> {
    const current = await this.getBusiness();
    return this.save<Business>('business', { ...input, id: input.id ?? current?.id });
  }

  // ---------- profesionales y servicios ----------

  listStaff(opts: { includeInactive?: boolean } = {}): Promise<Staff[]> {
    return this.listAll<Staff>(
      'staff',
      opts.includeInactive ? 'deleted_at IS NULL' : 'deleted_at IS NULL AND active = 1',
      [],
      `ORDER BY sort, ${this.nocase('name')}`,
    );
  }
  saveStaff(input: Input<typeof S.Staff>) {
    return this.save<Staff>('staff', input);
  }

  listServices(opts: { includeInactive?: boolean } = {}): Promise<Service[]> {
    return this.listAll<Service>(
      'services',
      opts.includeInactive ? 'deleted_at IS NULL' : 'deleted_at IS NULL AND active = 1',
      [],
      `ORDER BY sort, category, ${this.nocase('name')}`,
    );
  }
  saveService(input: Input<typeof S.Service>) {
    return this.save<Service>('services', input);
  }

  // ---------- clientes ----------

  async listClients(opts: { search?: string; limit?: number } = {}): Promise<Client[]> {
    const limit = opts.limit ?? 500;
    const q = opts.search?.trim();
    if (!q) return this.listAll<Client>('clients', 'deleted_at IS NULL', [], `ORDER BY ${this.nocase('name')} LIMIT ${limit}`);
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const digits = q.replace(/\D/g, '');
    const rows = await this.db.all(
      `SELECT * FROM clients WHERE deleted_at IS NULL AND (name ${this.like} ? OR email ${this.like} ? OR tags ${this.like} ?${
        digits.length >= 3 ? " OR REPLACE(REPLACE(phone, ' ', ''), '+', '') LIKE ?" : ''
      }) ORDER BY ${this.nocase('name')} LIMIT ${limit}`,
      digits.length >= 3 ? [like, like, like, `%${digits}%`] : [like, like, like],
    );
    return rows.map((r) => rowToEntity<Client>('clients', r));
  }
  getClient(id: string) {
    return this.getById<Client>('clients', id);
  }
  saveClient(input: Input<typeof S.Client>) {
    return this.save<Client>('clients', input);
  }

  async clientStats(id: string): Promise<ClientStats> {
    const now = this.now();
    const r = await this.db.get<Record<string, number | null>>(
      `SELECT
        SUM(CASE WHEN status IN ('completed','booked','confirmed') AND starts_at < ? THEN 1 ELSE 0 END) AS visits,
        SUM(CASE WHEN status IN ('booked','confirmed') AND starts_at >= ? THEN 1 ELSE 0 END) AS upcoming,
        SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) AS no_shows,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancellations,
        SUM(CASE WHEN status <> 'cancelled' THEN paid_cents ELSE 0 END) AS spent,
        MAX(CASE WHEN status IN ('completed','booked','confirmed') AND starts_at < ? THEN starts_at END) AS last_visit,
        MIN(CASE WHEN status IN ('booked','confirmed') AND starts_at >= ? THEN starts_at END) AS next_visit
      FROM appointments WHERE client_id = ? AND deleted_at IS NULL`,
      [now, now, now, now, id],
    );
    return {
      visits: Number(r?.visits ?? 0),
      upcoming: Number(r?.upcoming ?? 0),
      noShows: Number(r?.no_shows ?? 0),
      cancellations: Number(r?.cancellations ?? 0),
      totalSpentCents: Number(r?.spent ?? 0),
      lastVisitAt: r?.last_visit != null ? Number(r.last_visit) : null,
      nextVisitAt: r?.next_visit != null ? Number(r.next_visit) : null,
    };
  }

  // ---------- ausencias ----------

  listTimeOff(range: { from: number; to: number }): Promise<TimeOff[]> {
    return this.listAll<TimeOff>(
      'timeOff',
      'deleted_at IS NULL AND starts_at < ? AND ends_at > ?',
      [range.to, range.from],
      'ORDER BY starts_at',
    );
  }
  saveTimeOff(input: Input<typeof S.TimeOff>) {
    return this.save<TimeOff>('timeOff', input);
  }

  // ---------- citas ----------

  listAppointments(q: AppointmentQuery): Promise<Appointment[]> {
    const where = ['deleted_at IS NULL', 'starts_at < ?', 'ends_at > ?'];
    const params: (string | number)[] = [q.to, q.from];
    if (q.staffId) {
      where.push('staff_id = ?');
      params.push(q.staffId);
    }
    if (q.clientId) {
      where.push('client_id = ?');
      params.push(q.clientId);
    }
    if (!q.includeCancelled) where.push(`status <> 'cancelled'`);
    return this.listAll<Appointment>('appointments', where.join(' AND '), params, 'ORDER BY starts_at');
  }

  async listClientAppointments(clientId: string): Promise<Appointment[]> {
    return this.listAll<Appointment>(
      'appointments',
      'deleted_at IS NULL AND client_id = ?',
      [clientId],
      'ORDER BY starts_at DESC',
    );
  }

  getAppointment(id: string) {
    return this.getById<Appointment>('appointments', id);
  }

  private async conflictsFor(a: Appointment): Promise<Conflict[]> {
    const business = await this.getBusiness();
    const tz = business?.timezone ?? 'Europe/Madrid';
    const margin = 24 * 3600_000;
    const [appointments, timeOff, staff] = await Promise.all([
      this.listAppointments({ from: a.startsAt - margin, to: a.endsAt + margin, staffId: a.staffId }),
      this.listTimeOff({ from: a.startsAt, to: a.endsAt }),
      this.getById<Staff>('staff', a.staffId),
    ]);
    return findConflicts(a, { staff: staff ?? undefined, appointments, timeOff, timezone: tz });
  }

  async checkAppointment(input: Input<typeof S.Appointment>): Promise<Conflict[]> {
    const a = await this.prepare<Appointment>('appointments', input);
    return this.conflictsFor(a);
  }

  async saveAppointment(input: Input<typeof S.Appointment>, opts: SaveOptions = {}): Promise<Appointment> {
    const a = await this.prepare<Appointment>('appointments', input);
    const conflicts = await this.conflictsFor(a);
    if (conflicts.some((c) => c.level === 'error') || (!opts.force && conflicts.length)) {
      throw new ConflictError(conflicts);
    }
    await this.write('appointments', a as unknown as Record<string, unknown>);
    return a;
  }

  async createSeries(
    input: Input<typeof S.Appointment>,
    rule: RecurrenceRule,
    opts: SaveOptions = {},
  ): Promise<SeriesResult> {
    const business = await this.getBusiness();
    const tz = business?.timezone ?? 'Europe/Madrid';
    const duration = input.endsAt - input.startsAt;
    const seriesId = this.newId();
    const result: SeriesResult = { created: [], skipped: [] };
    for (const start of expandRecurrence(input.startsAt, rule, tz)) {
      try {
        const a = await this.saveAppointment(
          { ...input, id: undefined, seriesId, startsAt: start, endsAt: start + duration },
          opts,
        );
        result.created.push(a);
      } catch (e) {
        if (e instanceof ConflictError) result.skipped.push({ startsAt: start, conflicts: e.conflicts });
        else throw e;
      }
    }
    return result;
  }

  // ---------- lista de espera ----------

  listWaitlist(): Promise<WaitlistEntry[]> {
    return this.listAll<WaitlistEntry>('waitlist', `deleted_at IS NULL AND status = 'waiting'`, [], 'ORDER BY created_at');
  }
  saveWaitlist(input: Input<typeof S.WaitlistEntry>) {
    return this.save<WaitlistEntry>('waitlist', input);
  }

  // ---------- mensajería ----------

  listTemplates(): Promise<MessageTemplate[]> {
    return this.listAll<MessageTemplate>('templates', 'deleted_at IS NULL', [], 'ORDER BY kind, channel');
  }
  saveTemplate(input: Input<typeof S.MessageTemplate>) {
    return this.save<MessageTemplate>('templates', input);
  }
  listReminderRules(): Promise<ReminderRule[]> {
    return this.listAll<ReminderRule>('reminderRules', 'deleted_at IS NULL', [], 'ORDER BY anchor, offset_min DESC');
  }
  saveReminderRule(input: Input<typeof S.ReminderRule>) {
    return this.save<ReminderRule>('reminderRules', input);
  }
  async listMessages(q: { appointmentIds?: string[]; clientId?: string; since?: number; status?: OutboxMessage['status'][]; limit?: number } = {}): Promise<OutboxMessage[]> {
    const where = ['deleted_at IS NULL'];
    const params: SqlValue[] = [];
    if (q.appointmentIds) {
      if (!q.appointmentIds.length) return [];
      where.push(`appointment_id IN (${q.appointmentIds.map(() => '?').join(',')})`);
      params.push(...q.appointmentIds);
    }
    if (q.clientId) {
      where.push('client_id = ?');
      params.push(q.clientId);
    }
    if (q.since !== undefined) {
      where.push('created_at >= ?');
      params.push(q.since);
    }
    if (q.status?.length) {
      where.push(`status IN (${q.status.map(() => '?').join(',')})`);
      params.push(...q.status);
    }
    return this.listAll<OutboxMessage>('messages', where.join(' AND '), params, `ORDER BY created_at DESC LIMIT ${q.limit ?? 1000}`);
  }
  saveMessage(input: Input<typeof S.OutboxMessage>) {
    return this.save<OutboxMessage>('messages', input);
  }

  async getMeta<T = unknown>(key: string): Promise<T | null> {
    const row = await this.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
    return row ? (JSON.parse(row.value) as T) : null;
  }
  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
  }

  // ---------- borrado / deshacer ----------

  async remove(entity: EntityName, id: string): Promise<void> {
    const row = await this.getRow(entity, id);
    if (!row || row.deletedAt) return;
    const now = this.now();
    await this.write(entity, { ...row, deletedAt: now, updatedAt: now });
  }

  async restore(entity: EntityName, id: string): Promise<void> {
    const row = await this.getRow(entity, id);
    if (!row || !row.deletedAt) return;
    await this.write(entity, { ...row, deletedAt: null, updatedAt: this.now() });
  }

  // ---------- exportar / importar ----------

  async exportAll(): Promise<BackupFile> {
    const data = {} as BackupFile['data'];
    for (const e of ENTITY_ORDER) {
      (data as Record<string, unknown[]>)[e] = await this.listAll(e, '1 = 1', [], 'ORDER BY created_at');
    }
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: this.now(),
      app: 'AstroCitas',
      data,
    };
  }

  /**
   * `track: false` = no registrar como cambios locales (instantánea de sincronización). Solo afecta a las
   * escrituras de esta importación, nunca a lo que el usuario guarde a la vez.
   */
  async importAll(file: BackupFile, opts: { mode: 'replace' | 'merge'; track?: boolean } = { mode: 'replace' }): Promise<void> {
    if (!isBackupFile(file)) throw new Error('El archivo no es una copia de AstroCitas válida');
    if (file.version > BACKUP_VERSION) throw new Error('La copia es de una versión más nueva de AstroCitas');
    // Validar todo antes de tocar la base de datos.
    const parsed: [EntityName, Record<string, unknown>][] = [];
    for (const e of ENTITY_ORDER) {
      for (const item of (file.data as Record<string, unknown[]>)[e] ?? []) {
        parsed.push([e, parseOrThrow(SCHEMAS[e], item)]);
      }
    }
    await this.db.transaction(async (tx) => {
      if (opts.mode === 'replace') {
        for (const e of [...ENTITY_ORDER].reverse()) await tx.exec(`DELETE FROM ${TABLES[e].table}`);
      }
      for (const [e, v] of parsed) {
        if (opts.mode === 'merge') {
          const cur = await tx.all<{ updated_at: number }>(`SELECT updated_at FROM ${TABLES[e].table} WHERE id = ?`, [
            v.id as string,
          ]);
          if (cur[0] && Number(cur[0].updated_at) >= (v.updatedAt as number)) continue;
        }
        await this.write(e, v, tx, { track: opts.track });
      }
    });
  }

  async wipe(): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const e of [...ENTITY_ORDER].reverse()) await tx.exec(`DELETE FROM ${TABLES[e].table}`);
    });
  }
}
