import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import { ConflictError, ValidationError } from '@astrocitas/core';
import type { Config } from './config';
import type { Store } from './store';
import { SystemRepo, type Membership } from './system';
import { verifyAccess, type AccessClaims } from './security';
import { ForbiddenError } from './rpc';

/** Hooks que conectan módulos (cola de recordatorios, sincronización) sin acoplarlos. */
export interface AppHooks {
  /** Tras cualquier cambio de citas/clientes/reglas de un negocio. */
  dataChanged: ((businessId: string, methodOrEntity: string) => void)[];
}

export interface App {
  cfg: Config;
  store: Store;
  sys: SystemRepo;
  log: FastifyBaseLogger;
  hooks: AppHooks;
}

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function requireUser(app: App, req: FastifyRequest): Promise<AccessClaims> {
  const h = req.headers.authorization ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const claims = token ? await verifyAccess(app.cfg.secret, token) : null;
  if (!claims) throw new HttpError(401, 'Sesión caducada o no válida');
  const u = await app.sys.userById(claims.sub);
  if (!u || u.disabled) throw new HttpError(401, 'Usuario desactivado');
  return { sub: u.id, adm: !!u.is_admin };
}

/** Miembro del negocio (el administrador del servidor actúa como propietario en cualquier negocio). */
export async function requireMember(app: App, req: FastifyRequest, businessId: string, roles?: Membership['role'][]): Promise<{ user: AccessClaims; m: Membership }> {
  const user = await requireUser(app, req);
  let m = await app.sys.membership(user.sub, businessId);
  if (!m && user.adm) {
    const b = await app.sys.businessById(businessId);
    if (b) m = { businessId, businessName: b.name, slug: b.slug, role: 'owner', staffId: null };
  }
  if (!m) throw new HttpError(404, 'Negocio no encontrado');
  if (roles && !roles.includes(m.role)) throw new ForbiddenError();
  return { user, m };
}

export function requireAdmin(claims: AccessClaims) {
  if (!claims.adm) throw new ForbiddenError('Solo el administrador del servidor');
}

/** Errores de dominio → respuestas HTTP claras y serializables (el cliente reconstruye ConflictError). */
export function errorHandler(err: Error & { statusCode?: number; validation?: unknown }, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof ConflictError) return reply.code(409).send({ error: 'conflict', message: err.message, conflicts: err.conflicts });
  if (err instanceof ValidationError) return reply.code(400).send({ error: 'validation', message: err.message, issues: err.issues });
  if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: 'http', message: err.message, ...err.extra });
  if (err instanceof ForbiddenError) return reply.code(403).send({ error: 'forbidden', message: err.message });
  const code = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
  if (code >= 500) req.log.error({ err }, 'error interno');
  return reply.code(code).send({ error: code === 429 ? 'rate_limit' : 'server', message: code >= 500 ? 'Error interno del servidor' : err.message });
}

export function body<T>(req: FastifyRequest): T {
  return (req.body ?? {}) as T;
}
