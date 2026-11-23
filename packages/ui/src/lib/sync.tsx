import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CloudOff, RefreshCw } from 'lucide-react';
import { Hlc, httpSyncTransport, outboxHook, SyncEngine, type ServerSession, type SyncStatus } from '@astrocitas/core';
import { SqlAdapter, type SqlDriver } from '@astrocitas/core/sql';
import { useI18n } from '../i18n';
import { cx } from './util';
import type { OpenedStore } from '../App';

function hash(s: string): string {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h.toString(36);
}

function deviceId(key: string): string {
  try {
    const k = `astrocitas.device.${key}`;
    let id = localStorage.getItem(k);
    if (!id) {
      id = `d${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
      localStorage.setItem(k, id);
    }
    return id;
  } catch {
    return `d${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
}

let scheduleSync = () => undefined as void;

/**
 * Modo servidor offline-first: la interfaz lee y escribe en una caché SQLite local (por servidor y
 * negocio) y el motor sincroniza en segundo plano. Sin conexión todo sigue funcionando.
 */
export async function openSyncedStore(session: ServerSession, openCache: (name: string) => Promise<SqlDriver>): Promise<{ store: OpenedStore; engine: SyncEngine }> {
  const name = `remote-${hash(`${session.state.url}|${session.businessId}`)}`;
  const id = deviceId(name);
  const hlc = new Hlc(id);
  const record = outboxHook(hlc);
  const db = await SqlAdapter.open(await openCache(name), {
    onChange: async (...args) => {
      await record(...args);
      scheduleSync();
    },
  });
  const engine = new SyncEngine(db, hlc, httpSyncTransport(session), id);
  return { store: { db, storage: { kind: 'sync', persistent: true } }, engine };
}

/** Bucle de sincronización: al cambiar algo (con retardo corto), cada 15 s y al recuperar conexión. */
export function SyncRunner({ engine }: { engine: SyncEngine }) {
  const qc = useQueryClient();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => engine.sync();
    scheduleSync = () => {
      clearTimeout(timer);
      timer = setTimeout(run, 800);
    };
    const off = engine.onStatus((s) => {
      if (s.state === 'idle' && s.received) qc.invalidateQueries();
    });
    run();
    const id = setInterval(run, 15_000);
    const onOnline = () => run();
    const onVisible = () => document.visibilityState === 'visible' && run();
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      off();
      clearInterval(id);
      clearTimeout(timer);
      scheduleSync = () => undefined;
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [engine, qc]);
  return null;
}

export function useSyncStatus(engine: SyncEngine | null): SyncStatus | null {
  const [s, setS] = useState<SyncStatus | null>(engine?.status ?? null);
  useEffect(() => {
    if (!engine) return;
    const off = engine.onStatus(setS);
    return () => void off();
  }, [engine]);
  return s;
}

export function SyncBadge({ engine }: { engine: SyncEngine }) {
  const { t } = useI18n();
  const s = useSyncStatus(engine);
  if (!s) return null;
  const label =
    s.state === 'syncing'
      ? t('sync.syncing')
      : s.state === 'offline'
        ? t('sync.offline', { n: s.pending })
        : s.state === 'error'
          ? t('sync.error')
          : s.pending
            ? t('sync.pending', { n: s.pending })
            : t('sync.ok');
  return (
    <button
      type="button"
      onClick={() => engine.sync()}
      data-testid="sync-badge"
      className={cx(
        'press mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
        s.state === 'offline' || s.state === 'error' ? 'bg-amber-500/15 text-amber-200' : 'bg-white/[0.07] text-white/70',
      )}
      title={s.error ?? ''}
    >
      {s.state === 'offline' ? <CloudOff size={12} /> : <RefreshCw size={12} className={cx(s.state === 'syncing' && 'animate-spin')} />}
      {label}
      {s.conflicts > 0 && (
        <a href="#/settings" className="ml-1 inline-flex items-center gap-0.5 text-amber-200" onClick={(e) => e.stopPropagation()}>
          <AlertTriangle size={12} /> {s.conflicts}
        </a>
      )}
    </button>
  );
}
