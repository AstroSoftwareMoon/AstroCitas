import { useState } from 'react';
import { Clock, Plus, Scissors, Trash2 } from 'lucide-react';
import { formatMoney, PALETTE, type Service } from '@astrocitas/core';
import { useI18n } from '../i18n';
import { useBiz, useDb, useInvalidate, useServices } from '../lib/data';
import { errorMessage } from '../lib/errors';
import { Badge, Button, ColorSwatches, EmptyState, Field, Input, Modal, PageHeader, Switch } from '../components/ui';
import { useToast } from '../components/toast';

type Draft = Partial<Service> & { name: string; durationMin: number };

export function ServicesScreen() {
  const { t, lang } = useI18n();
  const biz = useBiz();
  const { data: services = [] } = useServices(true);
  const [editing, setEditing] = useState<Draft | null>(null);

  const groups = new Map<string, Service[]>();
  for (const s of services) groups.set(s.category || '—', [...(groups.get(s.category || '—') ?? []), s]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('services.title')}
        actions={
          <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={() => setEditing({ name: '', durationMin: 30, priceCents: 0, color: PALETTE[services.length % PALETTE.length]!, active: true })}>
            {t('services.new')}
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {services.length === 0 ? (
          <EmptyState icon={<Scissors size={28} />} title={t('services.empty')} />
        ) : (
          <div className="mx-auto max-w-4xl space-y-6">
            {[...groups.entries()].map(([cat, list]) => (
              <section key={cat}>
                {groups.size > 1 && <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{cat}</h2>}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((s) => (
                    <button key={s.id} type="button" onClick={() => setEditing(s)} className="card flex items-start gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md">
                      <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{s.name}</span>
                          {!s.active && <Badge>{t('common.inactive')}</Badge>}
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                          <span className="inline-flex items-center gap-1">
                            <Clock size={14} /> {s.durationMin} {t('common.min')}
                            {s.bufferAfterMin + s.bufferBeforeMin > 0 && <span className="text-xs">(+{s.bufferBeforeMin + s.bufferAfterMin})</span>}
                          </span>
                          <span className="font-medium text-slate-700 dark:text-slate-200">{formatMoney(s.priceCents, biz.currency, lang)}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
      {editing && <ServiceEditor draft={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ServiceEditor({ draft, onClose }: { draft: Draft; onClose(): void }) {
  const { t } = useI18n();
  const db = useDb();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [f, setF] = useState<Draft>(draft);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF({ ...f, [k]: v });

  async function save() {
    try {
      await db.saveService(f);
      await invalidate();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, t));
    }
  }
  async function remove() {
    if (!f.id) return;
    const id = f.id;
    await db.remove('services', id);
    await invalidate();
    onClose();
    toast.show(t('common.deleted'), { action: { label: t('common.undo'), onClick: () => db.restore('services', id).then(invalidate) } });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={f.id ? f.name : t('services.new')}
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('common.name')} className="sm:col-span-2">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>
        <Field label={t('services.category')}>
          <Input value={f.category ?? ''} onChange={(e) => set('category', e.target.value)} />
        </Field>
        <Field label={t('services.price')}>
          <Input type="number" min={0} step={0.5} value={(f.priceCents ?? 0) / 100} onChange={(e) => set('priceCents', Math.round(Number(e.target.value) * 100))} />
        </Field>
        <Field label={t('services.duration')}>
          <Input type="number" min={5} step={5} value={f.durationMin} onChange={(e) => set('durationMin', Number(e.target.value))} />
        </Field>
        <div />
        <Field label={t('services.bufferBefore')}>
          <Input type="number" min={0} step={5} value={f.bufferBeforeMin ?? 0} onChange={(e) => set('bufferBeforeMin', Number(e.target.value))} />
        </Field>
        <Field label={t('services.bufferAfter')} hint={t('services.bufferHelp')}>
          <Input type="number" min={0} step={5} value={f.bufferAfterMin ?? 0} onChange={(e) => set('bufferAfterMin', Number(e.target.value))} />
        </Field>
        <div className="sm:col-span-2">
          <span className="label">{t('common.color')}</span>
          <ColorSwatches value={f.color ?? PALETTE[0]!} onChange={(c) => set('color', c)} colors={PALETTE} />
        </div>
        <div className="sm:col-span-2">
          <Switch checked={f.active ?? true} onChange={(v) => set('active', v)} label={t('common.active')} />
        </div>
      </div>
    </Modal>
  );
}
