import {
  buildContext,
  computeSlots,
  dayBounds,
  dueReminders,
  ensureMessagingDefaults,
  pickTemplate,
  renderTemplate,
  toLocalDate,
  type Appointment,
  type MessageChannel,
} from '@astrocitas/core';
import type { SqlAdapter } from '@astrocitas/core/sql';
import type { App } from './app';
import { PermanentJobError, type JobQueue } from './jobs';
import { ProviderError, providerForChannel, sendVia, type ProviderKind } from './providers';
import { signLink, unseal } from './security';

const DAY = 86_400_000;

export type ReplyAction = 'confirm' | 'cancel' | 'change';

/** Enlaces firmados Confirmo / Cancelar / Cambiar. Incluyen la hora: si la cita se mueve, caducan solos. */
export function replyLinks(app: App, businessId: string, a: Pick<Appointment, 'id' | 'startsAt'>) {
  const mk = (x: ReplyAction) => `${app.cfg.publicUrl}/r/${signLink(app.cfg.secret, { b: businessId, a: a.id, x, s: a.startsAt })}`;
  return { confirm: mk('confirm'), cancel: mk('cancel'), change: mk('change') };
}

async function enabledProviders(app: App, businessId: string): Promise<Map<ProviderKind, Record<string, unknown>>> {
  const rows = await app.sys.listProviders(businessId);
  return new Map(rows.filter((r) => r.enabled).map((r) => [r.kind as ProviderKind, unseal<Record<string, unknown>>(app.cfg.secret, r.config)]));
}

/**
 * Recorre las citas de un negocio y encola los recordatorios que toquen.
 * Idempotente: la clave incluye cita + regla + canal + hora, así nunca se duplican y,
 * si la cita cambia de hora, se genera uno nuevo y el anterior se descarta al enviarse.
 */
export async function scanBusiness(app: App, queue: JobQueue, businessId: string, now = Date.now()): Promise<number> {
  const db = await app.store.business(businessId);
  const business = await db.getBusiness();
  if (!business) return 0;
  await ensureMessagingDefaults(db, business.locale);
  const providers = await enabledProviders(app, businessId);
  const channels = (['email', 'whatsapp', 'sms'] as MessageChannel[]).filter((c) => providerForChannel(c, new Set(providers.keys())));
  if (!channels.length) return 0;

  const [appointments, rules, clients, sent] = await Promise.all([
    db.listAppointments({ from: now - 2 * DAY, to: now + 15 * DAY, includeCancelled: false }),
    db.listReminderRules(),
    db.listClients({ limit: 100_000 }),
    db.listMessages({ since: now - 40 * DAY, limit: 100_000 }),
  ]);
  const due = dueReminders({
    now,
    appointments,
    rules,
    clients: new Map(clients.map((c) => [c.id, c])),
    sentKeys: new Set(sent.map((m) => m.idempotencyKey).filter((k): k is string => !!k)),
    channels,
  });
  for (const d of due) {
    const c = clients.find((x) => x.id === d.appointment.clientId)!;
    const msg = await db
      .saveMessage({
        appointmentId: d.appointment.id,
        clientId: c.id,
        ruleId: d.rule.id,
        kind: d.rule.kind,
        channel: d.channel,
        recipient: d.channel === 'email' ? c.email : c.phone,
        status: 'queued',
        idempotencyKey: d.key,
      })
      .catch(() => null); // otra instancia ya lo creó
    if (msg) await queue.enqueue({ type: 'message.send', businessId, payload: { messageId: msg.id }, idempotencyKey: `send:${businessId}:${msg.id}` });
  }
  return due.length;
}

