import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { ArrowUpCircle, Building2, Copy, Download, Globe, KeyRound, LogOut, Mail, Plus, Shield, Trash2, UserPlus, Users } from 'lucide-react';
import type { ServerSession } from '@astrocitas/core';
import { useI18n, type TKey } from '../i18n';
import { useStaff } from '../lib/data';
import { cx, downloadFile } from '../lib/util';
import { Badge, Button, Field, Input, PageHeader, Segmented, Select, Switch } from '../components/ui';
import { useToast } from '../components/toast';

type Tab = 'account' | 'team' | 'messaging' | 'booking' | 'backups' | 'admin';

export function ServerScreen({ session, onLogout }: { session: ServerSession; onLogout(): void }) {
  const { t } = useI18n();
  const role = session.membership?.role;
  const owner = role === 'owner' || session.state.user.isAdmin;
  const [tab, setTab] = useState<Tab>('account');
  const tabs: { value: Tab; label: string }[] = [
    { value: 'account', label: t('srv.account') },
    ...(owner
      ? ([
          { value: 'team', label: t('srv.team') },
          { value: 'messaging', label: t('srv.messaging') },
          { value: 'booking', label: t('srv.booking') },
          { value: 'backups', label: t('srv.backups') },
        ] as const)
      : []),
    ...(session.state.user.isAdmin ? [{ value: 'admin' as const, label: t('srv.admin') }] : []),
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={t('nav.server')}>
        <Segmented<Tab> className="mt-3 max-w-full overflow-x-auto" value={tab} onChange={setTab} options={tabs} />
      </PageHeader>
      <div className="flex-1 overflow-y-auto px-4 pb-8 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-5">
          {tab === 'account' && <Account session={session} onLogout={onLogout} />}
          {tab === 'team' && <Team session={session} />}
          {tab === 'messaging' && <Messaging session={session} />}
          {tab === 'booking' && <Booking session={session} />}
          {tab === 'backups' && <Backups session={session} />}
          {tab === 'admin' && <Admin session={session} />}
        </div>
      </div>
    </div>
  );
}

