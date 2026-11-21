export type SqlValue = string | number | null | Uint8Array;
export type Row = Record<string, unknown>;

/**
 * Contrato mínimo de un motor SQLite. Lo implementan:
 *  - web: sqlite-wasm + OPFS en un Worker (apps/web)
 *  - escritorio/móvil: tauri-plugin-sql (apps/client)
 *  - servidor y tests: node:sqlite (apps/server, packages/core/testing)
 */
export interface SqlDriver {
  /** Ejecuta uno o varios statements sin parámetros. */
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  all<T = Row>(sql: string, params?: SqlValue[]): Promise<T[]>;
  close?(): Promise<void>;
}

/**
 * Serializa el acceso a un driver asíncrono y añade transacciones seguras:
 * mientras una transacción está abierta ninguna otra operación se intercala.
 */
export class SerialDb {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly driver: SqlDriver) {}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => undefined);
    return p;
  }

  exec(sql: string) {
    return this.enqueue(() => this.driver.exec(sql));
  }
  run(sql: string, params: SqlValue[] = []) {
    return this.enqueue(() => this.driver.run(sql, params));
  }
  all<T = Row>(sql: string, params: SqlValue[] = []) {
    return this.enqueue(() => this.driver.all<T>(sql, params));
  }
  async get<T = Row>(sql: string, params: SqlValue[] = []): Promise<T | undefined> {
    return (await this.all<T>(sql, params))[0];
  }

  transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      await this.driver.exec('BEGIN IMMEDIATE');
      try {
        const r = await fn(this.driver);
        await this.driver.exec('COMMIT');
        return r;
      } catch (e) {
        await this.driver.exec('ROLLBACK').catch(() => undefined);
        throw e;
      }
    });
  }
}
