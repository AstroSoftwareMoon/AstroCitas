import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, Printer } from 'lucide-react';
import {
  addDays,
  addMonths,
  buildReport,
  dayBounds,
  formatLocalDate,
  formatMoney,
  startOfMonth,
  startOfWeek,
  toCsv,
  todayLocal,
} from '@astrocitas/core';
import { useI18n, type TKey } from '../i18n';
import { useBiz, useDb, useServices, useStaff } from '../lib/data';
import { cx, downloadFile } from '../lib/util';
import { Button, IconButton, PageHeader, Segmented } from '../components/ui';

type Period = 'week' | 'month' | 'year';

function range(period: Period, anchor: string, weekStartsOn: 1 | 7): [string, string] {
  if (period === 'week') {
    const f = startOfWeek(anchor, weekStartsOn);
    return [f, addDays(f, 6)];
  }
  if (period === 'month') {
    const f = startOfMonth(anchor);
    return [f, addDays(addMonths(f, 1), -1)];
  }
  const y = anchor.slice(0, 4);
  return [`${y}-01-01`, `${y}-12-31`];
}

export function ReportsScreen() {
  const { t, lang } = useI18n();
  const db = useDb();
  const biz = useBiz();
  const tz = biz.timezone;
  const [period, setPeriod] = useState<Period>('month');
  const [anchor, setAnchor] = useState(todayLocal(tz));
  const [from, to] = range(period, anchor, biz.settings.weekStartsOn);
  const [fromMs] = dayBounds(from, tz);
  const [, toMs] = dayBounds(to, tz);
  const { data: services = [] } = useServices(true);
  const { data: staff = [] } = useStaff(true);
  const { data: appts = [] } = useQuery({ queryKey: ['appointments', fromMs, toMs, null, null, true], queryFn: () => db.listAppointments({ from: fromMs, to: toMs, includeCancelled: true }) });
  const { data: timeOff = [] } = useQuery({ queryKey: ['timeOff', fromMs, toMs], queryFn: () => db.listTimeOff({ from: fromMs, to: toMs }) });
  // Primera visita de cada cliente (para «clientes nuevos»).
  const { data: firstVisits } = useQuery({
    queryKey: ['firstVisits', toMs],
    queryFn: async () => {
      const all = await db.listAppointments({ from: 0, to: toMs });
      const m = new Map<string, number>();
      for (const a of all) if (a.clientId && a.status !== 'cancelled') m.set(a.clientId, Math.min(m.get(a.clientId) ?? Infinity, a.startsAt));
      return m;
    },
  });
  const r = useMemo(() => buildReport({ from, to, timezone: tz, appointments: appts, services, staff, timeOff }, firstVisits), [from, to, tz, appts, services, staff, timeOff, firstVisits]);
  const money = (c: number) => formatMoney(c, biz.currency, lang);
  const pct = (x: number) => `${Math.round(x * 100)} %`;

  const step = (dir: 1 | -1) => setAnchor(period === 'week' ? addDays(anchor, 7 * dir) : period === 'month' ? addMonths(anchor, dir) : addMonths(anchor, 12 * dir));
  const title = period === 'year' ? from.slice(0, 4) : period === 'month' ? formatLocalDate(from, lang, 'LLLL yyyy') : `${formatLocalDate(from, lang, 'd LLL')} – ${formatLocalDate(to, lang, 'd LLL yyyy')}`;

  function exportCsv() {
    const rows = [
      ...r.byDay.map((d) => ({ fecha: d.date, citas: d.appointments, ingresos: (d.revenueCents / 100).toFixed(2) })),
      {},
      ...r.topServices.map((s) => ({ servicio: s.name, citas: s.count, ingresos: (s.revenueCents / 100).toFixed(2) })),
      {},
      ...r.byStaff.map((s) => ({ profesional: s.name, citas: s.count, ingresos: (s.revenueCents / 100).toFixed(2), ocupacion: pct(s.occupancy) })),
    ];
    downloadFile(`informe-${from}-${to}.csv`, toCsv(rows as Record<string, unknown>[]), 'text/csv');
  }

  const kpis: { key: TKey; value: string; sub?: string }[] = [
    { key: 'rep.appointments', value: String(r.appointments), sub: t('rep.completed', { n: r.completed }) },
    { key: 'rep.revenue', value: money(r.revenueCents), sub: t('rep.expected', { v: money(r.expectedCents) }) },
    { key: 'rep.avgTicket', value: money(r.avgTicketCents) },
    { key: 'rep.occupancy', value: pct(r.occupancy), sub: `${Math.round(r.bookedMinutes / 60)} / ${Math.round(r.availableMinutes / 60)} h` },
    { key: 'rep.noShows', value: pct(r.noShowRate), sub: t('rep.count', { n: r.noShows }) },
    { key: 'rep.newClients', value: String(r.newClients), sub: t('rep.cancelled', { n: r.cancelled }) },
  ];
  const bars = period === 'year' ? monthly(r.byDay) : r.byDay.map((d) => ({ label: d.date.slice(8), date: d.date, revenueCents: d.revenueCents, appointments: d.appointments }));
  const maxBar = Math.max(1, ...bars.map((b) => b.revenueCents));

  return (
    <div className="report flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('nav.reports')}
        actions={
          <div className="flex gap-2 print:hidden">
            <Button size="sm" icon={<Download size={15} />} onClick={exportCsv}>
              CSV
            </Button>
            <Button size="sm" icon={<Printer size={15} />} onClick={() => window.print()}>
              PDF
            </Button>
          </div>
        }
      >
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Segmented<Period>
            className="print:hidden"
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'week', label: t('cal.week') },
              { value: 'month', label: t('cal.month') },
              { value: 'year', label: t('rep.year') },
            ]}
          />
          <div className="glass flex items-center rounded-full p-1 print:hidden">
            <IconButton label={t('cal.prev')} onClick={() => step(-1)}>
              <ChevronLeft size={18} />
            </IconButton>
            <IconButton label={t('cal.next')} onClick={() => step(1)}>
              <ChevronRight size={18} />
            </IconButton>
          </div>
          <span className="text-lg font-semibold capitalize" data-testid="report-title">
            {title}
          </span>
        </div>
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-4 pb-8 sm:px-6">
        <div className="mx-auto max-w-5xl space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {kpis.map((k) => (
              <div key={k.key} className="card p-4" data-testid={`kpi-${k.key}`}>
                <div className="text-xs font-medium uppercase tracking-wider text-ink-muted">{t(k.key)}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums sm:text-3xl">{k.value}</div>
                {k.sub && <div className="mt-0.5 text-xs text-ink-muted">{k.sub}</div>}
              </div>
            ))}
          </div>

          <section className="card p-4 sm:p-5">
            <h2 className="mb-4 font-semibold">{t('rep.revenueByDay')}</h2>
            <div className="flex h-44 items-end gap-[3px]" role="img" aria-label={t('rep.revenueByDay')}>
              {bars.map((b) => (
                <div key={b.date} className="group relative flex h-full flex-1 flex-col justify-end" title={`${b.date}: ${money(b.revenueCents)} · ${b.appointments}`}>
                  <div className={cx('rounded-t-md bg-white/85 transition group-hover:bg-white', b.revenueCents === 0 && 'bg-white/10')} style={{ height: `${Math.max(2, (b.revenueCents / maxBar) * 100)}%` }} />
                  <span className="mt-1 hidden text-center text-[10px] text-ink-muted sm:block">{b.label}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Table
              title={t('rep.topServices')}
              rows={r.topServices.slice(0, 8).map((s) => [s.name, String(s.count), money(s.revenueCents)])}
              head={[t('appt.service'), t('rep.appointments'), t('rep.revenue')]}
            />
            <section className="card p-4 sm:p-5">
              <h2 className="mb-3 font-semibold">{t('rep.byStaff')}</h2>
              <ul className="space-y-3">
                {r.byStaff.map((s) => (
                  <li key={s.staffId}>
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{s.name}</span>
                      <span className="tabular-nums text-ink-muted">
                        {s.count} · {money(s.revenueCents)} · {pct(s.occupancy)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-white" style={{ width: pct(Math.min(1, s.occupancy)).replace(' ', '') }} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
            <Table title={t('rep.byPayment')} rows={r.byPayment.map((p) => [t(`pay.${p.method}` as TKey), String(p.count), money(p.cents)])} head={[t('appt.payment'), t('rep.appointments'), t('rep.revenue')]} />
            <Table title={t('rep.bySource')} rows={r.bySource.map((s) => [t(`source.${s.source}` as TKey), String(s.count)])} head={[t('rep.source'), t('rep.appointments')]} />
          </div>
        </div>
      </div>
    </div>
  );
}

function monthly(byDay: { date: string; revenueCents: number; appointments: number }[]) {
  const m = new Map<string, { label: string; date: string; revenueCents: number; appointments: number }>();
  for (const d of byDay) {
    const k = d.date.slice(0, 7);
    const cur = m.get(k) ?? { label: k.slice(5), date: k, revenueCents: 0, appointments: 0 };
    cur.revenueCents += d.revenueCents;
    cur.appointments += d.appointments;
    m.set(k, cur);
  }
  return [...m.values()];
}

function Table({ title, head, rows }: { title: string; head: string[]; rows: string[][] }) {
  const { t } = useI18n();
  return (
    <section className="card p-4 sm:p-5">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('rep.noData')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-ink-muted">
              {head.map((h, i) => (
                <th key={h} className={cx('pb-2 font-medium', i > 0 && 'text-right')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className={cx('py-2', j > 0 && 'text-right tabular-nums')}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
