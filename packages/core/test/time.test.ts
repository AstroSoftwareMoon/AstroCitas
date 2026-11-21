import { describe, expect, it } from 'vitest';
import { dayBounds, isBirthday, localToUtc, toLocalDate, toLocalMinutes, startOfWeek } from '../src/time';

const TZ = 'Europe/Madrid';

describe('zona horaria Europe/Madrid', () => {
  it('convierte hora de pared a UTC en invierno (+1) y verano (+2)', () => {
    expect(new Date(localToUtc('2026-01-15', 10 * 60, TZ)).toISOString()).toBe('2026-01-15T09:00:00.000Z');
    expect(new Date(localToUtc('2026-07-15', 10 * 60, TZ)).toISOString()).toBe('2026-07-15T08:00:00.000Z');
  });

  it('el día del cambio de primavera dura 23 h y el de otoño 25 h', () => {
    const [a, b] = dayBounds('2026-03-29', TZ);
    expect((b - a) / 3600_000).toBe(23);
    const [c, d] = dayBounds('2026-10-25', TZ);
    expect((d - c) / 3600_000).toBe(25);
  });

  it('una hora inexistente (02:30 del 29-mar) se desplaza hacia delante', () => {
    const t = localToUtc('2026-03-29', 2 * 60 + 30, TZ);
    expect(toLocalMinutes(t, TZ)).toBe(3 * 60 + 30);
  });

  it('ida y vuelta de fecha local', () => {
    const t = localToUtc('2026-10-25', 23 * 60 + 59, TZ);
    expect(toLocalDate(t, TZ)).toBe('2026-10-25');
    expect(toLocalMinutes(t, TZ)).toBe(23 * 60 + 59);
  });

  it('inicio de semana en lunes o domingo', () => {
    expect(startOfWeek('2026-11-21', 1)).toBe('2026-11-16');
    expect(startOfWeek('2026-11-21', 7)).toBe('2026-11-15');
  });

  it('cumpleaños, incluido 29 de febrero', () => {
    expect(isBirthday('1990-05-03', '2026-05-03')).toBe(true);
    expect(isBirthday('1990-05-03', '2026-05-04')).toBe(false);
    expect(isBirthday('2000-02-29', '2027-02-28')).toBe(true);
    expect(isBirthday('2000-02-29', '2028-02-29')).toBe(true);
    expect(isBirthday('2000-02-29', '2028-02-28')).toBe(false);
  });
});
