import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, defaultHours, localToUtc, todayLocal } from '@astrocitas/core';
import { setupAdmin, testServer } from './helpers';
import { automationPlugin } from '../src/plugins';
import { backoffMs, DbQueue, PermanentJobError } from '../src/jobs';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  vi.unstubAllGlobals();
  await close?.();
  close = null;
});

const TZ = 'Europe/Madrid';
/** Próximo lunes (laborable con defaultHours) a partir de mañana. */
function nextMonday(): string {
  let d = addDays(todayLocal(TZ), 1);
  while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1);
  return d;
}

async function world() {
  const plugin = automationPlugin();
  const { srv, call } = await testServer({ plugins: [plugin] });
  close = srv.close;
  const s = await setupAdmin(call);
  const bid = s.memberships[0]!.businessId;
  const rpc = (method: string, ...args: unknown[]) =>
    call('POST', `/api/v1/b/${bid}/rpc`, { method, args }, s.accessToken).then((r) => {
      if (r.status !== 200) throw new Error(JSON.stringify(r.json));
      return r.json.result;
    });
  const ana = await rpc('saveStaff', { name: 'Ana', hours: defaultHours() });
  const svc = await rpc('saveService', { name: 'Corte', durationMin: 30, priceCents: 1500 });
  const cli = await rpc('saveClient', { name: 'Lucía García', email: 'lucia@ejemplo.es', phone: '600111222' });
  await call('PUT', `/api/v1/b/${bid}/providers/resend`, { config: { apiKey: 're_test_1234567890', from: 'Luna <citas@luna.es>' } }, s.accessToken);
  const sent: { to: string[]; subject: string; text: string }[] = [];
  let failNext = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (String(url).startsWith('https://api.resend.com')) {
      if (failNext > 0) {
        failNext--;
        return new Response('down', { status: 503 });
      }
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: `re_${sent.length}` }), { status: 200 });
    }
    throw new Error(`fetch inesperado ${url}`);
  });
  const day = nextMonday();
  return { srv, call, plugin, s, bid, rpc, ana, svc, cli, sent, day, at: (h: number, m = 0) => localToUtc(day, h * 60 + m, TZ), failNext: (n: number) => (failNext = n) };
}

describe('cola de tareas', () => {
  it('backoff exponencial acotado', () => {
    expect(backoffMs(1, () => 0.5)).toBe(30_000);
    expect(backoffMs(3, () => 0.5)).toBe(120_000);
    expect(backoffMs(30, () => 0.5)).toBe(6 * 3600_000);
  });

  it('idempotencia, reintentos y errores permanentes', async () => {
    const { srv } = await testServer();
    close = srv.close;
    const q = new DbQueue(srv.app.store.system, { error: () => undefined });
    let calls = 0;
    q.register('t', async (j) => {
      calls++;
      if (j.payload.mode === 'flaky' && j.attempts < 2) throw new Error('temporal');
      if (j.payload.mode === 'bad') throw new PermanentJobError('no');
    });
    await q.enqueue({ type: 't', payload: { mode: 'flaky' }, idempotencyKey: 'k1' });
    await q.enqueue({ type: 't', payload: { mode: 'flaky' }, idempotencyKey: 'k1' }); // duplicado ignorado
    await q.enqueue({ type: 't', payload: { mode: 'bad' } });
    await q.tick();
    expect(calls).toBe(2);
    expect(await q.stats()).toMatchObject({ pending: 1, failed: 1 });
    await q.tick(Date.now() + 10 * 60_000); // pasado el backoff
    expect(calls).toBe(3);
    expect(await q.stats()).toMatchObject({ done: 1, failed: 1 });
  });
});

