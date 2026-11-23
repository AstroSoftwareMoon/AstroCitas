import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { serverAcceptPush, serverCursor, serverPull, type Change, type EntityName } from '@astrocitas/core';
import { ENTITY_ORDER } from '@astrocitas/core/sql';
import { body, requireMember, type App } from '../app';
import { authorize } from '../rpc';

const SAVE_METHOD: Record<EntityName, string> = {
  business: 'saveBusiness',
  staff: 'saveStaff',
  services: 'saveService',
  clients: 'saveClient',
  timeOff: 'saveTimeOff',
  appointments: 'saveAppointment',
  waitlist: 'saveWaitlist',
  templates: 'saveTemplate',
  reminderRules: 'saveReminderRule',
  messages: 'saveMessage',
};

const ChangeSchema = z.object({
  entity: z.enum(ENTITY_ORDER as [EntityName, ...EntityName[]]),
  rowId: z.string().min(1).max(100),
  field: z.string().min(1).max(60),
  value: z.unknown(),
  hlc: z.string().min(10).max(120),
});

/** Sincronización incremental: push (cola del dispositivo), pull (desde un cursor) y snapshot inicial. */
export function syncRoutes(f: FastifyInstance, app: App) {
  f.get<{ Params: { bid: string } }>('/api/v1/b/:bid/sync/snapshot', async (req) => {
    const { m } = await requireMember(app, req, req.params.bid);
    const db = await app.store.business(m.businessId);
    const cursor = await serverCursor(db); // primero el cursor: lo que llegue después se recibirá en el pull
    return { cursor, dump: await db.exportAll(), hlc: app.hlc.tick() };
  });

  f.get<{ Params: { bid: string }; Querystring: { since?: string; device?: string } }>('/api/v1/b/:bid/sync/pull', async (req) => {
    const { m } = await requireMember(app, req, req.params.bid);
    const db = await app.store.business(m.businessId);
    return serverPull(db, Number(req.query.since ?? 0), String(req.query.device ?? ''));
  });

  f.post<{ Params: { bid: string } }>('/api/v1/b/:bid/sync/push', async (req) => {
    const { m, user } = await requireMember(app, req, req.params.bid);
    const b = z.object({ device: z.string().min(1).max(100), changes: z.array(ChangeSchema).max(5000) }).parse(body(req));
    const db = await app.store.business(m.businessId);
    // Los permisos por rol se comprueban sobre la fila resultante, igual que en la API RPC.
    const res = await serverAcceptPush(db, b.changes as Change[], b.device, app.hlc, (entity, merged) => authorize(m, SAVE_METHOD[entity], [merged], db));
    if (res.accepted) {
      await app.sys.audit({ userId: user.sub, businessId: m.businessId, action: 'sync_push', detail: { device: b.device, accepted: res.accepted, rejected: res.rejected.length }, ip: req.ip });
      for (const h of app.hooks.dataChanged) h(m.businessId, 'sync');
    }
    return res;
  });
}
