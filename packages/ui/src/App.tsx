import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { BarChart3, CalendarDays, Cog, MessageCircle, Scissors, Server, Smartphone, Users, UserRound } from 'lucide-react';
import { createRemoteAdapter, ServerSession, type DataAdapter, type SyncEngine } from '@astrocitas/core';
import type { SqlDriver } from '@astrocitas/core/sql';
import { openSyncedStore, SyncRunner, SyncBadge } from './lib/sync';
import { ConnectScreen, loadSession, persistSession } from './screens/Connect';
import { ServerScreen } from './screens/Server';
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
import { ReportsScreen } from './screens/Reports';

export interface OpenedStore {
  db: DataAdapter;
  storage: StorageInfo;
}

export interface AstroAppProps {
  /** Abre la base de datos local de la plataforma (OPFS en web, SQLite nativo en Tauri). */
  openLocal: (password?: string) => Promise<OpenedStore>;
  /** Versión mostrada en Ajustes. */
  version?: string;
  /** Capacidades de la plataforma (Tauri sustituye a la web). */
  platform?: Platform;
  /**
   * Abre una base SQLite local con nombre (caché offline del modo servidor). Si la plataforma la ofrece,
   * el modo servidor funciona sin conexión y sincroniza; si no, trabaja en línea contra la API.
   */
  openCache?: (name: string) => Promise<SqlDriver>;
}

export interface AppControl {
  mode: 'local' | 'remote';
  session: ServerSession | null;
  sync: SyncEngine | null;
  /** Abre el asistente de conexión (opcionalmente con la URL ya puesta). */
  connect(url?: string): void;
  disconnect(): Promise<void>;
}
export const AppControlContext = createContext<AppControl>({ mode: 'local', session: null, sync: null, connect: () => undefined, disconnect: async () => undefined });
export const useAppControl = () => useContext(AppControlContext);

const MODE_KEY = 'astrocitas.mode';
type Mode = 'local' | 'remote';

function readMode(): Mode | null {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return m === 'local' || m === 'remote' ? m : null;
  } catch {
    return null;
  }
}
function writeMode(m: Mode | null) {
  try {
    if (m) localStorage.setItem(MODE_KEY, m);
    else localStorage.removeItem(MODE_KEY);
  } catch {
    /* ignore */
  }
}

