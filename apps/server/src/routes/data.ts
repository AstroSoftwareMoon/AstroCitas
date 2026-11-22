import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DataAdapter } from '@astrocitas/core';
import { body, type App } from '../app';
import { requireMember } from '../app';
import { authorize, isWrite } from '../rpc';

const RpcBody = z.object({ method: z.string().max(40), args: z.array(z.unknown()).max(4).default([]) });

/** Métodos cuyo efecto puede requerir reprogramar recordatorios / avisar a la lista de espera. */
const AFFECTS_REMINDERS = new Set(['saveAppointment', 'createSeries', 'remove', 'restore', 'saveClient', 'saveReminderRule', 'importAll', 'saveBusiness']);

export function dataRoutes(f: FastifyInstance, app: App) {
  f.post<{ Params: { bid: string } }>('/api/v1/b/:bid/rpc', async (req) => {
    const { m, user } = await requireMember(app, req, req.params.bid);
    const { method, args } = RpcBody.parse(body(req));
    const db = await app.store.business(m.businessId);
    await authorize(m, method, args, db);
    const fn = (db as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method] as (...a: unknown[]) => Promise<unknown>;
    const result = await fn.apply(db as DataAdapter, args);
    if (isWrite(method)) {
      const entity = method === 'remove' || method === 'restore' ? String(args[0]) : method.replace(/^save/, '').toLowerCase();
      const entityId = method === 'remove' || method === 'restore' ? String(args[1]) : ((result as { id?: string })?.id ?? '');
      await app.sys.audit({ userId: user.sub, businessId: m.businessId, action: method, entity, entityId, ip: req.ip });
      if (AFFECTS_REMINDERS.has(method)) for (const h of app.hooks.dataChanged) h(m.businessId, method);
    }
    return { result: result ?? null };
  });
}
