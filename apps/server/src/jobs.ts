import type { SerialDb } from '@astrocitas/core/sql';
import { newId } from './security';

export interface JobInput {
  type: string;
  businessId?: string | null;
  payload?: Record<string, unknown>;
  runAt?: number;
  /** Misma clave = mismo trabajo (no se duplica aunque se encole dos veces). */
  idempotencyKey?: string;
  maxAttempts?: number;
}

export interface Job {
  id: string;
  type: string;
  businessId: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

export type JobHandler = (job: Job) => Promise<void>;

/** Error que NO se reintenta (credenciales malas, destinatario inválido…). */
export class PermanentJobError extends Error {}

export interface JobQueue {
  enqueue(j: JobInput): Promise<void>;
  register(type: string, handler: JobHandler): void;
  /** Procesa los trabajos vencidos una vez (también lo usa el bucle). */
  tick(now?: number): Promise<number>;
  start(intervalMs: number): () => void;
  stats(): Promise<Record<string, number>>;
}

/** Backoff exponencial con jitter: 30 s, 1 min, 2 min, 4 min… hasta 6 h. */
export function backoffMs(attempt: number, rand = Math.random): number {
  const base = Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 6 * 3600_000);
  return Math.round(base * (0.8 + rand() * 0.4));
}

/**
 * Cola en la propia base de datos (por defecto): sin Redis ni servicios extra.
 * Reclamar un trabajo es un UPDATE condicional (atómico), así que es segura con varias instancias.
 */
export class DbQueue implements JobQueue {
  private handlers = new Map<string, JobHandler>();
  private busy = false;
  constructor(
    private db: SerialDb,
    private log: { error(o: unknown, m?: string): void; info?(o: unknown, m?: string): void } = console,
  ) {}

  register(type: string, handler: JobHandler) {
    this.handlers.set(type, handler);
  }

  async enqueue(j: JobInput) {
    const now = Date.now();
    await this.db.run(
      `INSERT INTO jobs (id, type, business_id, payload, run_at, max_attempts, idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(idempotency_key) DO NOTHING`,
      [newId(), j.type, j.businessId ?? null, JSON.stringify(j.payload ?? {}), j.runAt ?? now, j.maxAttempts ?? 5, j.idempotencyKey ?? null, now, now],
    );
  }

  async tick(now = Date.now()): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    let done = 0;
    try {
      const due = await this.db.all<{ id: string; type: string; business_id: string | null; payload: string; attempts: number; max_attempts: number }>(
        `SELECT id, type, business_id, payload, attempts, max_attempts FROM jobs
         WHERE status = 'pending' AND run_at <= ? AND (locked_until IS NULL OR locked_until < ?) ORDER BY run_at LIMIT 50`,
        [now, now],
      );
      for (const r of due) {
        const claimed = await this.db.run(`UPDATE jobs SET status = 'running', locked_until = ?, updated_at = ? WHERE id = ? AND status = 'pending'`, [now + 5 * 60_000, now, r.id]);
        if (!claimed.changes) continue;
        const job: Job = { id: r.id, type: r.type, businessId: r.business_id, payload: JSON.parse(r.payload), attempts: Number(r.attempts) + 1, maxAttempts: Number(r.max_attempts) };
        const handler = this.handlers.get(r.type);
        try {
          if (!handler) throw new PermanentJobError(`Sin manejador para ${r.type}`);
          await handler(job);
          await this.db.run(`UPDATE jobs SET status = 'done', attempts = ?, locked_until = NULL, last_error = '', updated_at = ? WHERE id = ?`, [job.attempts, Date.now(), r.id]);
        } catch (e) {
          const msg = String((e as Error)?.message ?? e).slice(0, 1000);
          const retry = !(e instanceof PermanentJobError) && job.attempts < job.maxAttempts;
          await this.db.run(`UPDATE jobs SET status = ?, attempts = ?, run_at = ?, locked_until = NULL, last_error = ?, updated_at = ? WHERE id = ?`, [
            retry ? 'pending' : 'failed',
            job.attempts,
            retry ? Date.now() + backoffMs(job.attempts) : now,
            msg,
            Date.now(),
            r.id,
          ]);
          if (!retry) this.log.error({ job: job.type, id: job.id, err: msg }, 'trabajo fallido definitivamente');
        }
        done++;
      }
      // Limpieza: trabajos terminados de hace más de 30 días.
      await this.db.run(`DELETE FROM jobs WHERE status = 'done' AND updated_at < ?`, [now - 30 * 86_400_000]);
    } finally {
      this.busy = false;
    }
    return done;
  }

  start(intervalMs: number) {
    const id = setInterval(() => this.tick().catch((e) => this.log.error({ err: e }, 'cola')), intervalMs);
    return () => clearInterval(id);
  }

  async stats() {
    const rows = await this.db.all<{ status: string; n: number }>('SELECT status, count(*) AS n FROM jobs GROUP BY status');
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  }
}

/**
 * Cola con BullMQ + Redis (opcional, para instalaciones grandes). Misma interfaz: los manejadores no cambian.
 */
export async function bullQueue(redisUrl: string, log: { error(o: unknown, m?: string): void }): Promise<JobQueue> {
  const { Queue, Worker } = await import('bullmq');
  const connection = { url: redisUrl } as never;
  const queue = new Queue('astrocitas', { connection });
  const handlers = new Map<string, JobHandler>();
  return {
    register: (t, h) => void handlers.set(t, h),
    async enqueue(j) {
      await queue.add(
        j.type,
        { businessId: j.businessId ?? null, payload: j.payload ?? {} },
        { jobId: j.idempotencyKey, delay: Math.max(0, (j.runAt ?? Date.now()) - Date.now()), attempts: j.maxAttempts ?? 5, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
      );
    },
    async tick() {
      return 0;
    },
    start() {
      const worker = new Worker(
        'astrocitas',
        async (bj) => {
          const h = handlers.get(bj.name);
          if (!h) throw new Error(`Sin manejador para ${bj.name}`);
          try {
            await h({ id: String(bj.id), type: bj.name, businessId: bj.data.businessId, payload: bj.data.payload, attempts: bj.attemptsMade + 1, maxAttempts: bj.opts.attempts ?? 5 });
          } catch (e) {
            if (e instanceof PermanentJobError) await bj.discard();
            throw e;
          }
        },
        { connection },
      );
      worker.on('failed', (j, err) => log.error({ job: j?.name, err: err.message }, 'trabajo fallido'));
      return () => void worker.close();
    },
    async stats() {
      return (await queue.getJobCounts()) as Record<string, number>;
    },
  };
}
