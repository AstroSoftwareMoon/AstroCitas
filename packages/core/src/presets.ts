import type { BusinessKind, Input, WorkRange } from './types';
import type * as S from './types';
import type { DataAdapter } from './adapter';
import { addDays, localToUtc, startOfWeek, todayLocal } from './time';

type ServicePreset = Pick<Input<typeof S.Service>, 'name' | 'durationMin' | 'priceCents' | 'category'> & {
  bufferAfterMin?: number;
};

/** Servicios sugeridos por tipo de negocio (se pueden editar en el onboarding). */
export const SERVICE_PRESETS: Record<BusinessKind, ServicePreset[]> = {
  peluqueria: [
    { name: 'Corte mujer', durationMin: 45, priceCents: 2500, category: 'Corte' },
    { name: 'Corte hombre', durationMin: 30, priceCents: 1500, category: 'Corte' },
    { name: 'Tinte', durationMin: 90, priceCents: 4500, category: 'Color', bufferAfterMin: 10 },
    { name: 'Mechas', durationMin: 120, priceCents: 6500, category: 'Color', bufferAfterMin: 10 },
    { name: 'Peinado', durationMin: 30, priceCents: 1800, category: 'Peinado' },
  ],
  barberia: [
    { name: 'Corte', durationMin: 30, priceCents: 1400, category: 'Corte' },
    { name: 'Corte + barba', durationMin: 45, priceCents: 2000, category: 'Corte' },
    { name: 'Arreglo de barba', durationMin: 20, priceCents: 900, category: 'Barba' },
    { name: 'Afeitado clásico', durationMin: 30, priceCents: 1500, category: 'Barba', bufferAfterMin: 5 },
  ],
  clinica: [
    { name: 'Primera consulta', durationMin: 45, priceCents: 6000, category: 'Consulta', bufferAfterMin: 5 },
    { name: 'Revisión', durationMin: 20, priceCents: 3500, category: 'Consulta', bufferAfterMin: 5 },
    { name: 'Limpieza dental', durationMin: 40, priceCents: 5000, category: 'Tratamiento', bufferAfterMin: 10 },
  ],
  fisioterapia: [
    { name: 'Valoración inicial', durationMin: 60, priceCents: 5000, category: 'Fisio', bufferAfterMin: 10 },
    { name: 'Sesión de fisioterapia', durationMin: 45, priceCents: 4000, category: 'Fisio', bufferAfterMin: 10 },
    { name: 'Masaje descontracturante', durationMin: 30, priceCents: 3000, category: 'Masaje', bufferAfterMin: 5 },
    { name: 'Punción seca', durationMin: 30, priceCents: 3500, category: 'Fisio', bufferAfterMin: 5 },
  ],
  estetica: [
    { name: 'Limpieza facial', durationMin: 60, priceCents: 4500, category: 'Facial', bufferAfterMin: 10 },
    { name: 'Manicura', durationMin: 45, priceCents: 2000, category: 'Uñas' },
    { name: 'Pedicura', durationMin: 50, priceCents: 2500, category: 'Uñas' },
    { name: 'Depilación piernas', durationMin: 40, priceCents: 2200, category: 'Depilación', bufferAfterMin: 5 },
  ],
  taller: [
    { name: 'Cambio de aceite', durationMin: 45, priceCents: 6000, category: 'Mantenimiento' },
    { name: 'Revisión pre-ITV', durationMin: 60, priceCents: 4000, category: 'Revisión' },
    { name: 'Cambio de neumáticos', durationMin: 60, priceCents: 3000, category: 'Neumáticos' },
    { name: 'Diagnosis', durationMin: 30, priceCents: 3500, category: 'Revisión' },
  ],
  academia: [
    { name: 'Clase individual', durationMin: 60, priceCents: 2500, category: 'Clases' },
    { name: 'Clase de prueba', durationMin: 30, priceCents: 0, category: 'Clases' },
    { name: 'Tutoría', durationMin: 45, priceCents: 2000, category: 'Tutoría' },
  ],
  otro: [
    { name: 'Cita estándar', durationMin: 30, priceCents: 2000, category: '' },
    { name: 'Cita larga', durationMin: 60, priceCents: 4000, category: '' },
  ],
};

/** Paleta del calendario: morados/espaciales con buen contraste sobre blanco y oscuro. */
export const PALETTE = ['#7c3aed', '#2563eb', '#db2777', '#059669', '#d97706', '#0891b2', '#9333ea', '#dc2626', '#4f46e5', '#65a30d'];

/** Horario típico de comercio español: L-V 9:30-14:00 y 16:30-20:30, sábado mañana. */
export function defaultHours(): WorkRange[] {
  const out: WorkRange[] = [];
  for (let wd = 1; wd <= 5; wd++) {
    out.push({ weekday: wd, start: 9 * 60 + 30, end: 14 * 60 });
    out.push({ weekday: wd, start: 16 * 60 + 30, end: 20 * 60 + 30 });
  }
  out.push({ weekday: 6, start: 10 * 60, end: 14 * 60 });
  return out;
}

