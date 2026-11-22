import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarOff, Copy, Plus, Trash2, UserRound, X } from 'lucide-react';
import {
  addDays,
  defaultHours,
  formatDate,
  hhmmToMinutes,
  localToUtc,
  minutesToHHMM,
  PALETTE,
  todayLocal,
  type Staff,
  type TimeOff,
  type WorkRange,
} from '@astrocitas/core';
import { useI18n, type TKey } from '../i18n';
import { useBiz, useDb, useInvalidate, useServices, useStaff } from '../lib/data';
import { errorMessage } from '../lib/errors';
import { Avatar, Badge, Button, ColorSwatches, EmptyState, Field, IconButton, Input, Modal, PageHeader, Select, Switch } from '../components/ui';
import { useToast } from '../components/toast';

type Draft = Partial<Staff> & { name: string };

export function StaffScreen() {
  const { t } = useI18n();
  const { data: staff = [] } = useStaff(true);
  const [editing, setEditing] = useState<Draft | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('staff.title')}
        actions={
          <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={() => setEditing({ name: '', color: PALETTE[staff.length % PALETTE.length]!, hours: defaultHours(), active: true, serviceIds: [] })}>
            {t('staff.new')}
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-4xl space-y-8">
          {staff.length === 0 ? (
            <EmptyState icon={<UserRound size={28} />} title={t('cal.noStaff')} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {staff.map((s) => (
                <button key={s.id} type="button" onClick={() => setEditing(s)} className="card flex items-center gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md">
                  <Avatar name={s.name} color={s.color} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{s.name}</span>
                      {!s.active && <Badge>{t('common.inactive')}</Badge>}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{summarizeHours(s.hours, t)}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <CalendarOff size={16} /> {t('staff.wholeBusiness')}
            </h2>
            <TimeOffList staffId={null} />
          </section>
        </div>
      </div>
      {editing && <StaffEditor draft={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function summarizeHours(hours: WorkRange[], t: (k: TKey) => string): string {
  const days = [...new Set(hours.map((h) => h.weekday))].sort();
  if (!days.length) return t('staff.closed');
  return days.map((d) => t(`weekday.${d}` as TKey).slice(0, 2)).join(' · ');
}

function StaffEditor({ draft, onClose }: { draft: Draft; onClose(): void }) {
  const { t } = useI18n();
  const db = useDb();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: services = [] } = useServices();
  const [f, setF] = useState<Draft>(draft);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF({ ...f, [k]: v });
  const hours = f.hours ?? [];

  async function save() {
    try {
      await db.saveStaff(f);
      await invalidate();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, t));
    }
  }
  async function remove() {
    if (!f.id) return;
    const id = f.id;
    await db.remove('staff', id);
    await invalidate();
    onClose();
    toast.show(t('common.deleted'), { action: { label: t('common.undo'), onClick: () => db.restore('staff', id).then(invalidate) } });
  }

  const updateRange = (idx: number, patch: Partial<WorkRange>) => set('hours', hours.map((h, i) => (i === idx ? { ...h, ...patch } : h)));

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={f.id ? f.name : t('staff.new')}
      footer={
        <>
          {f.id && (
            <Button variant="ghost" icon={<Trash2 size={16} />} className="mr-auto text-red-600 dark:text-red-400" onClick={remove}>
              {t('common.delete')}
            </Button>
          )}
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={save} disabled={!f.name.trim()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('common.name')} className="sm:col-span-2">
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus />
          </Field>
          <Field label={t('common.phone')}>
            <Input type="tel" value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label={t('common.email')}>
            <Input type="email" value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <span className="label">{t('common.color')}</span>
            <ColorSwatches value={f.color ?? PALETTE[0]!} onChange={(c) => set('color', c)} colors={PALETTE} />
          </div>
          <div className="sm:col-span-2">
            <Switch checked={f.active ?? true} onChange={(v) => set('active', v)} label={t('common.active')} />
          </div>
        </div>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t('staff.hours')}</h3>
            <Button
              size="sm"
              variant="ghost"
              icon={<Copy size={14} />}
              onClick={() => {
                const monday = hours.filter((h) => h.weekday === 1);
                set('hours', [...hours.filter((h) => h.weekday > 5), ...[1, 2, 3, 4, 5].flatMap((wd) => monday.map((m) => ({ ...m, weekday: wd })))]);
              }}
            >
              {t('staff.copyToWeek')}
            </Button>
          </div>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-white/5 dark:border-white/10">
            {[1, 2, 3, 4, 5, 6, 7].map((wd) => {
              const ranges = hours.map((h, i) => ({ h, i })).filter((x) => x.h.weekday === wd);
              return (
                <div key={wd} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="w-24 text-sm font-medium">{t(`weekday.${wd}` as TKey)}</span>
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    {ranges.length === 0 && <span className="text-sm text-slate-400">{t('staff.closed')}</span>}
                    {ranges.map(({ h, i }) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-slate-50 p-1 dark:bg-white/5">
                        <input type="time" aria-label={t('staff.from')} value={minutesToHHMM(h.start)} onChange={(e) => updateRange(i, { start: hhmmToMinutes(e.target.value) })} className="input h-8 w-24 px-2 py-0" />
                        –
                        <input type="time" aria-label={t('staff.to')} value={minutesToHHMM(h.end)} onChange={(e) => updateRange(i, { end: hhmmToMinutes(e.target.value) })} className="input h-8 w-24 px-2 py-0" />
                        <IconButton label={t('common.delete')} className="h-7 w-7" onClick={() => set('hours', hours.filter((_, j) => j !== i))}>
                          <X size={14} />
                        </IconButton>
                      </span>
                    ))}
                  </div>
                  <IconButton
                    label={t('staff.addRange')}
                    onClick={() => {
                      const last = ranges.at(-1)?.h;
                      const start = last ? Math.min(last.end + 60, 22 * 60) : 9 * 60;
                      set('hours', [...hours, { weekday: wd, start, end: Math.min(start + 4 * 60, 23 * 60 + 59) }]);
                    }}
                  >
                    <Plus size={16} />
                  </IconButton>
                </div>
              );
            })}
          </div>
        </section>

        {services.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold">{t('staff.services')}</h3>
            <p className="mb-2 text-xs text-slate-500">{t('staff.servicesHelp')}</p>
            <div className="flex flex-wrap gap-2">
              {services.map((s) => {
                const on = (f.serviceIds ?? []).includes(s.id);
                return (
                  <label key={s.id} className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-sm dark:border-white/10">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => set('serviceIds', on ? (f.serviceIds ?? []).filter((x) => x !== s.id) : [...(f.serviceIds ?? []), s.id])}
                      className="accent-astro-600"
                    />
                    {s.name}
                  </label>
                );
              })}
            </div>
          </section>
        )}

        {f.id && (
          <section>
            <h3 className="mb-2 text-sm font-semibold">{t('staff.timeOff')}</h3>
            <TimeOffList staffId={f.id} />
          </section>
        )}
      </div>
    </Modal>
  );
}

function TimeOffList({ staffId }: { staffId: string | null }) {
  const { t, lang } = useI18n();
  const db = useDb();
  const biz = useBiz();
  const toast = useToast();
  const invalidate = useInvalidate();
  const today = todayLocal(biz.timezone);
  const from = localToUtc(today, 0, biz.timezone);
  const to = from + 400 * 86_400_000;
  const { data = [] } = useQuery({ queryKey: ['timeOff', 'list', from], queryFn: () => db.listTimeOff({ from, to }) });
  const items = data.filter((x) => x.staffId === staffId);
  const [form, setForm] = useState({ kind: (staffId ? 'vacation' : 'holiday') as TimeOff['kind'], from: today, to: today, allDay: true, start: '14:00', end: '16:00', reason: '' });

  async function add() {
    try {
      const startsAt = localToUtc(form.from, form.allDay ? 0 : hhmmToMinutes(form.start), biz.timezone);
      const endsAt = form.allDay ? localToUtc(addDays(form.to, 1), 0, biz.timezone) : localToUtc(form.to, hhmmToMinutes(form.end), biz.timezone);
      await db.saveTimeOff({ staffId, kind: form.kind, startsAt, endsAt, reason: form.reason });
      await invalidate();
      toast.show(t('common.saved'));
    } catch (e) {
      toast.error(errorMessage(e, t));
    }
  }

  return (
    <div className="space-y-3">
      {items.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-white/5 dark:border-white/10">
          {items.map((x) => (
            <li key={x.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <Badge>{t(`timeoff.${x.kind}` as TKey)}</Badge>
              <span className="flex-1 tabular-nums">
                {formatDate(x.startsAt, biz.timezone, lang, 'd LLL HH:mm')} → {formatDate(x.endsAt, biz.timezone, lang, 'd LLL HH:mm')}
                {x.reason && <span className="text-slate-500"> · {x.reason}</span>}
              </span>
              <IconButton
                label={t('common.delete')}
                onClick={async () => {
                  await db.remove('timeOff', x.id);
                  await invalidate();
                  toast.show(t('common.deleted'), { action: { label: t('common.undo'), onClick: () => db.restore('timeOff', x.id).then(invalidate) } });
                }}
              >
                <Trash2 size={16} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 rounded-xl bg-slate-50 p-3 dark:bg-white/5 sm:grid-cols-6">
        <Field label={t('staff.kind')} className="sm:col-span-2">
          <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as TimeOff['kind'] })}>
            {(['vacation', 'holiday', 'block'] as const).map((k) => (
              <option key={k} value={k}>
                {t(`timeoff.${k}` as TKey)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('staff.from')} className="sm:col-span-2">
          <Input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value, to: e.target.value > form.to ? e.target.value : form.to })} />
        </Field>
        <Field label={t('staff.to')} className="sm:col-span-2">
          <Input type="date" value={form.to} min={form.from} onChange={(e) => setForm({ ...form, to: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} className="accent-astro-600" /> 24 h
        </label>
        {!form.allDay && (
          <>
            <Input type="time" aria-label={t('staff.from')} value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} className="sm:col-span-2" />
            <Input type="time" aria-label={t('staff.to')} value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} className="sm:col-span-2" />
          </>
        )}
        <Input placeholder={t('staff.reason')} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="sm:col-span-4" />
        <Button icon={<Plus size={16} />} onClick={add} className="sm:col-span-2">
          {t('staff.addTimeOff')}
        </Button>
      </div>
    </div>
  );
}
