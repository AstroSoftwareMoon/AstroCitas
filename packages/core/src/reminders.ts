import { DateTime } from 'luxon';
import type { Appointment, Business, Client, MessageChannel, MessageKind, MessageTemplate, OutboxMessage, ReminderRule, Service, Staff } from './types';
import type * as S from './types';
import type { Input } from './types';
import type { DataAdapter } from './adapter';
import { formatMoney } from './presets';
import { MINUTE } from './time';

/**
 * Recordatorios y mensajería. Todo es puro y se comparte:
 *  - Modo local: listas "pendientes" con envío en 1 toque y email por SMTP propio mientras la app está abierta.
 *  - Servidor: la cola automática usa exactamente `dueReminders()` y `renderTemplate()`.
 */

export const TEMPLATE_VARS = ['cliente', 'nombre', 'servicio', 'fecha', 'hora', 'duracion', 'precio', 'profesional', 'negocio', 'telefono_negocio', 'direccion', 'enlace'] as const;
export type TemplateVar = (typeof TEMPLATE_VARS)[number];
export type TemplateContext = Partial<Record<TemplateVar, string>>;

/** Sustituye {variable}. Las desconocidas se dejan tal cual para que se vean en la vista previa. */
export function renderTemplate(body: string, ctx: TemplateContext): string {
  return body.replace(/\{([a-z_]+)\}/g, (m, k: string) => {
    const v = ctx[k as TemplateVar];
    return v === undefined || v === '' ? (TEMPLATE_VARS.includes(k as TemplateVar) ? '' : m) : v;
  }).replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim();
}

export function buildContext(p: {
  business: Business;
  appointment?: Pick<Appointment, 'startsAt' | 'endsAt' | 'priceCents'> | null;
  client?: Pick<Client, 'name'> | null;
  service?: Pick<Service, 'name'> | null;
  staff?: Pick<Staff, 'name'> | null;
  link?: string;
}): TemplateContext {
  const { business: b, appointment: a } = p;
  const locale = b.locale ?? 'es';
  const dt = a ? DateTime.fromMillis(a.startsAt, { zone: b.timezone }).setLocale(locale) : null;
  return {
    cliente: p.client?.name ?? '',
    nombre: p.client?.name.split(/\s+/)[0] ?? '',
    servicio: p.service?.name ?? '',
    fecha: dt ? dt.toFormat(locale === 'es' ? "cccc d 'de' LLLL" : 'cccc d LLLL') : '',
    hora: dt ? dt.toFormat('HH:mm') : '',
    duracion: a ? `${Math.round((a.endsAt - a.startsAt) / MINUTE)} min` : '',
    precio: a && a.priceCents ? formatMoney(a.priceCents, b.currency, locale) : '',
    profesional: p.staff?.name ?? '',
    negocio: b.name,
    telefono_negocio: b.phone,
    direccion: b.address,
    enlace: p.link ?? '',
  };
}

type TemplateSeed = { kind: MessageKind; channel: 'any' | 'email'; subject?: string; body: string };

