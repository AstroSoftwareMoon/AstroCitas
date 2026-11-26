import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import type { Platform } from '@astrocitas/ui';
import { setPassword, isEncrypted } from './tauri-driver';

const os = (navigator.userAgent.match(/Android/i) ? 'android' : /iPhone|iPad/i.test(navigator.userAgent) ? 'ios' : 'desktop') as Platform['kind'];

export const tauriPlatform: Platform = {
  kind: os,
  openExternal: (url) => void openUrl(url),
  notificationsAllowed: () => isPermissionGranted(),
  async requestNotifications() {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === 'granted';
  },
  async notify(title, body) {
    if (await isPermissionGranted()) sendNotification({ title, body });
  },
  // SMTP real desde Rust (lettre + rustls): funciona sin servidor propio.
  sendEmail: (cfg, msg) => invoke('send_email', { cfg, msg }),
  autoBackups: {
    save: (name, content) => invoke('backup_save', { name, content }),
    list: () => invoke('backup_list'),
    read: (name) => invoke('backup_read', { name }),
    remove: (name) => invoke('backup_remove', { name }),
  },
  database: {
    isEncrypted,
    setPassword,
  },
  selfHost:
    os === 'desktop'
      ? {
          status: () => invoke('selfhost_status'),
          install: (version, secret) => invoke('selfhost_install', { version, secret }),
          start: () => invoke('selfhost_start'),
          stop: () => invoke('selfhost_stop'),
          remove: (deleteData) => invoke('selfhost_remove', { deleteData }),
        }
      : undefined,
};

/** Busca actualizaciones firmadas en GitHub Releases (solo escritorio). */
export async function checkForUpdates() {
  if (os !== 'desktop') return;
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return;
  if (!window.confirm(`AstroCitas ${update.version} está disponible.\n\n${update.body ?? ''}\n\n¿Instalar ahora?`)) return;
  await update.downloadAndInstall();
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
