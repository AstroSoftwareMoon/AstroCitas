import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Keyboard, Plus, UserRound } from 'lucide-react';
import {
  addDays,
  addMonths,
  ConflictError,
  dayBounds,
  formatLocalDate,
  isoWeekday,
  localToUtc,
  MINUTE,
  startOfMonth,
  startOfWeek,
  toLocalDate,
  toLocalMinutes,
  todayLocal,
  type Appointment,
  type Staff,
} from '@astrocitas/core';
import { useI18n, type TKey } from '../i18n';
import { useAppointments, useBiz, useDb, useInvalidate, useServices, useStaff, useTimeOff } from '../lib/data';
import { navigate } from '../lib/router';
import { cx } from '../lib/util';
import { useHotkeys } from '../lib/useHotkeys';
import { conflictMessages, errorMessage } from '../lib/errors';
import { Avatar, Button, EmptyState, IconButton, Modal, Segmented } from '../components/ui';
import { useToast } from '../components/toast';
import { TimeGrid, type GridColumn } from './TimeGrid';
import { MonthGrid } from './MonthGrid';
import { AppointmentEditor, type EditorState } from './AppointmentEditor';

type View = 'day' | 'week' | 'month';

function readPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

export function CalendarScreen({ params }: { params: URLSearchParams }) {
  const { t, lang } = useI18n();
  const biz = useBiz();
  const tz = biz.timezone;
  const db = useDb();
  const toast = useToast();
  const invalidate = useInvalidate();
  const today = todayLocal(tz);
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

  const [view, setViewState] = useState<View>(() => (params.get('view') as View) || readPref('astrocitas.view', isMobile ? 'day' : 'week'));
  const [date, setDate] = useState(() => params.get('date') || today);
  const [colorBy, setColorBy] = useState<'staff' | 'service'>(() => readPref('astrocitas.colorBy', 'service'));
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(readPref('astrocitas.hiddenStaff', '').split(',').filter(Boolean)));
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [help, setHelp] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Abrir una cita concreta desde otra pantalla (#/calendar?appt=…)
  useEffect(() => {
    const id = params.get('appt');
    if (id) db.getAppointment(id).then((a) => a && setEditor({ appointment: a }));
    if (params.get('new')) setEditor({ defaults: { clientId: params.get('client') ?? undefined } });
  }, [params, db]);

  const setView = (v: View) => {
    setViewState(v);
    writePref('astrocitas.view', v);
  };
  const toggleStaff = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
    writePref('astrocitas.hiddenStaff', [...next].join(','));
  };

  const { data: allStaff = [] } = useStaff();
  const { data: services = [] } = useServices(true);
  const { data: clients = [] } = useQuery({ queryKey: ['clients', '__all'], queryFn: () => db.listClients({ limit: 100_000 }) });
  const staff = allStaff.filter((s) => !hidden.has(s.id));

  // Rango visible
  const range = useMemo(() => {
    if (view === 'day') return { from: date, days: 1 };
    if (view === 'week') return { from: startOfWeek(date, biz.settings.weekStartsOn), days: 7 };
    const first = startOfWeek(startOfMonth(date), biz.settings.weekStartsOn);
    return { from: first, days: 42 };
  }, [view, date, biz.settings.weekStartsOn]);
  const [from] = dayBounds(range.from, tz);
  const [, to] = dayBounds(addDays(range.from, range.days - 1), tz);

  const { data: appointments = [] } = useAppointments({ from, to });
  const { data: timeOff = [] } = useTimeOff(from, to);

  const maps = useMemo(
    () => ({
      services: new Map(services.map((s) => [s.id, s])),
      staff: new Map(allStaff.map((s) => [s.id, s])),
      clients: new Map(clients.map((c) => [c.id, c])),
    }),
    [services, allStaff, clients],
  );
  const visibleStaffIds = new Set(staff.map((s) => s.id));
  const visibleAppts = appointments.filter((a) => visibleStaffIds.has(a.staffId));

  const step = (dir: 1 | -1) => {
    if (view === 'day') setDate(addDays(date, dir));
    else if (view === 'week') setDate(addDays(date, 7 * dir));
    else setDate(addMonths(date, dir));
  };

  useHotkeys({
    n: () => setEditor({ defaults: { date } }),
    t: () => setDate(today),
    d: () => setView('day'),
    w: () => setView('week'),
    s: () => setView('week'),
    m: () => setView('month'),
    ArrowLeft: () => step(-1),
    ArrowRight: () => step(1),
    j: () => step(1),
    k: () => step(-1),
    '/': () => navigate('/clients?focus=1'),
    '?': () => setHelp(true),
  });

  const blocksFor = useCallback(
    (d: string, s: Staff | null) => {
      const [ds, de] = dayBounds(d, tz);
      return timeOff
        .filter((x) => x.startsAt < de && x.endsAt > ds && (x.staffId === null || !s || x.staffId === s.id))
        .filter((x) => s || x.staffId === null)
        .map((x) => ({
          start: x.startsAt <= ds ? 0 : toLocalMinutes(x.startsAt, tz),
          end: x.endsAt >= de ? 1440 : toLocalMinutes(x.endsAt, tz),
          label: x.reason || t(`timeoff.${x.kind}` as TKey),
        }));
    },
    [timeOff, tz, t],
  );

  const columns: GridColumn[] = useMemo(() => {
    if (view === 'day') {
      const wd = isoWeekday(date, tz);
      return staff.map((s) => ({
        key: s.id,
        date,
        staffId: s.id,
        header: (
          <div className="flex items-center justify-center gap-2">
            <Avatar name={s.name} color={s.color} size={24} />
            <span className="truncate text-sm font-medium">{s.name}</span>
          </div>
        ),
        working: s.hours.filter((h) => h.weekday === wd),
        blocked: blocksFor(date, s),
        appointments: visibleAppts.filter((a) => a.staffId === s.id && toLocalDate(a.startsAt, tz) === date),
        isToday: date === today,
      }));
    }
    if (view === 'week') {
      return Array.from({ length: 7 }, (_, i) => {
        const d = addDays(range.from, i);
        const wd = isoWeekday(d, tz);
        const single = staff.length === 1 ? staff[0]! : null;
        return {
          key: d,
          date: d,
          staffId: single?.id ?? null,
          header: (
            <button type="button" onClick={() => { setDate(d); setView('day'); }} className="press w-full rounded-2xl py-0.5 hover:bg-white/[0.06]">
              <div className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">{formatLocalDate(d, lang, 'ccc')}</div>
              <div className={cx('mx-auto mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-base font-semibold', d === today && 'bg-white text-black')}>
                {Number(d.slice(8))}
              </div>
            </button>
          ),
          working: staff.flatMap((s) => s.hours.filter((h) => h.weekday === wd)),
          blocked: blocksFor(d, single),
          appointments: visibleAppts.filter((a) => toLocalDate(a.startsAt, tz) === d),
          isToday: d === today,
        };
      });
    }
    return [];
  }, [view, date, staff, visibleAppts, range.from, tz, today, lang, blocksFor]);

  async function persistMove(a: Appointment, next: Partial<Appointment>, msgKey: TKey) {
    const before = { ...a };
    const save = async (force: boolean) => {
      await db.saveAppointment({ ...a, ...next }, { force });
      await invalidate();
      toast.show(t(msgKey), {
        action: {
          label: t('common.undo'),
          onClick: async () => {
            await db.saveAppointment(before, { force: true }).catch(toast.error);
            await invalidate();
          },
        },
      });
    };
    try {
      await save(false);
    } catch (e) {
      if (e instanceof ConflictError && !e.conflicts.some((c) => c.level === 'error')) {
        if (window.confirm(`${conflictMessages(e.conflicts, t).join('\n')}\n\n${t('common.saveAnyway')}?`)) await save(true).catch((err) => toast.error(errorMessage(err, t)));
      } else toast.show(errorMessage(e, t), { tone: 'error' });
    }
  }

  const title =
    view === 'day'
      ? formatLocalDate(date, lang, isMobile ? 'ccc d LLL' : 'cccc d LLLL yyyy')
      : view === 'week'
        ? `${formatLocalDate(range.from, lang, 'd LLL')} – ${formatLocalDate(addDays(range.from, 6), lang, isMobile ? 'd LLL' : 'd LLL yyyy')}`
        : formatLocalDate(date, lang, isMobile ? 'LLL yyyy' : 'LLLL yyyy');

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Barra de herramientas */}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-2 pt-4 sm:px-5">
        <div className="glass mr-auto flex items-center rounded-full p-1 sm:mr-0">
          <IconButton label={t('cal.prev')} onClick={() => step(-1)}>
            <ChevronLeft size={20} />
          </IconButton>
          <Button size="sm" variant="ghost" onClick={() => setDate(today)} className="mx-0.5">
            {t('cal.today')}
          </Button>
          <IconButton label={t('cal.next')} onClick={() => step(1)}>
            <ChevronRight size={20} />
          </IconButton>
        </div>
        <h1 className="order-first w-full truncate text-3xl font-semibold capitalize tracking-tight sm:order-none sm:w-auto sm:min-w-0 sm:flex-1 sm:px-2" data-testid="cal-title">
          {title}
        </h1>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'day', label: t('cal.day') },
            { value: 'week', label: t('cal.week') },
            { value: 'month', label: t('cal.month') },
          ]}
        />
        <div className="hidden items-center gap-2 md:flex">
          <Button variant="primary" icon={<Plus size={18} />} onClick={() => setEditor({ defaults: { date } })} data-testid="new-appt">
            {t('cal.new')}
          </Button>
          <IconButton label={t('settings.shortcuts')} onClick={() => setHelp(true)}>
            <Keyboard size={18} />
          </IconButton>
        </div>
      </div>

      {/* Filtros de profesional y color */}
      {allStaff.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto px-4 pb-3 pt-1 sm:px-5">
          {allStaff.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={!hidden.has(s.id)}
              onClick={() => toggleStaff(s.id)}
              className={cx(
                'press inline-flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-3.5 text-sm font-medium',
                hidden.has(s.id) ? 'bg-white/[0.04] text-white/35' : 'bg-white/[0.09] text-white',
              )}
            >
              <span className={cx('inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white', hidden.has(s.id) && 'opacity-40')} style={{ backgroundColor: s.color }}>
                {s.name.slice(0, 1).toUpperCase()}
              </span>
              {s.name}
            </button>
          ))}
          <div className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-ink-muted">
            <span className="hidden sm:inline">{t('common.color')}:</span>
            <Segmented
              value={colorBy}
              onChange={(v) => {
                setColorBy(v);
                writePref('astrocitas.colorBy', v);
              }}
              options={[
                { value: 'service', label: t('appt.service') },
                { value: 'staff', label: t('appt.staff') },
              ]}
              className="text-xs"
            />
          </div>
        </div>
      )}

      {allStaff.length === 0 ? (
        <EmptyState icon={<UserRound size={28} />} title={t('cal.noStaff')} action={<Button variant="primary" onClick={() => navigate('/staff')}>{t('staff.new')}</Button>} />
      ) : view === 'month' ? (
        <MonthGrid
          date={date}
          today={today}
          tz={tz}
          weekStartsOn={biz.settings.weekStartsOn}
          appointments={visibleAppts}
          {...maps}
          colorBy={colorBy}
          onDay={(d) => {
            setDate(d);
            setView('day');
          }}
          onOpen={(a) => setEditor({ appointment: a })}
        />
      ) : (
        <TimeGrid
          key={`${view}-${range.from}`}
          columns={columns}
          startMin={biz.settings.calendarStart}
          endMin={biz.settings.calendarEnd}
          tz={tz}
          snap={15}
          {...maps}
          colorBy={colorBy}
          now={now}
          minColWidth={view === 'day' ? 150 : 96}
          onSlot={(col, minutes) => setEditor({ defaults: { date: col.date, minutes, staffId: col.staffId ?? undefined } })}
          onOpen={(a) => setEditor({ appointment: a })}
          onMove={(a, col, minutes) => {
            const startsAt = localToUtc(col.date, minutes, tz);
            persistMove(a, { startsAt, endsAt: startsAt + (a.endsAt - a.startsAt), staffId: col.staffId ?? a.staffId }, 'cal.moved');
          }}
          onResize={(a, dur) => persistMove(a, { endsAt: a.startsAt + dur * MINUTE }, 'cal.resized')}
        />
      )}

      {/* Botón flotante en móvil */}
      <button
        type="button"
        aria-label={t('cal.new')}
        onClick={() => setEditor({ defaults: { date } })}
        className="press fixed bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+5.25rem)] right-4 z-30 flex h-15 w-15 items-center justify-center rounded-full bg-white text-black shadow-[0_10px_30px_-6px_rgb(255_255_255/0.35)] md:hidden"
      >
        <Plus size={26} />
      </button>

      {editor && (
        <AppointmentEditor
          key={editor.appointment?.id ?? JSON.stringify(editor.defaults)}
          state={editor}
          onClose={() => setEditor(null)}
          onDuplicate={(a) =>
            setEditor({ defaults: { date: toLocalDate(a.startsAt, tz), staffId: a.staffId, clientId: a.clientId ?? undefined, serviceId: a.serviceId } })
          }
        />
      )}

      <Modal open={help} onClose={() => setHelp(false)} title={t('shortcuts.title')}>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          {(
            [
              ['N', 'shortcuts.new'],
              ['T', 'shortcuts.today'],
              ['D · W · M', 'shortcuts.views'],
              ['← →  /  J K', 'shortcuts.nav'],
              ['/', 'shortcuts.search'],
              ['?', 'shortcuts.help'],
            ] as const
          ).map(([k, l]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded-lg border border-white/15 bg-white/[0.06] px-2 py-0.5 font-mono text-xs">{k}</kbd>
              </dt>
              <dd>{t(l)}</dd>
            </div>
          ))}
        </dl>
      </Modal>
    </div>
  );
}
