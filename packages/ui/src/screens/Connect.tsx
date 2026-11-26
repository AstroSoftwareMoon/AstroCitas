import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, CloudUpload, Server, ShieldCheck } from 'lucide-react';
import { ServerSession, type DataAdapter, type StoredSession } from '@astrocitas/core';
import { useI18n } from '../i18n';
import { Button, Field, Input } from '../components/ui';
import { LogoMark } from '../components/Logo';

const SESSION_KEY = 'astrocitas.server';

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function persistSession(s: StoredSession | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

type Step = 'url' | 'login' | 'setup' | 'business' | 'migrate' | 'done';

/**
 * Asistente "Conectar a mi servidor":
 *  1) URL → comprueba que es AstroCitas y que la versión de API es compatible.
 *  2) Inicia sesión (con 2FA si está activo) o crea el administrador en un servidor recién instalado.
 *  3) Elige negocio si tienes varios.
 *  4) Si hay datos en este dispositivo, ofrece subirlos (fusión sin pérdidas, verificada por recuento).
 */
export function ConnectScreen({ onCancel, onConnected, openLocal, initialUrl }: { onCancel(): void; onConnected(s: ServerSession): void; openLocal?: () => Promise<{ db: DataAdapter }>; initialUrl?: string }) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>('url');
  const [url, setUrl] = useState(initialUrl ?? '');
  const [info, setInfo] = useState<{ version: string } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [bizName, setBizName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<ServerSession | null>(null);
  const [localCounts, setLocalCounts] = useState<Record<string, number> | null>(null);
  const [migrated, setMigrated] = useState<Record<string, number> | null>(null);

  // Si la app la sirve el propio servidor, proponer esa dirección.
  useEffect(() => {
    if (location.protocol.startsWith('http'))
      ServerSession.version(location.origin)
        .then(() => setUrl((u) => u || location.origin))
        .catch(() => undefined);
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const err = e as Error & { data?: { totpRequired?: boolean } };
      if (err.data?.totpRequired) setNeedTotp(true);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const checkUrl = () =>
    run(async () => {
      const v = await ServerSession.version(url);
      setInfo(v);
      setStep(v.setupRequired ? 'setup' : 'login');
    });

  const afterLogin = async (s: ServerSession) => {
    setSession(s);
    if (s.state.memberships.length > 1) return setStep('business');
    await prepareMigration(s);
  };

  const prepareMigration = async (s: ServerSession) => {
    if (openLocal) {
      try {
        const { db } = await openLocal();
        if (await db.getBusiness()) {
          const dump = await db.exportAll();
          setLocalCounts(Object.fromEntries(Object.entries(dump.data).map(([k, v]) => [k, (v as unknown[]).filter((x) => !(x as { deletedAt?: number }).deletedAt).length])));
          return setStep('migrate');
        }
      } catch {
        /* sin datos locales */
      }
    }
    onConnected(s);
  };

  const login = () =>
    run(async () => {
      const s = await ServerSession.login(url, { email, password, totp: needTotp ? totp : undefined }, persistSession);
      await afterLogin(s);
    });

  const setup = () =>
    run(async () => {
      const s = await ServerSession.login(url, { email, password, setup: { businessName: bizName, locale: navigator.language.startsWith('en') ? 'en' : 'es' } }, persistSession);
      await afterLogin(s);
    });

  const migrate = () =>
    run(async () => {
      const { db } = await openLocal!();
      const dump = await db.exportAll();
      // El negocio del servidor conserva su identidad: se fusiona todo lo demás.
      const serverBiz = await session!.rpc<{ id: string } | null>('getBusiness', []);
      const data = { ...dump.data, business: serverBiz ? dump.data.business.map((b) => ({ ...b, id: serverBiz.id })) : dump.data.business };
      await session!.rpc('importAll', [{ ...dump, data }, { mode: 'merge' }]);
      const after = await session!.rpc<typeof dump>('exportAll', []);
      const counts = Object.fromEntries(Object.entries(after.data).map(([k, v]) => [k, (v as unknown[]).filter((x) => !(x as { deletedAt?: number }).deletedAt).length]));
      const missing = Object.entries(localCounts ?? {}).filter(([k, n]) => k !== 'business' && (counts[k] ?? 0) < n);
      if (missing.length) throw new Error(t('connect.verifyFailed', { what: missing.map(([k]) => k).join(', ') }));
      setMigrated(counts);
      setStep('done');
    });

  return (
    <div className="flex min-h-full items-center justify-center p-4 text-white">
      <div className="glass w-full max-w-md rounded-[32px] p-6 animate-pop sm:p-7">
        <div className="mb-5 flex items-center gap-3">
          <button type="button" onClick={onCancel} aria-label={t('common.close')} className="press rounded-full p-2 text-white/70 hover:bg-white/10">
            <ArrowLeft size={20} />
          </button>
          <LogoMark size={28} />
          <h1 className="text-xl font-semibold">{t('mode.remote')}</h1>
        </div>

        {step === 'url' && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              checkUrl();
            }}
          >
            <p className="text-sm text-ink-muted">{t('connect.urlDesc')}</p>
            <Field label={t('connect.url')}>
              <Input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://citas.tudominio.es" inputMode="url" data-testid="server-url" />
            </Field>
            <Button type="submit" variant="primary" className="w-full" disabled={busy || !url.trim()} icon={<Server size={17} />}>
              {t('connect.check')}
            </Button>
          </form>
        )}

        {(step === 'login' || step === 'setup') && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (step === 'setup') setup();
              else login();
            }}
          >
            <p className="flex items-center gap-2 text-sm text-emerald-300">
              <CheckCircle2 size={16} /> {t('connect.compatible', { v: info?.version ?? '' })}
            </p>
            {step === 'setup' && (
              <>
                <p className="text-sm text-ink-muted">{t('connect.setupDesc')}</p>
                <Field label={t('onb.name')}>
                  <Input value={bizName} onChange={(e) => setBizName(e.target.value)} required data-testid="setup-business" />
                </Field>
              </>
            )}
            <Field label={t('common.email')}>
              <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="login-email" />
            </Field>
            <Field label={t('lock.password')} hint={step === 'setup' ? t('connect.passwordHint') : undefined}>
              <Input type="password" autoComplete={step === 'setup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required data-testid="login-password" />
            </Field>
            {needTotp && (
              <Field label={t('connect.totp')}>
                <Input inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={(e) => setTotp(e.target.value)} autoFocus />
              </Field>
            )}
            <Button type="submit" variant="primary" className="w-full" disabled={busy} icon={<ShieldCheck size={17} />} data-testid="login-submit">
              {step === 'setup' ? t('connect.createAdmin') : t('connect.login')}
            </Button>
          </form>
        )}

        {step === 'business' && session && (
          <div className="space-y-2">
            <p className="mb-2 text-sm text-ink-muted">{t('connect.chooseBusiness')}</p>
            {session.state.memberships.map((m) => (
              <button
                key={m.businessId}
                type="button"
                onClick={() => {
                  session.selectBusiness(m.businessId);
                  run(() => prepareMigration(session));
                }}
                className="press flex w-full items-center justify-between rounded-3xl bg-white/[0.07] px-4 py-3 text-left hover:bg-white/[0.12]"
              >
                <span className="font-medium">{m.businessName}</span>
                <span className="text-xs text-ink-muted">{t(`role.${m.role}` as never)}</span>
              </button>
            ))}
          </div>
        )}

        {step === 'migrate' && session && (
          <div className="space-y-4">
            <p className="text-sm text-ink-muted">{t('connect.migrateDesc')}</p>
            <ul className="grid grid-cols-2 gap-2 text-sm">
              {Object.entries(localCounts ?? {})
                .filter(([k, n]) => n > 0 && ['clients', 'appointments', 'services', 'staff'].includes(k))
                .map(([k, n]) => (
                  <li key={k} className="rounded-2xl bg-white/[0.06] px-3 py-2">
                    <span className="text-lg font-semibold">{n}</span> <span className="text-ink-muted">{t(`nav.${k === 'appointments' ? 'calendar' : k}` as never)}</span>
                  </li>
                ))}
            </ul>
            <Button variant="primary" className="w-full" icon={<CloudUpload size={17} />} onClick={migrate} disabled={busy} data-testid="migrate">
              {t('connect.migrate')}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => onConnected(session)} disabled={busy}>
              {t('connect.skipMigrate')}
            </Button>
          </div>
        )}

        {step === 'done' && session && (
          <div className="space-y-4 text-center">
            <CheckCircle2 size={40} className="mx-auto text-emerald-300" />
            <p>{t('connect.migrated', { n: migrated?.appointments ?? 0, c: migrated?.clients ?? 0 })}</p>
            <Button variant="primary" className="w-full" onClick={() => onConnected(session)}>
              {t('connect.open')}
            </Button>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-300">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
