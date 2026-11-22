import { useEffect, useState, type ReactNode } from 'react';
import { CalendarDays, Cog, MessageCircle, Scissors, Server, Smartphone, Users, UserRound } from 'lucide-react';
import type { DataAdapter } from '@astrocitas/core';
import { I18nProvider, useI18n, type TKey } from './i18n';
import { DataProvider, useBusiness, useDb, type StorageInfo } from './lib/data';
import { PlatformProvider, usePlatform, webPlatform, type Platform } from './lib/platform';
import { useBackgroundJobs } from './lib/background';
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
import { MessagesScreen } from './screens/Messages';

export interface OpenedStore {
  db: DataAdapter;
  storage: StorageInfo;
}

export interface AstroAppProps {
  /** Abre la base de datos local de la plataforma (OPFS en web, SQLite nativo en Tauri). */
  openLocal: () => Promise<OpenedStore>;
  /** Versión mostrada en Ajustes. */
  version?: string;
  /** Capacidades de la plataforma (Tauri sustituye a la web). */
  platform?: Platform;
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
    <PlatformProvider platform={props.platform ?? webPlatform}>
      <I18nProvider>
        <ToastProvider>
          <Boot {...props} />
        </ToastProvider>
      </I18nProvider>
    </PlatformProvider>
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
    <div className="flex h-full flex-col items-center justify-center gap-4 text-white">
      <LogoMark size={56} className="animate-pulse" />
      {children}
    </div>
  );
}

function ModeChooser({ onLocal }: { onLocal(): void }) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-full items-center justify-center p-4 text-white">
      <div className="w-full max-w-xl animate-pop">
        <div className="mb-10 flex flex-col items-center text-center">
          <div className="glass mb-5 rounded-[28px] p-4">
            <LogoMark size={56} />
          </div>
          <h1 className="text-5xl font-semibold tracking-tight">AstroCitas</h1>
          <p className="mt-2 text-lg text-ink-muted">{t('app.tagline')}</p>
        </div>
        <h2 className="mb-3 px-1 text-sm font-medium text-white/80">{t('mode.title')}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onLocal}
            data-testid="mode-local"
            className="glass press group rounded-[28px] p-5 text-left hover:[--glass-film:rgb(255_255_255/0.09)]"
          >
            <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-black">
              <Smartphone size={20} />
            </span>
            <div className="font-semibold">{t('mode.local')}</div>
            <p className="mt-1 text-sm text-ink-muted">{t('mode.localDesc')}</p>
          </button>
          <div className="rounded-[28px] border border-white/[0.07] bg-white/[0.03] p-5 text-left opacity-70" aria-disabled>
            <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/70">
              <Server size={20} />
            </span>
            <div className="font-semibold">{t('mode.remote')}</div>
            <p className="mt-1 text-sm text-ink-muted">{t('mode.remoteDesc')}</p>
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
  { path: '/messages', key: 'nav.messages', icon: MessageCircle },
  { path: '/services', key: 'nav.services', icon: Scissors },
  { path: '/staff', key: 'nav.staff', icon: UserRound },
  { path: '/settings', key: 'nav.settings', icon: Cog },
];

function Shell({ version }: { version?: string }) {
  const { t } = useI18n();
  const { data: business } = useBusiness();
  const [path, params] = useRoute();
  useBackgroundJobs(useDb(), usePlatform());
  const section = '/' + (path.split('/')[1] ?? 'calendar');

  let screen: ReactNode;
  switch (section) {
    case '/clients':
      screen = <ClientsScreen selectedId={path.split('/')[2]} />;
      break;
    case '/messages':
      screen = <MessagesScreen />;
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
    <div className="flex h-full gap-3 md:p-3">
      {/* Barra lateral: panel de cristal flotante */}
      <aside className="glass hidden w-64 shrink-0 flex-col rounded-[32px] px-3 py-5 md:flex">
        <Logo className="px-3" />
        <div className="mt-1 truncate px-3 text-sm text-ink-muted">{business?.name}</div>
        <nav className="mt-7 flex flex-col gap-1" aria-label="Principal">
          {NAV.map((n) => (
            <a
              key={n.path}
              href={`#${n.path}`}
              aria-current={section === n.path ? 'page' : undefined}
              className={cx(
                'press flex items-center gap-3 rounded-full px-4 py-2.5 text-[15px] font-medium',
                section === n.path ? 'bg-white text-black shadow-[0_6px_20px_-8px_rgb(255_255_255/0.5)]' : 'text-white/75 hover:bg-white/[0.07] hover:text-white',
              )}
            >
              <n.icon size={19} />
              {t(n.key)}
            </a>
          ))}
        </nav>
        <div className="mt-auto rounded-3xl bg-white/[0.05] p-3.5 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" /> Local
          </span>
          <p className="mt-1">{t('settings.localMode')}</p>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col pb-24 md:pb-0">{screen}</main>
      {/* Dock flotante en móvil */}
      <nav
        className="glass fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 flex rounded-[32px] p-1.5 md:hidden"
        aria-label="Principal"
      >
        {NAV.map((n) => (
          <button
            key={n.path}
            type="button"
            onClick={() => navigate(n.path)}
            aria-current={section === n.path ? 'page' : undefined}
            className={cx(
              'press flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-[26px] py-2 text-[10px] font-medium',
              section === n.path ? 'glass glass-lens text-white' : 'text-white/60',
            )}
          >
            <n.icon size={21} strokeWidth={section === n.path ? 2.4 : 2} />
            {t(n.key)}
          </button>
        ))}
      </nav>
    </div>
  );
}
