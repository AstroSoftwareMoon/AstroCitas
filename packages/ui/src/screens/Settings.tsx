import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { CalendarClock, Container, Copy, ExternalLink, Loader2, Play, Square, Database, Download, FileCode, FileText, HardDrive, History, Lock, Palette, Printer, QrCode, Server, ShieldCheck, Star, Store, Trash2, Upload } from 'lucide-react';
import {
  BusinessKind,
  decryptJson,
  defaultTemplates,
  encryptJson,
  generateRequestPage,
  hhmmToMinutes,
  isBackupFile,
  isEncryptedFile,
  isValidTimeZone,
  minutesToHHMM,
  renderTemplate,
  requestLink,
  toCsv,
  toIcs,
  privacyPolicy,
  type BackupFile,
  type Business,
} from '@astrocitas/core';
import { usePlatform, type SelfHostStatus } from '../lib/platform';
import { useServices, useStaff } from '../lib/data';
import { useI18n, type Lang, type TKey } from '../i18n';
import { useBiz, useDb, useInvalidate, useStorageInfo } from '../lib/data';
import { useReduceGlass } from '../lib/theme';
import { downloadFile, pickFile } from '../lib/util';
import { errorMessage } from '../lib/errors';
import { Button, Field, Input, PageHeader, Segmented, Select, Switch } from '../components/ui';
import { useToast } from '../components/toast';
import { LogoMark } from '../components/Logo';
import { useAppControl } from '../App';
import { useSyncStatus } from '../lib/sync';
import type { ConflictRecord, SyncEngine } from '@astrocitas/core';

