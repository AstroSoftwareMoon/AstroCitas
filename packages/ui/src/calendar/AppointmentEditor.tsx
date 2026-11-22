import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Ban, CheckCircle2, ChevronDown, Copy, Trash2, UserPlus, UserX, X } from 'lucide-react';
import {
  computeSlots,
  ConflictError,
  dayBounds,
  formatMoney,
  formatTime,
  groupSlotsByStart,
  hhmmToMinutes,
  localToUtc,
  MINUTE,
  minutesToHHMM,
  toLocalDate,
  toLocalMinutes,
  todayLocal,
  type Appointment,
  type AppointmentStatus,
  type Conflict,
  type RecurrenceRule,
} from '@astrocitas/core';
import { useI18n, type TKey } from '../i18n';
import { useBiz, useClient, useClients, useDb, useInvalidate, useServices, useStaff } from '../lib/data';
import { cx } from '../lib/util';
import { conflictMessages, errorMessage } from '../lib/errors';
import { Avatar, Button, Field, Input, Modal, Select, Textarea } from '../components/ui';
import { useToast } from '../components/toast';
import { SendButtons } from '../screens/Messages';

export interface EditorState {
  appointment?: Appointment;
  defaults?: { date?: string; minutes?: number; staffId?: string; clientId?: string; serviceId?: string; startsAt?: number };
}

type Repeat = 'none' | 'weekly' | 'biweekly' | 'monthly';
const STATUSES: AppointmentStatus[] = ['booked', 'confirmed', 'completed', 'no_show', 'cancelled'];
const PAYMENTS = ['cash', 'card', 'bizum', 'transfer', 'other'] as const;

