import { describe, expect, it } from 'vitest';
import { computeSlots, findConflicts, groupSlotsByStart, type SlotAppointment } from '../src/slots';
import { localToUtc, toLocalMinutes } from '../src/time';

const TZ = 'Europe/Madrid';
const H = (h: number, m = 0) => h * 60 + m;
const staff = (id: string, hours = [{ weekday: 1, start: H(9), end: H(13) }], serviceIds: string[] = []) => ({
  id,
  hours,
  serviceIds,
  active: true,
});
const svc = { id: 'corte', durationMin: 30, bufferBeforeMin: 0, bufferAfterMin: 0 };
const MON = '2026-11-16';
const appt = (id: string, staffId: string, from: number, to: number, extra: Partial<SlotAppointment> = {}): SlotAppointment => ({
  id,
  staffId,
  startsAt: localToUtc(MON, from, TZ),
  endsAt: localToUtc(MON, to, TZ),
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  status: 'booked',
  ...extra,
});
const mins = (slots: { start: number }[]) => slots.map((s) => toLocalMinutes(s.start, TZ));

describe('cálculo de huecos', () => {
  it('ofrece la jornada completa en pasos de 15 min', () => {
    const s = computeSlots({ date: MON, service: svc, staff: [staff('a')], appointments: [], timeOff: [], timezone: TZ });
    expect(mins(s)[0]).toBe(H(9));
    expect(mins(s).at(-1)).toBe(H(12, 30)); // 12:30 + 30 = 13:00
    expect(s).toHaveLength(15);
  });

  it('no ofrece huecos el día que no trabaja', () => {
    const s = computeSlots({ date: '2026-11-17', service: svc, staff: [staff('a')], appointments: [], timeOff: [], timezone: TZ });
    expect(s).toEqual([]);
  });

  it('respeta citas existentes y sus buffers', () => {
    const s = computeSlots({
      date: MON,
      service: svc,
      staff: [staff('a')],
      appointments: [appt('x', 'a', H(10), H(11), { bufferAfterMin: 15 })],
      timeOff: [],
      timezone: TZ,
    });
    const m = mins(s);
    expect(m).toContain(H(9, 30)); // 9:30-10:00 cabe justo
    expect(m).not.toContain(H(9, 45));
    expect(m).not.toContain(H(11)); // buffer hasta 11:15
    expect(m).toContain(H(11, 15));
  });

  it('aplica el buffer del servicio nuevo antes y después', () => {
    const s = computeSlots({
      date: MON,
      service: { ...svc, bufferBeforeMin: 10, bufferAfterMin: 10 },
      staff: [staff('a')],
      appointments: [],
      timeOff: [],
      timezone: TZ,
    });
    expect(mins(s)[0]).toBe(H(9, 15)); // 9:00 + 10 min de preparación → siguiente paso 9:15
    expect(mins(s).at(-1)).toBe(H(12, 15)); // 12:15+30+10 = 12:55 ≤ 13:00
  });

  it('ignora citas canceladas y borradas, y la propia cita al reprogramar', () => {
    const appointments = [
      appt('c', 'a', H(9), H(10), { status: 'cancelled' }),
      appt('d', 'a', H(10), H(11), { deletedAt: 1 }),
      appt('self', 'a', H(11), H(12)),
    ];
    const s = computeSlots({ date: MON, service: svc, staff: [staff('a')], appointments, timeOff: [], timezone: TZ, ignoreAppointmentId: 'self' });
    expect(s).toHaveLength(15);
  });

  it('respeta ausencias propias y festivos del negocio', () => {
    const s = computeSlots({
      date: MON,
      service: svc,
      staff: [staff('a'), staff('b')],
      appointments: [],
      timeOff: [
        { staffId: 'a', startsAt: localToUtc(MON, H(9), TZ), endsAt: localToUtc(MON, H(13), TZ) },
        { staffId: null, startsAt: localToUtc(MON, H(12), TZ), endsAt: localToUtc(MON, H(13), TZ) },
      ],
      timezone: TZ,
    });
    expect(new Set(s.map((x) => x.staffId))).toEqual(new Set(['b']));
    expect(mins(s).at(-1)).toBe(H(11, 30));
  });

  it('filtra profesionales que no hacen el servicio y agrupa por hora', () => {
    const s = computeSlots({
      date: MON,
      service: svc,
      staff: [staff('a'), staff('b', undefined, ['otro'])],
      appointments: [],
      timeOff: [],
      timezone: TZ,
    });
    expect(new Set(s.map((x) => x.staffId))).toEqual(new Set(['a']));
    const g = groupSlotsByStart(computeSlots({ date: MON, service: svc, staff: [staff('a'), staff('c')], appointments: [], timeOff: [], timezone: TZ }));
    expect(g[0]!.staffIds).toEqual(['a', 'c']);
  });

  it('no ofrece huecos en el pasado ni dentro de la antelación mínima', () => {
    const now = localToUtc(MON, H(10, 5), TZ);
    const s = computeSlots({ date: MON, service: svc, staff: [staff('a')], appointments: [], timeOff: [], timezone: TZ, now, minNoticeMin: 60 });
    expect(mins(s)[0]).toBe(H(11, 15));
  });

  it('funciona el día del cambio de hora de primavera (29-mar-2026, domingo)', () => {
    const sunday = staff('a', [{ weekday: 7, start: H(1), end: H(5) }]);
    const s = computeSlots({ date: '2026-03-29', service: { ...svc, durationMin: 60 }, staff: [sunday], appointments: [], timeOff: [], timezone: TZ });
    // 01:00–05:00 de pared son solo 3 h reales: inicios 01:00, 01:15, 01:30, 01:45(→ acaba 03:45 tras salto)...
    const real = s.map((x) => x.end - x.start);
    expect(real.every((d) => d === 3600_000)).toBe(true);
    const last = s.at(-1)!;
    expect(toLocalMinutes(last.end, TZ)).toBe(H(5));
    // ningún hueco empieza en la hora inexistente 02:xx
    expect(mins(s).some((m) => m >= H(2) && m < H(3))).toBe(false);
  });

  it('funciona el día del cambio de hora de otoño (25-oct-2026)', () => {
    const sunday = staff('a', [{ weekday: 7, start: H(1), end: H(4) }]);
    const s = computeSlots({ date: '2026-10-25', service: { ...svc, durationMin: 60 }, staff: [sunday], appointments: [], timeOff: [], timezone: TZ, step: 60 });
    // 01:00–04:00 de pared = 4 h reales → 4 inicios de 1 h a pasos de 60 min
    expect(s).toHaveLength(4);
  });
});

describe('conflictos', () => {
  const ctx = { appointments: [appt('x', 'a', H(10), H(11), { bufferAfterMin: 15 })], timeOff: [], timezone: TZ, staff: staff('a') };
  const proposal = (from: number, to: number) => ({ ...appt('new', 'a', from, to), serviceId: 'corte' });

  it('el solape es error (no se puede forzar)', () => {
    expect(findConflicts(proposal(H(10, 30), H(11)), ctx)).toEqual([{ kind: 'overlap', level: 'error', appointmentId: 'x' }]);
  });
  it('invadir el buffer es aviso', () => {
    expect(findConflicts(proposal(H(11), H(11, 30)), ctx).map((c) => c.kind)).toEqual(['buffer']);
  });
  it('fuera de horario es aviso', () => {
    expect(findConflicts(proposal(H(14), H(14, 30)), ctx).map((c) => c.kind)).toEqual(['outside_hours']);
  });
  it('una cita cancelada no genera conflictos', () => {
    expect(findConflicts({ ...proposal(H(10), H(11)), status: 'cancelled' }, ctx)).toEqual([]);
  });
});
