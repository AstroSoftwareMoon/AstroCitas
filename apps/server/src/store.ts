import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { migrate, pgDriver, SerialDb, SqlAdapter, type Migration, type PgLikeClient, type SqlAdapterOptions, type SqlDriver } from '@astrocitas/core/sql';
import { nodeSqliteDriver } from '@astrocitas/core/node';
import type { Config } from './config';

/**
 * Almacenamiento del servidor:
 *  - Base "sistema": usuarios, sesiones, negocios, auditoría, cola de tareas, proveedores, sincronización.
 *  - Una base por negocio con el MISMO esquema y repositorio que el modo local (SqlAdapter de core).
 * SQLite: archivos en DATA_DIR. PostgreSQL: un esquema por negocio dentro de la misma base.
 */
export interface Store {
  dialect: 'sqlite' | 'postgres';
  system: SerialDb;
  business(id: string): Promise<SqlAdapter>;
  close(): Promise<void>;
}

const SYSTEM_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'sistema',
    sql: /* sql */ `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  public_booking INTEGER NOT NULL DEFAULT 1,
  ics_token TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  user_id TEXT NOT NULL REFERENCES users(id),
  business_id TEXT NOT NULL REFERENCES businesses(id),
  role TEXT NOT NULL CHECK (role IN ('owner','reception','professional')),
  staff_id TEXT,
  PRIMARY KEY (user_id, business_id)
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  device TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  user_id TEXT,
  business_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '{}',
  ip TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS audit_business ON audit_log(business_id, at);
CREATE TABLE IF NOT EXISTS providers (
  business_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  config TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (business_id, kind)
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  business_id TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  run_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT UNIQUE,
  locked_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status, run_at);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
  },
];

export async function openStore(cfg: Config, opts: { pgFactory?: () => Promise<PgLikeClient>; businessOptions?: SqlAdapterOptions } = {}): Promise<Store> {
  const usePg = !!cfg.databaseUrl || !!opts.pgFactory;
  const businesses = new Map<string, Promise<SqlAdapter>>();
  const closers: (() => Promise<void>)[] = [];

  let connect: (schema: string) => Promise<SqlDriver>;
  if (usePg) {
    let factory = opts.pgFactory;
    if (!factory) {
      const pg = await import('pg');
      // BIGINT → number (las marcas de tiempo caben sin problema en Number).
      pg.default.types.setTypeParser(20, (v: string) => Number(v));
      const pool = new pg.default.Pool({ connectionString: cfg.databaseUrl, max: 20 });
      closers.push(() => pool.end());
      factory = async () => pool.connect();
    }
    connect = async (schema) => {
      const client = await factory!();
      const d = pgDriver(client, schema);
      await d.init();
      return d;
    };
  } else {
    mkdirSync(join(cfg.dataDir, 'businesses'), { recursive: true });
    connect = async (schema) => {
      const file = schema === 'astro_system' ? join(cfg.dataDir, 'system.db') : join(cfg.dataDir, 'businesses', `${schema}.db`);
      const d = nodeSqliteDriver(file);
      await d.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
      closers.push(() => d.close!());
      return d;
    };
  }

  const system = new SerialDb(await connect('astro_system'));
  if (system.dialect === 'sqlite') await system.exec('PRAGMA foreign_keys = ON');
  await migrate(system, SYSTEM_MIGRATIONS);

  return {
    dialect: usePg ? 'postgres' : 'sqlite',
    system,
    business(id: string) {
      if (!/^[a-z0-9_]{1,40}$/.test(id)) return Promise.reject(new Error('Negocio no válido'));
      let p = businesses.get(id);
      if (!p) {
        p = connect(`b_${id}`).then((d) => SqlAdapter.open(d, opts.businessOptions));
        businesses.set(id, p);
        p.catch(() => businesses.delete(id));
      }
      return p;
    },
    async close() {
      for (const c of closers) await c().catch(() => undefined);
    },
  };
}
