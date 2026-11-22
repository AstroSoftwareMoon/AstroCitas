import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AstroApp, type OpenedStore } from '@astrocitas/ui';
import { SqlAdapter } from '@astrocitas/core/sql';
import { openWebSqlite } from './sqlite-driver';
import './index.css';

async function openLocal(): Promise<OpenedStore> {
  const { driver, storage } = await openWebSqlite();
  const db = await SqlAdapter.open(driver);
  // Pide al navegador que no borre los datos por falta de espacio.
  navigator.storage?.persist?.().catch(() => undefined);
  return { db, storage: { kind: storage, persistent: storage === 'opfs' } };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AstroApp openLocal={openLocal} version={__APP_VERSION__} />
  </StrictMode>,
);