describe('recordatorios automáticos', () => {
  it('24 h antes envía email con Confirmo/Cancelar/Cambiar; reintenta si el proveedor falla; no duplica', async () => {
    const w = await world();
    const appt = await w.rpc('saveAppointment', { clientId: w.cli.id, staffId: w.ana.id, serviceId: w.svc.id, startsAt: w.at(10), endsAt: w.at(10, 30) });
    const q = w.plugin.queue();

    // Confirmación al reservar (regla on_booking)
    await w.plugin.scanAll(Date.now());
    await q.tick();
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]!.subject).toMatch(/Cita confirmada/);

    // 24 h antes: el proveedor falla una vez → reintento con backoff
    w.failNext(1);
    await w.plugin.scanAll(w.at(10) - 24 * 3600_000 + 60_000);
    await q.tick();
    expect(w.sent).toHaveLength(1);
    await q.tick(Date.now() + 10 * 60_000);
    expect(w.sent).toHaveLength(2);
    const reminder = w.sent[1]!;
    expect(reminder.to).toEqual(['lucia@ejemplo.es']);
    expect(reminder.text).toContain('Lucía');
    expect(reminder.text).toMatch(/Confirmo: http.*\/r\//);

    // Volver a escanear no duplica
    await w.plugin.scanAll(w.at(10) - 24 * 3600_000 + 120_000);
    await q.tick(Date.now() + 20 * 60_000);
    expect(w.sent).toHaveLength(2);
    const msgs = await w.rpc('listMessages', { appointmentIds: [appt.id] });
    expect(msgs.filter((m: { status: string }) => m.status === 'sent')).toHaveLength(2);

    // Confirmar desde el enlace: GET muestra un botón (no cambia nada), POST confirma
    const token = reminder.text.match(/Confirmo: (\S+)/)![1]!.split('/r/')[1]!;
    const view = await w.srv.fastify.inject({ method: 'GET', url: `/r/${token}` });
    expect(view.body).toContain('<form method="post">');
    expect((await w.rpc('getAppointment', appt.id)).status).toBe('booked');
    const post = await w.srv.fastify.inject({ method: 'POST', url: `/r/${token}` });
    expect(post.body).toContain('Cita confirmada');
    expect((await w.rpc('getAppointment', appt.id)).status).toBe('confirmed');
  });

  it('si la cita se mueve antes de enviar, el mensaje viejo se descarta y se programa uno nuevo', async () => {
    const w = await world();
    await w.rpc('saveReminderRule', { ...(await w.rpc('listReminderRules')).find((r: { anchor: string }) => r.anchor === 'on_booking'), active: false });
    const appt = await w.rpc('saveAppointment', { clientId: w.cli.id, staffId: w.ana.id, serviceId: w.svc.id, startsAt: w.at(10), endsAt: w.at(10, 30) });
    const q = w.plugin.queue();
    await w.plugin.scanAll(w.at(10) - 24 * 3600_000 + 60_000); // encolado (sin procesar)
    await w.rpc('saveAppointment', { ...appt, startsAt: w.at(12), endsAt: w.at(12, 30) });
    await q.tick();
    expect(w.sent).toHaveLength(0);
    const msgs = await w.rpc('listMessages', { appointmentIds: [appt.id] });
    expect(msgs[0].status).toBe('cancelled');
    await w.plugin.scanAll(w.at(12) - 24 * 3600_000 + 60_000);
    await q.tick();
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]!.text).toContain('12:00');
  });
});

