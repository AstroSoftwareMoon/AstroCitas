import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AstroApp, type OpenedStore } from '@astrocitas/ui';
import { SqlAdapter } from '@astrocitas/core/sql';
import { openNativeSqlite } from './tauri-driver';
import { tauriPlatform, checkForUpdates } from './platform';
import './index.css';

async function openLocal(password?: string): Promise<OpenedStore> {
  const driver = await openNativeSqlite(password);
  const db = await SqlAdapter.open(driver);
  return { db, storage: { kind: 'sqlite', persistent: true } };
}

document.documentElement.classList.add('dark');
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AstroApp openLocal={openLocal} version={__APP_VERSION__} platform={tauriPlatform} />
  </StrictMode>,
);

// Autoactualización (escritorio): comprueba firma e integridad antes de instalar.
checkForUpdates().catch((e) => console.warn('[astrocitas] actualizador:', e));
