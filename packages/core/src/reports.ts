import type { Appointment, Service, Staff, TimeOff } from './types';
import { addDays, daysBetween, toLocalDate, MINUTE } from './time';
import { busyIntervals, workIntervals } from './slots';
import { mergeIntervals, subtractIntervals, type Interval } from './intervals';

export interface ReportInput {
  from: string; // fecha local inclusiva
  to: string; // fecha local inclusiva
  timezone: string;
  appointments: Appointment[];
  services: Service[];
  staff: Staff[];
  timeOff: TimeOff[];
}

export interface Report {
  appointments: number;
  completed: number;
  cancelled: number;
  noShows: number;
  noShowRate: number;
  cancellationRate: number;
  revenueCents: number;
  expectedCents: number;
  avgTicketCents: number;
  /** Minutos reservados / minutos de horario disponibles (0..1). */
  occupancy: number;
  bookedMinutes: number;
  availableMinutes: number;
  newClients: number;
  byDay: { date: string; appointments: number; revenueCents: number }[];
  topServices: { serviceId: string; name: string; count: number; revenueCents: number }[];
  byStaff: { staffId: string; name: string; count: number; revenueCents: number; occupancy: number }[];
  byPayment: { method: string; cents: number; count: number }[];
  bySource: { source: string; count: number }[];
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const overlapMin = (a: Interval[], b: Interval[]) => {
  let t = 0;
  for (const x of a) for (const y of b) t += Math.max(0, Math.min(x.end, y.end) - Math.max(x.start, y.start));
  return t / MINUTE;
};

/** Informe de un periodo. Todo en hora local del negocio (los días con cambio de hora cuentan bien). */
export function buildReport(p: ReportInput, firstVisitByClient?: Map<string, number>): Report {
  const inRange = p.appointments.filter((a) => {
    if (a.deletedAt) return false;
    const d = toLocalDate(a.startsAt, p.timezone);
    return d >= p.from && d <= p.to;
  });
  const active = inRange.filter((a) => a.status !== 'cancelled');
  const completed = inRange.filter((a) => a.status === 'completed');
  const noShows = inRange.filter((a) => a.status === 'no_show');
  const cancelled = inRange.filter((a) => a.status === 'cancelled');
  const revenue = sum(inRange.map((a) => (a.status === 'cancelled' ? 0 : a.paidCents)));
  const paidCount = inRange.filter((a) => a.paidCents > 0 && a.status !== 'cancelled').length;
  const svc = new Map(p.services.map((s) => [s.id, s]));

  // Ocupación: minutos de horario (menos ausencias) vs minutos reservados dentro de ese horario.
  const days = daysBetween(p.from, p.to) + 1;
  let available = 0;
  let booked = 0;
  const staffOcc = new Map<string, { avail: number; booked: number }>();
  for (const s of p.staff.filter((x) => x.active)) {
    let sAvail = 0;
    let sBooked = 0;
    for (let i = 0; i < days; i++) {
      const date = addDays(p.from, i);
      const work = workIntervals(s, date, p.timezone);
      if (!work.length) continue;
      const blocked = p.timeOff.filter((t) => !t.deletedAt && (t.staffId === null || t.staffId === s.id)).map((t) => ({ start: t.startsAt, end: t.endsAt }));
      const open = subtractIntervals(work, blocked);
      sAvail += sum(open.map((x) => (x.end - x.start) / MINUTE));
      const appts = mergeIntervals(
        busyIntervals(s.id, inRange.filter((a) => a.status !== 'cancelled' && a.status !== 'no_show'), []).map((x) => ({ ...x })),
      );
      sBooked += overlapMin(open, appts.filter((x) => toLocalDate(x.start, p.timezone) === date));
    }
    available += sAvail;
    booked += sBooked;
    staffOcc.set(s.id, { avail: sAvail, booked: sBooked });
  }

  const byDay = Array.from({ length: Math.min(days, 400) }, (_, i) => {
    const date = addDays(p.from, i);
    const list = active.filter((a) => toLocalDate(a.startsAt, p.timezone) === date);
    return { date, appointments: list.length, revenueCents: sum(list.map((a) => a.paidCents)) };
  });

  const group = <K extends string>(list: Appointment[], key: (a: Appointment) => K) => {
    const m = new Map<K, Appointment[]>();
    for (const a of list) m.set(key(a), [...(m.get(key(a)) ?? []), a]);
    return m;
  };

  const topServices = [...group(active, (a) => a.serviceId)]
    .map(([id, list]) => ({ serviceId: id, name: svc.get(id)?.name ?? '—', count: list.length, revenueCents: sum(list.map((a) => a.paidCents)) }))
    .sort((a, b) => b.count - a.count || b.revenueCents - a.revenueCents);

  const byStaff = p.staff
    .map((s) => {
      const list = active.filter((a) => a.staffId === s.id);
      const o = staffOcc.get(s.id);
      return { staffId: s.id, name: s.name, count: list.length, revenueCents: sum(list.map((a) => a.paidCents)), occupancy: o && o.avail ? o.booked / o.avail : 0 };
    })
    .filter((x) => x.count > 0 || x.occupancy > 0);

  const byPayment = [...group(inRange.filter((a) => a.paidCents > 0 && a.status !== 'cancelled'), (a) => a.paymentMethod ?? 'other')]
    .map(([method, list]) => ({ method, cents: sum(list.map((a) => a.paidCents)), count: list.length }))
    .sort((a, b) => b.cents - a.cents);

  const bySource = [...group(active, (a) => a.source)].map(([source, list]) => ({ source, count: list.length }));

  const fromMs = Math.min(...inRange.map((a) => a.startsAt), Infinity);
  const newClients = firstVisitByClient
    ? [...new Set(active.map((a) => a.clientId).filter((c): c is string => !!c))].filter((c) => (firstVisitByClient.get(c) ?? Infinity) >= fromMs).length
    : 0;

  const decided = completed.length + noShows.length;
  return {
    appointments: active.length,
    completed: completed.length,
    cancelled: cancelled.length,
    noShows: noShows.length,
    noShowRate: decided ? noShows.length / decided : 0,
    cancellationRate: inRange.length ? cancelled.length / inRange.length : 0,
    revenueCents: revenue,
    expectedCents: sum(active.filter((a) => a.status !== 'no_show').map((a) => a.priceCents)),
    avgTicketCents: paidCount ? Math.round(revenue / paidCount) : 0,
    occupancy: available ? booked / available : 0,
    bookedMinutes: Math.round(booked),
    availableMinutes: Math.round(available),
    newClients,
    byDay,
    topServices,
    byStaff,
    byPayment,
    bySource,
  };
}

/** Tarjeta de fidelidad: sellos acumulados = visitas completadas − canjes × N. */
export function loyaltyStamps(completedVisits: number, redeemed: number, every: number): { stamps: number; rewardReady: boolean } {
  if (every <= 0) return { stamps: 0, rewardReady: false };
  const stamps = Math.max(0, completedVisits - redeemed * every);
  return { stamps: Math.min(stamps, every), rewardReady: stamps >= every };
}
