import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { loadConfig } from '../src/config';
import { buildServer, type Plugin } from '../src/server';

export async function testServer(opts: { pg?: boolean; plugins?: Plugin[]; env?: Record<string, string> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'astro-srv-'));
  const cfg = loadConfig({ ASTRO_SECRET: 'test-secret-test-secret-test-secret-1234', DATA_DIR: dir, WEB_DIR: join(dir, 'noweb'), UPDATE_CHECK: 'false', CAPTCHA: 'false', ...opts.env });
  // PGlite = PostgreSQL real en WASM: una sola conexión compartida (los esquemas se cambian por search_path).
  let pgFactory: (() => Promise<PGlite>) | undefined;
  if (opts.pg) {
    pgFactory = async () => {
      const db = new PGlite();
      await db.waitReady;
      return db;
    };
  }
  const srv = await buildServer(cfg, { pgFactory, plugins: opts.plugins, logger: false, startWorkers: false });
  const f = srv.fastify;
  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown, token?: string) => {
    const r = await f.inject({ method, url, payload: payload as never, headers: token ? { authorization: `Bearer ${token}` } : {} });
    return { status: r.statusCode, json: r.body ? (JSON.parse(r.body) as Record<string, any>) : {} };
  };
  return { srv, call, dir };
}

export async function setupAdmin(call: Awaited<ReturnType<typeof testServer>>['call']) {
  const r = await call('POST', '/api/v1/setup', { email: 'admin@luna.es', password: 'una-contraseña-larga', name: 'Marta', businessName: 'Peluquería Luna', kind: 'peluqueria' });
  if (r.status !== 200) throw new Error(JSON.stringify(r.json));
  return r.json as { accessToken: string; refreshToken: string; memberships: { businessId: string }[] };
}
