import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ShieldOff, Star, CalendarPlus, Cake, Download, FileUp, Plus, Search, Trash2, Users } from 'lucide-react';
import { formatDate, formatMoney, isBirthday, loyaltyStamps, parseCsv, toLocalDate, todayLocal, type Client } from '@astrocitas/core';
import { useI18n, type TKey } from '../i18n';
import { useBiz, useClient, useClients, useDb, useInvalidate, useServices, useStaff } from '../lib/data';
import { navigate } from '../lib/router';
import { cx, downloadFile, pickFile } from '../lib/util';
import { errorMessage } from '../lib/errors';
import { Avatar, Badge, Button, EmptyState, Field, IconButton, Input, PageHeader, Switch, Textarea } from '../components/ui';
import { useToast } from '../components/toast';

export function ClientsScreen({ selectedId }: { selectedId?: string }) {
  const { t } = useI18n();
  const db = useDb();
  const toast = useToast();
  const invalidate = useInvalidate();
  const biz = useBiz();
  const [q, setQ] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const { data: clients = [], isLoading } = useClients(q);
  const today = todayLocal(biz.timezone);

  useEffect(() => {
    if (window.location.hash.includes('focus=1')) searchRef.current?.focus();
  }, []);

  async function importCsv() {
    const file = await pickFile('.csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if (!file) return;
    try {
      const rows = /\.xlsx$/i.test(file.name) ? await readXlsx(file) : parseCsv(await file.text());
      const get = (r: Record<string, string>, ...keys: string[]) => {
        for (const k of Object.keys(r)) if (keys.includes(k.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, ''))) return r[k]!;
        return '';
      };
      let n = 0;
      for (const r of rows) {
        const name = get(r, 'nombre', 'name', 'cliente', 'client', 'nombre completo', 'full name');
        if (!name) continue;
        const bday = get(r, 'cumpleanos', 'birthday', 'fecha nacimiento', 'nacimiento');
        const iso = /^\d{4}-\d{2}-\d{2}$/.test(bday) ? bday : /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.test(bday) ? bday.replace(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/, (_, d, m, y) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`) : null;
        await db.saveClient({
          name,
          phone: get(r, 'telefono', 'phone', 'movil', 'mobile', 'tel'),
          email: get(r, 'email', 'correo', 'e-mail', 'mail'),
          notes: get(r, 'notas', 'notes', 'observaciones'),
          tags: get(r, 'etiquetas', 'tags').split(/[,|]/).map((s) => s.trim()).filter(Boolean),
          birthday: iso,
        });
        n++;
      }
      await invalidate();
      toast.show(t('clients.imported', { n }));
    } catch (e) {
      toast.error(errorMessage(e, t));
    }
  }

  const list = (
    <div className={cx('flex min-h-0 flex-col', selectedId && 'hidden lg:flex')}>
      <PageHeader
        title={t('clients.title')}
        actions={
          <>
            <Button size="sm" variant="ghost" icon={<FileUp size={16} />} onClick={importCsv}>
              <span className="hidden sm:inline">{t('clients.import')}</span>
            </Button>
            <Button size="sm" variant="primary" icon={<Plus size={16} />} onClick={() => navigate('/clients/new')}>
              {t('clients.new')}
            </Button>
          </>
        }
      >
        <div className="relative mt-3">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
          <Input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.search')} className="pl-9" aria-label={t('common.search')} />
        </div>
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        {!isLoading && clients.length === 0 ? (
          <EmptyState
            icon={<Users size={28} />}
            title={t('clients.empty')}
            description={t('clients.emptyDesc')}
            action={
              <div className="flex gap-2">
                <Button icon={<FileUp size={16} />} onClick={importCsv}>
                  {t('clients.import')}
                </Button>
                <Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate('/clients/new')}>
                  {t('clients.new')}
                </Button>
              </div>
            }
          />
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {clients.map((c) => (
              <li key={c.id}>
                <a
                  href={`#/clients/${c.id}`}
                  className={cx('mx-2 flex items-center gap-3 rounded-3xl px-3 py-2.5 transition hover:bg-white/[0.06] sm:mx-3', c.id === selectedId && 'bg-white/[0.09]')}
                >
                  <Avatar name={c.name} color={colorFromName(c.name)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{c.name}</span>
                      {isBirthday(c.birthday, today) && <Cake size={14} className="text-pink-500" aria-label={t('clients.birthday')} />}
                    </div>
                    <div className="truncate text-xs text-ink-muted">{c.phone || c.email || '—'}</div>
                  </div>
                  <div className="hidden gap-1 sm:flex">
                    {c.tags.slice(0, 2).map((tag) => (
                      <Badge key={tag}>{tag}</Badge>
                    ))}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[minmax(320px,420px)_1fr]">
      {list}
      <div className={cx('min-h-0 overflow-y-auto lg:m-3 lg:ml-0 lg:rounded-[32px] lg:border lg:border-white/[0.07] lg:bg-white/[0.025]', !selectedId && 'hidden lg:block')}>
        {selectedId ? (
          <ClientDetail key={selectedId} id={selectedId === 'new' ? null : selectedId} />
        ) : (
          <EmptyState icon={<Users size={28} />} title={t('clients.title')} description={t('appt.clientPh')} />
        )}
      </div>
    </div>
  );
}

const AVATAR_COLORS = ['#7c3aed', '#2563eb', '#db2777', '#059669', '#d97706', '#0891b2', '#4f46e5'];
function colorFromName(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

function ClientDetail({ id }: { id: string | null }) {
  const { t, lang } = useI18n();
  const db = useDb();
  const biz = useBiz();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: client, isLoading } = useClient(id);
  const { data: stats } = useQuery({ queryKey: ['clientStats', id], queryFn: () => db.clientStats(id!), enabled: !!id });
  const { data: history = [] } = useQuery({
    queryKey: ['appointments', 'client', id],
    queryFn: () => db.listAppointments({ from: 0, to: 8.64e15, clientId: id!, includeCancelled: true }),
    enabled: !!id,
  });
  const { data: services = [] } = useServices(true);
  const { data: staff = [] } = useStaff(true);
  const [form, setForm] = useState<Partial<Client> | null>(null);

  useEffect(() => {
    if (!id) setForm({ name: '', phone: '', email: '', notes: '', tags: [], birthday: null, consentReminders: true, consentMarketing: false });
    else if (client) setForm(client);
  }, [client, id]);

  if (id && isLoading) return null;
  if (!form) return null;

  const set = <K extends keyof Client>(k: K, v: Client[K]) => setForm({ ...form, [k]: v });

  async function save() {
    try {
      const saved = await db.saveClient(form as Client);
      await invalidate();
      toast.show(t('common.saved'));
      if (!id) navigate(`/clients/${saved.id}`);
    } catch (e) {
      toast.error(errorMessage(e, t));
    }
  }

  async function remove() {
    if (!client || !window.confirm(t('clients.deleteConfirm', { name: client.name }))) return;
    await db.remove('clients', client.id);
    await invalidate();
    navigate('/clients');
    toast.show(t('common.deleted'), { action: { label: t('common.undo'), onClick: () => db.restore('clients', client.id).then(invalidate) } });
  }

  /** Derecho de supresión (RGPD): se anonimiza la ficha y se conservan las citas sin datos personales. */
  async function erase() {
    if (!client || !window.confirm(t('clients.eraseConfirm', { name: client.name }))) return;
    await db.saveClient({ ...client, name: t('clients.erased'), phone: '', email: '', notes: '', birthday: null, tags: [], consentReminders: false, consentMarketing: false });
    await db.remove('clients', client.id);
    await invalidate();
    navigate('/clients');
    toast.show(t('clients.erased'));
  }

  async function redeem() {
    if (!client) return;
    await db.saveClient({ ...client, loyaltyRedeemed: (client.loyaltyRedeemed ?? 0) + 1 });
    await invalidate();
    toast.show(t('loyalty.redeemed'));
  }

  function gdprExport() {
    if (!client) return;
    downloadFile(`cliente-${client.name.replace(/\W+/g, '_')}.json`, JSON.stringify({ client, appointments: history }, null, 2));
  }

  const svc = new Map(services.map((s) => [s.id, s]));
  const stf = new Map(staff.map((s) => [s.id, s]));

  return (
    <div className="mx-auto max-w-3xl p-4 animate-fade sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <IconButton label={t('common.close')} onClick={() => navigate('/clients')} className="lg:hidden">
          <ArrowLeft size={20} />
        </IconButton>
        <Avatar name={form.name || '?'} color={colorFromName(form.name ?? '')} size={48} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold">{form.name || t('clients.new')}</h2>
          {client && <p className="text-sm text-ink-muted">{client.phone}</p>}
        </div>
        {client && (
          <Button variant="primary" size="sm" icon={<CalendarPlus size={16} />} onClick={() => navigate(`/calendar?new=1&client=${client.id}`)}>
            <span className="hidden sm:inline">{t('cal.new')}</span>
          </Button>
        )}
      </div>

      {stats && (
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={t('clients.visits')} value={String(stats.visits)} />
          <Stat label={t('clients.spent')} value={formatMoney(stats.totalSpentCents, biz.currency, lang)} />
          <Stat label={t('clients.noShows')} value={String(stats.noShows)} tone={stats.noShows > 0 ? 'warn' : undefined} />
          <Stat label={t('clients.next')} value={stats.nextVisitAt ? formatDate(stats.nextVisitAt, biz.timezone, lang, 'd LLL HH:mm') : '—'} />
        </div>
      )}

      {client && (biz.settings.loyaltyEvery ?? 0) > 0 && (
        <LoyaltyCard
          completed={history.filter((a) => a.status === 'completed').length}
          redeemed={client.loyaltyRedeemed ?? 0}
          every={biz.settings.loyaltyEvery}
          reward={biz.settings.loyaltyReward ?? ''}
          onRedeem={redeem}
        />
      )}

      <div className="card space-y-4 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('common.name')} className="sm:col-span-2">
            <Input value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} autoFocus={!id} />
          </Field>
          <Field label={t('common.phone')}>
            <Input type="tel" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label={t('common.email')}>
            <Input type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label={t('clients.birthday')}>
            <Input type="date" value={form.birthday ?? ''} onChange={(e) => set('birthday', e.target.value || null)} />
          </Field>
          <Field label={t('clients.tags')}>
            <Input
              defaultValue={(form.tags ?? []).join(', ')}
              onBlur={(e) => set('tags', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
              placeholder={t('clients.tagsPh')}
            />
          </Field>
          <Field label={t('common.notes')} className="sm:col-span-2">
            <Textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
        <div className="border-t border-white/[0.07] pt-3">
          <Switch checked={!!form.consentReminders} onChange={(v) => set('consentReminders', v)} label={t('clients.consentReminders')} />
          <Switch checked={!!form.consentMarketing} onChange={(v) => set('consentMarketing', v)} label={t('clients.consentMarketing')} />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {client && (
            <>
              <Button variant="ghost" size="sm" icon={<Download size={16} />} onClick={gdprExport} className="mr-auto">
                {t('clients.gdprExport')}
              </Button>
              <Button variant="ghost" size="sm" icon={<ShieldOff size={16} />} onClick={erase} className="text-red-300">
                {t('clients.erase')}
              </Button>
              <Button variant="ghost" size="sm" icon={<Trash2 size={16} />} onClick={remove} className="text-red-300">
                {t('common.delete')}
              </Button>
            </>
          )}
          <Button variant="primary" onClick={save} disabled={!form.name?.trim()}>
            {t('common.save')}
          </Button>
        </div>
      </div>

      {client && (
        <section className="mt-6">
          <h3 className="mb-2 text-sm font-semibold">{t('clients.history')}</h3>
          {history.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('clients.noHistory')}</p>
          ) : (
            <ul className="card divide-y divide-white/[0.06]">
              {[...history].reverse().map((a) => (
                <li key={a.id}>
                  <a href={`#/calendar?appt=${a.id}&view=day&date=${toLocalDate(a.startsAt, biz.timezone)}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-white/[0.06]">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: svc.get(a.serviceId)?.color }} />
                    <span className="w-32 shrink-0 tabular-nums text-white/70">{formatDate(a.startsAt, biz.timezone, lang, 'd LLL yy · HH:mm')}</span>
                    <span className="flex-1 truncate">
                      {svc.get(a.serviceId)?.name} <span className="text-white/40">· {stf.get(a.staffId)?.name}</span>
                    </span>
                    <StatusBadge status={a.status} />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="card px-3 py-2.5">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={cx('mt-0.5 truncate text-lg font-semibold tabular-nums', tone === 'warn' && 'text-amber-600 dark:text-amber-400')}>{value}</div>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  booked: '#7c3aed',
  confirmed: '#059669',
  completed: '#64748b',
  cancelled: '#94a3b8',
  no_show: '#dc2626',
};
export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <Badge color={STATUS_COLORS[status]}>{t(`status.${status}` as TKey)}</Badge>;
}

/** Lee un .xlsx (primera hoja) como filas con cabecera, igual que el CSV. */
async function readXlsx(file: File): Promise<Record<string, string>[]> {
  const { default: readXlsxFile } = await import('read-excel-file');
  const rows = (await readXlsxFile(file)) as unknown[][];
  const [head, ...body] = rows;
  if (!head) return [];
  const keys = head.map((h) => String(h ?? '').trim());
  return body.map((r) =>
    Object.fromEntries(
      keys.map((k, i) => {
        const v = r[i];
        return [k, v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? '' : String(v).trim()];
      }),
    ),
  );
}

function LoyaltyCard({ completed, redeemed, every, reward, onRedeem }: { completed: number; redeemed: number; every: number; reward: string; onRedeem(): void }) {
  const { t } = useI18n();
  const { stamps, rewardReady } = loyaltyStamps(completed, redeemed, every);
  return (
    <section className="glass mb-5 rounded-3xl p-4" data-testid="loyalty">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">{t('loyalty.title')}</h3>
        <span className="text-sm tabular-nums text-ink-muted">
          {stamps}/{every}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: every }, (_, i) => (
          <span key={i} className={cx('inline-flex h-8 w-8 items-center justify-center rounded-full', i < stamps ? 'bg-white text-black' : 'bg-white/[0.07] text-white/30')}>
            <Star size={15} fill={i < stamps ? 'currentColor' : 'none'} />
          </span>
        ))}
      </div>
      {rewardReady && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-emerald-500/15 p-3 text-sm text-emerald-100">
          <span>{t('loyalty.ready', { r: reward })}</span>
          <Button size="sm" variant="primary" onClick={onRedeem}>
            {t('loyalty.redeem')}
          </Button>
        </div>
      )}
    </section>
  );
}
