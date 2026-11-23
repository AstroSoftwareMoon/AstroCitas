import type { FastifyInstance } from 'fastify';
import { todayLocal } from '@astrocitas/core';
import type { Plugin } from './server';
import type { App } from './app';
import { bullQueue, DbQueue, type JobQueue } from './jobs';
import { applyReply, notifyWaitlist, scanBusiness, sendMessage, type ReplyAction } from './messaging';
import { publicRoutes } from './routes/public';
import { createServerBackup } from './routes/admin';
import { unseal, verifyLink } from './security';

const DAY = 86_400_000;

/**
 * Recordatorios automáticos 24/7, lista de espera, copias programadas, reserva pública,
 * respuestas Confirmo/Cancelar/Cambiar y webhook de WhatsApp.
 */
export function automationPlugin(): Plugin & { queue: () => JobQueue; scanAll: (now?: number) => Promise<void> } {
  let queue: JobQueue;
  let app: App;
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  const scanSoon = (businessId: string) => {
    clearTimeout(pending.get(businessId));
    pending.set(
      businessId,
      setTimeout(() => {
        pending.delete(businessId);
        scanBusiness(app, queue, businessId).catch((e) => app.log.error({ err: e }, 'scan'));
      }, 1500),
    );
  };

  async function waitlistSweep(businessId: string, now: number) {
    const db = await app.store.business(businessId);
    if (!(await db.listWaitlist()).length) return;
    const recent = (await db.listAppointments({ from: now, to: now + 60 * DAY, includeCancelled: true })).filter((a) => a.status === 'cancelled' && now - a.updatedAt < DAY);
    for (const a of recent) await notifyWaitlist(app, queue, businessId, a);
  }

  async function backupsDue(businessId: string, now: number) {
    const db = await app.store.business(businessId);
    const tz = (await db.getBusiness())?.timezone ?? 'Europe/Madrid';
    const sch = (await app.sys.getSetting<{ hour: number; keep: number }>(`backup.schedule.${businessId}`)) ?? { hour: 3, keep: 14 };
    const today = todayLocal(tz, now);
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now));
    const last = await app.sys.getSetting<string>(`backup.last.${businessId}`);
    if (hour >= sch.hour && last !== today) {
      await createServerBackup(app, businessId, sch.keep);
      await app.sys.setSetting(`backup.last.${businessId}`, today);
    }
  }

  async function scanAll(now = Date.now()) {
    for (const b of await app.sys.listBusinesses()) {
      await scanBusiness(app, queue, b.id, now).catch((e) => app.log.error({ err: e, business: b.id }, 'scan'));
      await waitlistSweep(b.id, now).catch((e) => app.log.error({ err: e }, 'waitlist'));
      await backupsDue(b.id, now).catch((e) => app.log.error({ err: e }, 'backup'));
    }
  }

  return {
    name: 'automation',
    queue: () => queue,
    scanAll,
    async register(f: FastifyInstance, a: App) {
      app = a;
      queue = app.cfg.redisUrl ? await bullQueue(app.cfg.redisUrl, app.log) : new DbQueue(app.store.system, app.log);
      queue.register('message.send', async (j) => sendMessage(app, j.businessId!, String(j.payload.messageId)));
      queue.register('waitlist.check', async (j) => {
        const db = await app.store.business(j.businessId!);
        const a = await db.getAppointment(String(j.payload.appointmentId));
        if (a) await notifyWaitlist(app, queue, j.businessId!, a);
      });
      app.hooks.dataChanged.push((bid) => scanSoon(bid));

      publicRoutes(f, app, {
        onBooked: (bid) => scanSoon(bid),
        onCancelled: (bid, apptId) => void queue.enqueue({ type: 'waitlist.check', businessId: bid, payload: { appointmentId: apptId } }),
      });

      // ---------- WhatsApp Cloud API: verificación, estados de entrega y botones ----------
      f.get<{ Params: { bid: string }; Querystring: Record<string, string> }>('/webhooks/whatsapp/:bid', async (req, reply) => {
        const row = await app.sys.getProvider(req.params.bid, 'whatsapp');
        const cfg = row ? unseal<{ verifyToken?: string }>(app.cfg.secret, row.config) : null;
        if (req.query['hub.mode'] === 'subscribe' && cfg?.verifyToken && req.query['hub.verify_token'] === cfg.verifyToken) return reply.type('text/plain').send(req.query['hub.challenge']);
        return reply.code(403).send('forbidden');
      });

      f.post<{ Params: { bid: string } }>('/webhooks/whatsapp/:bid', async (req) => {
        const db = await app.store.business(req.params.bid);
        type Value = { statuses?: { id: string; status: string; errors?: { title: string }[] }[]; messages?: { interactive?: { button_reply?: { id: string } }; button?: { payload?: string } }[] };
        const entries = ((req.body as { entry?: { changes?: { value?: Value }[] }[] })?.entry ?? []).flatMap((e) => e.changes ?? []).map((c) => c.value ?? {});
        const all = await db.listMessages({ since: Date.now() - 45 * DAY, limit: 100_000 });
        for (const v of entries) {
          for (const s of v.statuses ?? []) {
            const m = all.find((x) => x.providerId === s.id);
            const status = s.status === 'delivered' ? 'delivered' : s.status === 'read' ? 'read' : s.status === 'failed' ? 'failed' : null;
            if (m && status) await db.saveMessage({ ...m, status, error: s.errors?.[0]?.title ?? m.error });
          }
          for (const msg of v.messages ?? []) {
            const token = msg.interactive?.button_reply?.id ?? msg.button?.payload;
            const p = token ? verifyLink<{ b: string; a: string; x: ReplyAction; s: number }>(app.cfg.secret, token) : null;
            if (!p || p.b !== req.params.bid || p.x === 'change') continue;
            const r = await applyReply(db, p.a, p.s, p.x);
            if (r.ok && p.x === 'cancel') void queue.enqueue({ type: 'waitlist.check', businessId: p.b, payload: { appointmentId: p.a } });
          }
        }
        return { ok: true };
      });

      // Estado de la cola (propietario de cualquier negocio / admin).
      f.get('/api/v1/admin/queue', async () => queue.stats());
    },
    start(a: App) {
      const stopQueue = queue.start(a.cfg.workerIntervalMs);
      const first = setTimeout(() => scanAll().catch(() => undefined), 5000);
      const id = setInterval(() => scanAll().catch(() => undefined), 60_000);
      return () => {
        stopQueue();
        clearTimeout(first);
        clearInterval(id);
      };
    },
  };
}

/** Módulos opcionales del servidor. */
export const plugins: Plugin[] = [automationPlugin()];
