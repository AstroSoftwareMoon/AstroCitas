import { z } from 'zod';

/**
 * Modelo de dominio de AstroCitas.
 *
 * Convenciones (idénticas en modo local y autohospedado):
 *  - Ids: UUID v4 en texto (generados en el dispositivo → sin colisiones al sincronizar).
 *  - Instantes: milisegundos UTC (epoch ms). La zona del negocio se aplica al mostrar/calcular.
 *  - Horas de trabajo: minutos desde medianoche en hora LOCAL del negocio (0..1440).
 *  - Fechas sin hora (cumpleaños, festivos de día completo): 'YYYY-MM-DD'.
 *  - Dinero: céntimos enteros.
 *  - Cada fila lleva `updatedAt` y `deletedAt` (borrado lógico → deshacer y sincronización).
 */

export const ID = z.string().min(1);
export const ISODate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD');
export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color #RRGGBB');
export const Minutes = z.number().int().min(0).max(1440);

const base = {
  id: ID,
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable().default(null),
};

export const BusinessKind = z.enum([
  'peluqueria',
  'barberia',
  'clinica',
  'fisioterapia',
  'estetica',
  'taller',
  'academia',
  'otro',
]);
export type BusinessKind = z.infer<typeof BusinessKind>;

export const BusinessSettings = z.object({
  /** Granularidad de huecos ofrecidos (min). */
  slotStep: z.number().int().min(5).max(120).default(15),
  /** Hora visible inicial/final en el calendario (min locales). */
  calendarStart: Minutes.default(8 * 60),
  calendarEnd: Minutes.default(21 * 60),
  /** Antelación mínima para reservar (min). */
  minNotice: z.number().int().min(0).default(0),
  weekStartsOn: z.union([z.literal(1), z.literal(7)]).default(1),
});
export type BusinessSettings = z.infer<typeof BusinessSettings>;

export const Business = z.object({
  ...base,
  name: z.string().trim().min(1, 'Pon un nombre').max(120),
  kind: BusinessKind.default('otro'),
  timezone: z.string().default('Europe/Madrid'),
  currency: z.string().length(3).default('EUR'),
  locale: z.enum(['es', 'en']).default('es'),
  phone: z.string().max(40).default(''),
  email: z.string().max(200).default(''),
  address: z.string().max(300).default(''),
  settings: BusinessSettings.default(BusinessSettings.parse({})),
});
export type Business = z.infer<typeof Business>;

export const WorkRange = z
  .object({ weekday: z.number().int().min(1).max(7), start: Minutes, end: Minutes })
  .refine((r) => r.end > r.start, 'La hora de fin debe ser posterior a la de inicio');
export type WorkRange = z.infer<typeof WorkRange>;

export const Staff = z.object({
  ...base,
  name: z.string().trim().min(1, 'Pon un nombre').max(120),
  color: HexColor.default('#8b5cf6'),
  email: z.string().max(200).default(''),
  phone: z.string().max(40).default(''),
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
  /** Horario semanal propio: varios tramos por día (mañana/tarde). weekday ISO 1=lunes. */
  hours: z.array(WorkRange).default([]),
  /** Servicios que realiza. Vacío = todos. */
  serviceIds: z.array(ID).default([]),
});
export type Staff = z.infer<typeof Staff>;

export const Service = z.object({
  ...base,
  name: z.string().trim().min(1, 'Pon un nombre').max(120),
  category: z.string().max(60).default(''),
  durationMin: z.number().int().min(5).max(24 * 60),
  priceCents: z.number().int().min(0).default(0),
  bufferBeforeMin: z.number().int().min(0).max(240).default(0),
  bufferAfterMin: z.number().int().min(0).max(240).default(0),
  color: HexColor.default('#a78bfa'),
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
});
export type Service = z.infer<typeof Service>;

export const TimeOffKind = z.enum(['vacation', 'holiday', 'block']);
export const TimeOff = z
  .object({
    ...base,
    /** null = afecta a todo el negocio (festivo/cierre). */
    staffId: ID.nullable().default(null),
    kind: TimeOffKind.default('block'),
    startsAt: z.number().int(),
    endsAt: z.number().int(),
    reason: z.string().max(200).default(''),
  })
  .refine((t) => t.endsAt > t.startsAt, 'El fin debe ser posterior al inicio');
export type TimeOff = z.infer<typeof TimeOff>;

export const Client = z.object({
  ...base,
  name: z.string().trim().min(1, 'Pon un nombre').max(160),
  phone: z.string().max(40).default(''),
  email: z.string().max(200).default(''),
  birthday: ISODate.nullable().default(null),
  notes: z.string().max(5000).default(''),
  tags: z.array(z.string().max(40)).default([]),
  /** RGPD: consentimiento explícito. */
  consentReminders: z.boolean().default(true),
  consentMarketing: z.boolean().default(false),
});
export type Client = z.infer<typeof Client>;

