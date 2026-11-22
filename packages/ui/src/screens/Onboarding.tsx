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
    <div className="starfield min-h-full bg-space-950 px-4 py-10 text-white">
      <form onSubmit={submit} className="mx-auto w-full max-w-xl animate-pop">
        <div className="mb-8 flex items-center gap-3">
          <LogoMark size={40} />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('onb.title')}</h1>
            <p className="text-sm text-white/70">{t('onb.subtitle')}</p>
          </div>
        </div>

        <div className="space-y-6 rounded-3xl border border-white/10 bg-white/[0.06] p-5 backdrop-blur sm:p-7">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-white/80">{t('onb.name')}</span>
            <Input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('onb.namePh')}
              className="h-12 border-white/20 bg-white/10 text-base text-white placeholder:text-white/40"
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
                    'flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 text-xs font-medium transition',
                    kind === k ? 'border-astro-300 bg-astro-500/30 text-white' : 'border-white/10 bg-white/5 text-white/75 hover:bg-white/10',
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
                    className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
                  />
                  {staff.length > 1 && (
                    <button type="button" aria-label={t('common.delete')} onClick={() => setStaff(staff.filter((_, j) => j !== i))} className="rounded-xl px-2 text-white/60 hover:bg-white/10">
                      <X size={18} />
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setStaff([...staff, ''])} className="inline-flex items-center gap-1.5 text-sm text-astro-200 hover:text-white">
                <Plus size={16} /> {t('onb.addStaff')}
              </button>
            </div>
          </fieldset>

          <div className="rounded-2xl bg-white/5 p-3 [&_*]:!text-white/85">
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
