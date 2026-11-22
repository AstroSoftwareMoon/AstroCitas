import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, Cake, CheckCheck, Mail, MessageCircle, MessageSquare, Send, Smartphone } from 'lucide-react';
import {
  addDays,
  buildContext,
  channelLink,
  dayBounds,
  ensureMessagingDefaults,
  formatDate,
  formatTime,
  isBirthday,
  pendingManualReminders,
  pickTemplate,
  renderTemplate,
  TEMPLATE_VARS,
  todayLocal,
  type Appointment,
  type Client,
  type MessageChannel,
  type MessageKind,
  type MessageTemplate,
  type ReminderRule,
} from '@astrocitas/core';
import { useI18n, type TKey } from '../i18n';
import { useBiz, useDb, useInvalidate, useServices, useStaff } from '../lib/data';
import { usePlatform } from '../lib/platform';
import { DEFAULT_NOTIFY, DEFAULT_SMTP, type NotifySettings } from '../lib/background';
import type { SmtpConfig } from '../lib/platform';
import { cx } from '../lib/util';
import { errorMessage } from '../lib/errors';
import { Avatar, Badge, Button, EmptyState, Field, Input, PageHeader, Segmented, Select, Switch, Textarea } from '../components/ui';
import { useToast } from '../components/toast';

type Tab = 'pending' | 'templates' | 'auto' | 'history';

export function MessagesScreen() {
  const { t } = useI18n();
  const db = useDb();
  const biz = useBiz();
  const [tab, setTab] = useState<Tab>('pending');
  useEffect(() => {
    ensureMessagingDefaults(db, biz.locale).catch(() => undefined);
  }, [db, biz.locale]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={t('msg.title')}>
        <Segmented<Tab>
          className="mt-3 max-w-full overflow-x-auto"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'pending', label: t('msg.pending') },
            { value: 'templates', label: t('msg.templates') },
            { value: 'auto', label: t('msg.auto') },
            { value: 'history', label: t('msg.history') },
          ]}
        />
      </PageHeader>
      <div className="flex-1 overflow-y-auto px-4 pb-6 sm:px-6">
        <div className="mx-auto max-w-3xl">
          {tab === 'pending' && <Pending />}
          {tab === 'templates' && <Templates />}
          {tab === 'auto' && <Automatic />}
          {tab === 'history' && <History />}
        </div>
      </div>
    </div>
  );
}

/** Botones de 1 toque reutilizables (también en el editor de cita y la ficha del cliente). */
export function SendButtons({ client, appointment, kind, size = 'md' }: { client: Client; appointment?: Appointment | null; kind: MessageKind; size?: 'sm' | 'md' }) {
  const { t } = useI18n();
  const db = useDb();
  const biz = useBiz();
  const platform = usePlatform();
  const invalidate = useInvalidate();
  const { data: services = [] } = useServices(true);
  const { data: staff = [] } = useStaff(true);
  const { data: templates = [] } = useQuery({ queryKey: ['templates'], queryFn: () => db.listTemplates() });

  async function send(channel: MessageChannel) {
    const tpl = pickTemplate(templates, kind, channel);
    const ctx = buildContext({
      business: biz,
      appointment,
      client,
      service: appointment ? services.find((s) => s.id === appointment.serviceId) : null,
      staff: appointment ? staff.find((s) => s.id === appointment.staffId) : null,
    });
    const body = renderTemplate(tpl?.body ?? '{negocio}', ctx);
    const subject = renderTemplate(tpl?.subject || biz.name, ctx);
    const url = channelLink(channel, client, subject, body);
    if (!url) return;
    platform.openExternal(url);
    await db.saveMessage({
      appointmentId: appointment?.id ?? null,
      clientId: client.id,
      kind,
      channel,
      recipient: channel === 'email' ? client.email : client.phone,
      subject,
      body,
      status: 'opened',
      sentAt: Date.now(),
    });
    await invalidate();
  }

  const btn = (channel: MessageChannel, Icon: typeof Mail, label: string, disabled: boolean) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => send(channel)}
      title={label}
      aria-label={`${label} · ${client.name}`}
      data-testid={`send-${channel}`}
      className={cx(
        'press inline-flex items-center justify-center gap-1.5 rounded-full font-medium disabled:opacity-30',
        size === 'sm' ? 'h-9 w-9' : 'h-10 px-3.5 text-sm',
        channel === 'whatsapp' ? 'bg-[#25d366] text-black' : 'bg-white/10 text-white hover:bg-white/15',
      )}
    >
      <Icon size={size === 'sm' ? 16 : 17} />
      {size !== 'sm' && label}
    </button>
  );
  return (
    <div className="flex gap-1.5">
      {btn('whatsapp', MessageCircle, 'WhatsApp', !client.phone)}
      {btn('sms', MessageSquare, 'SMS', !client.phone)}
      {btn('email', Mail, t('common.email'), !client.email)}
    </div>
  );
}