const FIRST = ['Lucía', 'Hugo', 'Martina', 'Mateo', 'Sofía', 'Leo', 'Julia', 'Daniel', 'Paula', 'Álvaro', 'Valeria', 'Pablo', 'Emma', 'Manuel', 'Carmen', 'Javier', 'Noa', 'Adrián', 'Elena', 'Diego', 'Irene', 'Marcos', 'Sara', 'Iker'];
const LAST = ['García', 'Martínez', 'López', 'Sánchez', 'Pérez', 'Gómez', 'Fernández', 'Ruiz', 'Díaz', 'Moreno', 'Álvarez', 'Romero', 'Navarro', 'Torres', 'Vidal', 'Iglesias'];

/** PRNG determinista para que los datos de ejemplo (y las capturas) sean reproducibles. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export interface SetupInput {
  name: string;
  kind: BusinessKind;
  timezone?: string;
  staffNames?: string[];
  withDemo?: boolean;
  now?: number;
}

/** Crea el negocio en un paso (onboarding de 1 minuto) y opcionalmente datos de ejemplo. */
export async function setupBusiness(db: DataAdapter, input: SetupInput): Promise<void> {
  const tz = input.timezone ?? 'Europe/Madrid';
  await db.saveBusiness({ name: input.name, kind: input.kind, timezone: tz });
  const names = input.staffNames?.filter((n) => n.trim()).length ? input.staffNames!.filter((n) => n.trim()) : ['Yo'];
  const staffNames = input.withDemo && names.length < 3 ? [...names, ...['Marta', 'Carlos', 'Ana'].slice(0, 3 - names.length)] : names;
  const staff = [];
  for (const [i, name] of staffNames.entries()) {
    staff.push(await db.saveStaff({ name, color: PALETTE[i % PALETTE.length]!, sort: i, hours: defaultHours() }));
  }
  const services = [];
  for (const [i, p] of SERVICE_PRESETS[input.kind].entries()) {
    services.push(
      await db.saveService({
        ...p,
        bufferAfterMin: p.bufferAfterMin ?? 0,
        color: PALETTE[(i + 3) % PALETTE.length]!,
        sort: i,
      }),
    );
  }
  if (!input.withDemo) return;

  const rand = rng(42);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)]!;
  const clients = [];
  for (let i = 0; i < 24; i++) {
    const first = FIRST[i % FIRST.length]!;
    const last = pick(LAST);
    const month = String(1 + Math.floor(rand() * 12)).padStart(2, '0');
    const day = String(1 + Math.floor(rand() * 28)).padStart(2, '0');
    clients.push(
      await db.saveClient({
        name: `${first} ${last}`,
        phone: `+34 6${String(Math.floor(rand() * 1e8)).padStart(8, '0')}`,
        email: `${first.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')}.${last
          .toLowerCase()
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')}@ejemplo.es`,
        birthday: `${1960 + Math.floor(rand() * 45)}-${month}-${day}`,
        tags: rand() > 0.75 ? ['VIP'] : rand() > 0.8 ? ['Nuevo'] : [],
        notes: rand() > 0.8 ? 'Prefiere las primeras horas de la mañana.' : '',
      }),
    );
  }

  // Citas de la semana pasada, esta y la próxima.
  const now = input.now ?? Date.now();
  const today = todayLocal(tz, now);
  const weekStart = addDays(startOfWeek(today), -7);
  for (let d = 0; d < 21; d++) {
    const date = addDays(weekStart, d);
    for (const s of staff) {
      const ranges = s.hours.filter((h) => h.weekday === ((d % 7) + 1));
      for (const r of ranges) {
        let cursor = r.start + (rand() > 0.5 ? 0 : 30);
        while (cursor < r.end) {
          const svc = pick(services);
          if (cursor + svc.durationMin > r.end) break;
          if (rand() < 0.62) {
            const startsAt = localToUtc(date, cursor, tz);
            const past = startsAt < now;
            const roll = rand();
            const status = past ? (roll < 0.08 ? 'no_show' : roll < 0.13 ? 'cancelled' : 'completed') : roll < 0.4 ? 'confirmed' : 'booked';
            try {
              await db.saveAppointment(
                {
                  clientId: pick(clients).id,
                  staffId: s.id,
                  serviceId: svc.id,
                  startsAt,
                  endsAt: startsAt + svc.durationMin * 60_000,
                  bufferAfterMin: svc.bufferAfterMin,
                  status,
                  priceCents: svc.priceCents,
                  paidCents: status === 'completed' ? svc.priceCents : 0,
                  paymentMethod: status === 'completed' ? pick(['cash', 'card', 'bizum'] as const) : null,
                },
                { force: true },
              );
            } catch {
              /* hueco ocupado: se ignora en datos de ejemplo */
            }
          }
          cursor += svc.durationMin + svc.bufferAfterMin + (rand() > 0.7 ? 15 : 0);
        }
      }
    }
  }
}

/** Formatea céntimos según moneda/idioma. */
export function formatMoney(cents: number, currency = 'EUR', locale = 'es'): string {
  return new Intl.NumberFormat(locale === 'es' ? 'es-ES' : 'en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
