import type { Row, SqlDriver, SqlValue } from './driver';

/** Cliente mínimo compatible con `pg.Client`/`pg.PoolClient` y con PGlite (tests). */
export interface PgLikeClient {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null; affectedRows?: number }>;
  exec?(text: string): Promise<unknown>;
}

/** Convierte los `?` posicionales a `$1, $2…` ignorando los que van dentro de comillas. */
export function toPgParams(sql: string): string {
  let out = '';
  let n = 0;
  let quote: string | null = null;
  for (const ch of sql) {
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === '?') out += `$${++n}`;
    else out += ch;
  }
  return out;
}

/**
 * Driver PostgreSQL para SqlAdapter. Cada negocio usa su propio esquema (search_path),
 * así el mismo repositorio y las mismas migraciones sirven para SQLite y PostgreSQL.
 */
export function pgDriver(client: PgLikeClient, schema?: string): SqlDriver & { init(): Promise<void> } {
  const exec = async (sql: string) => {
    if (client.exec) await client.exec(sql);
    else await client.query(sql);
  };
  return {
    dialect: 'postgres',
    async init() {
      if (!schema) return;
      if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Nombre de esquema no válido');
      await exec(`CREATE SCHEMA IF NOT EXISTS ${schema}; SET search_path TO ${schema};`);
    },
    exec,
    async run(sql: string, params: SqlValue[] = []) {
      const r = await client.query(toPgParams(sql), params);
      return { changes: Number(r.rowCount ?? r.affectedRows ?? 0) };
    },
    async all<T = Row>(sql: string, params: SqlValue[] = []) {
      const r = await client.query(toPgParams(sql), params);
      return r.rows as T[];
    },
  };
}