export function SettingsScreen({ version }: { version?: string }) {
  const { t, lang, setLang } = useI18n();
  const biz = useBiz();
  const db = useDb();
  const storage = useStorageInfo();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [reduceGlass, setReduceGlass] = useReduceGlass();
  const [f, setF] = useState<Business>(biz);
  const set = <K extends keyof Business>(k: K, v: Business[K]) => setF({ ...f, [k]: v });
  const setS = <K extends keyof Business['settings']>(k: K, v: Business['settings'][K]) => setF({ ...f, settings: { ...f.settings, [k]: v } });

  async function saveBusiness() {
    if (!isValidTimeZone(f.timezone)) return toast.error(t('settings.timezone'));
    try {
      await db.saveBusiness(f);
      await invalidate();
      toast.show(t('common.saved'));
    } catch (e) {
      toast.error(errorMessage(e, t));
    }
  }

  const [backupPass, setBackupPass] = useState('');
  async function exportBackup() {
    const data = await db.exportAll();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const content = backupPass ? await encryptJson(data, backupPass) : data;
    downloadFile(`astrocitas-${stamp}.astrocitas`, JSON.stringify(content), 'application/json');
    await db.setMeta('backup.last', Date.now());
  }

  async function restoreText(text: string) {
    let json = JSON.parse(text);
    if (isEncryptedFile(json)) {
      const pass = window.prompt(t('settings.password'));
      if (!pass) return;
      json = await decryptJson(json, pass);
    }
    if (!isBackupFile(json)) throw new Error('El archivo no es una copia de AstroCitas');
    if (!window.confirm(t('settings.importConfirm'))) return;
    await db.importAll(json as BackupFile, { mode: 'replace' });
    await invalidate();
    toast.show(t('settings.imported'));
  }

  async function importBackup() {
    const file = await pickFile('.astrocitas,.json,application/json');
    if (!file) return;
    try {
      await restoreText(await file.text());
    } catch (e) {
      toast.error(errorMessage(e, t));
    }
  }

  async function exportCsv(kind: 'clients' | 'appointments') {
    const dump = await db.exportAll();
    if (kind === 'clients') {
      downloadFile(
        'clientes.csv',
        toCsv(
          dump.data.clients.filter((c) => !c.deletedAt).map((c) => ({ nombre: c.name, telefono: c.phone, email: c.email, cumpleanos: c.birthday ?? '', etiquetas: c.tags.join(', '), notas: c.notes })),
        ),
        'text/csv',
      );
    } else {
      const svc = new Map(dump.data.services.map((s) => [s.id, s.name]));
      const stf = new Map(dump.data.staff.map((s) => [s.id, s.name]));
      const cli = new Map(dump.data.clients.map((c) => [c.id, c.name]));
      const fmt = new Intl.DateTimeFormat('es-ES', { timeZone: biz.timezone, dateStyle: 'short', timeStyle: 'short' });
      downloadFile(
        'citas.csv',
        toCsv(
          dump.data.appointments
            .filter((a) => !a.deletedAt)
            .map((a) => ({
              inicio: fmt.format(a.startsAt),
              fin: fmt.format(a.endsAt),
              cliente: a.clientId ? cli.get(a.clientId) : '',
              servicio: svc.get(a.serviceId),
              profesional: stf.get(a.staffId),
              estado: t(`status.${a.status}` as TKey),
              precio: (a.priceCents / 100).toFixed(2),
              cobrado: (a.paidCents / 100).toFixed(2),
              notas: a.notes,
            })),
        ),
        'text/csv',
      );
    }
  }

  async function exportIcs() {
    const now = Date.now();
    const [appts, services, staff, clients] = await Promise.all([
      db.listAppointments({ from: now - 30 * 86_400_000, to: now + 365 * 86_400_000 }),
      db.listServices({ includeInactive: true }),
      db.listStaff({ includeInactive: true }),
      db.listClients({ limit: 100_000 }),
    ]);
    const svc = new Map(services.map((x) => [x.id, x.name]));
    const stf = new Map(staff.map((x) => [x.id, x.name]));
    const cli = new Map(clients.map((x) => [x.id, x.name]));
    const ics = toIcs({
      name: biz.name,
      events: appts.map((a) => ({
        uid: a.id,
        start: a.startsAt,
        end: a.endsAt,
        updatedAt: a.updatedAt,
        summary: [a.clientId ? cli.get(a.clientId) : null, svc.get(a.serviceId)].filter(Boolean).join(' · '),
        description: [stf.get(a.staffId), a.notes].filter(Boolean).join('\n'),
        location: biz.address,
      })),
    });
    downloadFile('astrocitas.ics', ics, 'text/calendar');
  }

  async function wipe() {
    if (window.prompt(t('settings.wipeConfirm')) !== 'BORRAR') return;
    await db.wipe();
    await invalidate();
  }

  const timezones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['Europe/Madrid', 'Atlantic/Canary'];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={t('settings.title')} />
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-3xl space-y-5">
          <Section icon={<Store size={18} />} title={t('settings.business')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('onb.name')} className="sm:col-span-2">
                <Input value={f.name} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field label={t('onb.kind')}>
                <Select value={f.kind} onChange={(e) => set('kind', e.target.value as Business['kind'])}>
                  {BusinessKind.options.map((k) => (
                    <option key={k} value={k}>
                      {t(`kind.${k}` as TKey)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('settings.timezone')}>
                <Select value={f.timezone} onChange={(e) => set('timezone', e.target.value)}>
                  {timezones.map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('common.phone')}>
                <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} />
              </Field>
              <Field label={t('common.email')}>
                <Input value={f.email} onChange={(e) => set('email', e.target.value)} />
              </Field>
              <Field label={t('settings.address')} className="sm:col-span-2">
                <Input value={f.address} onChange={(e) => set('address', e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section icon={<CalendarClock size={18} />} title={t('settings.calendar')}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t('settings.slotStep')}>
                <Select value={f.settings.slotStep} onChange={(e) => setS('slotStep', Number(e.target.value))}>
                  {[5, 10, 15, 20, 30, 60].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('settings.dayStart')}>
                <Input type="time" value={minutesToHHMM(f.settings.calendarStart)} onChange={(e) => setS('calendarStart', hhmmToMinutes(e.target.value))} />
              </Field>
              <Field label={t('settings.dayEnd')}>
                <Input type="time" value={minutesToHHMM(f.settings.calendarEnd)} onChange={(e) => setS('calendarEnd', hhmmToMinutes(e.target.value))} />
              </Field>
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="primary" onClick={saveBusiness}>
                {t('common.save')}
              </Button>
            </div>
          </Section>

          <Section icon={<Palette size={18} />} title={t('settings.appearance')}>
            <div className="space-y-4">
              <Switch checked={reduceGlass} onChange={setReduceGlass} label={t('settings.reduceGlass')} description={t('settings.reduceGlassDesc')} />
              <div>
                <span className="label">{t('settings.language')}</span>
                <Segmented<Lang>
                  value={lang}
                  onChange={setLang}
                  options={[
                    { value: 'es', label: 'Español' },
                    { value: 'en', label: 'English' },
                  ]}
                />
              </div>
            </div>
          </Section>

          <Section icon={<Database size={18} />} title={t('settings.data')}>
            <div className="mb-4 flex items-start gap-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100">
              <Lock size={18} className="mt-0.5 shrink-0" />
              <div>
                <p>{t('settings.localMode')}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs opacity-80">
                  <HardDrive size={14} /> {t('settings.storage')}: {storage.persistent ? t('settings.storagePersistent').replace('OPFS', storage.kind.toUpperCase()) : t('settings.storageMemory')}
                </p>
              </div>
            </div>
            <div className="mb-3 flex max-w-md items-center gap-2">
              <Lock size={16} className="shrink-0 text-ink-muted" />
              <Input type="password" value={backupPass} onChange={(e) => setBackupPass(e.target.value)} placeholder={t('settings.encryptPh')} aria-label={t('settings.encrypt')} autoComplete="new-password" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button icon={<Download size={16} />} onClick={exportBackup} data-testid="export">
                {t('settings.export')}
              </Button>
              <Button icon={<Upload size={16} />} onClick={importBackup}>
                {t('settings.import')}
              </Button>
              <Button variant="ghost" icon={<Download size={16} />} onClick={() => exportCsv('clients')}>
                {t('settings.exportCsv')} · {t('nav.clients')}
              </Button>
              <Button variant="ghost" icon={<Download size={16} />} onClick={() => exportCsv('appointments')}>
                {t('settings.exportCsv')} · {t('nav.calendar')}
              </Button>
              <Button variant="ghost" icon={<CalendarClock size={16} />} onClick={exportIcs}>
                {t('settings.ics')}
              </Button>
            </div>
            <div className="mt-4 border-t border-white/[0.07] pt-4">
              <Button variant="ghost" icon={<Trash2 size={16} />} className="text-red-300" onClick={wipe}>
                {t('settings.wipe')}
              </Button>
            </div>
          </Section>

          <LoyaltySection />

          <LegalSection />

          <DbPassword />

          <AutoBackups onRestore={(text) => restoreText(text).catch((e) => toast.error(errorMessage(e, t)))} />

          <RequestMode business={biz} />

          <ModeSection />

          <SelfHostSection version={version} />

          <div className="flex items-center justify-center gap-2 py-4 text-xs text-white/40">
            <LogoMark size={16} /> AstroCitas {version ?? ''} · AGPL-3.0 · Open source
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="card p-4 sm:p-5">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-black">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function AutoBackups({ onRestore }: { onRestore(text: string): void }) {
  const { t, lang } = useI18n();
  const platform = usePlatform();
  const { data: list = [] } = useQuery({ queryKey: ['autoBackups'], queryFn: () => platform.autoBackups.list() });
  return (
    <Section icon={<History size={18} />} title={t('settings.autoBackups')}>
      <p className="mb-3 text-sm text-ink-muted">{t('settings.autoBackupsDesc')}</p>
      {list.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('settings.noBackups')}</p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {list.map((b) => (
            <li key={b.name} className="flex items-center gap-3 py-2 text-sm">
              <span className="flex-1 truncate">{new Date(b.date).toLocaleString(lang)}</span>
              <span className="text-xs text-ink-muted">{Math.max(1, Math.round(b.size / 1024))} KB</span>
              <Button size="sm" onClick={async () => onRestore(await platform.autoBackups.read(b.name))}>
                {t('settings.restore')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function RequestMode({ business }: { business: Business }) {
  const { t } = useI18n();
  const toast = useToast();
  const { data: services = [] } = useServices();
  const { data: staff = [] } = useStaff();
  const tpl = defaultTemplates(business.locale).find((x) => x.kind === 'request')!;
  const link = requestLink(business, renderTemplate(tpl.body, { negocio: business.name, servicio: '…', cliente: '…' }));
  const [svg, setSvg] = useState('');
  useEffect(() => {
    if (!link) return setSvg('');
    QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }).then(setSvg, () => setSvg(''));
  }, [link]);
  return (
    <Section icon={<QrCode size={18} />} title={t('settings.request')}>
      <p className="mb-4 text-sm text-ink-muted">{t('settings.requestDesc')}</p>
      {!link ? (
        <p className="rounded-3xl bg-amber-500/10 p-3 text-sm text-amber-100">{t('settings.requestNeedsContact')}</p>
      ) : (
        <div className="flex flex-wrap items-start gap-5">
          <div className="w-40 overflow-hidden rounded-3xl bg-white p-2" data-testid="request-qr" dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="flex flex-col gap-2">
            <Button icon={<Download size={16} />} onClick={() => downloadFile('astrocitas-qr.svg', svg, 'image/svg+xml')}>
              {t('settings.downloadQr')}
            </Button>
            <Button
              icon={<Copy size={16} />}
              onClick={() => {
                localStorage.setItem('astrocitas.shared', '1');
                navigator.clipboard?.writeText(link).then(() => toast.show(t('settings.copied')), () => undefined);
              }}
            >
              {t('settings.copyLink')}
            </Button>
            <Button
              variant="primary"
              icon={<FileCode size={16} />}
              onClick={() => downloadFile('reserva.html', generateRequestPage({ business, services, staff }), 'text/html')}
              data-testid="download-request-page"
            >
              {t('settings.downloadPage')}
            </Button>
          </div>
        </div>
      )}
      <p className="mt-4 text-xs text-ink-muted">{t('settings.serverOnly')}</p>
    </Section>
  );
}

function DbPassword() {
  const { t } = useI18n();
  const platform = usePlatform();
  const toast = useToast();
  const [enc, setEnc] = useState<boolean | null>(null);
  const [pass, setPass] = useState('');
  useEffect(() => {
    platform.database?.isEncrypted().then(setEnc, () => setEnc(null));
  }, [platform]);
  return (
    <Section icon={<Lock size={18} />} title={t('settings.dbPassword')}>
      {!platform.database ? (
        <p className="text-sm text-ink-muted">{t('settings.dbWebNote')}</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-muted">{t('settings.dbPasswordDesc')}</p>
          <p className="mb-3 text-sm">
            {t('settings.storage')}: <strong>{enc ? t('settings.dbEncrypted') : t('settings.dbPlain')}</strong>
          </p>
          <div className="flex flex-wrap gap-2">
            <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} className="max-w-xs" autoComplete="new-password" aria-label={t('settings.dbPassword')} />
            <Button
              variant="primary"
              disabled={pass.length < 6}
              onClick={async () => {
                try {
                  await platform.database!.setPassword(pass);
                  setEnc(true);
                  setPass('');
                  toast.show(t('common.saved'));
                } catch (e) {
                  toast.error(e);
                }
              }}
            >
              {t('settings.dbSet')}
            </Button>
            {enc && (
              <Button
                variant="ghost"
                onClick={async () => {
                  await platform.database!.setPassword(null);
                  setEnc(false);
                }}
              >
                {t('settings.dbRemove')}
              </Button>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

function ModeSection() {
  const { t } = useI18n();
  const control = useAppControl();
  return (
    <Section icon={<Server size={18} />} title={t('settings.mode')}>
      {control.mode === 'remote' && control.session ? (
        <>
          <p className="text-sm">{t('connect.connectedTo', { url: control.session.state.url })}</p>
          {control.sync && <SyncConflicts engine={control.sync} />}
          <Button className="mt-3" variant="ghost" onClick={() => control.disconnect()}>
            {t('connect.disconnect')}
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-white/70">
            <strong>{t('settings.serverFeatures')}:</strong> {t('settings.serverFeaturesList')}.
          </p>
          <Button className="mt-3" variant="primary" icon={<Server size={16} />} onClick={() => control.connect()} data-testid="connect-server">
            {t('connect.connectBtn')}
          </Button>
        </>
      )}
    </Section>
  );
}

/** Instalar el servidor propio en este ordenador (Docker) y conectar la app, sin terminal. */
function SelfHostSection({ version }: { version?: string }) {
  const { t } = useI18n();
  const platform = usePlatform();
  const control = useAppControl();
  const toast = useToast();
  const sh = platform.selfHost;
  const [status, setStatus] = useState<SelfHostStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [svg, setSvg] = useState('');
  const refresh = () => sh?.status().then(setStatus, toast.error);
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (status?.url) QRCode.toString(status.url, { type: 'svg', margin: 1 }).then(setSvg);
  }, [status?.url]);
  if (!sh) return null;

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
      await refresh();
    }
  }
  async function install() {
    await act(t('selfhost.installing'), async () => {
      const secret = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
      const url = await sh!.install(version ?? 'latest', secret);
      // Esperar a que responda (primer arranque: migraciones).
      for (let i = 0; i < 60; i++) {
        try {
          if ((await fetch(`${url}/health`)).ok) break;
        } catch {
          /* arrancando */
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      toast.show(t('selfhost.ready'));
    });
  }

  const ipChanged = status?.url && status.ip && !status.url.includes(`//${status.ip}:`);
  return (
    <Section icon={<Container size={18} />} title={t('selfhost.title')}>
      <p className="text-sm text-white/70">{t('selfhost.desc')}</p>
      {!status ? (
        <Loader2 size={18} className="mt-3 animate-spin text-white/50" />
      ) : !status.docker ? (
        <div className="mt-3 space-y-2 text-sm">
          <p>{t('selfhost.needDocker')}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" icon={<ExternalLink size={14} />} onClick={() => platform.openExternal('https://www.docker.com/products/docker-desktop/')}>
              {t('selfhost.getDocker')}
            </Button>
            <Button size="sm" onClick={() => refresh()}>
              {t('selfhost.check')}
            </Button>
          </div>
        </div>
      ) : !status.dockerRunning ? (
        <div className="mt-3 space-y-2 text-sm">
          <p>{t('selfhost.startDocker')}</p>
          <Button size="sm" onClick={() => refresh()}>
            {t('selfhost.check')}
          </Button>
        </div>
      ) : !status.installed ? (
        <Button className="mt-3" variant="primary" icon={busy ? <Loader2 size={16} className="animate-spin" /> : <Container size={16} />} disabled={!!busy} onClick={install} data-testid="selfhost-install">
          {busy ?? t('selfhost.install')}
        </Button>
      ) : (
        <div className="mt-3 flex flex-wrap items-start gap-4">
          {svg && <div className="w-28 rounded-2xl bg-white p-1.5" dangerouslySetInnerHTML={{ __html: svg }} />}
          <div className="min-w-0 flex-1 space-y-2 text-sm">
            <p>
              <span className={status.running ? 'text-emerald-300' : 'text-white/50'}>● {status.running ? t('selfhost.running') : t('selfhost.stopped')}</span>
            </p>
            <p className="break-all font-medium">{status.url}</p>
            <p className="text-white/60">{t('selfhost.share')}</p>
            {ipChanged && <p className="text-amber-200">{t('selfhost.ipChanged', { ip: status.ip ?? '' })}</p>}
            <div className="flex flex-wrap gap-2">
              {control.mode !== 'remote' && status.running && (
                <Button size="sm" variant="primary" onClick={() => control.connect(status.url ?? undefined)}>
                  {t('selfhost.connect')}
                </Button>
              )}
              {status.running ? (
                <Button size="sm" icon={<Square size={14} />} disabled={!!busy} onClick={() => act('stop', sh.stop)}>
                  {t('selfhost.stop')}
                </Button>
              ) : (
                <Button size="sm" icon={<Play size={14} />} disabled={!!busy} onClick={() => act('start', sh.start)}>
                  {t('selfhost.start')}
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={install}>
                {busy === t('selfhost.installing') ? busy : t('selfhost.update')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

function SyncConflicts({ engine }: { engine: SyncEngine }) {
  const { t, lang } = useI18n();
  const status = useSyncStatus(engine);
  const [list, setList] = useState<ConflictRecord[]>([]);
  useEffect(() => {
    engine.conflicts().then(setList);
  }, [engine, status?.conflicts]);
  if (!list.length) return null;
  return (
    <div className="mt-4 rounded-3xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm" data-testid="sync-conflicts">
      <h3 className="font-semibold text-amber-100">{t('sync.conflicts')}</h3>
      <p className="mb-2 text-amber-100/80">{t('sync.conflictsDesc')}</p>
      <ul className="space-y-2">
        {list.map((c) => (
          <li key={c.id} className="flex items-center gap-3">
            <span className="flex-1">
              {t(`sync.reason.${c.reason}` as TKey)} · <span className="text-white/60">{new Date(c.createdAt).toLocaleString(lang)}</span>
            </span>
            <Button size="sm" onClick={() => engine.dismissConflict(c.id)}>
              {t('sync.dismiss')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LoyaltySection() {
  const { t } = useI18n();
  const biz = useBiz();
  const db = useDb();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [f, setF] = useState({ every: biz.settings.loyaltyEvery ?? 0, reward: biz.settings.loyaltyReward ?? '', reviewUrl: biz.settings.reviewUrl ?? '' });
  return (
    <Section icon={<Star size={18} />} title={t('settings.loyalty')}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('loyalty.every')}>
          <Input type="number" min={0} max={100} value={f.every} onChange={(e) => setF({ ...f, every: Number(e.target.value) })} />
        </Field>
        <Field label={t('loyalty.reward')} className="sm:col-span-2">
          <Input value={f.reward} onChange={(e) => setF({ ...f, reward: e.target.value })} placeholder={t('loyalty.rewardPh')} />
        </Field>
        <Field label={t('settings.reviewUrl')} className="sm:col-span-3">
          <Input type="url" value={f.reviewUrl} onChange={(e) => setF({ ...f, reviewUrl: e.target.value })} placeholder="https://g.page/r/…" />
        </Field>
      </div>
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          onClick={async () => {
            await db.saveBusiness({ ...biz, settings: { ...biz.settings, loyaltyEvery: f.every, loyaltyReward: f.reward, reviewUrl: f.reviewUrl } });
            await invalidate();
            toast.show(t('common.saved'));
          }}
        >
          {t('common.save')}
        </Button>
      </div>
    </Section>
  );
}

function LegalSection() {
  const { t } = useI18n();
  const biz = useBiz();
  const control = useAppControl();
  const tpl = defaultTemplates(biz.locale).find((x) => x.kind === 'request')!;
  const link = control.session ? null : requestLink(biz, renderTemplate(tpl.body, { negocio: biz.name, servicio: '…', cliente: '…' }));
  async function poster() {
    const url = link ?? '';
    const svg = url ? await QRCode.toString(url, { type: 'svg', margin: 1 }) : '';
    const w = window.open('', '_blank');
    if (!w) return;
    const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(biz.name)}</title><style>
      body{font-family:system-ui,sans-serif;text-align:center;padding:48px;color:#000}h1{font-size:44px;margin:0 0 8px}p{font-size:22px;margin:0 0 32px}
      .qr{width:340px;margin:0 auto}.qr svg{width:100%;height:auto}small{display:block;margin-top:24px;color:#555;font-size:14px}</style></head>
      <body><h1>${esc(biz.name)}</h1><p>${biz.locale === 'en' ? 'Scan to book an appointment' : 'Escanea para pedir cita'}</p><div class="qr">${svg}</div>
      <small>${esc(biz.phone)} ${esc(biz.address)}</small><script>setTimeout(()=>print(),300)</script></body></html>`);
    w.document.close();
  }
  return (
    <Section icon={<ShieldCheck size={18} />} title={t('settings.legal')}>
      <p className="mb-3 text-sm text-ink-muted">{t('settings.legalDesc')}</p>
      <div className="flex flex-wrap gap-2">
        <Button icon={<FileText size={16} />} onClick={() => downloadFile('politica-de-privacidad.md', privacyPolicy(biz, { selfHosted: control.mode === 'remote' }), 'text/markdown')}>
          {t('settings.privacy')}
        </Button>
        {link && (
          <Button icon={<Printer size={16} />} onClick={poster}>
            {t('settings.poster')}
          </Button>
        )}
      </div>
    </Section>
  );
}
