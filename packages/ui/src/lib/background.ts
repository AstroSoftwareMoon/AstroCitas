import { useEffect, useRef } from 'react';
import {
  buildContext,
  dueReminders,
  ensureMessagingDefaults,
  formatTime,
  isBirthday,
  pickTemplate,
  renderTemplate,
  todayLocal,
  upcomingForOwner,
  type DataAdapter,
} from '@astrocitas/core';
import type { Platform, SmtpConfig } from './platform';

export interface NotifySettings {
  enabled: boolean;
  leadMin: number;
  birthdays: boolean;
  dailySummary: boolean;
}
export const DEFAULT_NOTIFY: NotifySettings = { enabled: true, leadMin: 15, birthdays: true, dailySummary: true };
export const DEFAULT_SMTP: SmtpConfig = { enabled: false, host: '', port: 587, secure: false, user: '', pass: '', from: '' };

const DAY = 86_400_000;

/**
 * Tareas mientras la app está abierta (o en bandeja/segundo plano en Tauri):
 *  - avisos al dueño (próximas citas, resumen del día, cumpleaños);
 *  - email automático con el SMTP propio usando las MISMAS reglas que el servidor;
 *  - copia de seguridad automática diaria.
 */
export async function runBackgroundTick(db: DataAdapter, platform: Platform, state: { notified: Set<string> }, now = Date.now()) {
  const business = await db.getBusiness();
  if (!business) return;
  const tz = business.timezone;
  const today = todayLocal(tz, now);
  const notify = { ...DEFAULT_NOTIFY, ...((await db.getMeta<NotifySettings>('notify')) ?? {}) };
  const appts = await db.listAppointments({ from: now - 2 * DAY, to: now + 15 * DAY });

  // 1) Avisos al dueño
  if (notify.enabled && (await platform.notificationsAllowed())) {
    const [clients, services] = await Promise.all([db.listClients({ limit: 100_000 }), db.listServices({ includeInactive: true })]);
    const cMap = new Map(clients.map((c) => [c.id, c]));
    const sMap = new Map(services.map((s) => [s.id, s]));
    for (const a of upcomingForOwner(now, appts, notify.leadMin, state.notified)) {
      state.notified.add(a.id);
      await platform.notify(`${formatTime(a.startsAt, tz)} · ${a.clientId ? cMap.get(a.clientId)?.name ?? '' : ''}`.trim(), `${sMap.get(a.serviceId)?.name ?? ''} — ${business.name}`);
    }
    const dayKey = `day:${today}`;
    const lastDay = await db.getMeta<string>('notify.lastDaily');
    if (lastDay !== today && notify.dailySummary) {
      await db.setMeta('notify.lastDaily', today);
      const todays = appts.filter((a) => todayLocal(tz, a.startsAt) === today && (a.status === 'booked' || a.status === 'confirmed'));
      const bdays = notify.birthdays ? clients.filter((c) => isBirthday(c.birthday, today)) : [];
      const parts = [`${todays.length} cita${todays.length === 1 ? '' : 's'} hoy`];
      if (bdays.length) parts.push(`🎂 ${bdays.map((c) => c.name).join(', ')}`);
      state.notified.add(dayKey);
      await platform.notify(business.name, parts.join(' · '));
    }
  }

  // 2) Email automático con SMTP propio
  const smtp = { ...DEFAULT_SMTP, ...((await db.getMeta<SmtpConfig>('smtp')) ?? {}) };
  if (smtp.enabled && smtp.host && platform.sendEmail) {
    await ensureMessagingDefaults(db, business.locale);
    const [rules, templates, clients, services, staff, sent] = await Promise.all([
      db.listReminderRules(),
      db.listTemplates(),
      db.listClients({ limit: 100_000 }),
      db.listServices({ includeInactive: true }),
      db.listStaff({ includeInactive: true }),
      db.listMessages({ since: now - 30 * DAY, limit: 100_000 }),
    ]);
    const cMap = new Map(clients.map((c) => [c.id, c]));
    const due = dueReminders({
      now,
      appointments: appts,
      rules,
      clients: cMap,
      sentKeys: new Set(sent.map((m) => m.idempotencyKey).filter((k): k is string => !!k)),
      channels: ['email'],
    });
    for (const d of due) {
      const client = cMap.get(d.appointment.clientId!)!;
      const tpl = pickTemplate(templates, d.rule.kind, 'email');
      if (!tpl) continue;
      const ctx = buildContext({
        business,
        appointment: d.appointment,
        client,
        service: services.find((s) => s.id === d.appointment.serviceId),
        staff: staff.find((s) => s.id === d.appointment.staffId),
      });
      const subject = renderTemplate(tpl.subject || business.name, ctx);
      const text = renderTemplate(tpl.body, ctx);
      const msg = await db.saveMessage({
        appointmentId: d.appointment.id,
        clientId: client.id,
        ruleId: d.rule.id,
        kind: d.rule.kind,
        channel: 'email',
        recipient: client.email,
        subject,
        body: text,
        status: 'queued',
        idempotencyKey: d.key,
      });
      try {
        await platform.sendEmail(smtp, { to: client.email, subject, text });
        await db.saveMessage({ ...msg, status: 'sent', sentAt: Date.now(), attempts: msg.attempts + 1 });
      } catch (e) {
        await db.saveMessage({ ...msg, status: 'failed', error: String((e as Error)?.message ?? e), attempts: msg.attempts + 1 });
      }
    }
  }

  // 3) Copia automática diaria
  const lastBackup = (await db.getMeta<number>('backup.last')) ?? 0;
  if (now - lastBackup > DAY) {
    const dump = await db.exportAll();
    await platform.autoBackups.save(`auto-${new Date(now).toISOString().slice(0, 10)}.astrocitas`, JSON.stringify(dump));
    await db.setMeta('backup.last', now);
  }
}

export function useBackgroundJobs(db: DataAdapter, platform: Platform) {
  const state = useRef({ notified: new Set<string>() });
  useEffect(() => {
    let stop = false;
    const tick = () => {
      if (!stop) runBackgroundTick(db, platform, state.current).catch((e) => console.warn('[astrocitas] tarea en segundo plano:', e));
    };
    const first = setTimeout(tick, 3000);
    const id = setInterval(tick, 60_000);
    return () => {
      stop = true;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [db, platform]);
}
