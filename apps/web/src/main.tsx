import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AstroApp, type OpenedStore } from '@astrocitas/ui';
import { SqlAdapter } from '@astrocitas/core/sql';
import { openWebSqlite } from './sqlite-driver';
import './index.css';

// Abierta por http://IP-local (servidor sin dominio) el navegador no da «contexto seguro»:
// sin crypto.randomUUID ni almacenamiento OPFS. Se usa un UUID v4 equivalente y se trabaja
// directamente contra el servidor (sin caché sin conexión).
if (typeof crypto.randomUUID !== 'function') {
  Object.defineProperty(crypto, 'randomUUID', {
    configurable: true,
    value: () => {
      const b = crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6]! & 0x0f) | 0x40;
      b[8] = (b[8]! & 0x3f) | 0x80;
      const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    },
  });
}
const openCache = window.isSecureContext ? async (name: string) => (await openWebSqlite(name)).driver : undefined;

async function openLocal(): Promise<OpenedStore> {
  const { driver, storage } = await openWebSqlite();
  const db = await SqlAdapter.open(driver);
  // Pide al navegador que no borre los datos por falta de espacio.
  navigator.storage?.persist?.().catch(() => undefined);
  return { db, storage: { kind: storage, persistent: storage === 'opfs' } };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AstroApp openLocal={openLocal} openCache={openCache} version={__APP_VERSION__} />
  </StrictMode>,
);