describe('reserva pública', () => {
  it('info, huecos, reserva, anti doble reserva concurrente y .ics', async () => {
    const w = await world();
    const pub = (await w.call('GET', `/api/v1/b/${w.bid}/public`, undefined, w.s.accessToken)).json;
    const info = await w.call('GET', `/api/v1/public/${pub.slug}`);
    expect(info.json.services[0].name).toBe('Corte');
    const slots = await w.call('GET', `/api/v1/public/${pub.slug}/slots?service=${w.svc.id}&date=${w.day}`);
    const first = slots.json.slots[0];
    expect(first.start).toBe(w.at(9, 30));
    const page = await w.srv.fastify.inject({ method: 'GET', url: `/b/${pub.slug}` });
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");

    const book = (name: string) =>
      w.call('POST', `/api/v1/public/${pub.slug}/book`, { serviceId: w.svc.id, startsAt: first.start, name, phone: '600 999 888', consent: true });
    // 5 reservas simultáneas del mismo hueco: solo una gana
    const results = await Promise.all(['A', 'B', 'C', 'D', 'E'].map((n) => book(`Cliente ${n}`)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    const ok = results.find((r) => r.status === 200)!;
    expect(ok.json.links.change).toContain('/r/');
    const appts = await w.rpc('listAppointments', { from: w.at(0), to: w.at(23) });
    expect(appts).toHaveLength(1);
    expect(appts[0].source).toBe('online');

    // «Cambiar»: redirige a la reserva con el token y mueve la misma cita
    const token = ok.json.links.change.split('/r/')[1];
    const redirect = await w.srv.fastify.inject({ method: 'GET', url: `/r/${token}` });
    expect(redirect.statusCode).toBe(302);
    const moved = await w.call('POST', `/api/v1/public/${pub.slug}/book`, { serviceId: w.svc.id, startsAt: w.at(11), name: 'Xavi', phone: '600 999 888', consent: true, reschedule: token });
    expect(moved.status).toBe(200);
    expect((await w.rpc('listAppointments', { from: w.at(0), to: w.at(23) })).map((a: { startsAt: number }) => a.startsAt)).toEqual([w.at(11)]);

    // Calendario suscribible
    const ics = await w.srv.fastify.inject({ method: 'GET', url: new URL(pub.icsUrl).pathname });
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.body).toContain('BEGIN:VEVENT');
    expect((await w.srv.fastify.inject({ method: 'GET', url: `/ics/${w.bid}/mal.ics` })).statusCode).toBe(404);

    // Datos inválidos → 400 claro (no 500)
    const bad = await w.call('POST', `/api/v1/public/${pub.slug}/book`, { serviceId: w.svc.id, startsAt: w.at(12), name: 'X', phone: '600', consent: true });
    expect(bad.status).toBe(400);
    // Validación: sin consentimiento no se reserva
    expect((await w.call('POST', `/api/v1/public/${pub.slug}/book`, { serviceId: w.svc.id, startsAt: w.at(12), name: 'Y', phone: '6', consent: false })).status).toBe(400);
    // Desactivar la reserva online
    await w.call('PUT', `/api/v1/b/${w.bid}/public`, { enabled: false }, w.s.accessToken);
    expect((await w.call('GET', `/api/v1/public/${pub.slug}`)).status).toBe(404);
  });

  it('CAPTCHA ALTCHA obligatorio cuando está activo', async () => {
    const plugin = automationPlugin();
    const { srv, call } = await testServer({ plugins: [plugin], env: { CAPTCHA: 'true' } });
    close = srv.close;
    const s = await setupAdmin(call);
    const pub = (await call('GET', `/api/v1/b/${s.memberships[0]!.businessId}/public`, undefined, s.accessToken)).json;
    const r = await call('POST', `/api/v1/public/${pub.slug}/book`, { serviceId: 'x', startsAt: 0, name: 'Bot', phone: '600', consent: true });
    expect(r.status).toBe(400);
    expect(r.json.message).toMatch(/anti-spam/);
    const ch = await call('GET', '/api/v1/public/captcha');
    expect(ch.json).toHaveProperty('challenge');
  });
});

describe('lista de espera', () => {
  it('al cancelar, avisa a quien espera ese servicio ese día', async () => {
    const w = await world();
    const appt = await w.rpc('saveAppointment', { staffId: w.ana.id, serviceId: w.svc.id, startsAt: w.at(10), endsAt: w.at(10, 30) });
    const mateo = await w.rpc('saveClient', { name: 'Mateo', email: 'mateo@ejemplo.es' });
    await w.rpc('saveWaitlist', { clientId: mateo.id, serviceId: w.svc.id, fromDate: w.day, toDate: w.day });
    await w.rpc('saveAppointment', { ...appt, status: 'cancelled' });
    await w.plugin.scanAll(Date.now());
    await w.plugin.queue().tick();
    const toMateo = w.sent.filter((m) => m.to[0] === 'mateo@ejemplo.es');
    expect(toMateo).toHaveLength(1);
    expect(toMateo[0]!.text).toMatch(/hueco/);
    expect((await w.rpc('listWaitlist'))).toHaveLength(0); // ya no está "waiting"
  });
});
