import { DatabaseSync } from 'node:sqlite';
import type { Row, SqlDriver, SqlValue } from '../sql/driver';

/** Driver SQLite para Node (tests, scripts y servidor) usando el módulo nativo node:sqlite. */
export function nodeSqliteDriver(path = ':memory:'): SqlDriver & { raw: DatabaseSync } {
  const db = new DatabaseSync(path);
  return {
    raw: db,
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params: SqlValue[] = []) {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    async all<T = Row>(sql: string, params: SqlValue[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async close() {
      db.close();
    },
  };
}
