import { BLOCKING_STATUSES, type Appointment, type Service, type Staff, type TimeOff } from './types';
import { dayBounds, isoWeekday, localToUtc, MINUTE } from './time';
import { overlaps, subtractIntervals, type Interval } from './intervals';

export type SlotService = Pick<Service, 'id' | 'durationMin' | 'bufferBeforeMin' | 'bufferAfterMin'>;
export type SlotStaff = Pick<Staff, 'id' | 'hours' | 'serviceIds' | 'active'>;
export type SlotAppointment = Pick<
  Appointment,
  'id' | 'staffId' | 'startsAt' | 'endsAt' | 'bufferBeforeMin' | 'bufferAfterMin' | 'status'
> & { deletedAt?: number | null };
export type SlotTimeOff = Pick<TimeOff, 'staffId' | 'startsAt' | 'endsAt'> & { deletedAt?: number | null };

export interface SlotQuery {
  /** Fecha local 'YYYY-MM-DD' en la zona del negocio. */
  date: string;
  service: SlotService;
  staff: SlotStaff[];
  appointments: SlotAppointment[];
  timeOff: SlotTimeOff[];
  timezone: string;
  /** Rejilla de inicio en minutos (desde medianoche local). */
  step?: number;
  /** Instante actual (para no ofrecer huecos pasados). */
  now?: number;
  minNoticeMin?: number;
  /** Al reprogramar: ignorar la propia cita. */
  ignoreAppointmentId?: string;
}

export interface Slot {
  start: number;
  end: number;
  staffId: string;
}

export function staffCanDo(staff: SlotStaff, serviceId: string): boolean {
  return staff.active && (staff.serviceIds.length === 0 || staff.serviceIds.includes(serviceId));
}

/** Tramos de trabajo de un profesional en una fecha local, en UTC. */
export function workIntervals(staff: SlotStaff, date: string, tz: string): Interval[] {
  const wd = isoWeekday(date, tz);
  return staff.hours
    .filter((h) => h.weekday === wd)
    .map((h) => ({ start: localToUtc(date, h.start, tz), end: localToUtc(date, h.end, tz) }));
}

/** Intervalos ocupados de un profesional (citas con sus buffers + ausencias propias y del negocio). */
export function busyIntervals(
  staffId: string,
  appointments: SlotAppointment[],
  timeOff: SlotTimeOff[],
  ignoreAppointmentId?: string,
): Interval[] {
  const busy: Interval[] = [];
  for (const a of appointments) {
    if (a.deletedAt || a.staffId !== staffId || a.id === ignoreAppointmentId) continue;
    if (!BLOCKING_STATUSES.includes(a.status)) continue;
    busy.push({ start: a.startsAt - a.bufferBeforeMin * MINUTE, end: a.endsAt + a.bufferAfterMin * MINUTE });
  }
  for (const t of timeOff) {
    if (t.deletedAt) continue;
    if (t.staffId === null || t.staffId === staffId) busy.push({ start: t.startsAt, end: t.endsAt });
  }
  return busy;
}

/**
 * Calcula los huecos libres para un servicio en una fecha.
 * Un inicio `t` es válido si el bloque [t − bufferAntes, t + duración + bufferDespués)
 * cabe entero en el horario del profesional sin tocar citas (con sus buffers) ni ausencias.
 */
export function computeSlots(q: SlotQuery): Slot[] {
  const step = (q.step ?? 15) * MINUTE;
  const dur = q.service.durationMin * MINUTE;
  const before = q.service.bufferBeforeMin * MINUTE;
  const after = q.service.bufferAfterMin * MINUTE;
  const earliest = q.now !== undefined ? q.now + (q.minNoticeMin ?? 0) * MINUTE : -Infinity;
  const [dayStart] = dayBounds(q.date, q.timezone);
  const slots: Slot[] = [];

  for (const s of q.staff) {
    if (!staffCanDo(s, q.service.id)) continue;
    const free = subtractIntervals(
      workIntervals(s, q.date, q.timezone),
      busyIntervals(s.id, q.appointments, q.timeOff, q.ignoreAppointmentId),
    );
    for (const f of free) {
      // Primer inicio alineado a la rejilla dentro del tramo libre.
      const firstStart = f.start + before;
      let t = dayStart + Math.ceil((firstStart - dayStart) / step) * step;
      for (; t + dur + after <= f.end; t += step) {
        if (t < earliest) continue;
        slots.push({ start: t, end: t + dur, staffId: s.id });
      }
    }
  }
  return slots.sort((a, b) => a.start - b.start || a.staffId.localeCompare(b.staffId));
}

