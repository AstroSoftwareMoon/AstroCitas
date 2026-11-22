import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Configuración por variables de entorno (ver .env.example). */
export interface Config {
  port: number;
  host: string;
  dataDir: string;
  /** Secreto ≥ 32 caracteres: firma JWT, enlaces de respuesta y cifra credenciales de proveedores. */
  secret: string;
  /** postgres://… → PostgreSQL. Vacío → SQLite en dataDir. */
  databaseUrl: string;
  /** redis://… → cola BullMQ. Vacío → cola en la propia base de datos. */
  redisUrl: string;
  publicUrl: string;
  webDir: string;
  logLevel: string;
  updateCheck: boolean;
  allowRegistration: boolean;
  captcha: boolean;
  trustProxy: boolean;
  corsOrigins: string[];
  version: string;
  /** Intervalo de la cola de tareas (ms). */
  workerIntervalMs: number;
}

function pkgVersion(): string {
  try {
    return JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return process.env.ASTRO_VERSION ?? '0.0.0';
  }
}

const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const secret = env.ASTRO_SECRET ?? '';
  if (secret.length < 32) {
    throw new Error('ASTRO_SECRET debe tener al menos 32 caracteres (genera uno con: openssl rand -hex 32)');
  }
  const port = Number(env.PORT ?? 8080);
  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    dataDir: resolve(env.DATA_DIR ?? '/data'),
    secret,
    databaseUrl: env.DATABASE_URL ?? '',
    redisUrl: env.REDIS_URL ?? '',
    publicUrl: (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    webDir: resolve(env.WEB_DIR ?? new URL('../../web/dist', import.meta.url).pathname),
    logLevel: env.LOG_LEVEL ?? 'info',
    updateCheck: bool(env.UPDATE_CHECK, true),
    allowRegistration: bool(env.ALLOW_REGISTRATION, false),
    captcha: bool(env.CAPTCHA, true),
    trustProxy: bool(env.TRUST_PROXY, true),
    corsOrigins: (env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()).filter(Boolean),
    version: env.ASTRO_VERSION ?? pkgVersion(),
    workerIntervalMs: Number(env.WORKER_INTERVAL_MS ?? 15_000),
  };
}

/** Versión de la API. Los clientes comprueban que coincide antes de conectar. */
export const API_VERSION = 1;
