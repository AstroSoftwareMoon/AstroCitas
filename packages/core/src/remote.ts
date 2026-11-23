import { ConflictError, ValidationError, type DataAdapter } from './adapter';

/** Versión de API que entiende este cliente. */
export const CLIENT_API_VERSION = 1;

export interface ServerUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  totpEnabled: boolean;
}

export interface ServerMembership {
  businessId: string;
  businessName: string;
  slug: string;
  role: 'owner' | 'reception' | 'professional';
  staffId: string | null;
}

export interface StoredSession {
  url: string;
  refreshToken: string;
  businessId: string;
  user: ServerUser;
  memberships: ServerMembership[];
}

export class ServerError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ServerError';
  }
}

export function normalizeServerUrl(input: string): string {
  let u = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

/**
 * Sesión con el servidor propio: guarda el refresh token, renueva el de acceso solo cuando hace falta
 * y reintenta una vez si caduca. `persist` decide dónde se guarda (localStorage, almacén seguro de Tauri…).
 */
export class ServerSession {
  private access: string | null = null;
  private refreshing: Promise<void> | null = null;
  private fetchImpl: typeof fetch;
  constructor(
    public state: StoredSession,
    private persist: (s: StoredSession | null) => void,
    fetchFn: typeof fetch = fetch,
    /** Lee la sesión guardada: si otra pestaña ya rotó el token, se usa el más reciente. */
    private load?: () => StoredSession | null,
  ) {
    // Envolver: llamar a window.fetch como método de otro objeto lanza "Illegal invocation".
    this.fetchImpl = (...a) => fetchFn(...a);
  }

  static async version(url: string, fetchImpl: typeof fetch = fetch) {
    const r = await fetchImpl(`${normalizeServerUrl(url)}/api/v1/version`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new ServerError(r.status, 'No es un servidor AstroCitas');
    const j = (await r.json()) as { name?: string; version: string; apiVersion: number; setupRequired: boolean };
    if (j.name !== 'astrocitas') throw new ServerError(400, 'No es un servidor AstroCitas');
    if (j.apiVersion !== CLIENT_API_VERSION)
      throw new ServerError(400, `Versión incompatible: el servidor usa la API v${j.apiVersion} y esta app la v${CLIENT_API_VERSION}. Actualiza ${j.apiVersion > CLIENT_API_VERSION ? 'la app' : 'el servidor'}.`);
    return j;
  }

  /** Inicia sesión (o crea el administrador si el servidor está recién instalado). */
  static async login(
    url: string,
    creds: { email: string; password: string; totp?: string; setup?: { businessName: string; name?: string; kind?: string; locale?: string } },
    persist: (s: StoredSession | null) => void,
    fetchImpl: typeof fetch = fetch,
  ): Promise<ServerSession> {
    const base = normalizeServerUrl(url);
    const path = creds.setup ? '/api/v1/setup' : '/api/v1/auth/login';
    const payload = creds.setup ? { email: creds.email, password: creds.password, ...creds.setup } : { email: creds.email, password: creds.password, totp: creds.totp, device: 'AstroCitas app' };
    const r = await fetchImpl(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw new ServerError(r.status, String(j.message ?? 'Error al iniciar sesión'), j);
    const memberships = j.memberships as ServerMembership[];
    const state: StoredSession = { url: base, refreshToken: String(j.refreshToken), businessId: memberships[0]?.businessId ?? '', user: j.user as ServerUser, memberships };
    persist(state);
    const s = new ServerSession(state, persist, fetchImpl);
    s.access = String(j.accessToken);
    return s;
  }

  private async refresh() {
    if (!this.refreshing)
      this.refreshing = (async () => {
        const latest = this.load?.();
        if (latest && latest.url === this.state.url && latest.refreshToken !== this.state.refreshToken) this.state = { ...this.state, refreshToken: latest.refreshToken };
        const r = await this.fetchImpl(`${this.state.url}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: this.state.refreshToken }),
        });
        const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
        if (!r.ok) {
          if (r.status === 401) this.persist(null);
          throw new ServerError(r.status, String(j.message ?? 'Sesión caducada'), j);
        }
        this.access = String(j.accessToken);
        this.state = { ...this.state, refreshToken: String(j.refreshToken), user: j.user as ServerUser, memberships: j.memberships as ServerMembership[] };
        this.persist(this.state);
      })().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  async request<T = unknown>(method: string, path: string, payload?: unknown): Promise<T> {
    if (!this.access) await this.refresh();
    const go = () =>
      this.fetchImpl(this.state.url + path, {
        method,
        headers: { Authorization: `Bearer ${this.access}`, ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: payload !== undefined ? JSON.stringify(payload) : undefined,
      });
    let r = await go();
    if (r.status === 401) {
      await this.refresh();
      r = await go();
    }
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (r.status === 409 && j.error === 'conflict') throw new ConflictError(j.conflicts as ConflictError['conflicts']);
    if (r.status === 400 && j.error === 'validation') throw new ValidationError(j.issues as ValidationError['issues']);
    if (!r.ok) throw new ServerError(r.status, String(j.message ?? `Error ${r.status}`), j);
    return j as T;
  }

  get businessId() {
    return this.state.businessId;
  }
  get membership(): ServerMembership | undefined {
    return this.state.memberships.find((m) => m.businessId === this.state.businessId);
  }
  selectBusiness(id: string) {
    this.state = { ...this.state, businessId: id };
    this.persist(this.state);
  }

  async logout() {
    await this.fetchImpl(`${this.state.url}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: this.state.refreshToken }),
    }).catch(() => undefined);
    this.persist(null);
  }

  /** Llamada RPC sobre la interfaz DataAdapter. */
  rpc<T>(method: string, args: unknown[]): Promise<T> {
    return this.request<{ result: T }>('POST', `/api/v1/b/${this.businessId}/rpc`, { method, args }).then((r) => r.result);
  }
}

const RPC_METHODS = [
  'getBusiness', 'saveBusiness', 'listStaff', 'saveStaff', 'listServices', 'saveService', 'listClients', 'getClient', 'saveClient',
  'clientStats', 'listTimeOff', 'saveTimeOff', 'listAppointments', 'getAppointment', 'saveAppointment', 'checkAppointment',
  'createSeries', 'listWaitlist', 'saveWaitlist', 'listTemplates', 'saveTemplate', 'listReminderRules', 'saveReminderRule',
  'listMessages', 'saveMessage', 'remove', 'restore', 'exportAll', 'importAll', 'wipe',
] as const;

/**
 * RemoteAdapter: la misma interfaz DataAdapter servida por tu servidor (online).
 * Los ajustes de dispositivo (getMeta/setMeta) se quedan en el propio dispositivo.
 */
export function createRemoteAdapter(session: ServerSession, meta: { get(k: string): unknown; set(k: string, v: unknown): void }): DataAdapter {
  const a: Record<string, unknown> = { mode: 'remote' };
  for (const m of RPC_METHODS)
    a[m] = (...args: unknown[]) => {
      while (args.length && args[args.length - 1] === undefined) args.pop();
      return session.rpc(m, args);
    };
  a.getMeta = async (k: string) => (meta.get(k) as never) ?? null;
  a.setMeta = async (k: string, v: unknown) => meta.set(k, v);
  return a as unknown as DataAdapter;
}

/** Transporte de sincronización sobre la API del servidor propio. */
export function httpSyncTransport(session: ServerSession): import('./sync').SyncTransport {
  const base = () => `/api/v1/b/${session.businessId}/sync`;
  return {
    push: (device, changes) => session.request('POST', `${base()}/push`, { device, changes }),
    pull: (device, since) => session.request('GET', `${base()}/pull?since=${since}&device=${encodeURIComponent(device)}`),
    snapshot: () => session.request('GET', `${base()}/snapshot`),
  };
}
