import { useState } from 'react';
import { Briefcase, Car, Dumbbell, GraduationCap, HeartPulse, Plus, Scissors, Sparkles, Stethoscope, X } from 'lucide-react';
import { setupBusiness, type BusinessKind } from '@astrocitas/core';
import { useI18n, type TKey } from '../i18n';
import { useDb, useInvalidate } from '../lib/data';
import { cx } from '../lib/util';
import { Button, Input, Switch } from '../components/ui';
import { LogoMark } from '../components/Logo';
import { useToast } from '../components/toast';

const KINDS: { kind: BusinessKind; icon: typeof Scissors }[] = [
  { kind: 'peluqueria', icon: Scissors },
  { kind: 'barberia', icon: Scissors },
  { kind: 'clinica', icon: Stethoscope },
  { kind: 'fisioterapia', icon: Dumbbell },
  { kind: 'estetica', icon: Sparkles },
  { kind: 'taller', icon: Car },
  { kind: 'academia', icon: GraduationCap },
  { kind: 'otro', icon: Briefcase },
];

export function Onboarding() {
  const { t } = useI18n();
  const db = useDb();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<BusinessKind>('peluqueria');
  const [staff, setStaff] = useState<string[]>(['']);
  const [demo, setDemo] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await setupBusiness(db, { name: name.trim(), kind, staffNames: staff, withDemo: demo });
      await invalidate();
    } catch (err) {
      toast.error(err);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full px-4 py-10 text-white">
      <form onSubmit={submit} className="mx-auto w-full max-w-xl animate-pop">
        <div className="mb-8 flex items-center gap-4">
          <div className="glass rounded-3xl p-3">
            <LogoMark size={40} />
          </div>
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">{t('onb.title')}</h1>
            <p className="text-ink-muted">{t('onb.subtitle')}</p>
          </div>
        </div>

        <div className="glass space-y-6 rounded-[32px] p-5 sm:p-7">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-white/80">{t('onb.name')}</span>
            <Input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('onb.namePh')}
              className="h-12 text-base"
              data-testid="onb-name"
            />
          </label>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-white/80">{t('onb.kind')}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {KINDS.map(({ kind: k, icon: Icon }) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  className={cx(
                    'press flex flex-col items-center gap-1.5 rounded-3xl px-2 py-3.5 text-xs font-medium',
                    kind === k ? 'bg-white text-black' : 'bg-white/[0.06] text-white/75 hover:bg-white/10',
                  )}
                >
                  <Icon size={20} />
                  {t(`kind.${k}` as TKey)}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-white/80">{t('onb.staff')}</legend>
            <div className="space-y-2">
              {staff.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={s}
                    onChange={(e) => setStaff(staff.map((x, j) => (j === i ? e.target.value : x)))}
                    placeholder={t('onb.staffPh')}
                    className=""
                  />
                  {staff.length > 1 && (
                    <button type="button" aria-label={t('common.delete')} onClick={() => setStaff(staff.filter((_, j) => j !== i))} className="rounded-full px-2.5 text-white/60 hover:bg-white/10">
                      <X size={18} />
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setStaff([...staff, ''])} className="inline-flex items-center gap-1.5 text-sm text-white/70 hover:text-white">
                <Plus size={16} /> {t('onb.addStaff')}
              </button>
            </div>
          </fieldset>

          <div className="rounded-3xl bg-white/[0.05] px-4 py-3">
            <Switch checked={demo} onChange={setDemo} label={t('onb.demo')} description={t('onb.demoDesc')} />
          </div>

          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || !name.trim()} data-testid="onb-start">
            <HeartPulse size={18} className={busy ? 'animate-pulse' : 'hidden'} />
            {t('onb.start')}
          </Button>
        </div>
      </form>
    </div>
  );
}
