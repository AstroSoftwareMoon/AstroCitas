import { describe, expect, it } from 'vitest';
import { toIcs } from '../src/ics';

describe('iCalendar', () => {
  it('genera eventos en UTC, escapa y pliega líneas largas', () => {
    const ics = toIcs({
      name: 'Luna; citas',
      events: [{ uid: 'a1', start: Date.UTC(2026, 10, 23, 9, 0), end: Date.UTC(2026, 10, 23, 9, 30), summary: 'Lucía, corte', description: 'Línea 1\nLínea 2 ' + 'x'.repeat(120) }],
    });
    expect(ics).toContain('DTSTART:20261123T090000Z');
    expect(ics).toContain('SUMMARY:Lucía\\, corte');
    expect(ics).toContain('X-WR-CALNAME:Luna\\; citas');
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});
