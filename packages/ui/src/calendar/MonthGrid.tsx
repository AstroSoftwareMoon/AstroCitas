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
    <div className="flex flex-1 flex-col overflow-auto px-2 pb-2 sm:px-3">
      <div className="grid grid-cols-7 pb-2 text-center text-xs font-medium uppercase tracking-wider text-ink-muted">
        {weekdayNames.map((n) => (
          <div key={n}>{n}</div>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7 grid-rows-6 gap-1.5">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const inMonth = d.startsWith(month);
          return (
            <button
              type="button"
              key={d}
              onClick={() => props.onDay(d)}
              className={cx(
                'press flex min-h-20 flex-col items-stretch gap-0.5 rounded-2xl p-1.5 text-left hover:bg-white/[0.09]',
                inMonth ? 'bg-white/[0.05]' : 'bg-transparent text-white/30',
              )}
            >
              <span
                className={cx(
                  'mb-0.5 inline-flex h-6 w-6 items-center justify-center self-start rounded-full text-xs font-semibold',
                  d === props.today && 'bg-white text-black',
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
                    className="hidden truncate rounded-md px-1.5 text-[11px] text-white sm:block"
                    style={{ backgroundColor: alpha(color, 0.3) }}
                  >
                    <span className="tabular-nums">{formatTime(a.startsAt, props.tz)}</span>{' '}
                    {a.clientId ? props.clients.get(a.clientId)?.name : props.services.get(a.serviceId)?.name}
                  </span>
                );
              })}
              {list.length > 3 && <span className="hidden px-1 text-[11px] text-ink-muted sm:block">{t('cal.more', { n: list.length - 3 })}</span>}
              {list.length > 0 && (
                <span className="mt-auto self-start rounded-full bg-white px-1.5 text-[10px] font-semibold text-black sm:hidden">
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
