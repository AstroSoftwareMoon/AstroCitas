import { describe, expect, it } from 'vitest';
import { expandRecurrence } from '../src/recurrence';
import { localToUtc, toLocalDate, toLocalMinutes } from '../src/time';

const TZ = 'Europe/Madrid';

describe('citas recurrentes', () => {
  it('semanal mantiene la hora de pared al cruzar el cambio de hora', () => {
    const first = localToUtc('2026-10-19', 10 * 60, TZ);
    const out = expandRecurrence(first, { freq: 'weekly', interval: 1, count: 3 }, TZ);
    expect(out.map((t) => toLocalDate(t, TZ))).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
    expect(out.every((t) => toLocalMinutes(t, TZ) === 600)).toBe(true);
    expect(out[1]! - out[0]!).toBe(7 * 24 * 3600_000 + 3600_000); // la semana del cambio dura 1 h más
  });
  it('quincenal con fecha límite', () => {
    const first = localToUtc('2026-11-02', 9 * 60, TZ);
    const out = expandRecurrence(first, { freq: 'weekly', interval: 2, until: '2026-12-14' }, TZ);
    expect(out.map((t) => toLocalDate(t, TZ))).toEqual(['2026-11-02', '2026-11-16', '2026-11-30', '2026-12-14']);
  });
  it('mensual el día 31 cae en fin de mes', () => {
    const first = localToUtc('2027-01-31', 9 * 60, TZ);
    const out = expandRecurrence(first, { freq: 'monthly', interval: 1, count: 3 }, TZ);
    expect(out.map((t) => toLocalDate(t, TZ))).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
  });
  it('exige count o until', () => {
    expect(() => expandRecurrence(0, { freq: 'daily', interval: 1 }, TZ)).toThrow();
  });
});
