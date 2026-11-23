import type { SerialDb } from './driver';

/** SQLite → PostgreSQL para el DDL común: marcas de tiempo en BIGINT e índices sin COLLATE. */
function pgify(sql: string): string {
  return sql.replace(/\bINTEGER\b/g, 'BIGINT').replace(/\(name COLLATE NOCASE\)/g, '(lower(name))');
}

const SQLITE_OVERLAP_TRIGGERS = /* sql */ `
-- Prevención de doble reserva en el propio motor: ninguna cita activa puede solaparse
-- con otra del mismo profesional, venga de donde venga la escritura.
CREATE TRIGGER IF NOT EXISTS appointments_no_overlap_ins
BEFORE INSERT ON appointments
WHEN NEW.deleted_at IS NULL AND NEW.status IN ('booked','confirmed','completed')
BEGIN
  SELECT RAISE(ABORT, 'ASTRO_OVERLAP') WHERE EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.staff_id = NEW.staff_id AND a.id <> NEW.id AND a.deleted_at IS NULL
      AND a.status IN ('booked','confirmed','completed')
      AND a.starts_at < NEW.ends_at AND NEW.starts_at < a.ends_at);
END;
CREATE TRIGGER IF NOT EXISTS appointments_no_overlap_upd
BEFORE UPDATE ON appointments
WHEN NEW.deleted_at IS NULL AND NEW.status IN ('booked','confirmed','completed')
BEGIN
  SELECT RAISE(ABORT, 'ASTRO_OVERLAP') WHERE EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.staff_id = NEW.staff_id AND a.id <> NEW.id AND a.deleted_at IS NULL
      AND a.status IN ('booked','confirmed','completed')
      AND a.starts_at < NEW.ends_at AND NEW.starts_at < a.ends_at);
END;

`;

const PG_OVERLAP_TRIGGER = /* sql */ `
CREATE OR REPLACE FUNCTION astro_no_overlap() RETURNS trigger AS $$
BEGIN
  IF NEW.deleted_at IS NULL AND NEW.status IN ('booked','confirmed','completed') AND EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.staff_id = NEW.staff_id AND a.id <> NEW.id AND a.deleted_at IS NULL
      AND a.status IN ('booked','confirmed','completed')
      AND a.starts_at < NEW.ends_at AND NEW.starts_at < a.ends_at) THEN
    RAISE EXCEPTION 'ASTRO_OVERLAP';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS appointments_no_overlap ON appointments;
CREATE TRIGGER appointments_no_overlap BEFORE INSERT OR UPDATE ON appointments
FOR EACH ROW EXECUTE FUNCTION astro_no_overlap();
`;

/**
 * Migraciones versionadas (PRAGMA user_version). El MISMO esquema se usa en el dispositivo
 * (modo local) y en el servidor con SQLite (modo autohospedado). Nunca edites una migración
 * publicada: añade una nueva.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
  /** Extra solo SQLite / solo PostgreSQL. */
  sqlite?: string;
  postgres?: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'esquema inicial',
    sqlite: SQLITE_OVERLAP_TRIGGERS,
    postgres: PG_OVERLAP_TRIGGER,
    sql: /* sql */ `
CREATE TABLE IF NOT EXISTS business (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'otro',
  timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  currency TEXT NOT NULL DEFAULT 'EUR',
  locale TEXT NOT NULL DEFAULT 'es',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  hours TEXT NOT NULL DEFAULT '[]',
  service_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  duration_min INTEGER NOT NULL CHECK (duration_min > 0),
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  buffer_before_min INTEGER NOT NULL DEFAULT 0,
  buffer_after_min INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  birthday TEXT,
  notes TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  consent_reminders INTEGER NOT NULL DEFAULT 1,
  consent_marketing INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS clients_name ON clients(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS clients_phone ON clients(phone);

CREATE TABLE IF NOT EXISTS time_off (
  id TEXT PRIMARY KEY,
  staff_id TEXT REFERENCES staff(id),
  kind TEXT NOT NULL DEFAULT 'block',
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL CHECK (ends_at > starts_at),
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS time_off_range ON time_off(starts_at, ends_at);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id),
  staff_id TEXT NOT NULL REFERENCES staff(id),
  service_id TEXT NOT NULL REFERENCES services(id),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL CHECK (ends_at > starts_at),
  buffer_before_min INTEGER NOT NULL DEFAULT 0,
  buffer_after_min INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'booked'
    CHECK (status IN ('booked','confirmed','completed','cancelled','no_show')),
  price_cents INTEGER NOT NULL DEFAULT 0,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT,
  notes TEXT NOT NULL DEFAULT '',
  series_id TEXT,
  source TEXT NOT NULL DEFAULT 'staff',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS appointments_range ON appointments(starts_at, ends_at);
CREATE INDEX IF NOT EXISTS appointments_staff ON appointments(staff_id, starts_at);
CREATE INDEX IF NOT EXISTS appointments_client ON appointments(client_id, starts_at);

CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  service_id TEXT NOT NULL REFERENCES services(id),
  staff_id TEXT REFERENCES staff(id),
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'waiting',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    name: 'mensajería: plantillas, reglas de recordatorio y registro de envíos',
    sql: /* sql */ `
