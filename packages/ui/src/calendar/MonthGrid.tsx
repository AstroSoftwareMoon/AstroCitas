import { addDays, formatTime, startOfMonth, startOfWeek, toLocalDate, type Appointment, type Client, type Service, type Staff } from '@astrocitas/core';
import { useI18n } from '../i18n';
import { alpha, cx } from '../lib/util';

export function MonthGrid(props: {
  date: string;
  today: string;
  tz: string;
  weekStartsOn: 1 | 7;
  appointments: Appointment[];
  services: Map<string, Service>;
  staff: Map<string, Staff>;
  clients: Map<string, Client>;
  colorBy: 'staff' | 'service';
  onDay(date: string): void;
  onOpen(a: Appointment): void;
}) {
  const { t, lang } = useI18n();
  const month = props.date.slice(0, 7);
  const first = startOfWeek(startOfMonth(props.date), props.weekStartsOn);
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  const byDay = new Map<string, Appointment[]>();
  for (const a of props.appointments) {
    const d = toLocalDate(a.startsAt, props.tz);
    byDay.set(d, [...(byDay.get(d) ?? []), a]);
  }
  const weekdayNames = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(lang, { weekday: 'short' }).format(new Date(`${addDays(first, i)}T12:00:00Z`)),
  );
  return (
    <div className="flex flex-1 flex-col overflow-auto p-2 sm:p-4">
      <div className="grid grid-cols-7 pb-1 text-center text-xs font-medium uppercase tracking-wide text-slate-500">
        {weekdayNames.map((n) => (
          <div key={n}>{n}</div>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7 grid-rows-6 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 dark:border-white/10 dark:bg-white/10">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const inMonth = d.startsWith(month);
          return (
            <button
              type="button"
              key={d}
              onClick={() => props.onDay(d)}
              className={cx(
                'flex min-h-20 flex-col items-stretch gap-0.5 p-1 text-left transition hover:bg-astro-50 dark:hover:bg-astro-500/10',
                inMonth ? 'bg-white dark:bg-space-900' : 'bg-slate-50 text-slate-400 dark:bg-space-950',
              )}
            >
              <span
                className={cx(
                  'mb-0.5 inline-flex h-6 w-6 items-center justify-center self-start rounded-full text-xs font-semibold',
                  d === props.today && 'bg-astro-600 text-white',
                )}
              >
                {Number(d.slice(8))}
              </span>
              {list.slice(0, 3).map((a) => {
                const color = (props.colorBy === 'service' ? props.services.get(a.serviceId)?.color : props.staff.get(a.staffId)?.color) ?? '#7c3aed';
                return (
                  <span
                    key={a.id}
                    role="link"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onOpen(a);
                    }}
                    className="hidden truncate rounded px-1 text-[11px] text-slate-800 sm:block dark:text-slate-100"
                    style={{ backgroundColor: alpha(color, 0.16) }}
                  >
                    <span className="tabular-nums">{formatTime(a.startsAt, props.tz)}</span>{' '}
                    {a.clientId ? props.clients.get(a.clientId)?.name : props.services.get(a.serviceId)?.name}
                  </span>
                );
              })}
              {list.length > 3 && <span className="hidden px-1 text-[11px] text-slate-500 sm:block">{t('cal.more', { n: list.length - 3 })}</span>}
              {list.length > 0 && (
                <span className="mt-auto self-start rounded-full bg-astro-100 px-1.5 text-[10px] font-semibold text-astro-700 sm:hidden dark:bg-astro-500/20 dark:text-astro-200">
                  {list.length}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
