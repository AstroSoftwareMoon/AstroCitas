import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createChallenge, verifySolution } from 'altcha-lib';
import {
  addDays,
  computeSlots,
  ConflictError,
  dayBounds,
  groupSlotsByStart,
  ISODate,
  toIcs,
  toLocalDate,
  todayLocal,
  type Business,
} from '@astrocitas/core';
import type { SqlAdapter } from '@astrocitas/core/sql';
import { body, HttpError, type App } from '../app';
import { sha256, verifyLink } from '../security';
import { applyReply, replyLinks, type ReplyAction } from '../messaging';
import type { BusinessRow } from '../system';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface PublicDeps {
  onBooked(businessId: string, appointmentId: string): void;
  onCancelled(businessId: string, appointmentId: string): void;
}

async function resolve(app: App, slug: string): Promise<{ row: BusinessRow; db: SqlAdapter; business: Business }> {
  const row = await app.sys.businessBySlug(slug);
  if (!row || !row.public_booking) throw new HttpError(404, 'Reserva online no disponible');
  const db = await app.store.business(row.id);
  const business = await db.getBusiness();
  if (!business) throw new HttpError(404, 'Negocio no encontrado');
  return { row, db, business };
}

/** Página HTML mínima con el estilo de AstroCitas (negro + cristal) para respuestas y la reserva. */
export function page(title: string, inner: string, opts: { scripts?: string[]; lang?: string; embed?: boolean } = {}) {
  return `<!doctype html><html lang="${opts.lang ?? 'es'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="robots" content="noindex"><link rel="stylesheet" href="/public/booking.css">
</head><body class="${opts.embed ? 'embed' : ''}"><main>${inner}</main>${(opts.scripts ?? []).map((s) => `<script src="${s}" defer></script>`).join('')}</body></html>`;
}