/** Ajustes de dispositivo en modo servidor (avisos, SMTP local…): se quedan en este equipo. */
const deviceMeta = {
  get: (k: string) => {
    try {
      const v = localStorage.getItem(`astrocitas.meta.${k}`);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  },
  set: (k: string, v: unknown) => {
    try {
      localStorage.setItem(`astrocitas.meta.${k}`, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  },
};

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

function Boot({ openLocal, version, openCache }: AstroAppProps) {
  const [mode, setModeState] = useState(readMode);
  const [connecting, setConnecting] = useState(false);
  const [connectUrl, setConnectUrl] = useState<string | undefined>();
  const [store, setStore] = useState<OpenedStore | null>(null);
  const [session, setSession] = useState<ServerSession | null>(null);
  const [sync, setSync] = useState<SyncEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  const setMode = (m: Mode | null) => {
    writeMode(m);
    setModeState(m);
  };

  const open = (password?: string) =>
    openLocal(password).then(
      (s) => {
        setLocked(false);
        setStore(s);
      },
      (e) => {
        const msg = String(e?.message ?? e);
        if (msg.includes('ASTRO_LOCKED')) setLocked(true);
        else if (msg.includes('ASTRO_DB_BUSY')) setError('AstroCitas ya está abierto en otra pestaña o ventana. Ciérrala y recarga esta página.');
        else setError(msg);
        if (password) throw e;
      },
    );

  const openRemote = async (s: ServerSession) => {
    setSession(s);
    // Con caché local + sincronización si la plataforma lo ofrece; si no, en línea.
    if (openCache) {
      const synced = await openSyncedStore(s, openCache);
      setSync(synced.engine);
      setStore(synced.store);
    } else setStore({ db: createRemoteAdapter(s, deviceMeta), storage: { kind: 'remote', persistent: true } });
  };

  const pending = useRef<ServerSession | null>(null);
  useEffect(() => {
    if (store || connecting) return;
    if (mode === 'local') open();
    if (mode === 'remote') {
      // Una sola sesión viva: la recién iniciada o la guardada (nunca dos rotando el mismo token).
      const s = pending.current ?? (loadSession() ? new ServerSession(loadSession()!, persistSession, undefined, loadSession) : null);
      pending.current = null;
      if (!s) setConnecting(true);
      else openRemote(s).catch((e) => setError(String(e?.message ?? e)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, connecting]);

  const control: AppControl = {
    mode: mode ?? 'local',
    session,
    sync,
    connect: (url?: string) => {
      setConnectUrl(url);
      setConnecting(true);
    },
    disconnect: async () => {
      await session?.logout();
      setSession(null);
      setSync(null);
      setStore(null);
      setMode('local');
    },
  };

  if (connecting)
    return (
      <ConnectScreen
        initialUrl={connectUrl}
        openLocal={mode === 'remote' ? undefined : store ? async () => store : () => openLocal()}
        onCancel={() => setConnecting(false)}
        onConnected={(s) => {
          pending.current = s;
          setStore(null);
          setMode('remote');
          setConnecting(false);
        }}
      />
    );
  if (locked) return <Unlock onUnlock={open} />;
  if (error)
    return (
      <Splash>
        <p className="max-w-md text-center text-sm text-red-300">{error}</p>
        {mode === 'remote' && (
          <button type="button" className="press rounded-full bg-white px-4 py-2 text-sm font-semibold text-black" onClick={() => { setError(null); setConnecting(true); }}>
            {'Reconectar'}
          </button>
        )}
      </Splash>
    );
  if (!mode) return <ModeChooser onLocal={() => setMode('local')} onRemote={() => setConnecting(true)} />;
  if (!store) return <Splash />;
  return (
    <AppControlContext.Provider value={control}>
      <DataProvider db={store.db} storage={store.storage}>
        {sync && <SyncRunner engine={sync} />}
        <Gate version={version} />
      </DataProvider>
    </AppControlContext.Provider>
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

function Unlock({ onUnlock }: { onUnlock(password: string): Promise<void> }) {
  const { t } = useI18n();
  const [pass, setPass] = useState('');
  const [bad, setBad] = useState(false);
  return (
    <div className="flex min-h-full items-center justify-center p-4 text-white">
      <form
        className="glass w-full max-w-sm rounded-[32px] p-6 text-center animate-pop"
        onSubmit={(e) => {
          e.preventDefault();
          setBad(false);
          onUnlock(pass).catch(() => setBad(true));
        }}
      >
        <LogoMark size={48} className="mx-auto" />
        <h1 className="mt-4 text-2xl font-semibold">{t('lock.title')}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t('lock.desc')}</p>
        <input
          type="password"
          autoFocus
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          className="input mt-5 text-center"
          aria-label={t('lock.password')}
          placeholder={t('lock.password')}
        />
        {bad && <p className="mt-2 text-sm text-red-300">{t('lock.wrong')}</p>}
        <button type="submit" className="press mt-4 h-11 w-full rounded-full bg-white font-semibold text-black">
          {t('lock.unlock')}
        </button>
      </form>
    </div>
  );
}

function ModeChooser({ onLocal, onRemote }: { onLocal(): void; onRemote(): void }) {
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
          <button
            type="button"
            onClick={onRemote}
            data-testid="mode-remote"
            className="glass press group rounded-[28px] p-5 text-left hover:[--glass-film:rgb(255_255_255/0.09)]"
          >
            <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white">
              <Server size={20} />
            </span>
            <div className="font-semibold">{t('mode.remote')}</div>
            <p className="mt-1 text-sm text-ink-muted">{t('mode.remoteDesc')}</p>
          </button>
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
  { path: '/reports', key: 'nav.reports', icon: BarChart3 },
  { path: '/services', key: 'nav.services', icon: Scissors },
  { path: '/staff', key: 'nav.staff', icon: UserRound },
  { path: '/settings', key: 'nav.settings', icon: Cog },
];

function Shell({ version }: { version?: string }) {
  const { t } = useI18n();
  const control = useAppControl();
  const nav = control.mode === 'remote' ? [...NAV.slice(0, -1), { path: '/server', key: 'nav.server' as TKey, icon: Server }, NAV[NAV.length - 1]!] : NAV;
  const { data: business } = useBusiness();
  const [path, params] = useRoute();
  useBackgroundJobs(useDb(), usePlatform());
  const section = '/' + (path.split('/')[1] ?? 'calendar');

  let screen: ReactNode;
  switch (section) {
    case '/clients':
      screen = <ClientsScreen selectedId={path.split('/')[2]} />;
      break;
    case '/server':
      screen = control.session ? <ServerScreen session={control.session} onLogout={() => control.disconnect()} /> : null;
      break;
    case '/reports':
      screen = <ReportsScreen />;
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
          {nav.map((n) => (
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
            <span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" /> {control.mode === 'remote' ? t('nav.server') : 'Local'}
          </span>
          <p className="mt-1 truncate">{control.session ? new URL(control.session.state.url).host : t('settings.localMode')}</p>
          {control.sync && <SyncBadge engine={control.sync} />}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col pb-24 md:pb-0">{screen}</main>
      {/* Dock flotante en móvil */}
      <nav
        className="glass fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 flex rounded-[32px] p-1.5 md:hidden"
        aria-label="Principal"
      >
        {nav.map((n) => (
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
