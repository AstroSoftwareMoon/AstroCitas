import { DateTime } from 'luxon';

export interface RecurrenceRule {
  freq: 'daily' | 'weekly' | 'monthly';
  interval: number;
  /** Número total de citas (incluida la primera). */
  count?: number;
  /** Fecha local límite inclusiva 'YYYY-MM-DD'. */
  until?: string;
}

const MAX_OCCURRENCES = 104;

/**
 * Genera los inicios de una serie manteniendo la HORA DE PARED local
 * (una cita semanal a las 10:00 sigue a las 10:00 tras el cambio de hora).
 * En mensual, el día 31 cae en el último día de los meses cortos.
 */
export function expandRecurrence(firstStart: number, rule: RecurrenceRule, tz: string): number[] {
  if (rule.interval < 1) throw new Error('El intervalo debe ser ≥ 1');
  if (!rule.count && !rule.until) throw new Error('Indica número de repeticiones o fecha límite');
  const first = DateTime.fromMillis(firstStart, { zone: tz });
  const limit = Math.min(rule.count ?? MAX_OCCURRENCES, MAX_OCCURRENCES);
  const until = rule.until ? DateTime.fromISO(rule.until, { zone: tz }).endOf('day') : null;
  const out: number[] = [];
  for (let i = 0; out.length < limit; i++) {
    const unit = rule.freq === 'daily' ? 'days' : rule.freq === 'weekly' ? 'weeks' : 'months';
    const d = first.plus({ [unit]: i * rule.interval });
    if (until && d > until) break;
    out.push(d.toMillis());
  }
  return out;
}
