/// <reference lib="webworker" />
/**
 * Worker que aloja SQLite (WASM). Persistencia con el VFS "opfs-sahpool": no requiere
 * cabeceras COOP/COEP, así que funciona en cualquier hosting estático. Si el navegador
 * no soporta OPFS, cae a una base en memoria y lo comunica a la UI.
 */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

type Req = { id: number; op: 'exec' | 'run' | 'all'; sql: string; params?: unknown[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
let storage: 'opfs' | 'memory' = 'memory';

const ready = (async () => {
  const sqlite3 = await sqlite3InitModule();
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'astrocitas' });
    db = new pool.OpfsSAHPoolDb('/astrocitas.sqlite3');
    storage = 'opfs';
  } catch (e) {
    console.warn('[astrocitas] OPFS no disponible, usando memoria:', e);
    db = new sqlite3.oo1.DB(':memory:', 'c');
  }
  db.exec('PRAGMA journal_mode = TRUNCATE; PRAGMA foreign_keys = ON;');
  return storage;
})();

self.onmessage = async (ev: MessageEvent<Req | { id: number; op: 'init' }>) => {
  const msg = ev.data;
  try {
    const kind = await ready;
    let result: unknown;
    if (msg.op === 'init') result = { storage: kind };
    else if (msg.op === 'exec') {
      db.exec(msg.sql);
    } else if (msg.op === 'run') {
      db.exec({ sql: msg.sql, bind: msg.params?.length ? msg.params : undefined });
      result = { changes: db.changes() };
    } else {
      result = db.exec({ sql: msg.sql, bind: msg.params?.length ? msg.params : undefined, rowMode: 'object', returnValue: 'resultRows' });
    }
    self.postMessage({ id: msg.id, ok: true, result });
  } catch (e) {
    self.postMessage({ id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