export function defaultTemplates(locale: 'es' | 'en' = 'es'): TemplateSeed[] {
  if (locale === 'en')
    return [
      { kind: 'reminder', channel: 'any', subject: 'Reminder: {servicio} on {fecha}', body: 'Hi {nombre}! Just a reminder of your {servicio} appointment at {negocio} on {fecha} at {hora}. {enlace}\nReply if you need to change it. See you soon!' },
      { kind: 'confirmation', channel: 'any', subject: 'Appointment confirmed: {fecha} {hora}', body: 'Hi {nombre}, your {servicio} appointment at {negocio} is booked for {fecha} at {hora} with {profesional}. {enlace}' },
      { kind: 'thanks', channel: 'any', subject: 'Thanks for your visit', body: 'Thanks for coming to {negocio}, {nombre}! We hope you enjoyed your {servicio}.' },
      { kind: 'review', channel: 'any', subject: 'How was it?', body: 'Hi {nombre}, would you mind leaving us a review? It helps a lot: {enlace}' },
      { kind: 'birthday', channel: 'any', subject: 'Happy birthday!', body: 'Happy birthday, {nombre}! 🎉 Everyone at {negocio} wishes you a great day.' },
      { kind: 'waitlist', channel: 'any', subject: 'A slot opened up', body: 'Hi {nombre}, a {servicio} slot is now free on {fecha} at {hora}. Want it? Reply to book it.' },
      { kind: 'request', channel: 'any', body: 'Hi {negocio}, I would like to book an appointment for {servicio}. My name is {cliente}. Preferred day/time: ' },
    ];
  return [
    { kind: 'reminder', channel: 'any', subject: 'Recordatorio: {servicio} el {fecha}', body: '¡Hola {nombre}! Te recordamos tu cita de {servicio} en {negocio} el {fecha} a las {hora}. {enlace}\nSi necesitas cambiarla, responde a este mensaje. ¡Hasta pronto!' },
    { kind: 'confirmation', channel: 'any', subject: 'Cita confirmada: {fecha} {hora}', body: 'Hola {nombre}, tu cita de {servicio} en {negocio} queda reservada para el {fecha} a las {hora} con {profesional}. {enlace}' },
    { kind: 'thanks', channel: 'any', subject: 'Gracias por tu visita', body: '¡Gracias por venir a {negocio}, {nombre}! Esperamos que te haya encantado tu {servicio}.' },
    { kind: 'review', channel: 'any', subject: '¿Qué tal fue?', body: 'Hola {nombre}, ¿nos dejarías una reseña? Nos ayuda muchísimo: {enlace}' },
    { kind: 'birthday', channel: 'any', subject: '¡Feliz cumpleaños!', body: '¡Feliz cumpleaños, {nombre}! 🎉 Todo el equipo de {negocio} te desea un día genial.' },
    { kind: 'waitlist', channel: 'any', subject: 'Se ha liberado un hueco', body: 'Hola {nombre}, se ha liberado un hueco para {servicio} el {fecha} a las {hora}. ¿Lo quieres? Responde y te lo reservamos.' },
    { kind: 'request', channel: 'any', body: 'Hola {negocio}, quiero pedir cita para {servicio}. Me llamo {cliente}. Día/hora preferidos: ' },
  ];
}

export function defaultRules(): Input<typeof S.ReminderRule>[] {
  return [
    { kind: 'confirmation', anchor: 'on_booking', offsetMin: 0, channels: ['email'], active: true },
    { kind: 'reminder', anchor: 'before_start', offsetMin: 24 * 60, channels: ['email'], active: true },
    { kind: 'reminder', anchor: 'before_start', offsetMin: 2 * 60, channels: ['email'], active: false },
    { kind: 'thanks', anchor: 'after_end', offsetMin: 60, channels: ['email'], active: false },
    { kind: 'review', anchor: 'after_end', offsetMin: 24 * 60, channels: ['email'], active: false },
  ];
}

/** Crea plantillas y reglas por defecto si no existen (idempotente). */
export async function ensureMessagingDefaults(db: DataAdapter, locale: 'es' | 'en' = 'es'): Promise<void> {
  const [templates, rules] = await Promise.all([db.listTemplates(), db.listReminderRules()]);
  if (!templates.length) for (const t of defaultTemplates(locale)) await db.saveTemplate({ ...t, subject: t.subject ?? '' });
  if (!rules.length) for (const r of defaultRules()) await db.saveReminderRule(r);
}

export function pickTemplate(templates: MessageTemplate[], kind: MessageKind, channel: MessageChannel): MessageTemplate | undefined {
  const active = templates.filter((t) => t.active && t.kind === kind && !t.deletedAt);
  return active.find((t) => t.channel === channel) ?? active.find((t) => t.channel === 'any');
}

// ---------- enlaces de 1 toque ----------

/** Normaliza a dígitos E.164 sin '+'. Números de 9 cifras se asumen del país por defecto (34 = España). */
export function normalizePhone(phone: string, defaultCountry = '34'): string {
  const raw = phone.trim();
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (raw.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.length <= 10) digits = defaultCountry + digits.replace(/^0/, '');
  return digits;
}