/** Agrupa huecos por hora de inicio (modo "cualquier profesional"). */
export function groupSlotsByStart(slots: Slot[]): { start: number; end: number; staffIds: string[] }[] {
  const map = new Map<number, { start: number; end: number; staffIds: string[] }>();
  for (const s of slots) {
    const g = map.get(s.start);
    if (g) g.staffIds.push(s.staffId);
    else map.set(s.start, { start: s.start, end: s.end, staffIds: [s.staffId] });
  }
  return [...map.values()];
}

export type ConflictKind = 'overlap' | 'buffer' | 'time_off' | 'outside_hours' | 'staff_cannot';
export interface Conflict {
  kind: ConflictKind;
  /** error = bloquea guardar; warning = se puede forzar. */
  level: 'error' | 'warning';
  appointmentId?: string;
}

/**
 * Comprueba una cita propuesta contra la agenda. Los solapes reales son errores (prevención de
 * doble reserva); buffers, ausencias y fuera de horario son avisos que el negocio puede forzar.
 */
export function findConflicts(
  proposal: SlotAppointment & { serviceId: string },
  ctx: { staff?: SlotStaff; appointments: SlotAppointment[]; timeOff: SlotTimeOff[]; timezone: string },
): Conflict[] {
  const out: Conflict[] = [];
  const core: Interval = { start: proposal.startsAt, end: proposal.endsAt };
  const padded: Interval = {
    start: proposal.startsAt - proposal.bufferBeforeMin * MINUTE,
    end: proposal.endsAt + proposal.bufferAfterMin * MINUTE,
  };
  if (!BLOCKING_STATUSES.includes(proposal.status)) return out;

  for (const a of ctx.appointments) {
    if (a.deletedAt || a.id === proposal.id || a.staffId !== proposal.staffId) continue;
    if (!BLOCKING_STATUSES.includes(a.status)) continue;
    const other: Interval = { start: a.startsAt, end: a.endsAt };
    const otherPadded: Interval = {
      start: a.startsAt - a.bufferBeforeMin * MINUTE,
      end: a.endsAt + a.bufferAfterMin * MINUTE,
    };
    if (overlaps(core, other)) out.push({ kind: 'overlap', level: 'error', appointmentId: a.id });
    else if (overlaps(padded, other) || overlaps(core, otherPadded))
      out.push({ kind: 'buffer', level: 'warning', appointmentId: a.id });
  }
  for (const t of ctx.timeOff) {
    if (t.deletedAt) continue;
    if ((t.staffId === null || t.staffId === proposal.staffId) && overlaps(core, { start: t.startsAt, end: t.endsAt })) {
      out.push({ kind: 'time_off', level: 'warning' });
      break;
    }
  }
  if (ctx.staff) {
    if (!staffCanDo(ctx.staff, proposal.serviceId)) out.push({ kind: 'staff_cannot', level: 'warning' });
    // Fuera de horario: la cita debe caber en algún tramo del día local de inicio (o del anterior si cruza medianoche).
    const dates = adjacentLocalDates(proposal.startsAt, ctx.timezone);
    const work = dates.flatMap((d) => workIntervals(ctx.staff!, d, ctx.timezone));
    const inside = work.some((w) => w.start <= core.start && core.end <= w.end);
    if (!inside) out.push({ kind: 'outside_hours', level: 'warning' });
  }
  return out;
}

function adjacentLocalDates(ms: number, tz: string): string[] {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return [fmt.format(ms - 24 * 3600_000), fmt.format(ms)];
}
