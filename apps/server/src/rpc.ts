import type { DataAdapter, EntityName } from '@astrocitas/core';
import type { Membership, Role } from './system';

/**
 * La API de datos es un RPC sobre la MISMA interfaz DataAdapter que usa la app en local:
 * el cliente remoto (RemoteAdapter) es un proxy de 20 líneas y nunca hay dos lógicas distintas.
 */
export const READ_METHODS = [
  'getBusiness',
  'listStaff',
  'listServices',
  'listClients',
  'getClient',
  'clientStats',
  'listTimeOff',
  'listAppointments',
  'getAppointment',
  'checkAppointment',
  'listWaitlist',
  'listTemplates',
  'listReminderRules',
  'listMessages',
] as const;

const RECEPTION_WRITE = ['saveClient', 'saveAppointment', 'createSeries', 'saveWaitlist', 'saveMessage', 'saveTimeOff', 'remove', 'restore'] as const;
const OWNER_WRITE = ['saveBusiness', 'saveStaff', 'saveService', 'saveTemplate', 'saveReminderRule', 'exportAll', 'importAll', 'wipe'] as const;
const PROFESSIONAL_WRITE = ['saveClient', 'saveAppointment', 'createSeries', 'remove', 'restore'] as const;

export type RpcMethod = (typeof READ_METHODS)[number] | (typeof RECEPTION_WRITE)[number] | (typeof OWNER_WRITE)[number];
export const ALL_METHODS = new Set<string>([...READ_METHODS, ...RECEPTION_WRITE, ...OWNER_WRITE]);
export const isWrite = (m: string) => !(READ_METHODS as readonly string[]).includes(m) && m !== 'exportAll';

const RECEPTION_REMOVABLE: EntityName[] = ['clients', 'appointments', 'waitlist', 'timeOff', 'messages'];

export class ForbiddenError extends Error {
  readonly statusCode = 403;
  constructor(msg = 'No tienes permiso para esta acción') {
    super(msg);
  }
}

/** Comprueba el permiso del rol para un método (y, para profesionales, que la cita sea suya). */
export async function authorize(m: Membership, method: string, args: unknown[], db: DataAdapter): Promise<void> {
  if (!ALL_METHODS.has(method)) throw new ForbiddenError(`Método desconocido: ${method}`);
  const role: Role = m.role;
  if ((READ_METHODS as readonly string[]).includes(method)) return;
  if (role === 'owner') return;
  if (role === 'reception') {
    if (!(RECEPTION_WRITE as readonly string[]).includes(method)) throw new ForbiddenError();
    if ((method === 'remove' || method === 'restore') && !RECEPTION_REMOVABLE.includes(args[0] as EntityName)) throw new ForbiddenError();
    return;
  }
  // profesional: solo sus propias citas (y crear/editar clientes)
  if (!(PROFESSIONAL_WRITE as readonly string[]).includes(method)) throw new ForbiddenError();
  if (!m.staffId) throw new ForbiddenError('Tu usuario no está vinculado a ningún profesional');
  if (method === 'saveAppointment' || method === 'createSeries') {
    const input = args[0] as { id?: string; staffId?: string };
    if (input?.staffId !== m.staffId) throw new ForbiddenError('Solo puedes gestionar tus propias citas');
    if (input.id) {
      const cur = await db.getAppointment(input.id);
      if (cur && cur.staffId !== m.staffId) throw new ForbiddenError('Solo puedes gestionar tus propias citas');
    }
    return;
  }
  if (method === 'remove' || method === 'restore') {
    if (args[0] !== 'appointments') throw new ForbiddenError();
    const cur = await db.getAppointment(String(args[1]));
    if (!cur || cur.staffId !== m.staffId) throw new ForbiddenError('Solo puedes gestionar tus propias citas');
  }
}
