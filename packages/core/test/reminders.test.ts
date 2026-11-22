import { describe, expect, it } from 'vitest';
import {
  buildContext,
  dueReminders,
  ensureMessagingDefaults,
  mailtoLink,
  normalizePhone,
  pendingManualReminders,
  pickTemplate,
  renderTemplate,
  smsLink,
  upcomingForOwner,
  whatsappLink,
} from '../src/reminders';
import { decryptJson, encryptJson, isEncryptedFile, sha256Hex } from '../src/crypto';
import { SqlAdapter } from '../src/sql';
import { nodeSqliteDriver } from '../src/testing/node-sqlite-driver';
import { localToUtc } from '../src/time';
import type { Appointment, Business, Client, ReminderRule } from '../src/types';

const TZ = 'Europe/Madrid';
const biz = { name: 'Peluquería Luna', timezone: TZ, currency: 'EUR', locale: 'es', phone: '+34 911 000 000', address: 'C/ Sol 1' } as Business;
const at = (d: string, h: number, m = 0) => localToUtc(d, h * 60 + m, TZ);

const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: 'a1', createdAt: at('2026-11-20', 9), updatedAt: 0, deletedAt: null, clientId: 'c1', staffId: 's1', serviceId: 'x',
  startsAt: at('2026-11-23', 10), endsAt: at('2026-11-23', 10, 45), bufferBeforeMin: 0, bufferAfterMin: 0, status: 'booked',
  priceCents: 2500, paidCents: 0, paymentMethod: null, notes: '', seriesId: null, source: 'staff', ...over,
});
const rule = (over: Partial<ReminderRule> = {}): ReminderRule => ({
  id: 'r24', createdAt: 0, updatedAt: 0, deletedAt: null, kind: 'reminder', anchor: 'before_start', offsetMin: 1440, channels: ['email', 'whatsapp'], active: true, ...over,
});
const clients = new Map([['c1', { email: 'lucia@ejemplo.es', phone: '600111222', consentReminders: true }]]);

describe('plantillas', () => {
  it('rellena variables con fecha/hora en la zona del negocio', () => {
    const ctx = buildContext({ business: biz, appointment: appt(), client: { name: 'Lucía García' }, service: { name: 'Corte' }, staff: { name: 'Ana' } });
    expect(renderTemplate('¡Hola {nombre}! {servicio} el {fecha} a las {hora} con {profesional} ({precio}).', ctx).replace(/\u00a0/g, ' ')).toBe(
      '¡Hola Lucía! Corte el lunes 23 de noviembre a las 10:00 con Ana (25 €).',
    );
  });
  it('variables vacías desaparecen y las desconocidas se conservan', () => {
    expect(renderTemplate('Hola {cliente} {enlace} {nope}', { cliente: 'Ana' })).toBe('Hola Ana {nope}');
  });
});

describe('enlaces de 1 toque', () => {
  it('normaliza teléfonos españoles e internacionales', () => {
    expect(normalizePhone('600 111 222')).toBe('34600111222');
    expect(normalizePhone('+34 600-111-222')).toBe('34600111222');
    expect(normalizePhone('0044 7700 900123')).toBe('447700900123');
    expect(normalizePhone('+1 (555) 010-9999')).toBe('15550109999');
  });
  it('genera wa.me, sms y mailto codificados', () => {
    expect(whatsappLink('600111222', 'Hola & adiós')).toBe('https://wa.me/34600111222?text=Hola%20%26%20adi%C3%B3s');
    expect(smsLink('600111222', 'Hola')).toBe('sms:+34600111222?&body=Hola');
    expect(mailtoLink('a@b.es', 'Asunto', 'Cuerpo')).toBe('mailto:a%40b.es?subject=Asunto&body=Cuerpo');
  });
});