CREATE TABLE IF NOT EXISTS message_templates (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'any',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS reminder_rules (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  anchor TEXT NOT NULL DEFAULT 'before_start',
  offset_min INTEGER NOT NULL DEFAULT 1440,
  channels TEXT NOT NULL DEFAULT '["email"]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS outbox_messages (
  id TEXT PRIMARY KEY,
  appointment_id TEXT,
  client_id TEXT,
  rule_id TEXT,
  kind TEXT NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT NOT NULL DEFAULT '',
  provider_id TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE,
  sent_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS outbox_appointment ON outbox_messages(appointment_id, kind);
CREATE INDEX IF NOT EXISTS outbox_status ON outbox_messages(status, created_at);
`,
  },
  {
    version: 3,
    name: 'sincronización: relojes por campo, cola de salida, registro del servidor y conflictos',
    sql: /* sql */ `
CREATE TABLE IF NOT EXISTS sync_clocks (
  entity TEXT NOT NULL,
  row_id TEXT NOT NULL,
  field TEXT NOT NULL,
  hlc TEXT NOT NULL,
  PRIMARY KEY (entity, row_id, field)
);
CREATE TABLE IF NOT EXISTS sync_conflicts (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  row_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
`,
    // Cola local (cliente) y registro incremental (servidor) con secuencia autoincremental.
    sqlite: /* sql */ `
CREATE TABLE IF NOT EXISTS sync_outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL, row_id TEXT NOT NULL, field TEXT NOT NULL, value TEXT, hlc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL, row_id TEXT NOT NULL, field TEXT NOT NULL, value TEXT, hlc TEXT NOT NULL,
  device TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
);
`,
    postgres: /* sql */ `
CREATE TABLE IF NOT EXISTS sync_outbox (
  seq BIGSERIAL PRIMARY KEY,
  entity TEXT NOT NULL, row_id TEXT NOT NULL, field TEXT NOT NULL, value TEXT, hlc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_log (
  seq BIGSERIAL PRIMARY KEY,
  entity TEXT NOT NULL, row_id TEXT NOT NULL, field TEXT NOT NULL, value TEXT, hlc TEXT NOT NULL,
  device TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL
);
`,
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

/** Aplica migraciones versionadas. `list` permite reutilizarlo para otras bases (p. ej. la del sistema del servidor). */
export async function migrate(db: SerialDb, list: Migration[] = MIGRATIONS): Promise<number> {
  const target = list[list.length - 1]!.version;
  const pg = db.dialect === 'postgres';
  let current: number;
  if (pg) {
    await db.exec('CREATE TABLE IF NOT EXISTS astro_schema (version INTEGER NOT NULL)');
    const row = await db.get<{ version: number }>('SELECT max(version) AS version FROM astro_schema');
    current = Number(row?.version ?? 0);
  } else {
    const row = await db.get<{ user_version: number }>('PRAGMA user_version');
    current = Number(row?.user_version ?? 0);
  }
  if (current > target) {
    throw new Error(
      `La base de datos es de una versión más nueva (v${current}) que esta app (v${target}). Actualiza AstroCitas.`,
    );
  }
  for (const m of list) {
    if (m.version <= current) continue;
    await db.transaction(async (tx) => {
      await tx.exec(pg ? pgify(m.sql) : m.sql);
      const extra = pg ? m.postgres : m.sqlite;
      if (extra) await tx.exec(extra);
      if (pg) await tx.run('INSERT INTO astro_schema (version) VALUES (?)', [m.version]);
      else await tx.exec(`PRAGMA user_version = ${m.version}`);
    });
  }
  return target;
}