export function AppointmentEditor({ state, onClose, onDuplicate }: { state: EditorState; onClose(): void; onDuplicate?(a: Appointment): void }) {
  const { t, lang } = useI18n();
  const biz = useBiz();
  const tz = biz.timezone;
  const db = useDb();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: services = [] } = useServices();
  const { data: staff = [] } = useStaff();

  const existing = state.appointment;
  const d = state.defaults ?? {};
  const [serviceId, setServiceId] = useState(existing?.serviceId ?? d.serviceId ?? '');
  const [staffId, setStaffId] = useState(existing?.staffId ?? d.staffId ?? '');
  const [date, setDate] = useState(existing ? toLocalDate(existing.startsAt, tz) : (d.date ?? todayLocal(tz)));
  const [minutes, setMinutes] = useState<number | null>(existing ? toLocalMinutes(existing.startsAt, tz) : (d.minutes ?? null));
  const [clientId, setClientId] = useState<string | null>(existing?.clientId ?? d.clientId ?? null);
  const [clientQuery, setClientQuery] = useState('');
  const [newClient, setNewClient] = useState<{ name: string; phone: string } | null>(null);
  const [duration, setDuration] = useState<number>(existing ? Math.round((existing.endsAt - existing.startsAt) / MINUTE) : 0);
  const [price, setPrice] = useState<number | null>(existing ? existing.priceCents : null);
  const [status, setStatus] = useState<AppointmentStatus>(existing?.status ?? 'booked');
  const [paid, setPaid] = useState(existing?.paidCents ?? 0);
  const [payment, setPayment] = useState(existing?.paymentMethod ?? null);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [repeat, setRepeat] = useState<Repeat>('none');
  const [repeatCount, setRepeatCount] = useState(4);
  const [more, setMore] = useState(!!existing);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const service = services.find((s) => s.id === serviceId);
  const effectiveDuration = duration || service?.durationMin || 30;
  const effectivePrice = price ?? service?.priceCents ?? 0;

  // Seleccionar el primer servicio por defecto
  useEffect(() => {
    if (!serviceId && services[0]) setServiceId(services[0].id);
  }, [services, serviceId]);

  // Datos del día para calcular huecos
  const [dayFrom, dayTo] = dayBounds(date, tz);
  const { data: dayAppts = [] } = useQuery({
    queryKey: ['appointments', dayFrom, dayTo, null, null, false],
    queryFn: () => db.listAppointments({ from: dayFrom, to: dayTo }),
  });
  const { data: dayOff = [] } = useQuery({ queryKey: ['timeOff', dayFrom, dayTo], queryFn: () => db.listTimeOff({ from: dayFrom, to: dayTo }) });

  const slots = useMemo(() => {
    if (!service) return [];
    const candidates = staffId ? staff.filter((s) => s.id === staffId) : staff;
    return groupSlotsByStart(
      computeSlots({
        date,
        service: { ...service, durationMin: effectiveDuration },
        staff: candidates,
        appointments: dayAppts,
        timeOff: dayOff,
        timezone: tz,
        step: biz.settings.slotStep,
        now: Date.now(),
        ignoreAppointmentId: existing?.id,
      }),
    );
  }, [service, staffId, staff, date, dayAppts, dayOff, tz, biz.settings.slotStep, existing?.id, effectiveDuration]);

  const { data: clientResults = [] } = useClients(clientQuery);
  const { data: selectedClient } = useClient(clientId);

  function pickSlot(start: number, staffIds: string[]) {
    setMinutes(toLocalMinutes(start, tz));
    if (!staffId) setStaffId(staffIds[0]!);
  }

  async function save(force = false) {
    setError(null);
    if (!service) return setError(t('appt.service'));
    if (minutes === null) return setError(t('appt.time'));
    const finalStaff = staffId || slots.find((s) => toLocalMinutes(s.start, tz) === minutes)?.staffIds[0] || staff[0]?.id;
    if (!finalStaff) return setError(t('cal.noStaff'));
    setBusy(true);
    try {
      let cid = clientId;
      if (!cid && newClient?.name.trim()) {
        const c = await db.saveClient({ name: newClient.name.trim(), phone: newClient.phone.trim() });
        cid = c.id;
        setClientId(c.id);
        setNewClient(null);
      }
      const startsAt = localToUtc(date, minutes, tz);
      const input = {
        ...(existing ?? {}),
        clientId: cid,
        staffId: finalStaff,
        serviceId: service.id,
        startsAt,
        endsAt: startsAt + effectiveDuration * MINUTE,
        bufferBeforeMin: existing?.serviceId === service.id ? existing.bufferBeforeMin : service.bufferBeforeMin,
        bufferAfterMin: existing?.serviceId === service.id ? existing.bufferAfterMin : service.bufferAfterMin,
        status,
        priceCents: effectivePrice,
        paidCents: paid,
        paymentMethod: payment,
        notes,
      };
      if (!existing && repeat !== 'none') {
        const rule: RecurrenceRule =
          repeat === 'monthly' ? { freq: 'monthly', interval: 1, count: repeatCount } : { freq: 'weekly', interval: repeat === 'biweekly' ? 2 : 1, count: repeatCount };
        const r = await db.createSeries(input, rule, { force });
        toast.show(t('appt.seriesResult', { created: r.created.length, skipped: r.skipped.length }));
      } else {
        await db.saveAppointment(input, { force });
        toast.show(existing ? t('common.saved') : t('appt.created'));
      }
      await invalidate();
      onClose();
    } catch (e) {
      if (e instanceof ConflictError) setConflicts(e.conflicts);
      else setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function quickStatus(next: AppointmentStatus, extra: Partial<Appointment> = {}) {
    if (!existing) return;
    const before = existing;
    try {
      await db.saveAppointment({ ...existing, status: next, ...extra }, { force: true });
      await invalidate();
      toast.show(next === 'cancelled' ? t('appt.cancelled') : t('common.saved'), {
        action: { label: t('common.undo'), onClick: () => db.saveAppointment(before, { force: true }).then(invalidate, toast.error) },
      });
      onClose();
    } catch (e) {
      setError(errorMessage(e, t));
    }
  }

  async function remove() {
    if (!existing) return;
    await db.remove('appointments', existing.id);
    await invalidate();
    toast.show(t('appt.deleted'), {
      action: { label: t('common.undo'), onClick: () => db.restore('appointments', existing.id).then(invalidate, (e) => toast.error(errorMessage(e, t))) },
    });
    onClose();
  }

  const hasErrors = conflicts?.some((c) => c.level === 'error');

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={existing ? t('appt.edit') : t('appt.new')}
      footer={
        <>
          {existing && (
            <div className="mr-auto flex flex-wrap gap-0.5">
              <Button size="sm" variant="ghost" icon={<CheckCircle2 size={16} />} onClick={() => quickStatus('completed', { paidCents: existing.paidCents || existing.priceCents, paymentMethod: existing.paymentMethod ?? 'cash' })}>
                {t('appt.charge')}
              </Button>
              <Button size="sm" variant="ghost" icon={<UserX size={16} />} onClick={() => quickStatus('no_show')}>
                {t('appt.noShow')}
              </Button>
              <Button size="sm" variant="ghost" icon={<Ban size={16} />} onClick={() => quickStatus('cancelled')}>
                {t('appt.cancelAppt')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Copy size={16} />}
                onClick={() => onDuplicate?.(existing)}
              >
                {t('appt.duplicate')}
              </Button>
              <Button size="sm" variant="ghost" icon={<Trash2 size={16} />} onClick={remove} className="text-red-300" aria-label={t('common.delete')} />
            </div>
          )}
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={() => save(false)} disabled={busy || minutes === null || !service} data-testid="appt-save">
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* 1 · Servicio */}
        <section>
          <h3 className="label">{t('appt.service')}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {services.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={s.id === serviceId}
                onClick={() => {
                  setServiceId(s.id);
                  setDuration(0);
                  setPrice(null);
                }}
                className={cx(
                  'press flex items-start gap-2.5 rounded-3xl p-3 text-left text-sm',
                  s.id === serviceId ? 'bg-white text-black' : 'bg-white/[0.06] hover:bg-white/10',
                )}
              >
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{s.name}</span>
                  <span className={cx('text-xs', s.id === serviceId ? 'text-black/60' : 'text-ink-muted')}>
                    {s.durationMin} {t('common.min')} · {formatMoney(s.priceCents, biz.currency, lang)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* 2 · Profesional */}
        {staff.length > 1 && (
          <section>
            <h3 className="label">{t('appt.staff')}</h3>
            <div className="flex flex-wrap gap-2">
              <Chip active={!staffId} onClick={() => setStaffId('')}>
                {t('appt.anyStaff')}
              </Chip>
              {staff.map((s) => (
                <Chip key={s.id} active={s.id === staffId} onClick={() => setStaffId(s.id)}>
                  <Avatar name={s.name} color={s.color} size={20} /> {s.name}
                </Chip>
              ))}
            </div>
          </section>
        )}

        {/* 3 · Fecha y hora */}
        <section className="grid gap-3 sm:grid-cols-[180px_1fr]">
          <Field label={t('appt.date')}>
            <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
          <Field label={t('appt.time')}>
            <Input type="time" step={300} value={minutes === null ? '' : minutesToHHMM(minutes)} onChange={(e) => setMinutes(e.target.value ? hhmmToMinutes(e.target.value) : null)} data-testid="appt-time" />
          </Field>
          <div className="sm:col-span-2">
            <h3 className="label">{t('appt.slots')}</h3>
            {slots.length === 0 ? (
              <p className="text-sm text-ink-muted">{t('appt.noSlots')}</p>
            ) : (
              <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto" data-testid="slots">
                {slots.map((s) => {
                  const m = toLocalMinutes(s.start, tz);
                  return (
                    <button
                      key={s.start}
                      type="button"
                      onClick={() => pickSlot(s.start, s.staffIds)}
                      className={cx(
                        'press rounded-full px-3 py-1.5 text-sm tabular-nums',
                        m === minutes ? 'bg-white font-semibold text-black' : 'bg-white/[0.07] hover:bg-white/[0.12]',
                      )}
                    >
                      {formatTime(s.start, tz)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* 4 · Cliente */}
        <section>
          <h3 className="label">{t('appt.client')}</h3>
          {clientId && selectedClient ? (
            <div className="flex items-center gap-3 rounded-full bg-white/[0.07] p-1.5 pr-2">
              <Avatar name={selectedClient.name} size={32} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{selectedClient.name}</div>
                <div className="truncate text-xs text-ink-muted">{selectedClient.phone || selectedClient.email}</div>
              </div>
              <button type="button" aria-label={t('common.delete')} onClick={() => setClientId(null)} className="rounded-full p-1.5 text-white/60 hover:bg-white/10">
                <X size={16} />
              </button>
            </div>
          ) : newClient ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} placeholder={t('common.name')} />
              <div className="flex gap-2">
                <Input value={newClient.phone} onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })} placeholder={t('common.phone')} type="tel" autoFocus />
                <Button variant="ghost" onClick={() => setNewClient(null)} aria-label={t('common.cancel')}>
                  <X size={16} />
                </Button>
              </div>
            </div>
          ) : (
            <div className="relative">
              <Input value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder={t('appt.clientPh')} data-testid="client-search" />
              {clientQuery.trim() && (
                <div className="mt-2 max-h-56 overflow-y-auto rounded-3xl bg-white/[0.05] p-1.5">
                  {clientResults.slice(0, 8).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setClientId(c.id);
                        setClientQuery('');
                      }}
                      className="flex w-full items-center gap-2 rounded-full px-2 py-1.5 text-left text-sm hover:bg-white/10"
                    >
                      <Avatar name={c.name} size={24} />
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="text-xs text-ink-muted">{c.phone}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const looksLikePhone = /^[+\d\s]{6,}$/.test(clientQuery.trim());
                      setNewClient(looksLikePhone ? { name: '', phone: clientQuery.trim() } : { name: clientQuery.trim(), phone: '' });
                      setClientQuery('');
                    }}
                    className="flex w-full items-center gap-2 rounded-full px-3 py-2 text-left text-sm font-medium text-white hover:bg-white/10"
                    data-testid="client-create"
                  >
                    <UserPlus size={16} /> {t('appt.newClient', { name: clientQuery.trim() })}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {existing && selectedClient && (existing.status === 'booked' || existing.status === 'confirmed') && (
          <section>
            <h3 className="label">{t('msg.sendReminder')}</h3>
            <SendButtons client={selectedClient} appointment={existing} kind="reminder" />
          </section>
        )}

        {/* Más opciones */}
        <section>
          <button type="button" onClick={() => setMore(!more)} className="flex items-center gap-1 text-sm font-medium text-white/70 hover:text-white" aria-expanded={more}>
            <ChevronDown size={16} className={cx('transition', more && 'rotate-180')} /> {t('appt.status')}, {t('appt.price').toLowerCase()}, {t('appt.repeat').toLowerCase()}…
          </button>
          {more && (
            <div className="mt-3 grid gap-3 animate-fade sm:grid-cols-3">
              <Field label={`${t('appt.duration')} (${t('common.min')})`}>
                <Input type="number" min={5} step={5} value={effectiveDuration} onChange={(e) => setDuration(Number(e.target.value))} />
              </Field>
              <Field label={`${t('appt.price')} (€)`}>
                <Input type="number" min={0} step={0.5} value={effectivePrice / 100} onChange={(e) => setPrice(Math.round(Number(e.target.value) * 100))} />
              </Field>
              <Field label={t('appt.status')}>
                <Select value={status} onChange={(e) => setStatus(e.target.value as AppointmentStatus)}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`status.${s}` as TKey)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={`${t('appt.paid')} (€)`}>
                <Input type="number" min={0} step={0.5} value={paid / 100} onChange={(e) => setPaid(Math.round(Number(e.target.value) * 100))} />
              </Field>
              <Field label={t('appt.payment')}>
                <Select value={payment ?? ''} onChange={(e) => setPayment((e.target.value || null) as typeof payment)}>
                  <option value="">—</option>
                  {PAYMENTS.map((p) => (
                    <option key={p} value={p}>
                      {t(`pay.${p}` as TKey)}
                    </option>
                  ))}
                </Select>
              </Field>
              {!existing && (
                <Field label={t('appt.repeat')}>
                  <div className="flex gap-2">
                    <Select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
                      <option value="none">{t('appt.repeatNone')}</option>
                      <option value="weekly">{t('appt.repeatWeekly')}</option>
                      <option value="biweekly">{t('appt.repeatBiweekly')}</option>
                      <option value="monthly">{t('appt.repeatMonthly')}</option>
                    </Select>
                    {repeat !== 'none' && (
                      <Input type="number" min={2} max={52} value={repeatCount} onChange={(e) => setRepeatCount(Number(e.target.value))} aria-label={t('appt.repeatCount')} className="w-20" />
                    )}
                  </div>
                </Field>
              )}
              <Field label={t('common.notes')} className="sm:col-span-3">
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </Field>
            </div>
          )}
        </section>

        {conflicts && conflicts.length > 0 && (
          <div role="alert" className={cx('rounded-3xl border p-4 text-sm', hasErrors ? 'border-red-400/40 bg-red-500/15 text-red-100' : 'border-amber-400/40 bg-amber-500/15 text-amber-100')}>
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="font-semibold">{t('conflict.title')}</div>
                <ul className="mt-1 list-disc pl-4">
                  {conflictMessages(conflicts, t).map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
                {!hasErrors && (
                  <Button size="sm" className="mt-2" onClick={() => save(true)} data-testid="save-anyway">
                    {t('common.saveAnyway')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'press inline-flex items-center gap-1.5 rounded-full py-1.5 pl-1.5 pr-3.5 text-sm font-medium first:pl-3.5',
        active ? 'bg-white text-black' : 'bg-white/[0.07] text-white/85 hover:bg-white/[0.12]',
      )}
    >
      {children}
    </button>
  );
}
