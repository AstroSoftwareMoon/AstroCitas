/** Generador iCalendar (RFC 5545): exportar citas y calendario suscribible por enlace. */

export interface IcsEvent {
  uid: string;
  start: number;
  end: number;
  summary: string;
  description?: string;
  location?: string;
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  updatedAt?: number;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Pliega líneas a 75 octetos (no rompe caracteres multibyte). */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
    }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function toIcs(cal: { name: string; events: IcsEvent[]; refreshMinutes?: number }): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AstroCitas//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(cal.name)}`,
    `REFRESH-INTERVAL;VALUE=DURATION:PT${cal.refreshMinutes ?? 30}M`,
    `X-PUBLISHED-TTL:PT${cal.refreshMinutes ?? 30}M`,
  ];
  const now = stamp(Date.now());
  for (const e of cal.events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@astrocitas`,
      `DTSTAMP:${e.updatedAt ? stamp(e.updatedAt) : now}`,
      `DTSTART:${stamp(e.start)}`,
      `DTEND:${stamp(e.end)}`,
      `SUMMARY:${esc(e.summary)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    lines.push(`STATUS:${e.status ?? 'CONFIRMED'}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
