import type {
  Appointment,
  Business,
  Client,
  EntityName,
  Input,
  Service,
  Staff,
  TimeOff,
  WaitlistEntry,
  MessageTemplate,
  ReminderRule,
  OutboxMessage,
} from './types';
import type * as S from './types';
import type { Conflict } from './slots';
import type { RecurrenceRule } from './recurrence';
import type { BackupFile } from './backup';

export interface ClientStats {
  visits: number;
  upcoming: number;
  noShows: number;
  cancellations: number;
  totalSpentCents: number;
  lastVisitAt: number | null;
  nextVisitAt: number | null;
}

export interface AppointmentQuery {
  from: number;
  to: number;
  staffId?: string;
  clientId?: string;
  includeCancelled?: boolean;
}

export interface SaveOptions {
  /** Guardar aunque haya avisos (buffer, fuera de horario, ausencia). Los solapes nunca se fuerzan. */
  force?: boolean;
}

/**
 * Capa de datos abstracta. La UI solo habla con esta interfaz:
 *  - LocalAdapter  → SQLite en el dispositivo (sin red).
 *  - RemoteAdapter → API REST del servidor propio (fase 4).
 */
export interface DataAdapter {
  readonly mode: 'local' | 'remote';
  getBusiness(): Promise<Business | null>;
  saveBusiness(input: Input<typeof S.Business>): Promise<Business>;

  listStaff(opts?: { includeInactive?: boolean }): Promise<Staff[]>;
  saveStaff(input: Input<typeof S.Staff>): Promise<Staff>;

  listServices(opts?: { includeInactive?: boolean }): Promise<Service[]>;
  saveService(input: Input<typeof S.Service>): Promise<Service>;

  listClients(opts?: { search?: string; limit?: number }): Promise<Client[]>;
  getClient(id: string): Promise<Client | null>;
  saveClient(input: Input<typeof S.Client>): Promise<Client>;
  clientStats(id: string): Promise<ClientStats>;

  listTimeOff(range: { from: number; to: number }): Promise<TimeOff[]>;
  saveTimeOff(input: Input<typeof S.TimeOff>): Promise<TimeOff>;

  listAppointments(q: AppointmentQuery): Promise<Appointment[]>;
  getAppointment(id: string): Promise<Appointment | null>;
  /** Valida y guarda. Lanza ConflictError si hay solape (o avisos sin `force`). */
  saveAppointment(input: Input<typeof S.Appointment>, opts?: SaveOptions): Promise<Appointment>;
  checkAppointment(input: Input<typeof S.Appointment>): Promise<Conflict[]>;
  createSeries(input: Input<typeof S.Appointment>, rule: RecurrenceRule, opts?: SaveOptions): Promise<SeriesResult>;

  listWaitlist(): Promise<WaitlistEntry[]>;
  saveWaitlist(input: Input<typeof S.WaitlistEntry>): Promise<WaitlistEntry>;

  listTemplates(): Promise<MessageTemplate[]>;
  saveTemplate(input: Input<typeof S.MessageTemplate>): Promise<MessageTemplate>;
  listReminderRules(): Promise<ReminderRule[]>;
  saveReminderRule(input: Input<typeof S.ReminderRule>): Promise<ReminderRule>;
  listMessages(q?: { appointmentIds?: string[]; clientId?: string; since?: number; status?: OutboxMessage['status'][]; limit?: number }): Promise<OutboxMessage[]>;
  saveMessage(input: Input<typeof S.OutboxMessage>): Promise<OutboxMessage>;

  /** Ajustes locales clave/valor (preferencias de notificación, SMTP…). No se sincronizan. */
  getMeta<T = unknown>(key: string): Promise<T | null>;
  setMeta(key: string, value: unknown): Promise<void>;

  /** Borrado lógico (permite deshacer). */
  remove(entity: EntityName, id: string): Promise<void>;
  restore(entity: EntityName, id: string): Promise<void>;

  exportAll(): Promise<BackupFile>;
  importAll(file: BackupFile, opts?: { mode: 'replace' | 'merge'; track?: boolean }): Promise<void>;
  /** Borra todos los datos (empezar de cero). */
  wipe(): Promise<void>;
}

export interface SeriesResult {
  created: Appointment[];
  skipped: { startsAt: number; conflicts: Conflict[] }[];
}

export class ConflictError extends Error {
  constructor(readonly conflicts: Conflict[]) {
    super(conflicts.some((c) => c.level === 'error') ? 'ASTRO_OVERLAP' : 'ASTRO_WARNINGS');
    this.name = 'ConflictError';
  }
}

export class ValidationError extends Error {
  constructor(readonly issues: { path: string; message: string }[]) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join('; '));
    this.name = 'ValidationError';
  }
}
