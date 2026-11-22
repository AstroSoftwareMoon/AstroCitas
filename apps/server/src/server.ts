import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { PgLikeClient } from '@astrocitas/core/sql';
import type { Config } from './config';
import { openStore } from './store';
import { SystemRepo } from './system';
import { errorHandler, type App } from './app';
import { authRoutes } from './routes/auth';
import { dataRoutes } from './routes/data';
import { adminRoutes } from './routes/admin';

export interface BuiltServer {
  fastify: FastifyInstance;
  app: App;
  close(): Promise<void>;
}

export interface Plugin {
  name: string;
  register(f: FastifyInstance, app: App): void | Promise<void>;
  /** Tareas de fondo (cola, copias programadas…). Devuelve una función para pararlas. */
  start?(app: App): () => void;
}

export async function buildServer(cfg: Config, opts: { pgFactory?: () => Promise<PgLikeClient>; plugins?: Plugin[]; logger?: boolean; startWorkers?: boolean } = {}): Promise<BuiltServer> {
  const fastify = Fastify({
    logger: opts.logger === false ? false : { level: cfg.logLevel, redact: ['req.headers.authorization', 'req.body.password', 'req.body.refreshToken'] },
    trustProxy: cfg.trustProxy,
    bodyLimit: 25 * 1024 * 1024,
  });
  const store = await openStore(cfg, { pgFactory: opts.pgFactory });
  const app: App = { cfg, store, sys: new SystemRepo(store.system), log: fastify.log, hooks: { dataChanged: [] } };

  fastify.setErrorHandler(errorHandler);
  await fastify.register(cors, {
    origin: cfg.corsOrigins.includes('*') ? true : cfg.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86_400,
  });
  await fastify.register(rateLimit, { max: 600, timeWindow: '1 minute', allowList: (req) => req.url === '/health' });
  fastify.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    return payload;
  });

  authRoutes(fastify, app);
  dataRoutes(fastify, app);
  adminRoutes(fastify, app);
  for (const p of opts.plugins ?? []) await p.register(fastify, app);

  // La PWA se sirve desde el propio servidor (misma interfaz que la app instalada).
  if (existsSync(cfg.webDir)) {
    await fastify.register(fastifyStatic, { root: cfg.webDir, prefix: '/', wildcard: false, index: ['index.html'], cacheControl: false, setHeaders: (res, path) => {
      res.setHeader('Cache-Control', /\/assets\//.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
    } });
  }

  const stops = opts.startWorkers === false ? [] : (opts.plugins ?? []).map((p) => p.start?.(app)).filter((s): s is () => void => !!s);
  return {
    fastify,
    app,
    async close() {
      for (const s of stops) s();
      await fastify.close();
      await store.close();
    },
  };
}
