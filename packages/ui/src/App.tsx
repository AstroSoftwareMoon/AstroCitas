import { useEffect, useState, type ReactNode } from 'react';
import { CalendarDays, Cog, Scissors, Server, Smartphone, Users, UserRound } from 'lucide-react';
import type { DataAdapter } from '@astrocitas/core';
import { I18nProvider, useI18n, type TKey } from './i18n';
import { DataProvider, useBusiness, type StorageInfo } from './lib/data';
import { navigate, useRoute } from './lib/router';
import { initTheme } from './lib/theme';
import { cx } from './lib/util';
import { ToastProvider } from './components/toast';
import { Logo, LogoMark } from './components/Logo';
import { Onboarding } from './screens/Onboarding';
import { CalendarScreen } from './calendar/CalendarScreen';
import { ClientsScreen } from './screens/Clients';
import { ServicesScreen } from './screens/Services';
import { StaffScreen } from './screens/Staff';
import { SettingsScreen } from './screens/Settings';

export interface OpenedStore {
  db: DataAdapter;
  storage: StorageInfo;
}

export interface AstroAppProps {
  /** Abre la base de datos local de la plataforma (OPFS en web, SQLite nativo en Tauri). */
  openLocal: () => Promise<OpenedStore>;
  /** Versión mostrada en Ajustes. */
  version?: string;
}

const MODE_KEY = 'astrocitas.mode';

function readMode(): 'local' | null {
  try {
    return localStorage.getItem(MODE_KEY) === 'local' ? 'local' : null;
  } catch {
    return null;
  }
}

export function AstroApp(props: AstroAppProps) {
  useEffect(initTheme, []);
  return (
    <I18nProvider>
      <ToastProvider>
        <Boot {...props} />
      </ToastProvider>
    </I18nProvider>
  );
}

function Boot({ openLocal, version }: AstroAppProps) {
  const [mode, setMode] = useState(readMode);
  const [store, setStore] = useState<OpenedStore | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'local' || store) return;
    openLocal().then(setStore, (e) => setError(String(e?.message ?? e)));
  }, [mode, store, openLocal]);

  if (error) return <Splash><p className="max-w-md text-center text-sm text-red-300">{error}</p></Splash>;
  if (!mode)
    return (
      <ModeChooser
        onLocal={() => {
          try {
            localStorage.setItem(MODE_KEY, 'local');
          } catch {
            /* ignore */
          }
          setMode('local');
        }}
      />
    );
  if (!store) return <Splash />;
  return (
    <DataProvider db={store.db} storage={store.storage}>
      <Gate version={version} />
    </DataProvider>
  );
}

function Splash({ children }: { children?: ReactNode }) {
  return (
    <div className="starfield flex h-full flex-col items-center justify-center gap-4 bg-space-950 text-white">
      <LogoMark size={56} className="animate-pulse" />
      {children}
    </div>
  );
}

function ModeChooser({ onLocal }: { onLocal(): void }) {
  const { t } = useI18n();
  return (
    <div className="starfield flex min-h-full items-center justify-center bg-space-950 p-4 text-white">
      <div className="w-full max-w-xl animate-pop">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark size={64} />
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">AstroCitas</h1>
          <p className="mt-1 text-white/70">{t('app.tagline')}</p>
        </div>
        <h2 className="mb-3 text-sm font-medium text-white/80">{t('mode.title')}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onLocal}
            data-testid="mode-local"
            className="group rounded-2xl border border-white/15 bg-white/10 p-5 text-left backdrop-blur transition hover:border-astro-300 hover:bg-white/15"
          >
            <Smartphone className="mb-3 text-astro-300" />
            <div className="font-semibold">{t('mode.local')}</div>
            <p className="mt-1 text-sm text-white/70">{t('mode.localDesc')}</p>
          </button>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-left opacity-70" aria-disabled>
            <Server className="mb-3 text-white/60" />
            <div className="font-semibold">{t('mode.remote')}</div>
            <p className="mt-1 text-sm text-white/60">{t('mode.remoteDesc')}</p>
            <span className="mt-3 inline-block rounded-full bg-white/10 px-2 py-0.5 text-xs">{t('mode.soon')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Gate({ version }: { version?: string }) {
  const { data: business, isLoading } = useBusiness();
  if (isLoading) return <Splash />;
  if (!business) return <Onboarding />;
  return <Shell version={version} />;
}

const NAV: { path: string; key: TKey; icon: typeof CalendarDays }[] = [
  { path: '/calendar', key: 'nav.calendar', icon: CalendarDays },
  { path: '/clients', key: 'nav.clients', icon: Users },
  { path: '/services', key: 'nav.services', icon: Scissors },
  { path: '/staff', key: 'nav.staff', icon: UserRound },
  { path: '/settings', key: 'nav.settings', icon: Cog },
];

function Shell({ version }: { version?: string }) {
  const { t } = useI18n();
  const { data: business } = useBusiness();
  const [path, params] = useRoute();
  const section = '/' + (path.split('/')[1] ?? 'calendar');

  let screen: ReactNode;
  switch (section) {
    case '/clients':
      screen = <ClientsScreen selectedId={path.split('/')[2]} />;
      break;
    case '/services':
      screen = <ServicesScreen />;
      break;
    case '/staff':
      screen = <StaffScreen />;
      break;
    case '/settings':
      screen = <SettingsScreen version={version} />;
      break;
    default:
      screen = <CalendarScreen params={params} />;
  }

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200/70 bg-white px-3 py-4 dark:border-white/10 dark:bg-space-900 md:flex">
        <Logo className="px-2" />
        <div className="mt-1 truncate px-2 text-xs text-slate-500 dark:text-slate-400">{business?.name}</div>
        <nav className="mt-6 flex flex-col gap-1" aria-label="Principal">
          {NAV.map((n) => (
            <a
              key={n.path}
              href={`#${n.path}`}
              aria-current={section === n.path ? 'page' : undefined}
              className={cx(
                'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition',
                section === n.path
                  ? 'bg-astro-50 text-astro-700 dark:bg-astro-500/15 dark:text-astro-200'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5',
              )}
            >
              <n.icon size={18} />
              {t(n.key)}
            </a>
          ))}
        </nav>
        <div className="mt-auto rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-white/5 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-current" /> Local
          </span>
          <p className="mt-1">{t('settings.localMode')}</p>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">{screen}</main>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-white/10 dark:bg-space-900/95 md:hidden"
        aria-label="Principal"
      >
        {NAV.map((n) => (
          <button
            key={n.path}
            type="button"
            onClick={() => navigate(n.path)}
            aria-current={section === n.path ? 'page' : undefined}
            className={cx(
              'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium',
              section === n.path ? 'text-astro-600 dark:text-astro-300' : 'text-slate-500 dark:text-slate-400',
            )}
          >
            <n.icon size={20} />
            {t(n.key)}
          </button>
        ))}
      </nav>
    </div>
  );
}