/** Envía un mensaje de la cola con el proveedor del canal. Reintenta solo errores temporales. */
export async function sendMessage(app: App, businessId: string, messageId: string): Promise<void> {
  const db = await app.store.business(businessId);
  const [msg] = (await db.listMessages({ limit: 100_000 })).filter((m) => m.id === messageId);
  if (!msg || msg.status === 'sent' || msg.status === 'delivered' || msg.status === 'read' || msg.status === 'cancelled') return;
  const business = (await db.getBusiness())!;
  const appt = msg.appointmentId ? await db.getAppointment(msg.appointmentId) : null;

  // Revalidar justo antes de enviar: si la cita se canceló o se movió, este mensaje ya no vale.
  if (msg.appointmentId && msg.kind !== 'waitlist') {
    const stale = !appt || appt.deletedAt || (msg.idempotencyKey && !msg.idempotencyKey.endsWith(`:${appt.startsAt}`));
    const wrongStatus = appt && (msg.kind === 'thanks' || msg.kind === 'review' ? appt.status !== 'completed' : appt.status !== 'booked' && appt.status !== 'confirmed');
    if (stale || wrongStatus) {
      await db.saveMessage({ ...msg, status: 'cancelled', error: 'La cita cambió o se canceló' });
      return;
    }
  }

  const providers = await enabledProviders(app, businessId);
  const kind = providerForChannel(msg.channel, new Set(providers.keys()));
  if (!kind) {
    await db.saveMessage({ ...msg, status: 'failed', error: 'No hay proveedor configurado para este canal' });
    throw new PermanentJobError('Sin proveedor');
  }

  const client = msg.clientId ? await db.getClient(msg.clientId) : null;
  let subject = msg.subject;
  let text = msg.body;
  let buttons: { id: string; title: string }[] | undefined;
  if (!text) {
    const templates = await db.listTemplates();
    const tpl = pickTemplate(templates, msg.kind, msg.channel);
    const links = appt ? replyLinks(app, businessId, appt) : null;
    const pub = await app.sys.businessById(businessId);
    const link = msg.kind === 'review' ? (business.settings as { reviewUrl?: string }).reviewUrl ?? '' : pub ? `${app.cfg.publicUrl}/b/${pub.slug}` : '';
    const ctx = buildContext({
      business,
      appointment: appt,
      client,
      service: appt ? (await db.listServices({ includeInactive: true })).find((s) => s.id === appt.serviceId) : null,
      staff: appt ? (await db.listStaff({ includeInactive: true })).find((s) => s.id === appt.staffId) : null,
      link,
    });
    subject = renderTemplate(tpl?.subject || business.name, ctx);
    text = renderTemplate(tpl?.body ?? '{negocio}', ctx);
    if (links && (msg.kind === 'reminder' || msg.kind === 'confirmation')) {
      if (msg.channel === 'whatsapp') {
        buttons = [
          { id: links.confirm.split('/r/')[1]!, title: business.locale === 'en' ? 'Confirm' : 'Confirmo' },
          { id: links.cancel.split('/r/')[1]!, title: business.locale === 'en' ? 'Cancel' : 'Cancelar' },
          { id: links.change.split('/r/')[1]!, title: business.locale === 'en' ? 'Change' : 'Cambiar' },
        ];
      } else {
        const L = business.locale === 'en' ? ['Confirm', 'Cancel', 'Change'] : ['Confirmo', 'Cancelar', 'Cambiar'];
        text += `\n\n✅ ${L[0]}: ${links.confirm}\n❌ ${L[1]}: ${links.cancel}\n🔁 ${L[2]}: ${links.change}`;
      }
    }
  }

  try {
    const r = await sendVia(kind, providers.get(kind)!, { channel: msg.channel, to: msg.recipient, subject, text, buttons });
    await db.saveMessage({ ...msg, subject, body: text, status: 'sent', providerId: r.providerId, sentAt: Date.now(), attempts: msg.attempts + 1, error: '' });
  } catch (e) {
    const retryable = e instanceof ProviderError ? e.retryable : true;
    await db.saveMessage({ ...msg, subject, body: text, status: retryable ? 'queued' : 'failed', error: String((e as Error).message).slice(0, 900), attempts: msg.attempts + 1 });
    if (!retryable) throw new PermanentJobError((e as Error).message);
    throw e;
  }
}

