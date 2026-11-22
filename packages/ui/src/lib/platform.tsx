import { createContext, useContext, type ReactNode } from 'react';

export interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  /** true = TLS directo (465); false = STARTTLS (587) */
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface BackupEntry {
  name: string;
  size: number;
  date: number;
}

/**
 * Capacidades que dependen de dónde corre la app. La PWA trae una implementación web;
 * Tauri (escritorio/Android) la sustituye con plugins nativos (SMTP, notificaciones del sistema,
 * archivos en la carpeta de datos, bandeja del sistema…).
 */
export interface Platform {
  kind: 'web' | 'desktop' | 'android' | 'ios';
  openExternal(url: string): void;
  notificationsAllowed(): Promise<boolean>;
  requestNotifications(): Promise<boolean>;
  notify(title: string, body: string): Promise<void>;
  /** Solo donde hay sockets TCP (Tauri). En web el email automático requiere servidor propio. */
  sendEmail?: (cfg: SmtpConfig, msg: EmailMessage) => Promise<void>;
  autoBackups: {
    save(name: string, content: string): Promise<void>;
    list(): Promise<BackupEntry[]>;
    read(name: string): Promise<string>;
    remove(name: string): Promise<void>;
  };
}

// ---------- implementación web ----------

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('astrocitas-backups', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('backups', { keyPath: 'name' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return idb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction('backups', mode);
        const r = fn(t.objectStore('backups'));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
  );
}

export const webPlatform: Platform = {
  kind: 'web',
  openExternal(url) {
    // mailto/sms/whatsapp: misma pestaña para que el SO abra la app correspondiente.
    if (/^(mailto|sms|tel):/.test(url)) window.location.href = url;
    else window.open(url, '_blank', 'noopener');
  },
  async notificationsAllowed() {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  },
  async requestNotifications() {
    if (typeof Notification === 'undefined') return false;
    return (await Notification.requestPermission()) === 'granted';
  },
  async notify(title, body) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration?.().catch(() => undefined);
    if (reg) await reg.showNotification(title, { body, icon: './icons/icon-192.png', badge: './icons/icon-192.png' });
    else new Notification(title, { body, icon: './icons/icon-192.png' });
  },
  autoBackups: {
    async save(name, content) {
      await tx('readwrite', (s) => s.put({ name, content, size: content.length, date: Date.now() }));
      const all = (await tx('readonly', (s) => s.getAll())) as BackupEntry[];
      const old = all.sort((a, b) => b.date - a.date).slice(10);
      for (const o of old) await tx('readwrite', (s) => s.delete(o.name));
    },
    async list() {
      const all = (await tx('readonly', (s) => s.getAll())) as (BackupEntry & { content: string })[];
      return all.map(({ name, size, date }) => ({ name, size, date })).sort((a, b) => b.date - a.date);
    },
    async read(name) {
      const r = (await tx('readonly', (s) => s.get(name))) as { content: string } | undefined;
      if (!r) throw new Error('Copia no encontrada');
      return r.content;
    },
    async remove(name) {
      await tx('readwrite', (s) => s.delete(name));
    },
  },
};

const Ctx = createContext<Platform>(webPlatform);
export const PlatformProvider = ({ platform, children }: { platform: Platform; children: ReactNode }) => <Ctx.Provider value={platform}>{children}</Ctx.Provider>;
export const usePlatform = () => useContext(Ctx);