export const AppointmentStatus = z.enum(['booked', 'confirmed', 'completed', 'cancelled', 'no_show']);
export type AppointmentStatus = z.infer<typeof AppointmentStatus>;
/** Estados que ocupan agenda. */
export const BLOCKING_STATUSES: readonly AppointmentStatus[] = ['booked', 'confirmed', 'completed'];

export const PaymentMethod = z.enum(['cash', 'card', 'transfer', 'bizum', 'other']);

export const Appointment = z
  .object({
    ...base,
    clientId: ID.nullable().default(null),
    staffId: ID,
    serviceId: ID,
    startsAt: z.number().int(),
    endsAt: z.number().int(),
    /** Buffers copiados del servicio al crear (el servicio puede cambiar después). */
    bufferBeforeMin: z.number().int().min(0).default(0),
    bufferAfterMin: z.number().int().min(0).default(0),
    status: AppointmentStatus.default('booked'),
    priceCents: z.number().int().min(0).default(0),
    paidCents: z.number().int().min(0).default(0),
    paymentMethod: PaymentMethod.nullable().default(null),
    notes: z.string().max(2000).default(''),
    seriesId: ID.nullable().default(null),
    source: z.enum(['staff', 'request', 'online']).default('staff'),
  })
  .refine((a) => a.endsAt > a.startsAt, 'La cita debe terminar después de empezar');
export type Appointment = z.infer<typeof Appointment>;

export const WaitlistEntry = z.object({
  ...base,
  clientId: ID,
  serviceId: ID,
  staffId: ID.nullable().default(null),
  fromDate: ISODate,
  toDate: ISODate,
  notes: z.string().max(500).default(''),
  status: z.enum(['waiting', 'notified', 'booked', 'expired']).default('waiting'),
});
export type WaitlistEntry = z.infer<typeof WaitlistEntry>;

/** Entrada para crear/editar desde la UI: campos con valor por defecto opcionales; el repositorio completa id y marcas. */
export type Input<S extends z.ZodType> = Omit<z.input<S>, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> & {
  id?: string;
};

export const MessageChannel = z.enum(['whatsapp', 'sms', 'email']);
export type MessageChannel = z.infer<typeof MessageChannel>;
export const MessageKind = z.enum(['reminder', 'confirmation', 'thanks', 'review', 'birthday', 'waitlist', 'request', 'custom']);
export type MessageKind = z.infer<typeof MessageKind>;

/** Plantilla editable con variables: {cliente} {servicio} {fecha} {hora} {profesional} {negocio} {enlace} … */
export const MessageTemplate = z.object({
  ...base,
  kind: MessageKind,
  channel: z.enum(['whatsapp', 'sms', 'email', 'any']).default('any'),
  subject: z.string().max(200).default(''),
  body: z.string().min(1, 'La plantilla no puede estar vacía').max(2000),
  active: z.boolean().default(true),
});
export type MessageTemplate = z.infer<typeof MessageTemplate>;

/** Regla de recordatorio (p. ej. 24 h antes por email). offsetMin < 0 = antes del inicio; > 0 = después del fin. */
export const ReminderRule = z.object({
  ...base,
  kind: MessageKind,
  /** 'before_start' | 'after_end' | 'on_booking' */
  anchor: z.enum(['before_start', 'after_end', 'on_booking']).default('before_start'),
  offsetMin: z.number().int().min(0).max(60 * 24 * 14).default(24 * 60),
  channels: z.array(MessageChannel).default(['email']),
  active: z.boolean().default(true),
});
export type ReminderRule = z.infer<typeof ReminderRule>;

/** Registro de cada mensaje enviado o abierto (1 toque) para no repetir y para el estado de entrega. */
export const OutboxMessage = z.object({
  ...base,
  appointmentId: ID.nullable().default(null),
  clientId: ID.nullable().default(null),
  ruleId: ID.nullable().default(null),
  kind: MessageKind,
  channel: MessageChannel,
  recipient: z.string().max(200).default(''),
  subject: z.string().max(200).default(''),
  body: z.string().max(4000).default(''),
  /** opened = abierto en WhatsApp/SMS/correo (1 toque, el envío lo confirma la persona) */
  status: z.enum(['queued', 'opened', 'sent', 'delivered', 'read', 'failed', 'cancelled']).default('queued'),
  error: z.string().max(1000).default(''),
  providerId: z.string().max(200).default(''),
  attempts: z.number().int().min(0).default(0),
  idempotencyKey: z.string().max(300).nullable().default(null),
  sentAt: z.number().int().nullable().default(null),
});
export type OutboxMessage = z.infer<typeof OutboxMessage>;

export type EntityName =
  | 'business'
  | 'staff'
  | 'services'
  | 'clients'
  | 'appointments'
  | 'timeOff'
  | 'waitlist'
  | 'templates'
  | 'reminderRules'
  | 'messages';
