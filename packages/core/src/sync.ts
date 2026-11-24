import type { BackupFile } from './backup';
import type { EntityName } from './types';
import { ConflictError, ValidationError } from './adapter';
import type { SqlAdapter, ChangeHook } from './sql/repository';
import type { SqlDriver } from './sql/driver';
import { ENTITY_ORDER } from './sql/repository';

/**
 * Sincronización local ↔ servidor.
 *  - Reloj lógico híbrido (HLC): ordena cambios de distintos dispositivos aunque sus relojes difieran.
 *  - Last-write-wins POR CAMPO: si en el móvil cambias el teléfono de un cliente y en el PC sus notas,
 *    se conservan ambos cambios.
 *  - El servidor vuelve a validar (incluida la doble reserva). Si rechaza un cambio, gana su estado y
 *    el dispositivo registra un conflicto visible para el usuario.
 * La misma función `applyChanges` la usan el cliente (al recibir) y el servidor (al aceptar).
 */

export interface Change {
  entity: EntityName;
  rowId: string;
  field: string;
  value: unknown;
  hlc: string;
}

export interface ServerChange extends Change {
  seq: number;
}

// ---------- HLC ----------

const W = 11; // base36 de ms epoch cabe en 11 dígitos hasta el año 5000+
const C = 5;

export function encodeHlc(wall: number, counter: number, node: string): string {
  return `${wall.toString(36).padStart(W, '0')}-${counter.toString(36).padStart(C, '0')}-${node}`;
}

export function decodeHlc(h: string): { wall: number; counter: number; node: string } {
  const [w, c, ...n] = h.split('-');
  return { wall: parseInt(w!, 36), counter: parseInt(c!, 36), node: n.join('-') };
}

export class Hlc {
  private wall = 0;
  private counter = 0;
  constructor(
    readonly node: string,
    private clock: () => number = Date.now,
  ) {}

  tick(): string {
    const t = this.clock();
    if (t > this.wall) {
      this.wall = t;
      this.counter = 0;
    } else this.counter++;
    return encodeHlc(this.wall, this.counter, this.node);
  }

  /** Avanza el reloj al ver un HLC remoto (nunca genera marcas menores que las ya vistas). */
  receive(remote: string): void {
    const r = decodeHlc(remote);
    const t = this.clock();
    const w = Math.max(t, this.wall, r.wall);
    if (w === this.wall && w === r.wall) this.counter = Math.max(this.counter, r.counter) + 1;
    else if (w === this.wall) this.counter++;
    else if (w === r.wall) this.counter = r.counter + 1;
    else this.counter = 0;
    this.wall = w;
  }
}

// ---------- relojes por campo ----------

async function clocksFor(d: SqlDriver, entity: string, rowId: string): Promise<Map<string, string>> {
  const rows = await d.all<{ field: string; hlc: string }>('SELECT field, hlc FROM sync_clocks WHERE entity = ? AND row_id = ?', [entity, rowId]);
  return new Map(rows.map((r) => [r.field, r.hlc]));
}

async function setClock(d: SqlDriver, c: Change) {
  await d.run(
    'INSERT INTO sync_clocks (entity, row_id, field, hlc) VALUES (?, ?, ?, ?) ON CONFLICT(entity, row_id, field) DO UPDATE SET hlc = excluded.hlc',
    [c.entity, c.rowId, c.field, c.hlc],
  );
}

/** Deja solo el cambio más reciente de cada campo. */
export function coalesce<T extends Change>(changes: T[]): T[] {
  const m = new Map<string, T>();
  for (const c of changes) {
    const k = `${c.entity}\u0000${c.rowId}\u0000${c.field}`;
    const prev = m.get(k);
    if (!prev || c.hlc > prev.hlc) m.set(k, c);
  }
  return [...m.values()];
}

export interface RejectedRow {
  entity: EntityName;
  rowId: string;
  reason: 'overlap' | 'validation' | 'forbidden';
  message: string;
}

export interface ApplyResult {
  applied: Change[];
  rejected: RejectedRow[];
}