export function whatsappLink(phone: string, text: string, defaultCountry = '34'): string {
  const n = normalizePhone(phone, defaultCountry);
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

/** `sms:` con cuerpo: `?&body=` funciona tanto en iOS como en Android. */
export function smsLink(phone: string, text: string, defaultCountry = '34'): string {
  const n = normalizePhone(phone, defaultCountry);
  return `sms:${n ? '+' + n : ''}?&body=${encodeURIComponent(text)}`;
}

export function mailtoLink(email: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function channelLink(channel: MessageChannel, to: { phone: string; email: string }, subject: string, body: string): string | null {
  if (channel === 'email') return to.email ? mailtoLink(to.email, subject, body) : null;
  if (!to.phone) return null;
  return channel === 'whatsapp' ? whatsappLink(to.phone, body) : smsLink(to.phone, body);
}

// ---------- qué hay que enviar ----------

export interface DueReminder {
  appointment: Appointment;
  rule: ReminderRule;
  channel: MessageChannel;
  /** Momento en que tocaba enviarlo. */
  dueAt: number;
  /** Clave de idempotencia: cambia si la cita se mueve → se reprograma solo. */
  key: string;
}

export function reminderDueAt(rule: Pick<ReminderRule, 'anchor' | 'offsetMin'>, a: Pick<Appointment, 'startsAt' | 'endsAt' | 'createdAt'>): number {
  if (rule.anchor === 'on_booking') return a.createdAt;
  if (rule.anchor === 'after_end') return a.endsAt + rule.offsetMin * MINUTE;
  return a.startsAt - rule.offsetMin * MINUTE;
}

export function reminderKey(rule: Pick<ReminderRule, 'id'>, a: Pick<Appointment, 'id' | 'startsAt'>, channel: MessageChannel): string {
  return `r:${a.id}:${rule.id}:${channel}:${a.startsAt}`;
}

/** Estados en los que se envía cada tipo de mensaje. */
function eligible(kind: MessageKind, a: Appointment): boolean {
  if (a.deletedAt) return false;
  if (kind === 'thanks' || kind === 'review') return a.status === 'completed';
  return a.status === 'booked' || a.status === 'confirmed';
}

/**
 * Recordatorios que deberían enviarse ya. `graceMin` evita mandar recordatorios muy atrasados
 * (p. ej. el de 24 h si la app/servidor estuvo apagado y la cita es dentro de 10 minutos).
 */
export function dueReminders(p: {
  now: number;
  appointments: Appointment[];
  rules: ReminderRule[];
  clients: Map<string, Pick<Client, 'email' | 'phone' | 'consentReminders'>>;
  sentKeys: Set<string>;
  channels?: MessageChannel[];
  graceMin?: number;
}): DueReminder[] {
  const grace = (p.graceMin ?? 6 * 60) * MINUTE;
  const out: DueReminder[] = [];
  for (const rule of p.rules) {
    if (!rule.active || rule.deletedAt) continue;
    for (const a of p.appointments) {
      if (!eligible(rule.kind, a) || !a.clientId) continue;
      const client = p.clients.get(a.clientId);
      if (!client || !client.consentReminders) continue;
      const dueAt = reminderDueAt(rule, a);
      if (dueAt > p.now || p.now - dueAt > grace) continue;
      if (rule.anchor === 'before_start' && a.startsAt <= p.now) continue;
      for (const channel of rule.channels) {
        if (p.channels && !p.channels.includes(channel)) continue;
        if (channel === 'email' ? !client.email : !client.phone) continue;
        const key = reminderKey(rule, a, channel);
        if (p.sentKeys.has(key)) continue;
        out.push({ appointment: a, rule, channel, dueAt, key });
      }
    }
  }
  return out.sort((x, y) => x.dueAt - y.dueAt);
}

/** Lista "Recordatorios pendientes" del modo local: citas de un rango sin recordatorio abierto/enviado. */
export function pendingManualReminders(appointments: Appointment[], messages: OutboxMessage[], clients: Map<string, Client>): Appointment[] {
  const done = new Set(messages.filter((m) => m.kind === 'reminder' && m.status !== 'failed' && m.status !== 'cancelled').map((m) => m.appointmentId));
  return appointments.filter((a) => {
    if (a.deletedAt || !a.clientId || done.has(a.id)) return false;
    if (a.status !== 'booked' && a.status !== 'confirmed') return false;
    const c = clients.get(a.clientId);
    return !!c && c.consentReminders && !!(c.phone || c.email);
  });
}

/** Avisos al dueño: citas que empiezan dentro de `leadMin` y aún no se han notificado. */
export function upcomingForOwner(now: number, appointments: Appointment[], leadMin: number, notified: Set<string>): Appointment[] {
  return appointments.filter(
    (a) => !a.deletedAt && (a.status === 'booked' || a.status === 'confirmed') && a.startsAt > now && a.startsAt - now <= leadMin * MINUTE && !notified.has(a.id),
  );
}
