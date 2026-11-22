import type { EntityName } from '../types';
import type { Row, SqlValue } from './driver';

type ColType = 'text' | 'int' | 'bool' | 'json' | 'nullable_text' | 'nullable_int';
interface Col {
  field: string;
  column: string;
  type: ColType;
}

const c = (field: string, type: ColType = 'text'): Col => ({
  field,
  column: field.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`),
  type,
});

const baseCols = [c('id'), c('createdAt', 'int'), c('updatedAt', 'int'), c('deletedAt', 'nullable_int')];

export const TABLES: Record<EntityName, { table: string; cols: Col[] }> = {
  business: {
    table: 'business',
    cols: [
      ...baseCols,
      c('name'),
      c('kind'),
      c('timezone'),
      c('currency'),
      c('locale'),
      c('phone'),
      c('email'),
      c('address'),
      c('settings', 'json'),
    ],
  },
  staff: {
    table: 'staff',
    cols: [
      ...baseCols,
      c('name'),
      c('color'),
      c('email'),
      c('phone'),
      c('active', 'bool'),
      c('sort', 'int'),
      c('hours', 'json'),
      c('serviceIds', 'json'),
    ],
  },
  services: {
    table: 'services',
    cols: [
      ...baseCols,
      c('name'),
      c('category'),
      c('durationMin', 'int'),
      c('priceCents', 'int'),
      c('bufferBeforeMin', 'int'),
      c('bufferAfterMin', 'int'),
      c('color'),
      c('active', 'bool'),
      c('sort', 'int'),
    ],
  },
  clients: {
    table: 'clients',
    cols: [
      ...baseCols,
      c('name'),
      c('phone'),
      c('email'),
      c('birthday', 'nullable_text'),
      c('notes'),
      c('tags', 'json'),
      c('consentReminders', 'bool'),
      c('consentMarketing', 'bool'),
    ],
  },
  timeOff: {
    table: 'time_off',
    cols: [
      ...baseCols,
      c('staffId', 'nullable_text'),
      c('kind'),
      c('startsAt', 'int'),
      c('endsAt', 'int'),
      c('reason'),
    ],
  },
  appointments: {
    table: 'appointments',
    cols: [
      ...baseCols,
      c('clientId', 'nullable_text'),
      c('staffId'),
      c('serviceId'),
      c('startsAt', 'int'),
      c('endsAt', 'int'),
      c('bufferBeforeMin', 'int'),
      c('bufferAfterMin', 'int'),
      c('status'),
      c('priceCents', 'int'),
      c('paidCents', 'int'),
      c('paymentMethod', 'nullable_text'),
      c('notes'),
      c('seriesId', 'nullable_text'),
      c('source'),
    ],
  },
  waitlist: {
    table: 'waitlist',
    cols: [
      ...baseCols,
      c('clientId'),
      c('serviceId'),
      c('staffId', 'nullable_text'),
      c('fromDate'),
      c('toDate'),
      c('notes'),
      c('status'),
    ],
  },
  templates: {
    table: 'message_templates',
    cols: [...baseCols, c('kind'), c('channel'), c('subject'), c('body'), c('active', 'bool')],
  },
  reminderRules: {
    table: 'reminder_rules',
    cols: [...baseCols, c('kind'), c('anchor'), c('offsetMin', 'int'), c('channels', 'json'), c('active', 'bool')],
  },
  messages: {
    table: 'outbox_messages',
    cols: [
      ...baseCols,
      c('appointmentId', 'nullable_text'),
      c('clientId', 'nullable_text'),
      c('ruleId', 'nullable_text'),
      c('kind'),
      c('channel'),
      c('recipient'),
      c('subject'),
      c('body'),
      c('status'),
      c('error'),
      c('providerId'),
      c('attempts', 'int'),
      c('idempotencyKey', 'nullable_text'),
      c('sentAt', 'nullable_int'),
    ],
  },
};

export function rowToEntity<T>(entity: EntityName, row: Row): T {
  const out: Record<string, unknown> = {};
  for (const col of TABLES[entity].cols) {
    const v = row[col.column];
    switch (col.type) {
      case 'int':
        out[col.field] = Number(v);
        break;
      case 'nullable_int':
        out[col.field] = v === null || v === undefined ? null : Number(v);
        break;
      case 'bool':
        out[col.field] = Number(v) === 1;
        break;
      case 'json':
        out[col.field] = typeof v === 'string' ? JSON.parse(v) : v;
        break;
      case 'nullable_text':
        out[col.field] = v ?? null;
        break;
      default:
        out[col.field] = v ?? '';
    }
  }
  return out as T;
}

export function entityToParams(entity: EntityName, obj: Record<string, unknown>): SqlValue[] {
  return TABLES[entity].cols.map((col) => {
    const v = obj[col.field];
    if (col.type === 'bool') return v ? 1 : 0;
    if (col.type === 'json') return JSON.stringify(v ?? null);
    if (v === undefined) return null;
    return v as SqlValue;
  });
}

export function upsertSql(entity: EntityName): string {
  const { table, cols } = TABLES[entity];
  const names = cols.map((x) => x.column);
  return `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})
ON CONFLICT(id) DO UPDATE SET ${names
    .filter((n) => n !== 'id' && n !== 'created_at')
    .map((n) => `${n} = excluded.${n}`)
    .join(', ')}`;
}
