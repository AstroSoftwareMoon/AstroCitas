import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AstroApp, type OpenedStore } from '@astrocitas/ui';
import { SqlAdapter } from '@astrocitas/core/sql';
import { openNativeSqlite } from './tauri-driver';
import { tauriPlatform, checkForUpdates } from './platform';
import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
import './index.css';

// Las peticiones al servidor propio van por Rust (plugin-http): así funcionan también con
// http://IP-local (sin dominio ni certificado), que el WebView/Android bloquearían.
const webFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const external = /^https?:\/\//i.test(url) && !/^https?:\/\/(tauri|ipc)\.localhost/i.test(url);
  return external ? nativeFetch(input, init) : webFetch(input, init);
}) as typeof fetch;

async function openLocal(password?: string): Promise<OpenedStore> {
  const driver = await openNativeSqlite(password);
  const db = await SqlAdapter.open(driver);
  return { db, storage: { kind: 'sqlite', persistent: true } };
}

document.documentElement.classList.add('dark');
// Android 15+ dibuja la app bajo la barra de estado (edge-to-edge obligatorio)
const android = /Android (\d+)/.exec(navigator.userAgent);
if (android && Number(android[1]) >= 15) document.documentElement.classList.add('edge-to-edge');
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AstroApp openLocal={openLocal} openCache={(name) => openNativeSqlite(undefined, name)} version={__APP_VERSION__} platform={tauriPlatform} />
  </StrictMode>,
);

// Autoactualización (escritorio): comprueba firma e integridad antes de instalar.
checkForUpdates().catch((e) => console.warn('[astrocitas] actualizador:', e));