function Card({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="card p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-black">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

const useSrv = <T,>(session: ServerSession, path: string) =>
  useQuery({ queryKey: ['srv', session.businessId, path], queryFn: () => session.request<T>('GET', path) });

function Account({ session, onLogout }: { session: ServerSession; onLogout(): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; uri: string; svg: string } | null>(null);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState({ current: '', next: '' });
  const { data: me } = useQuery({ queryKey: ['srv', 'me'], queryFn: () => session.request<{ user: { email: string; totpEnabled: boolean } }>('GET', '/api/v1/me') });
  const { data: update } = useQuery({ queryKey: ['srv', 'update'], queryFn: () => session.request<{ updateAvailable?: boolean; latest?: string; current?: string; url?: string }>('GET', '/api/v1/admin/update') });

  return (
    <>
      <Card icon={<Globe size={16} />} title={t('srv.connection')}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-muted">{t('connect.url')}</dt>
          <dd className="truncate">{session.state.url}</dd>
          <dt className="text-ink-muted">{t('common.email')}</dt>
          <dd>{me?.user.email}</dd>
          <dt className="text-ink-muted">{t('srv.role')}</dt>
          <dd>{session.membership ? t(`role.${session.membership.role}` as TKey) : '—'}</dd>
          <dt className="text-ink-muted">{t('srv.version')}</dt>
          <dd>
            {update?.current}
            {update?.updateAvailable && (
              <a href={update.url} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-200">
                <ArrowUpCircle size={12} /> {t('srv.updateAvailable', { v: update.latest ?? '' })}
              </a>
            )}
          </dd>
        </dl>
        {session.state.memberships.length > 1 && (
          <Field label={t('connect.chooseBusiness')} className="mt-3 max-w-sm">
            <Select
              value={session.businessId}
              onChange={(e) => {
                session.selectBusiness(e.target.value);
                qc.invalidateQueries();
              }}
            >
              {session.state.memberships.map((m) => (
                <option key={m.businessId} value={m.businessId}>
                  {m.businessName}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Button className="mt-4" variant="ghost" icon={<LogOut size={16} />} onClick={onLogout}>
          {t('srv.logout')}
        </Button>
      </Card>

      <Card icon={<Shield size={16} />} title={t('srv.twofa')}>
        {me?.user.totpEnabled ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge color="#34d399">{t('srv.twofaOn')}</Badge>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" className="w-32" inputMode="numeric" />
            <Button
              size="sm"
              onClick={() =>
                session.request('POST', '/api/v1/me/2fa/disable', { code }).then(
                  () => qc.invalidateQueries({ queryKey: ['srv', 'me'] }),
                  (e) => toast.error(e),
                )
              }
            >
              {t('srv.twofaDisable')}
            </Button>
          </div>
        ) : setup ? (
          <div className="flex flex-wrap items-start gap-4">
            <div className="w-40 rounded-3xl bg-white p-2" dangerouslySetInnerHTML={{ __html: setup.svg }} />
            <div className="space-y-2 text-sm">
              <p className="text-ink-muted">{t('srv.twofaScan')}</p>
              <code className="block break-all rounded-xl bg-white/[0.06] p-2 text-xs">{setup.secret}</code>
              <div className="flex gap-2">
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" className="w-32" inputMode="numeric" />
                <Button
                  variant="primary"
                  onClick={() =>
                    session.request('POST', '/api/v1/me/2fa/enable', { code }).then(
                      () => {
                        setSetup(null);
                        setCode('');
                        qc.invalidateQueries({ queryKey: ['srv', 'me'] });
                        toast.show(t('srv.twofaOn'));
                      },
                      (e) => toast.error(e),
                    )
                  }
                >
                  {t('srv.twofaEnable')}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <Button
            variant="primary"
            onClick={async () => {
              const r = await session.request<{ secret: string; uri: string }>('POST', '/api/v1/me/2fa/setup', {});
              setSetup({ ...r, svg: await QRCode.toString(r.uri, { type: 'svg', margin: 1 }) });
            }}
          >
            {t('srv.twofaSetup')}
          </Button>
        )}
      </Card>

      <Card icon={<KeyRound size={16} />} title={t('srv.password')}>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input type="password" placeholder={t('srv.currentPassword')} value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
          <Input type="password" placeholder={t('srv.newPassword')} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
          <Button
            onClick={() =>
              session.request('POST', '/api/v1/me/password', pw).then(
                () => {
                  toast.show(t('common.saved'));
                  onLogout();
                },
                (e) => toast.error(e),
              )
            }
          >
            {t('common.save')}
          </Button>
        </div>
      </Card>
    </>
  );
}

function Team({ session }: { session: ServerSession }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const bid = session.businessId;
  const { data } = useSrv<{ members: { user_id: string; email: string; name: string; role: string; staff_id: string | null }[] }>(session, `/api/v1/b/${bid}/members`);
  const { data: staff = [] } = useStaff(true);
  const [form, setForm] = useState({ email: '', role: 'reception', staffId: '' });
  const [temp, setTemp] = useState<string | null>(null);
  return (
    <Card icon={<Users size={16} />} title={t('srv.team')}>
      <p className="mb-3 text-sm text-ink-muted">{t('srv.teamDesc')}</p>
      <ul className="mb-4 divide-y divide-white/[0.06]">
        {data?.members.map((m) => (
          <li key={m.user_id} className="flex items-center gap-3 py-2 text-sm">
            <span className="flex-1 truncate">{m.email}</span>
            <Badge>{t(`role.${m.role}` as TKey)}</Badge>
            {m.staff_id && <span className="text-xs text-ink-muted">{staff.find((s) => s.id === m.staff_id)?.name}</span>}
            {m.user_id !== session.state.user.id && (
              <button
                type="button"
                aria-label={t('common.delete')}
                className="press rounded-full p-1.5 text-white/50 hover:bg-white/10"
                onClick={() => session.request('DELETE', `/api/v1/b/${bid}/members/${m.user_id}`).then(() => qc.invalidateQueries({ queryKey: ['srv', bid] }), toast.error)}
              >
                <Trash2 size={15} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <Input type="email" placeholder="email@negocio.es" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          {(['owner', 'reception', 'professional'] as const).map((r) => (
            <option key={r} value={r}>
              {t(`role.${r}` as TKey)}
            </option>
          ))}
        </Select>
        {form.role === 'professional' && (
          <Select value={form.staffId} onChange={(e) => setForm({ ...form, staffId: e.target.value })}>
            <option value="">—</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
        <Button
          variant="primary"
          icon={<UserPlus size={16} />}
          onClick={() =>
            session
              .request<{ tempPassword: string | null }>('POST', `/api/v1/b/${bid}/members`, { email: form.email, role: form.role, staffId: form.staffId || null })
              .then((r) => {
                setTemp(r.tempPassword);
                setForm({ email: '', role: 'reception', staffId: '' });
                qc.invalidateQueries({ queryKey: ['srv', bid] });
              }, toast.error)
          }
        >
          {t('common.add')}
        </Button>
      </div>
      {temp && <p className="mt-3 rounded-2xl bg-amber-500/10 p-3 text-sm text-amber-100">{t('srv.tempPassword', { p: temp })}</p>}
    </Card>
  );
}

const PROVIDER_FIELDS: Record<string, { key: string; label: string; type?: string }[]> = {
  smtp: [
    { key: 'host', label: 'Host' },
    { key: 'port', label: 'Port', type: 'number' },
    { key: 'user', label: 'User' },
    { key: 'pass', label: 'Password', type: 'password' },
    { key: 'from', label: 'From' },
  ],
  resend: [
    { key: 'apiKey', label: 'API key', type: 'password' },
    { key: 'from', label: 'From' },
  ],
  whatsapp: [
    { key: 'phoneNumberId', label: 'Phone number ID' },
    { key: 'token', label: 'Access token', type: 'password' },
    { key: 'templateName', label: 'Template name' },
    { key: 'templateLang', label: 'Template language' },
    { key: 'verifyToken', label: 'Webhook verify token', type: 'password' },
  ],
  twilio: [
    { key: 'accountSid', label: 'Account SID' },
    { key: 'authToken', label: 'Auth token', type: 'password' },
    { key: 'from', label: 'From (+34… o Messaging Service)' },
  ],
};
const PROVIDER_NAMES: Record<string, string> = { smtp: 'Email · SMTP', resend: 'Email · Resend', whatsapp: 'WhatsApp Cloud API', twilio: 'SMS · Twilio' };

function Messaging({ session }: { session: ServerSession }) {
  const { t } = useI18n();
  const bid = session.businessId;
  const { data } = useSrv<{ providers: { kind: string; enabled: boolean; configured: boolean; config: Record<string, unknown> | null }[] }>(session, `/api/v1/b/${bid}/providers`);
  return (
    <>
      <p className="text-sm text-ink-muted">{t('srv.messagingDesc')}</p>
      {data?.providers.map((p) => <ProviderCard key={p.kind} session={session} p={p} />)}
    </>
  );
}

function ProviderCard({ session, p }: { session: ServerSession; p: { kind: string; enabled: boolean; configured: boolean; config: Record<string, unknown> | null } }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [cfg, setCfg] = useState<Record<string, unknown>>(p.config ?? (p.kind === 'smtp' ? { port: 587, secure: false } : p.kind === 'whatsapp' ? { templateLang: 'es' } : {}));
  const [enabled, setEnabled] = useState(p.enabled || !p.configured);
  const [to, setTo] = useState('');
  const bid = session.businessId;
  return (
    <Card icon={<Mail size={16} />} title={PROVIDER_NAMES[p.kind] ?? p.kind}>
      <div className="grid gap-2 sm:grid-cols-2">
        {PROVIDER_FIELDS[p.kind]!.map((f) => (
          <Field key={f.key} label={f.label}>
            <Input
              type={f.type === 'number' ? 'number' : f.type === 'password' ? 'password' : 'text'}
              autoComplete="off"
              value={String(cfg[f.key] ?? '')}
              onChange={(e) => setCfg({ ...cfg, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value, ...(f.key === 'port' ? { secure: Number(e.target.value) === 465 } : {}) })}
            />
          </Field>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Switch checked={enabled} onChange={setEnabled} label={t('common.active')} />
        <div className="ml-auto flex gap-2">
          <Input placeholder={t('srv.testTo')} value={to} onChange={(e) => setTo(e.target.value)} className="w-48" />
          <Button size="sm" disabled={!p.configured || !to} onClick={() => session.request('POST', `/api/v1/b/${bid}/providers/${p.kind}/test`, { to }).then(() => toast.show(t('srv.testOk')), toast.error)}>
            {t('srv.test')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() =>
              session.request('PUT', `/api/v1/b/${bid}/providers/${p.kind}`, { enabled, config: cfg }).then(() => {
                toast.show(t('common.saved'));
                qc.invalidateQueries({ queryKey: ['srv', bid] });
              }, toast.error)
            }
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Booking({ session }: { session: ServerSession }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const bid = session.businessId;
  const { data } = useSrv<{ slug: string; enabled: boolean; bookingUrl: string; widgetSnippet: string; icsUrl: string }>(session, `/api/v1/b/${bid}/public`);
  const [svg, setSvg] = useState('');
  const [slug, setSlug] = useState('');
  useEffect(() => {
    if (data) {
      setSlug(data.slug);
      QRCode.toString(data.bookingUrl, { type: 'svg', margin: 1 }).then(setSvg);
    }
  }, [data]);
  if (!data) return null;
  const put = (p: unknown) => session.request('PUT', `/api/v1/b/${bid}/public`, p).then(() => qc.invalidateQueries({ queryKey: ['srv', bid] }), toast.error);
  const copy = (s: string) => navigator.clipboard?.writeText(s).then(() => toast.show(t('settings.copied')));
  return (
    <>
      <Card icon={<Globe size={16} />} title={t('srv.booking')}>
        <Switch checked={data.enabled} onChange={(v) => put({ enabled: v })} label={t('srv.bookingEnabled')} description={t('srv.bookingDesc')} />
        <div className="mt-3 flex flex-wrap items-start gap-5">
          <div className={cx('w-36 rounded-3xl bg-white p-2', !data.enabled && 'opacity-40')} dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="min-w-0 flex-1 space-y-2">
            <a href={data.bookingUrl} target="_blank" rel="noreferrer" className="block truncate text-sm underline">
              {data.bookingUrl}
            </a>
            <div className="flex gap-2">
              <Input value={slug} onChange={(e) => setSlug(e.target.value)} className="max-w-48" aria-label="slug" />
              <Button size="sm" onClick={() => put({ slug })}>
                {t('common.save')}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<Copy size={14} />} onClick={() => copy(data.bookingUrl)}>
                {t('settings.copyLink')}
              </Button>
              <Button size="sm" icon={<Download size={14} />} onClick={() => downloadFile('reserva-qr.svg', svg, 'image/svg+xml')}>
                {t('settings.downloadQr')}
              </Button>
            </div>
          </div>
        </div>
      </Card>
      <Card icon={<Plus size={16} />} title={t('srv.widget')}>
        <p className="mb-2 text-sm text-ink-muted">{t('srv.widgetDesc')}</p>
        <code className="block break-all rounded-2xl bg-white/[0.06] p-3 text-xs">{data.widgetSnippet}</code>
        <Button size="sm" className="mt-2" icon={<Copy size={14} />} onClick={() => copy(data.widgetSnippet)}>
          {t('srv.copyCode')}
        </Button>
      </Card>
      <Card icon={<Building2 size={16} />} title={t('srv.ics')}>
        <p className="mb-2 text-sm text-ink-muted">{t('srv.icsDesc')}</p>
        <code className="block break-all rounded-2xl bg-white/[0.06] p-3 text-xs">{data.icsUrl}</code>
        <div className="mt-2 flex gap-2">
          <Button size="sm" icon={<Copy size={14} />} onClick={() => copy(data.icsUrl)}>
            {t('settings.copyLink')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => put({ rotateIcs: true })}>
            {t('srv.rotate')}
          </Button>
        </div>
      </Card>
    </>
  );
}

function Backups({ session }: { session: ServerSession }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const bid = session.businessId;
  const { data } = useSrv<{ schedule: { hour: number; keep: number }; backups: { name: string; size: number; date: number }[] }>(session, `/api/v1/b/${bid}/backups`);
  const [sch, setSch] = useState({ hour: 3, keep: 14 });
  useEffect(() => data && setSch(data.schedule), [data]);
  return (
    <Card icon={<Download size={16} />} title={t('srv.backups')}>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label={t('srv.backupHour')}>
          <Input type="number" min={0} max={23} value={sch.hour} onChange={(e) => setSch({ ...sch, hour: Number(e.target.value) })} className="w-24" />
        </Field>
        <Field label={t('srv.backupKeep')}>
          <Input type="number" min={1} max={365} value={sch.keep} onChange={(e) => setSch({ ...sch, keep: Number(e.target.value) })} className="w-24" />
        </Field>
        <Button onClick={() => session.request('PUT', `/api/v1/b/${bid}/backups/schedule`, sch).then(() => toast.show(t('common.saved')), toast.error)}>{t('common.save')}</Button>
        <Button variant="primary" className="ml-auto" onClick={() => session.request('POST', `/api/v1/b/${bid}/backups`, {}).then(() => qc.invalidateQueries({ queryKey: ['srv', bid] }), toast.error)}>
          {t('srv.backupNow')}
        </Button>
      </div>
      <ul className="divide-y divide-white/[0.06]">
        {data?.backups.map((b) => (
          <li key={b.name} className="flex items-center gap-3 py-2 text-sm">
            <span className="flex-1">{new Date(b.date).toLocaleString(lang)}</span>
            <span className="text-xs text-ink-muted">{Math.max(1, Math.round(b.size / 1024))} KB</span>
            <Button
              size="sm"
              icon={<Download size={14} />}
              onClick={async () => {
                const json = await session.request<unknown>('GET', `/api/v1/b/${bid}/backups/${b.name}`);
                downloadFile(b.name, JSON.stringify(json));
              }}
            >
              {t('srv.download')}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Admin({ session }: { session: ServerSession }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: users } = useSrv<{ users: { id: string; email: string; isAdmin: boolean; disabled: boolean; totpEnabled: boolean }[] }>(session, '/api/v1/admin/users');
  const { data: biz } = useSrv<{ businesses: { id: string; name: string; slug: string }[] }>(session, '/api/v1/admin/businesses');
  const [nb, setNb] = useState({ name: '', ownerEmail: '' });
  const [temp, setTemp] = useState<string | null>(null);
  const patch = (id: string, p: unknown) =>
    session.request<{ tempPassword: string | null }>('PATCH', `/api/v1/admin/users/${id}`, p).then((r) => {
      if (r.tempPassword) setTemp(r.tempPassword);
      qc.invalidateQueries({ queryKey: ['srv'] });
    }, toast.error);
  return (
    <>
      <Card icon={<Users size={16} />} title={t('srv.users')}>
        <ul className="divide-y divide-white/[0.06]">
          {users?.users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className={cx('flex-1 truncate', u.disabled && 'line-through opacity-50')}>{u.email}</span>
              {u.isAdmin && <Badge>admin</Badge>}
              {u.totpEnabled && <Badge color="#34d399">2FA</Badge>}
              {u.id !== session.state.user.id && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => patch(u.id, { resetPassword: true })}>
                    {t('srv.resetPassword')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => patch(u.id, { disabled: !u.disabled })}>
                    {u.disabled ? t('srv.enable') : t('srv.disable')}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card icon={<Building2 size={16} />} title={t('srv.businesses')}>
        <ul className="mb-3 divide-y divide-white/[0.06]">
          {biz?.businesses.map((b) => (
            <li key={b.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="flex-1">{b.name}</span>
              <span className="text-xs text-ink-muted">/b/{b.slug}</span>
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input placeholder={t('onb.name')} value={nb.name} onChange={(e) => setNb({ ...nb, name: e.target.value })} />
          <Input placeholder={t('srv.ownerEmail')} value={nb.ownerEmail} onChange={(e) => setNb({ ...nb, ownerEmail: e.target.value })} />
          <Button
            variant="primary"
            disabled={!nb.name}
            onClick={() =>
              session.request<{ tempPassword: string | null }>('POST', '/api/v1/admin/businesses', { name: nb.name, ownerEmail: nb.ownerEmail || undefined }).then((r) => {
                setTemp(r.tempPassword);
                setNb({ name: '', ownerEmail: '' });
                qc.invalidateQueries({ queryKey: ['srv'] });
              }, toast.error)
            }
          >
            {t('common.add')}
          </Button>
        </div>
      </Card>
      {temp && <p className="rounded-2xl bg-amber-500/10 p-3 text-sm text-amber-100">{t('srv.tempPassword', { p: temp })}</p>}
    </>
  );
}
