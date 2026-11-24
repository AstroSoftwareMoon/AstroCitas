import { describe, expect, it } from 'vitest';
import { buildReport, loyaltyStamps } from '../src/reports';
import { localToUtc } from '../src/time';
import type { Appointment, Service, Staff } from '../src/types';

const TZ = 'Europe/Madrid';
const at = (d: string, h: number, m = 0) => localToUtc(d, h * 60 + m, TZ);
const staff: Staff[] = [{ id: 's', name: 'Ana', active: true, hours: [{ weekday: 1, start: 9 * 60, end: 13 * 60 }], serviceIds: [] } as unknown as Staff];
const services: Service[] = [{ id: 'c', name: 'Corte', priceCents: 2000 } as Service, { id: 't', name: 'Tinte', priceCents: 5000 } as Service];
let n = 0;
const appt = (o: Partial<Appointment>): Appointment =>
  ({ id: `a${n++}`, staffId: 's', serviceId: 'c', status: 'completed', priceCents: 2000, paidCents: 2000, paymentMethod: 'card', source: 'staff', bufferBeforeMin: 0, bufferAfterMin: 0, deletedAt: null, clientId: 'x', ...o }) as Appointment;

describe('informes', () => {
  it('KPIs, ocupación, servicios top, cobros por método', () => {
    const d = '2026-11-16'; // lunes, 4 h de horario
    const r = buildReport({
      from: d,
      to: d,
      timezone: TZ,
      staff,
      services,
      timeOff: [],
      appointments: [
        appt({ startsAt: at(d, 9), endsAt: at(d, 10) }),
        appt({ startsAt: at(d, 10), endsAt: at(d, 11), serviceId: 't', priceCents: 5000, paidCents: 5000, paymentMethod: 'cash' }),
        appt({ startsAt: at(d, 11), endsAt: at(d, 11, 30), status: 'no_show', paidCents: 0 }),
        appt({ startsAt: at(d, 12), endsAt: at(d, 12, 30), status: 'cancelled', paidCents: 0 }),
        appt({ startsAt: at('2026-11-17', 9), endsAt: at('2026-11-17', 10) }), // fuera de rango
      ],
    });
    expect(r.appointments).toBe(3);
    expect(r.revenueCents).toBe(7000);
    expect(r.avgTicketCents).toBe(3500);
    expect(r.noShowRate).toBeCloseTo(1 / 3);
    expect(r.cancellationRate).toBeCloseTo(1 / 4);
    expect(r.availableMinutes).toBe(240);
    expect(r.bookedMinutes).toBe(120); // el no-show no cuenta como ocupado
    expect(r.occupancy).toBeCloseTo(0.5);
    expect(r.topServices[0]).toMatchObject({ name: 'Corte', count: 2 });
    expect(r.byPayment.map((p) => p.method)).toEqual(['cash', 'card']);
  });

  it('fidelidad', () => {
    expect(loyaltyStamps(7, 0, 10)).toEqual({ stamps: 7, rewardReady: false });
    expect(loyaltyStamps(12, 0, 10)).toEqual({ stamps: 10, rewardReady: true });
    expect(loyaltyStamps(12, 1, 10)).toEqual({ stamps: 2, rewardReady: false });
  });
});