/**
 * Aplica cambios con LWW por campo. Agrupa por fila, combina con la fila actual y valida con el mismo
 * esquema Zod y los mismos triggers anti-solape que una escritura normal. Las filas que fallan por solape
 * se reintentan al final (el orden de llegada puede no ser el de causa).
 */
export async function applyChanges(
  db: SqlAdapter,
  incoming: Change[],
  opts: { force?: boolean; authorize?: (entity: EntityName, merged: Record<string, unknown>, before: Record<string, unknown> | null) => Promise<void> } = {},
): Promise<ApplyResult> {
  const groups = new Map<string, Change[]>();
  for (const c of coalesce(incoming)) {
    if (!ENTITY_ORDER.includes(c.entity)) continue;
    const k = `${c.entity}\u0000${c.rowId}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  // Orden por dependencias (staff/servicios/clientes antes que citas).
  const ordered = [...groups.values()].sort((a, b) => ENTITY_ORDER.indexOf(a[0]!.entity) - ENTITY_ORDER.indexOf(b[0]!.entity));
  const result: ApplyResult = { applied: [], rejected: [] };

  const applyGroup = (changes: Change[]) =>
    db.db.transaction(async (tx) => {
      const { entity, rowId } = changes[0]!;
      const clocks = await clocksFor(tx, entity, rowId);
      const winners = opts.force ? changes : changes.filter((c) => !clocks.has(c.field) || c.hlc > clocks.get(c.field)!);
      if (!winners.length) return [] as Change[];
      const before = await db.getRow(entity, rowId, tx);
      const merged: Record<string, unknown> = { ...(before ?? {}), id: rowId };
      for (const c of winners) merged[c.field] = c.value;
      await opts.authorize?.(entity, merged, before);
      await db.applyRow(entity, merged, tx);
      for (const c of winners) await setClock(tx, c);
      return winners;
    });

  const retry: Change[][] = [];
  for (const g of ordered) {
    try {
      result.applied.push(...(await applyGroup(g)));
    } catch (e) {
      if (e instanceof ConflictError) retry.push(g);
      else result.rejected.push(rejection(g[0]!, e));
    }
  }
  for (const g of retry) {
    try {
      result.applied.push(...(await applyGroup(g)));
    } catch (e) {
      result.rejected.push(rejection(g[0]!, e));
    }
  }
  return result;
}

function rejection(c: Change, e: unknown): RejectedRow {
  const reason = e instanceof ConflictError ? 'overlap' : e instanceof ValidationError ? 'validation' : (e as { statusCode?: number })?.statusCode === 403 ? 'forbidden' : 'validation';
  return { entity: c.entity, rowId: c.rowId, reason, message: (e as Error)?.message ?? String(e) };
}

// ---------- registro de cambios locales (cliente) ----------

/** Hook de SqlAdapter que encola cada cambio local en sync_outbox con su HLC. */
export function outboxHook(hlc: Hlc): ChangeHook {
  return async (entity, id, fields, tx) => {
    for (const [field, value] of Object.entries(fields)) {
      const c: Change = { entity, rowId: id, field, value, hlc: hlc.tick() };
      await tx.run('INSERT INTO sync_outbox (entity, row_id, field, value, hlc) VALUES (?, ?, ?, ?, ?)', [entity, id, field, JSON.stringify(value), c.hlc]);
      await setClock(tx, c);
    }
  };
}

/** Hook del servidor: todo cambio (venga de RPC, reserva pública o push) entra en sync_log para los demás. */
export function serverLogHook(hlc: Hlc, device = () => 'server'): ChangeHook {
  return async (entity, id, fields, tx) => {
    for (const [field, value] of Object.entries(fields)) {
      const c: Change = { entity, rowId: id, field, value, hlc: hlc.tick() };
      await logChange(tx, c, device());
      await setClock(tx, c);
    }
  };
}

export async function logChange(d: SqlDriver, c: Change, device: string) {
  await d.run('INSERT INTO sync_log (entity, row_id, field, value, hlc, device, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    c.entity,
    c.rowId,
    c.field,
    JSON.stringify(c.value),
    c.hlc,
    device,
    Date.now(),
  ]);
}

type Row = { seq: number; entity: string; row_id: string; field: string; value: string | null; hlc: string; device?: string };
const toChange = (r: Row): ServerChange => ({ seq: Number(r.seq), entity: r.entity as EntityName, rowId: r.row_id, field: r.field, value: r.value === null ? null : JSON.parse(r.value), hlc: r.hlc });

// ---------- lado servidor ----------

export interface PushResult {
  accepted: number;
  rejected: (RejectedRow & { current: Change[] | null })[];
}

/** El servidor acepta cambios de un dispositivo: LWW + validación + permisos, y los publica en sync_log. */
export async function serverAcceptPush(
  db: SqlAdapter,
  changes: Change[],
  device: string,
  hlc: Hlc,
  authorize?: (entity: EntityName, merged: Record<string, unknown>, before: Record<string, unknown> | null) => Promise<void>,
): Promise<PushResult> {
  for (const c of changes) hlc.receive(c.hlc);
  const r = await applyChanges(db, changes, { authorize });
  // Publicar lo aceptado para el resto de dispositivos.
  if (r.applied.length) await db.db.transaction(async (tx) => {
    for (const c of r.applied) await logChange(tx, c, device);
  });
  const rejected: PushResult['rejected'] = [];
  for (const rej of r.rejected) {
    // Estado actual del servidor para que el dispositivo lo adopte (o null: la fila no existe aquí).
    const row = await db.getRow(rej.entity, rej.rowId);
    const stamp = hlc.tick();
    rejected.push({ ...rej, current: row ? Object.entries(row).filter(([k]) => k !== 'id').map(([field, value]) => ({ entity: rej.entity, rowId: rej.rowId, field, value, hlc: stamp })) : null });
  }
  return { accepted: r.applied.length, rejected };
}

export async function serverPull(db: SqlAdapter, since: number, device: string, limit = 2000): Promise<{ changes: ServerChange[]; cursor: number; more: boolean }> {
  const rows = await db.db.all<Row>(`SELECT * FROM sync_log WHERE seq > ? ORDER BY seq LIMIT ${Number(limit) + 1}`, [since]);
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const cursor = page.length ? Number(page[page.length - 1]!.seq) : since;
  return { changes: page.filter((r) => r.device !== device).map(toChange), cursor, more };
}

export async function serverCursor(db: SqlAdapter): Promise<number> {
  return Number((await db.db.get<{ s: number | null }>('SELECT max(seq) AS s FROM sync_log'))?.s ?? 0);
}

// ---------- lado cliente ----------

export interface SyncTransport {
  push(device: string, changes: Change[]): Promise<PushResult>;
  pull(device: string, since: number): Promise<{ changes: ServerChange[]; cursor: number; more: boolean }>;
  snapshot(): Promise<{ dump: BackupFile; cursor: number; hlc: string }>;
}

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'offline' | 'error';
  pending: number;
  conflicts: number;
  lastSyncAt: number | null;
  /** Cambios recibidos en la última pasada (para refrescar la interfaz solo si hace falta). */
  received?: number;
  error?: string;
}

export interface ConflictRecord {
  id: string;
  entity: EntityName;
  rowId: string;
  reason: string;
  detail: Record<string, unknown>;
  createdAt: number;
}

/**
 * Motor del dispositivo: envía la cola, aplica lo recibido y guarda el cursor.
 * Primera vez: descarga una instantánea completa (rápido y sin depender del historial).
 */
export class SyncEngine {
  private running: Promise<void> | null = null;
  private listeners = new Set<(s: SyncStatus) => void>();
  status: SyncStatus = { state: 'idle', pending: 0, conflicts: 0, lastSyncAt: null };

  constructor(
    readonly db: SqlAdapter,
    readonly hlc: Hlc,
    private transport: SyncTransport,
    readonly device: string,
  ) {}

  onStatus(fn: (s: SyncStatus) => void) {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private emit(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }

  async pendingCount(): Promise<number> {
    return Number((await this.db.db.get<{ n: number }>('SELECT count(*) AS n FROM sync_outbox'))?.n ?? 0);
  }

  async conflicts(): Promise<ConflictRecord[]> {
    const rows = await this.db.db.all<{ id: string; entity: string; row_id: string; reason: string; detail: string; created_at: number }>(
      'SELECT * FROM sync_conflicts WHERE resolved_at IS NULL ORDER BY created_at DESC',
    );
    return rows.map((r) => ({ id: r.id, entity: r.entity as EntityName, rowId: r.row_id, reason: r.reason, detail: JSON.parse(r.detail), createdAt: Number(r.created_at) }));
  }

  async dismissConflict(id: string) {
    await this.db.db.run('UPDATE sync_conflicts SET resolved_at = ? WHERE id = ?', [Date.now(), id]);
    this.emit({ conflicts: (await this.conflicts()).length });
  }

  private again = false;

  /**
   * Una pasada completa. Si llega otra petición mientras hay una en curso (p. ej. guardaste algo justo
   * entonces), se encadena otra pasada al terminar: ningún cambio local espera al siguiente ciclo.
   */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.run();
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run() {
    this.emit({ state: 'syncing' });
    let received = 0;
    try {
      let cursor = (await this.db.getMeta<number>('sync.cursor')) ?? null;
      if (cursor === null) {
        const snap = await this.transport.snapshot();
        this.hlc.receive(snap.hlc);
        // Lo importado es el estado del servidor: ni se reenvía ni fija relojes locales.
        await this.db.importAll(snap.dump, { mode: 'merge', track: false });
        cursor = snap.cursor;
        received += 1;
        await this.db.setMeta('sync.cursor', cursor);
      }

      // 1) Enviar
      const out = await this.db.db.all<Row>('SELECT * FROM sync_outbox ORDER BY seq LIMIT 2000');
      if (out.length) {
        const maxSeq = Number(out[out.length - 1]!.seq);
        const res = await this.transport.push(this.device, coalesce(out.map(toChange)));
        for (const rej of res.rejected) await this.adoptServerState(rej);
        await this.db.db.run('DELETE FROM sync_outbox WHERE seq <= ?', [maxSeq]);
      }

      // 2) Recibir
      let more = true;
      while (more) {
        const page = await this.transport.pull(this.device, cursor!);
        for (const c of page.changes) this.hlc.receive(c.hlc);
        if (page.changes.length) received += (await applyChanges(this.db, page.changes)).applied.length;
        cursor = page.cursor;
        more = page.more;
        await this.db.setMeta('sync.cursor', cursor);
      }
      this.emit({ state: 'idle', pending: await this.pendingCount(), conflicts: (await this.conflicts()).length, lastSyncAt: Date.now(), received, error: undefined });
    } catch (e) {
      const offline = e instanceof TypeError || /fetch|network|Failed to fetch|NetworkError/i.test(String((e as Error)?.message));
      this.emit({ state: offline ? 'offline' : 'error', pending: await this.pendingCount(), received, error: (e as Error)?.message });
    }
  }

  /** El servidor rechazó una fila: se adopta su versión (o se descarta la fila local) y se registra el conflicto. */
  private async adoptServerState(rej: PushResult['rejected'][number]) {
    const local = await this.db.getRow(rej.entity, rej.rowId);
    if (rej.current) {
      await applyChanges(this.db, rej.current, { force: true });
    } else if (local && !local.deletedAt) {
      await this.db.db.transaction(async (tx) => {
        await this.db.applyRow(rej.entity, { ...local, deletedAt: Date.now() }, tx);
      });
    }
    await this.db.db.run('INSERT INTO sync_conflicts (id, entity, row_id, reason, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      crypto.randomUUID(),
      rej.entity,
      rej.rowId,
      rej.reason,
      JSON.stringify({ message: rej.message, local }),
      Date.now(),
    ]);
  }
}