describe('recordatorios debidos', () => {
  it('24 h antes, por cada canal disponible, una sola vez', () => {
    const now = at('2026-11-22', 10, 5);
    const due = dueReminders({ now, appointments: [appt()], rules: [rule()], clients, sentKeys: new Set() });
    expect(due.map((d) => d.channel)).toEqual(['email', 'whatsapp']);
    const again = dueReminders({ now, appointments: [appt()], rules: [rule()], clients, sentKeys: new Set(due.map((d) => d.key)) });
    expect(again).toEqual([]);
  });
  it('aún no toca / demasiado tarde / sin consentimiento / cancelada', () => {
    expect(dueReminders({ now: at('2026-11-22', 9), appointments: [appt()], rules: [rule()], clients, sentKeys: new Set() })).toEqual([]);
    expect(dueReminders({ now: at('2026-11-23', 9, 50), appointments: [appt()], rules: [rule()], clients, sentKeys: new Set() })).toEqual([]);
    const noConsent = new Map([['c1', { ...clients.get('c1')!, consentReminders: false }]]);
    expect(dueReminders({ now: at('2026-11-22', 10, 5), appointments: [appt()], rules: [rule()], clients: noConsent, sentKeys: new Set() })).toEqual([]);
    expect(dueReminders({ now: at('2026-11-22', 10, 5), appointments: [appt({ status: 'cancelled' })], rules: [rule()], clients, sentKeys: new Set() })).toEqual([]);
  });
  it('si la cita se mueve, la clave cambia y se vuelve a programar', () => {
    const now = at('2026-11-22', 10, 5);
    const [first] = dueReminders({ now, appointments: [appt()], rules: [rule({ channels: ['email'] })], clients, sentKeys: new Set() });
    const moved = appt({ startsAt: at('2026-11-23', 10, 30), endsAt: at('2026-11-23', 11, 15) });
    const [second] = dueReminders({ now: at('2026-11-22', 10, 35), appointments: [moved], rules: [rule({ channels: ['email'] })], clients, sentKeys: new Set([first!.key]) });
    expect(second!.key).not.toBe(first!.key);
  });
  it('agradecimiento después de completar y confirmación al reservar', () => {
    const thanks = rule({ id: 't', kind: 'thanks', anchor: 'after_end', offsetMin: 60, channels: ['email'] });
    const done = appt({ status: 'completed' });
    expect(dueReminders({ now: at('2026-11-23', 11, 50), appointments: [done], rules: [thanks], clients, sentKeys: new Set() })).toHaveLength(1);
    const conf = rule({ id: 'c', kind: 'confirmation', anchor: 'on_booking', offsetMin: 0, channels: ['email'] });
    expect(dueReminders({ now: at('2026-11-20', 9, 1), appointments: [appt()], rules: [conf], clients, sentKeys: new Set() })).toHaveLength(1);
  });
  it('pendientes manuales y avisos al dueño', () => {
    const c = new Map([['c1', { id: 'c1', name: 'L', email: '', phone: '600', consentReminders: true } as Client]]);
    expect(pendingManualReminders([appt()], [], c)).toHaveLength(1);
    expect(pendingManualReminders([appt()], [{ appointmentId: 'a1', kind: 'reminder', status: 'opened' } as never], c)).toHaveLength(0);
    expect(upcomingForOwner(at('2026-11-23', 9, 50), [appt()], 15, new Set())).toHaveLength(1);
    expect(upcomingForOwner(at('2026-11-23', 9, 30), [appt()], 15, new Set())).toHaveLength(0);
  });
});

describe('mensajería en el repositorio', () => {
  it('siembra plantillas y reglas una sola vez y elige plantilla por canal', async () => {
    const db = await SqlAdapter.open(nodeSqliteDriver());
    await ensureMessagingDefaults(db, 'es');
    await ensureMessagingDefaults(db, 'es');
    const t = await db.listTemplates();
    expect(t.filter((x) => x.kind === 'reminder')).toHaveLength(1);
    expect(pickTemplate(t, 'reminder', 'whatsapp')?.body).toContain('{nombre}');
    expect((await db.listReminderRules()).length).toBe(5);
    await db.saveMessage({ kind: 'reminder', channel: 'whatsapp', appointmentId: 'a1', status: 'opened', idempotencyKey: 'k1' });
    await expect(db.saveMessage({ kind: 'reminder', channel: 'whatsapp', appointmentId: 'a1', idempotencyKey: 'k1' })).rejects.toThrow();
    expect(await db.listMessages({ appointmentIds: ['a1'] })).toHaveLength(1);
    await db.setMeta('notify', { leadMin: 15 });
    expect(await db.getMeta('notify')).toEqual({ leadMin: 15 });
  });
});

describe('copias cifradas', () => {
  it('cifra y descifra; contraseña incorrecta falla', async () => {
    const enc = await encryptJson({ hola: 'mundo', n: [1, 2] }, 'secreta');
    expect(isEncryptedFile(enc)).toBe(true);
    expect(JSON.stringify(enc)).not.toContain('mundo');
    expect(await decryptJson(enc, 'secreta')).toEqual({ hola: 'mundo', n: [1, 2] });
    await expect(decryptJson(enc, 'otra')).rejects.toThrow(/incorrecta/);
  });
  it('sha256', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

import { generateRequestPage, requestLink } from '../src/requestPage';
describe('modo solicitud', () => {
  it('genera una página autocontenida y escapa el contenido', () => {
    const html = generateRequestPage({
      business: { ...biz, name: 'Luna <script>', email: 'hola@luna.es', kind: 'peluqueria', settings: {} } as Business,
      services: [{ name: 'Corte', durationMin: 30, priceCents: 1500, active: true } as never],
      staff: [{ active: true, hours: [{ weekday: 1, start: 570, end: 840 }] } as never],
    });
    expect(html).toContain('Luna &lt;script&gt;');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('34911000000');
    expect(html).toContain('09:30–14:00');
    expect(html).not.toMatch(/src="http/);
  });
  it('enlace del QR a WhatsApp o, si no hay teléfono, a email', () => {
    expect(requestLink({ phone: '600111222', email: '', name: 'X' }, 'Hola')).toBe('https://wa.me/34600111222?text=Hola');
    expect(requestLink({ phone: '', email: 'a@b.es', name: 'X' }, 'Hola')).toContain('mailto:a@b.es');
    expect(requestLink({ phone: '', email: '', name: 'X' }, 'Hola')).toBeNull();
  });
});