function Pending() {
  const { t, lang } = useI18n();
  const db = useDb();
  const biz = useBiz();
  const tz = biz.timezone;
  const today = todayLocal(tz);
  const [date, setDate] = useState(addDays(today, 1));
  const [from, to] = dayBounds(date, tz);
  const { data: appts = [] } = useQuery({ queryKey: ['appointments', from, to, null, null, false], queryFn: () => db.listAppointments({ from, to }) });
  const { data: clients = [] } = useQuery({ queryKey: ['clients', '__all'], queryFn: () => db.listClients({ limit: 100_000 }) });
  const { data: services = [] } = useServices(true);
  const { data: messages = [] } = useQuery({
    queryKey: ['messages', appts.map((a) => a.id).join()],
    queryFn: () => db.listMessages({ appointmentIds: appts.map((a) => a.id) }),
  });
  const cMap = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const pending = pendingManualReminders(appts, messages, cMap);
  const done = appts.filter((a) => messages.some((m) => m.appointmentId === a.id && m.kind === 'reminder'));
  const birthdays = clients.filter((c) => isBirthday(c.birthday, today));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={date === today ? 'today' : date === addDays(today, 1) ? 'tomorrow' : 'other'}
          onChange={(v) => v !== 'other' && setDate(v === 'today' ? today : addDays(today, 1))}
          options={[
            { value: 'today', label: t('cal.today') },
            { value: 'tomorrow', label: t('msg.tomorrow') },
            { value: 'other', label: t('msg.otherDay') },
          ]}
        />
        <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" aria-label={t('appt.date')} />
      </div>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold">
          {t('msg.pendingFor', { date: formatDate(from, tz, lang, 'cccc d LLLL') })}
          <Badge>{pending.length}</Badge>
        </h2>
        {pending.length === 0 ? (
          <EmptyState icon={<CheckCheck size={26} />} title={t('msg.allDone')} description={t('msg.allDoneDesc')} />
        ) : (
          <ul className="space-y-2" data-testid="pending-list">
            {pending.map((a) => {
              const c = cMap.get(a.clientId!)!;
              return (
                <li key={a.id} className="card flex flex-wrap items-center gap-3 p-3 pl-4">
                  <Avatar name={c.name} size={38} color={services.find((s) => s.id === a.serviceId)?.color} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="truncate text-sm text-ink-muted">
                      <span className="tabular-nums">{formatTime(a.startsAt, tz)}</span> · {services.find((s) => s.id === a.serviceId)?.name}
                    </div>
                  </div>
                  <SendButtons client={c} appointment={a} kind="reminder" size="sm" />
                </li>
              );
            })}
          </ul>
        )}
        {done.length > 0 && <p className="mt-3 text-sm text-ink-muted">{t('msg.alreadySent', { n: done.length })}</p>}
      </section>

      {birthdays.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold">
            <Cake size={18} /> {t('msg.birthdays')}
          </h2>
          <ul className="space-y-2">
            {birthdays.map((c) => (
              <li key={c.id} className="card flex items-center gap-3 p-3 pl-4">
                <Avatar name={c.name} size={38} color="#db2777" />
                <span className="flex-1 truncate font-medium">{c.name}</span>
                <SendButtons client={c} kind="birthday" size="sm" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const KINDS: MessageKind[] = ['reminder', 'confirmation', 'thanks', 'review', 'birthday', 'waitlist', 'request'];

function Templates() {
  const { t } = useI18n();
  const db = useDb();
  const biz = useBiz();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: templates = [] } = useQuery({ queryKey: ['templates'], queryFn: () => db.listTemplates() });
  const [kind, setKind] = useState<MessageKind>('reminder');
  const tpl = templates.find((x) => x.kind === kind && x.channel === 'any') ?? templates.find((x) => x.kind === kind);
  const [draft, setDraft] = useState<Partial<MessageTemplate>>({});
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(tpl ?? { kind, channel: 'any', body: '', subject: '' }), [tpl, kind]);

  const sample = buildContext({
    business: biz,
    appointment: { startsAt: Date.now() + 86_400_000, endsAt: Date.now() + 86_400_000 + 45 * 60_000, priceCents: 2500 },
    client: { name: 'Lucía García' },
    service: { name: t('msg.sampleService') },
    staff: { name: 'Marta' },
    link: 'https://…',
  });

  function insert(v: string) {
    const el = ref.current;
    const body = draft.body ?? '';
    const pos = el?.selectionStart ?? body.length;
    const next = `${body.slice(0, pos)}{${v}}${body.slice(el?.selectionEnd ?? pos)}`;
    setDraft({ ...draft, body: next });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos + v.length + 2, pos + v.length + 2);
    });
  }

  async function save() {
    try {
      await db.saveTemplate({ ...(draft as MessageTemplate), kind });
      await invalidate();
      toast.show(t('common.saved'));
    } catch (e) {
      toast.error(errorMessage(e, t));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {KINDS.map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={cx('press rounded-full px-3.5 py-1.5 text-sm font-medium', k === kind ? 'bg-white text-black' : 'bg-white/[0.07] text-white/80')}>
            {t(`kind.msg.${k}` as TKey)}
          </button>
        ))}
      </div>
      <div className="card space-y-3 p-4 sm:p-5">
        <Field label={t('msg.subject')} hint={t('msg.subjectHint')}>
          <Input value={draft.subject ?? ''} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
        </Field>
        <Field label={t('msg.body')}>
          <Textarea ref={ref} rows={5} value={draft.body ?? ''} onChange={(e) => setDraft({ ...draft, body: e.target.value })} data-testid="tpl-body" />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATE_VARS.map((v) => (
            <button key={v} type="button" onClick={() => insert(v)} className="press rounded-full bg-white/[0.07] px-2.5 py-1 font-mono text-xs text-white/80 hover:bg-white/15">
              {`{${v}}`}
            </button>
          ))}
        </div>
        <div>
          <span className="label">{t('msg.preview')}</span>
          <div className="whitespace-pre-wrap rounded-3xl rounded-bl-md bg-[#25d366]/15 p-4 text-sm leading-relaxed" data-testid="tpl-preview">
            {renderTemplate(draft.body ?? '', sample)}
          </div>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" onClick={save} disabled={!draft.body?.trim()}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Automatic() {
  const { t } = useI18n();
  const db = useDb();
  const platform = usePlatform();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: notifySaved } = useQuery({ queryKey: ['meta', 'notify'], queryFn: () => db.getMeta<NotifySettings>('notify') });
  const { data: smtpSaved } = useQuery({ queryKey: ['meta', 'smtp'], queryFn: () => db.getMeta<SmtpConfig>('smtp') });
  const { data: rules = [] } = useQuery({ queryKey: ['rules'], queryFn: () => db.listReminderRules() });
  const [notify, setNotify] = useState<NotifySettings>(DEFAULT_NOTIFY);
  const [smtp, setSmtp] = useState<SmtpConfig>(DEFAULT_SMTP);
  const [allowed, setAllowed] = useState(false);
  useEffect(() => setNotify({ ...DEFAULT_NOTIFY, ...(notifySaved ?? {}) }), [notifySaved]);
  useEffect(() => setSmtp({ ...DEFAULT_SMTP, ...(smtpSaved ?? {}) }), [smtpSaved]);
  useEffect(() => {
    platform.notificationsAllowed().then(setAllowed);
  }, [platform]);

  const saveNotify = async (n: NotifySettings) => {
    setNotify(n);
    await db.setMeta('notify', n);
  };
  async function saveSmtp(test = false) {
    await db.setMeta('smtp', smtp);
    await invalidate();
    if (test && platform.sendEmail) {
      try {
        await platform.sendEmail(smtp, { to: smtp.from || smtp.user, subject: 'AstroCitas · prueba SMTP', text: t('msg.smtpTestBody') });
        toast.show(t('msg.smtpOk'));
      } catch (e) {
        toast.error(errorMessage(e, t));
      }
    } else toast.show(t('common.saved'));
  }
  async function toggleRule(r: ReminderRule, patch: Partial<ReminderRule>) {
    await db.saveReminderRule({ ...r, ...patch });
    await invalidate();
  }

  return (
    <div className="space-y-5">
      <section className="card space-y-2 p-4 sm:p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Bell size={18} /> {t('msg.ownerNotifs')}
        </h2>
        {!allowed && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-3xl bg-white/[0.05] p-3 text-sm">
            <span className="text-ink-muted">{t('msg.allowNotifs')}</span>
            <Button size="sm" variant="primary" onClick={async () => setAllowed(await platform.requestNotifications())}>
              {t('msg.allow')}
            </Button>
          </div>
        )}
        <Switch checked={notify.enabled} onChange={(v) => saveNotify({ ...notify, enabled: v })} label={t('msg.notifyUpcoming')} />
        {notify.enabled && (
          <Field label={t('msg.leadMin')} className="max-w-48">
            <Select value={notify.leadMin} onChange={(e) => saveNotify({ ...notify, leadMin: Number(e.target.value) })}>
              {[5, 10, 15, 30, 60].map((n) => (
                <option key={n} value={n}>
                  {n} min
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Switch checked={notify.dailySummary} onChange={(v) => saveNotify({ ...notify, dailySummary: v })} label={t('msg.dailySummary')} />
        <Switch checked={notify.birthdays} onChange={(v) => saveNotify({ ...notify, birthdays: v })} label={t('msg.notifyBirthdays')} />
      </section>

      <section className="card space-y-3 p-4 sm:p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Send size={18} /> {t('msg.smtpTitle')}
        </h2>
        {!platform.sendEmail && (
          <p className="rounded-3xl bg-amber-500/10 p-3 text-sm text-amber-100">
            <Smartphone size={14} className="mr-1 inline" /> {t('msg.smtpNeedsApp')}
          </p>
        )}
        <Switch checked={smtp.enabled} onChange={(v) => setSmtp({ ...smtp, enabled: v })} label={t('msg.smtpEnable')} description={t('msg.smtpDesc')} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Host" className="sm:col-span-2">
            <Input value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} placeholder="smtp.tudominio.es" />
          </Field>
          <Field label={t('msg.port')}>
            <Input type="number" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value), secure: Number(e.target.value) === 465 })} />
          </Field>
          <Field label={t('msg.user')}>
            <Input value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={t('msg.password')}>
            <Input type="password" value={smtp.pass} onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })} autoComplete="new-password" />
          </Field>
          <Field label={t('msg.from')}>
            <Input value={smtp.from} onChange={(e) => setSmtp({ ...smtp, from: e.target.value })} placeholder="Luna <citas@luna.es>" />
          </Field>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {platform.sendEmail && <Button onClick={() => saveSmtp(true)}>{t('msg.smtpTest')}</Button>}
          <Button variant="primary" onClick={() => saveSmtp(false)}>
            {t('common.save')}
          </Button>
        </div>
      </section>

      <section className="card p-4 sm:p-5">
        <h2 className="mb-1 font-semibold">{t('msg.rules')}</h2>
        <p className="mb-3 text-sm text-ink-muted">{t('msg.rulesDesc')}</p>
        <ul className="divide-y divide-white/[0.06]">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{t(`kind.msg.${r.kind}` as TKey)}</div>
                <div className="text-xs text-ink-muted">
                  {r.anchor === 'on_booking'
                    ? t('msg.onBooking')
                    : t(r.anchor === 'before_start' ? 'msg.before' : 'msg.after', { h: r.offsetMin >= 60 ? `${r.offsetMin / 60} h` : `${r.offsetMin} min` })}
                </div>
              </div>
              <div className="flex gap-1">
                {(['email', 'whatsapp', 'sms'] as MessageChannel[]).map((ch) => {
                  const on = r.channels.includes(ch);
                  return (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => toggleRule(r, { channels: on ? r.channels.filter((x) => x !== ch) : [...r.channels, ch] })}
                      className={cx('press rounded-full px-2.5 py-1 text-xs font-medium', on ? 'bg-white text-black' : 'bg-white/[0.07] text-white/60')}
                    >
                      {ch === 'email' ? 'Email' : ch === 'whatsapp' ? 'WhatsApp' : 'SMS'}
                    </button>
                  );
                })}
              </div>
              <Switch checked={r.active} onChange={(v) => toggleRule(r, { active: v })} label="" />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-muted">{t('msg.rulesServer')}</p>
      </section>
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = { opened: '#a78bfa', sent: '#34d399', delivered: '#34d399', read: '#22d3ee', failed: '#f87171', queued: '#fbbf24', cancelled: '#94a3b8' };

function History() {
  const { t, lang } = useI18n();
  const db = useDb();
  const biz = useBiz();
  const { data: messages = [] } = useQuery({ queryKey: ['messages', 'history'], queryFn: () => db.listMessages({ limit: 200 }) });
  if (!messages.length) return <EmptyState icon={<MessageCircle size={26} />} title={t('msg.noHistory')} />;
  return (
    <ul className="space-y-2">
      {messages.map((m) => (
        <li key={m.id} className="card p-3 pl-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{m.recipient || '—'}</span>
            <Badge>{t(`kind.msg.${m.kind}` as TKey)}</Badge>
            <Badge color={STATUS_COLOR[m.status]}>{t(`msgstatus.${m.status}` as TKey)}</Badge>
            <span className="ml-auto text-xs text-ink-muted">{formatDate(m.createdAt, biz.timezone, lang, 'd LLL HH:mm')}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-white/70">{m.body}</p>
          {m.error && <p className="mt-1 text-xs text-red-300">{m.error}</p>}
        </li>
      ))}
    </ul>
  );
}

