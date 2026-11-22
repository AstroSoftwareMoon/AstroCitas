import { useState, type ReactNode } from 'react';
import { Database, Download, HardDrive, Lock, Palette, Server, Store, Upload, Trash2, CalendarClock } from 'lucide-react';
import { BusinessKind, hhmmToMinutes, isBackupFile, isValidTimeZone, minutesToHHMM, toCsv, type Business } from '@astrocitas/core';
import { useI18n, type Lang, type TKey } from '../i18n';
import { useBiz, useDb, useInvalidate, useStorageInfo } from '../lib/data';
import { useTheme, type Theme } from '../lib/theme';
import { downloadFile, pickFile } from '../lib/util';
import { errorMessage } from '../lib/errors';
import { Button, Field, Input, PageHeader, Segmented, Select } from '../components/ui';
import { useToast } from '../components/toast';
import { LogoMark } from '../components/Logo';

export function SettingsScreen({ version }: { version?: string }) {
  const { t, lang, setLang } = useI18n();
  const biz = useBiz();
  const db = useDb();
  const storage = useStorageInfo();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [theme, setTheme] = useTheme();
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

  async function exportBackup() {
    const data = await db.exportAll();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    downloadFile(`astrocitas-${stamp}.astrocitas`, JSON.stringify(data), 'application/json');
  }

  async function importBackup() {
    const file = await pickFile('.astrocitas,.json,application/json');
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      if (!isBackupFile(json)) throw new Error('El archivo no es una copia de AstroCitas');
      if (!window.confirm(t('settings.importConfirm'))) return;
      await db.importAll(json, { mode: 'replace' });
      await invalidate();
      toast.show(t('settings.imported'));
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
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <span className="label">{t('settings.theme')}</span>
                <Segmented<Theme>
                  value={theme}
                  onChange={setTheme}
                  options={[
                    { value: 'light', label: t('settings.themeLight') },
                    { value: 'dark', label: t('settings.themeDark') },
                    { value: 'system', label: t('settings.themeSystem') },
                  ]}
                />
              </div>
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
            </div>
            <div className="mt-4 border-t border-slate-100 pt-4 dark:border-white/10">
              <Button variant="ghost" icon={<Trash2 size={16} />} className="text-red-600 dark:text-red-400" onClick={wipe}>
                {t('settings.wipe')}
              </Button>
            </div>
          </Section>

          <Section icon={<Server size={18} />} title={t('settings.mode')}>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              <strong>{t('settings.serverFeatures')}:</strong> {t('settings.serverFeaturesList')}.
            </p>
            <p className="mt-2 text-xs text-slate-500">{t('mode.soon')}</p>
          </Section>

          <div className="flex items-center justify-center gap-2 py-4 text-xs text-slate-400">
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
        <span className="text-astro-600 dark:text-astro-300">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}
