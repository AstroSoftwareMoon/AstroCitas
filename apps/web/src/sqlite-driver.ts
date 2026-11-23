import type { Row, SqlDriver, SqlValue } from '@astrocitas/core/sql';

/** Cliente del worker SQLite: implementa SqlDriver con mensajes asíncronos. */
export async function openWebSqlite(name = 'astrocitas'): Promise<{ driver: SqlDriver; storage: 'opfs' | 'memory' }> {
  const worker = new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module' });
  let seq = 0;
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  worker.onmessage = (ev) => {
    const { id, ok, result, error } = ev.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(result);
    else p.reject(new Error(error));
  };
  const call = <T,>(op: string, sql = '', params: SqlValue[] = []) =>
    new Promise<T>((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ id, op, sql, params });
    });

  const { storage } = await call<{ storage: 'opfs' | 'memory' }>('init', name);
  const driver: SqlDriver = {
    exec: (sql) => call<void>('exec', sql),
    run: (sql, params = []) => call<{ changes: number }>('run', sql, params),
    all: <T = Row,>(sql: string, params: SqlValue[] = []) => call<T[]>('all', sql, params),
    close: async () => worker.terminate(),
  };
  return { driver, storage };
}
