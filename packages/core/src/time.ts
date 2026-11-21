import { DateTime } from 'luxon';

/**
 * Utilidades de tiempo conscientes de zona horaria.
 * Todo instante es epoch ms UTC; las conversiones a "hora de pared" usan la zona del negocio
 * (por defecto Europe/Madrid) y respetan los cambios de hora (DST).
 */

export const DEFAULT_TZ = 'Europe/Madrid';
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export function isValidTimeZone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

/** 'YYYY-MM-DD' del instante en la zona dada. */
export function toLocalDate(ms: number, tz = DEFAULT_TZ): string {
  return DateTime.fromMillis(ms, { zone: tz }).toISODate()!;
}

/** Minutos desde la medianoche local del instante. */
export function toLocalMinutes(ms: number, tz = DEFAULT_TZ): number {
  const d = DateTime.fromMillis(ms, { zone: tz });
  return d.hour * 60 + d.minute;
}

/** Día de la semana ISO (1 = lunes … 7 = domingo) de una fecha local. */
export function isoWeekday(date: string, tz = DEFAULT_TZ): number {
  return DateTime.fromISO(date, { zone: tz }).weekday;
}

/**
 * Convierte fecha local + minutos de pared a instante UTC.
 * - Hora inexistente (salto de primavera, 02:00–03:00 en Madrid): se desplaza hacia delante.
 * - Hora ambigua (otoño, 02:00–03:00 se repite): se usa la primera ocurrencia.
 * `minutes` puede ser 1440 (fin del día = medianoche siguiente).
 */
export function localToUtc(date: string, minutes: number, tz = DEFAULT_TZ): number {
  const day = DateTime.fromISO(date, { zone: tz }).startOf('day');
  if (!day.isValid) throw new Error(`Fecha inválida: ${date}`);
  const target = day.plus({ days: Math.floor(minutes / 1440) });
  const m = minutes % 1440;
  return target.set({ hour: Math.floor(m / 60), minute: m % 60, second: 0, millisecond: 0 }).toMillis();
}

/** Inicio y fin (exclusivo) del día local en UTC — un día puede durar 23 o 25 h. */
export function dayBounds(date: string, tz = DEFAULT_TZ): [number, number] {
  const d = DateTime.fromISO(date, { zone: tz }).startOf('day');
  return [d.toMillis(), d.plus({ days: 1 }).toMillis()];
}

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: 'UTC' }).plus({ days }).toISODate()!;
}

export function addMonths(date: string, months: number): string {
  return DateTime.fromISO(date, { zone: 'UTC' }).plus({ months }).toISODate()!;
}

export function startOfWeek(date: string, weekStartsOn: 1 | 7 = 1): string {
  const d = DateTime.fromISO(date, { zone: 'UTC' });
  const diff = weekStartsOn === 1 ? d.weekday - 1 : d.weekday % 7;
  return d.minus({ days: diff }).toISODate()!;
}

export function startOfMonth(date: string): string {
  return DateTime.fromISO(date, { zone: 'UTC' }).startOf('month').toISODate()!;
}

export function daysBetween(a: string, b: string): number {
  return Math.round(DateTime.fromISO(b, { zone: 'UTC' }).diff(DateTime.fromISO(a, { zone: 'UTC' }), 'days').days);
}

export function todayLocal(tz = DEFAULT_TZ, now = Date.now()): string {
  return toLocalDate(now, tz);
}

export function formatTime(ms: number, tz = DEFAULT_TZ, locale = 'es'): string {
  return DateTime.fromMillis(ms, { zone: tz }).setLocale(locale).toFormat('HH:mm');
}

export function formatDate(ms: number, tz = DEFAULT_TZ, locale = 'es', fmt = 'cccc d LLLL'): string {
  return DateTime.fromMillis(ms, { zone: tz }).setLocale(locale).toFormat(fmt);
}

export function formatLocalDate(date: string, locale = 'es', fmt = 'cccc d LLLL'): string {
  return DateTime.fromISO(date).setLocale(locale).toFormat(fmt);
}

export function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Edad/años que cumple en `onDate` y si ese día es su cumpleaños (29-feb → 28-feb en años no bisiestos). */
export function isBirthday(birthday: string | null, onDate: string): boolean {
  if (!birthday) return false;
  const [, bm, bd] = birthday.split('-');
  const [y, m, d] = onDate.split('-');
  if (bm === '02' && bd === '29') {
    const leap = DateTime.fromISO(`${y}-01-01`).isInLeapYear;
    return m === '02' && d === (leap ? '29' : '28');
  }
  return bm === m && bd === d;
}
