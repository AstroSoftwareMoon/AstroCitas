import type { Appointment, Business, Client, MessageTemplate, OutboxMessage, ReminderRule, Service, Staff, TimeOff, WaitlistEntry } from './types';

export const BACKUP_FORMAT = 'astrocitas-backup';
export const BACKUP_VERSION = 1;

/** Formato de exportación completo (.astrocitas = este JSON, opcionalmente cifrado — fase 2). */
export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  schemaVersion: number;
  exportedAt: number;
  app: string;
  data: {
    business: Business[];
    staff: Staff[];
    services: Service[];
    clients: Client[];
    timeOff: TimeOff[];
    appointments: Appointment[];
    waitlist: WaitlistEntry[];
    templates?: MessageTemplate[];
    reminderRules?: ReminderRule[];
    messages?: OutboxMessage[];
  };
}

export function isBackupFile(x: unknown): x is BackupFile {
  return !!x && typeof x === 'object' && (x as BackupFile).format === BACKUP_FORMAT && !!(x as BackupFile).data;
}

/** CSV con separador `;` (Excel en español) y BOM UTF-8. */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\r\n');
}

/** Parser CSV tolerante: detecta `;` o `,`, comillas y saltos de línea dentro de campos. */
export function parseCsv(text: string): Record<string, string>[] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((x) => x.trim() !== ''));
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}