/** Al liberarse un hueco: avisa a quien espera ese servicio en esas fechas (una vez por entrada). */
export async function notifyWaitlist(app: App, queue: JobQueue, businessId: string, freed: Appointment): Promise<number> {
  const db = await app.store.business(businessId);
  const business = (await db.getBusiness())!;
  const tz = business.timezone;
  const date = toLocalDate(freed.startsAt, tz);
  const waiting = (await db.listWaitlist()).filter((w) => w.serviceId === freed.serviceId && w.fromDate <= date && w.toDate >= date && (!w.staffId || w.staffId === freed.staffId));
  if (!waiting.length) return 0;
  const providers = await enabledProviders(app, businessId);
  const [from, to] = dayBounds(date, tz);
  const service = (await db.listServices({ includeInactive: true })).find((s) => s.id === freed.serviceId);
  if (!service) return 0;
  const free = computeSlots({
    date,
    service,
    staff: await db.listStaff(),
    appointments: await db.listAppointments({ from, to }),
    timeOff: await db.listTimeOff({ from, to }),
    timezone: tz,
    now: Date.now(),
  }).some((s) => s.start === freed.startsAt);
  if (!free) return 0;
  let n = 0;
  for (const w of waiting) {
    const c = await db.getClient(w.clientId);
    if (!c || !c.consentReminders) continue;
    const channel = (['whatsapp', 'email', 'sms'] as MessageChannel[]).find((ch) => providerForChannel(ch, new Set(providers.keys())) && (ch === 'email' ? c.email : c.phone));
    if (!channel) continue;
    const ctx = buildContext({ business, appointment: freed, client: c, service, link: `${app.cfg.publicUrl}/b/${(await app.sys.businessById(businessId))?.slug ?? ''}` });
    const tpl = pickTemplate(await db.listTemplates(), 'waitlist', channel);
    const msg = await db
      .saveMessage({
        clientId: c.id,
        appointmentId: freed.id,
        kind: 'waitlist',
        channel,
        recipient: channel === 'email' ? c.email : c.phone,
        subject: renderTemplate(tpl?.subject || business.name, ctx),
        body: renderTemplate(tpl?.body ?? '', ctx) + (ctx.enlace ? `\n${ctx.enlace}` : ''),
        status: 'queued',
        idempotencyKey: `w:${w.id}:${freed.startsAt}`,
      })
      .catch(() => null);
    if (!msg) continue;
    await db.saveWaitlist({ ...w, status: 'notified' });
    await queue.enqueue({ type: 'message.send', businessId, payload: { messageId: msg.id }, idempotencyKey: `send:${businessId}:${msg.id}` });
    n++;
  }
  return n;
}

/** Aplica una respuesta Confirmo/Cancelar desde el enlace o el botón de WhatsApp. */
export async function applyReply(db: SqlAdapter, appointmentId: string, startsAt: number, action: ReplyAction): Promise<{ ok: boolean; appointment: Appointment | null; reason?: string }> {
  const a = await db.getAppointment(appointmentId);
  if (!a || a.deletedAt) return { ok: false, appointment: null, reason: 'not_found' };
  if (a.startsAt !== startsAt) return { ok: false, appointment: a, reason: 'changed' };
  if (a.status === 'cancelled') return { ok: action === 'cancel', appointment: a, reason: action === 'cancel' ? undefined : 'cancelled' };
  if (a.startsAt < Date.now()) return { ok: false, appointment: a, reason: 'past' };
  if (action === 'confirm') return { ok: true, appointment: await db.saveAppointment({ ...a, status: 'confirmed' }, { force: true }) };
  if (action === 'cancel') return { ok: true, appointment: await db.saveAppointment({ ...a, status: 'cancelled' }, { force: true }) };
  return { ok: true, appointment: a };
}

export { DAY };