export function publicRoutes(f: FastifyInstance, app: App, deps: PublicDeps) {
  const hmacKey = sha256(`altcha:${app.cfg.secret}`);
  const assets = join(new URL('.', import.meta.url).pathname, '..', 'public');
  const asset = (name: string) => {
    for (const dir of [assets, join(process.cwd(), 'public'), join(new URL('.', import.meta.url).pathname, '..', '..', 'public')]) {
      try {
        return readFileSync(join(dir, name));
      } catch {
        /* probar siguiente */
      }
    }
    throw new HttpError(404, 'No encontrado');
  };

  // ---------- recursos estáticos de la reserva y el widget ----------
  f.get<{ Params: { file: string } }>('/public/:file', async (req, reply) => {
    if (!/^[\w.-]+\.(js|css)$/.test(req.params.file)) throw new HttpError(404, 'No encontrado');
    return reply
      .type(req.params.file.endsWith('.js') ? 'text/javascript' : 'text/css')
      .header('Cache-Control', 'public, max-age=3600')
      .send(asset(req.params.file));
  });
  f.get('/widget.js', async (_req, reply) => reply.type('text/javascript').header('Cache-Control', 'public, max-age=3600').header('Access-Control-Allow-Origin', '*').send(asset('widget.js')));

  // ---------- página de reserva ----------
  f.get<{ Params: { slug: string }; Querystring: { embed?: string; r?: string } }>('/b/:slug', async (req, reply) => {
    const { business } = await resolve(app, req.params.slug);
    const inner = `<div id="app" data-slug="${esc(req.params.slug)}" data-reschedule="${esc(req.query.r ?? '')}" data-captcha="${app.cfg.captcha ? '1' : '0'}"><p class="muted">${esc(business.name)}</p><h1>${business.locale === 'en' ? 'Book an appointment' : 'Reserva tu cita'}</h1><noscript>Activa JavaScript para reservar.</noscript></div>`;
    return reply
      .type('text/html')
      .header('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors *; base-uri 'none'")
      .send(page(business.name, inner, { scripts: ['/public/booking.js'], lang: business.locale, embed: req.query.embed === '1' }));
  });

  // ---------- API pública ----------
  f.get<{ Params: { slug: string } }>('/api/v1/public/:slug', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const { db, business } = await resolve(app, req.params.slug);
    const [services, staff] = await Promise.all([db.listServices(), db.listStaff()]);
    return {
      business: { name: business.name, address: business.address, phone: business.phone, timezone: business.timezone, locale: business.locale, currency: business.currency },
      services: services.map((s) => ({ id: s.id, name: s.name, category: s.category, durationMin: s.durationMin, priceCents: s.priceCents, color: s.color })),
      staff: staff.map((s) => ({ id: s.id, name: s.name, color: s.color, serviceIds: s.serviceIds })),
      today: todayLocal(business.timezone),
      captcha: app.cfg.captcha,
    };
  });

  const slotQuery = z.object({ service: z.string(), staff: z.string().optional(), date: ISODate });
  async function slotsFor(db: SqlAdapter, business: Business, q: z.infer<typeof slotQuery>, ignore?: string) {
    const services = await db.listServices();
    const service = services.find((s) => s.id === q.service);
    if (!service) throw new HttpError(400, 'Servicio no válido');
    const staff = (await db.listStaff()).filter((s) => !q.staff || s.id === q.staff);
    const [from, to] = dayBounds(q.date, business.timezone);
    return computeSlots({
      date: q.date,
      service,
      staff,
      appointments: await db.listAppointments({ from: from - 86_400_000, to: to + 86_400_000 }),
      timeOff: await db.listTimeOff({ from, to }),
      timezone: business.timezone,
      step: business.settings.slotStep,
      now: Date.now(),
      minNoticeMin: Math.max(business.settings.minNotice, 30),
      ignoreAppointmentId: ignore,
    });
  }

  f.get<{ Params: { slug: string }; Querystring: Record<string, string> }>('/api/v1/public/:slug/slots', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const { db, business } = await resolve(app, req.params.slug);
    const q = slotQuery.parse(req.query);
    return { slots: groupSlotsByStart(await slotsFor(db, business, q)).map((s) => ({ start: s.start, end: s.end, staffIds: s.staffIds })) };
  });

  /** Disponibilidad de los próximos días (para pintar el calendario de la reserva). */
  f.get<{ Params: { slug: string }; Querystring: Record<string, string> }>('/api/v1/public/:slug/days', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const { db, business } = await resolve(app, req.params.slug);
    const q = z.object({ service: z.string(), staff: z.string().optional(), from: ISODate.optional(), days: z.coerce.number().int().min(1).max(42).default(21) }).parse(req.query);
    const start = q.from ?? todayLocal(business.timezone);
    const out: { date: string; count: number }[] = [];
    for (let i = 0; i < q.days; i++) {
      const date = addDays(start, i);
      out.push({ date, count: groupSlotsByStart(await slotsFor(db, business, { service: q.service, staff: q.staff, date })).length });
    }
    return { days: out };
  });

  f.get('/api/v1/public/captcha', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async () =>
    createChallenge({ hmacKey, maxNumber: 80_000, expires: new Date(Date.now() + 10 * 60_000) }),
  );

  const Book = z.object({
    serviceId: z.string(),
    staffId: z.string().nullable().default(null),
    startsAt: z.number().int(),
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(40).default(''),
    email: z.string().trim().max(200).default(''),
    notes: z.string().max(500).default(''),
    consent: z.literal(true, { message: 'Debes aceptar la política de privacidad' }),
    altcha: z.string().max(5000).optional(),
    reschedule: z.string().max(500).optional(),
  });

  f.post<{ Params: { slug: string } }>('/api/v1/public/:slug/book', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (req) => {
    const { row, db, business } = await resolve(app, req.params.slug);
    const b = Book.parse(body(req));
    if (app.cfg.captcha && !(b.altcha && (await verifySolution(b.altcha, hmacKey, true)))) throw new HttpError(400, 'Verificación anti-spam no superada');
    if (!b.phone && !b.email) throw new HttpError(400, 'Indica un teléfono o un email');

    // Reprogramación desde el botón «Cambiar»: se mueve la cita existente en vez de crear otra.
    let existing = null as Awaited<ReturnType<typeof db.getAppointment>>;
    if (b.reschedule) {
      const p = verifyLink<{ b: string; a: string; x: ReplyAction; s: number }>(app.cfg.secret, b.reschedule);
      if (!p || p.b !== row.id || p.x !== 'change') throw new HttpError(400, 'Enlace no válido');
      existing = await db.getAppointment(p.a);
      if (!existing || existing.startsAt !== p.s || existing.status === 'cancelled') throw new HttpError(409, 'Esta cita ya ha cambiado');
    }

    const date = toLocalDate(b.startsAt, business.timezone);
    const slots = await slotsFor(db, business, { service: b.serviceId, staff: b.staffId ?? undefined, date }, existing?.id);
    const slot = slots.find((s) => s.start === b.startsAt);
    if (!slot) throw new HttpError(409, 'Ese hueco ya no está disponible, elige otro');
    const service = (await db.listServices()).find((s) => s.id === b.serviceId)!;

    // Cliente: se reutiliza por teléfono o email.
    let client = existing?.clientId ? await db.getClient(existing.clientId) : null;
    if (!client) {
      const digits = b.phone.replace(/\D/g, '');
      const candidates = digits.length >= 6 ? await db.listClients({ search: digits }) : b.email ? await db.listClients({ search: b.email }) : [];
      client = candidates.find((c) => (digits && c.phone.replace(/\D/g, '').endsWith(digits.slice(-9))) || (b.email && c.email.toLowerCase() === b.email.toLowerCase())) ?? null;
    }
    if (!client) client = await db.saveClient({ name: b.name, phone: b.phone, email: b.email, consentReminders: true, tags: ['Online'] });

    try {
      // SerialDb + trigger SQL: aunque lleguen dos reservas a la vez, solo una gana.
      const appt = await db.saveAppointment(
        {
          ...(existing ?? {}),
          clientId: client.id,
          staffId: slot.staffId,
          serviceId: service.id,
          startsAt: slot.start,
          endsAt: slot.end,
          bufferBeforeMin: service.bufferBeforeMin,
          bufferAfterMin: service.bufferAfterMin,
          priceCents: service.priceCents,
          status: 'booked',
          notes: [existing?.notes, b.notes].filter(Boolean).join('\n'),
          source: 'online',
        },
        { force: true },
      );
      await app.sys.audit({ businessId: row.id, action: existing ? 'online_reschedule' : 'online_booking', entity: 'appointments', entityId: appt.id, ip: req.ip });
      deps.onBooked(row.id, appt.id);
      return { ok: true, appointment: { id: appt.id, startsAt: appt.startsAt, endsAt: appt.endsAt, service: service.name }, links: replyLinks(app, row.id, appt) };
    } catch (e) {
      if (e instanceof ConflictError) throw new HttpError(409, 'Ese hueco ya no está disponible, elige otro');
      throw e;
    }
  });

  // ---------- respuestas Confirmo / Cancelar / Cambiar ----------
  const texts = (lang: string) =>
    lang === 'en'
      ? { confirm: 'Confirm appointment', cancel: 'Cancel appointment', done_confirm: 'Appointment confirmed. See you soon!', done_cancel: 'Appointment cancelled.', changed: 'This appointment has changed. Check your latest message.', past: 'This appointment has already taken place.', not_found: 'Appointment not found.', cancelled: 'This appointment was cancelled.' }
      : { confirm: 'Confirmar cita', cancel: 'Cancelar cita', done_confirm: '¡Cita confirmada! Te esperamos.', done_cancel: 'Cita cancelada.', changed: 'Esta cita ha cambiado. Revisa tu último mensaje.', past: 'Esta cita ya ha pasado.', not_found: 'No encontramos la cita.', cancelled: 'Esta cita está cancelada.' };

  f.get<{ Params: { token: string } }>('/r/:token', async (req, reply) => {
    const p = verifyLink<{ b: string; a: string; x: ReplyAction; s: number }>(app.cfg.secret, req.params.token);
    if (!p) throw new HttpError(400, 'Enlace no válido');
    const row = await app.sys.businessById(p.b);
    if (!row) throw new HttpError(404, 'No encontrado');
    if (p.x === 'change') return reply.redirect(`/b/${row.slug}?r=${encodeURIComponent(req.params.token)}`);
    const db = await app.store.business(row.id);
    const business = (await db.getBusiness())!;
    const t = texts(business.locale);
    const a = await db.getAppointment(p.a);
    const when = a ? new Intl.DateTimeFormat(business.locale === 'en' ? 'en-GB' : 'es-ES', { timeZone: business.timezone, dateStyle: 'full', timeStyle: 'short' }).format(a.startsAt) : '';
    // GET solo muestra un botón: los antivirus/previsualizadores que abren enlaces no cancelan citas.
    const inner = `<div class="glass"><p class="muted">${esc(business.name)}</p><h1>${esc(when)}</h1>
<form method="post"><button class="primary" type="submit">${p.x === 'cancel' ? t.cancel : t.confirm}</button></form></div>`;
    return reply.type('text/html').send(page(business.name, inner, { lang: business.locale }));
  });

  f.post<{ Params: { token: string } }>('/r/:token', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const p = verifyLink<{ b: string; a: string; x: ReplyAction; s: number }>(app.cfg.secret, req.params.token);
    if (!p || p.x === 'change') throw new HttpError(400, 'Enlace no válido');
    const db = await app.store.business(p.b);
    const business = (await db.getBusiness())!;
    const t = texts(business.locale);
    const r = await applyReply(db, p.a, p.s, p.x);
    if (r.ok) {
      await app.sys.audit({ businessId: p.b, action: `reply_${p.x}`, entity: 'appointments', entityId: p.a, ip: req.ip });
      if (p.x === 'cancel') deps.onCancelled(p.b, p.a);
    }
    const msg = r.ok ? (p.x === 'cancel' ? t.done_cancel : t.done_confirm) : t[(r.reason ?? 'not_found') as keyof typeof t];
    return reply.type('text/html').send(page(business.name, `<div class="glass"><p class="muted">${esc(business.name)}</p><h1>${esc(msg)}</h1></div>`, { lang: business.locale }));
  });

  // ---------- calendario suscribible (.ics) ----------
  f.get<{ Params: { bid: string; token: string } }>('/ics/:bid/:token', async (req, reply) => {
    const token = req.params.token.replace(/\.ics$/, '');
    const row = await app.sys.businessById(req.params.bid);
    if (!row || !row.ics_token || row.ics_token !== token) throw new HttpError(404, 'No encontrado');
    const db = await app.store.business(row.id);
    const now = Date.now();
    const [appts, services, staff, clients] = await Promise.all([
      db.listAppointments({ from: now - 30 * 86_400_000, to: now + 180 * 86_400_000, includeCancelled: true }),
      db.listServices({ includeInactive: true }),
      db.listStaff({ includeInactive: true }),
      db.listClients({ limit: 100_000 }),
    ]);
    const svc = new Map(services.map((s) => [s.id, s.name]));
    const stf = new Map(staff.map((s) => [s.id, s.name]));
    const cli = new Map(clients.map((c) => [c.id, c]));
    const ics = toIcs({
      name: row.name,
      events: appts.map((a) => ({
        uid: a.id,
        start: a.startsAt,
        end: a.endsAt,
        updatedAt: a.updatedAt,
        summary: [a.clientId ? cli.get(a.clientId)?.name : null, svc.get(a.serviceId)].filter(Boolean).join(' · '),
        description: [stf.get(a.staffId), a.clientId ? cli.get(a.clientId)?.phone : '', a.notes].filter(Boolean).join('\n'),
        status: a.status === 'cancelled' || a.status === 'no_show' ? 'CANCELLED' : a.status === 'booked' ? 'TENTATIVE' : 'CONFIRMED',
      })),
    });
    return reply.type('text/calendar; charset=utf-8').header('Cache-Control', 'private, max-age=300').send(ics);
  });
}
