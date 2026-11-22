import type { SerialDb } from '@astrocitas/core/sql';
import { newId, randomToken, sha256 } from './security';

export type Role = 'owner' | 'reception' | 'professional';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  is_admin: number;
  totp_secret: string | null;
  totp_enabled: number;
  disabled: number;
  created_at: number;
  last_login_at: number | null;
}

export interface Membership {
  businessId: string;
  businessName: string;
  slug: string;
  role: Role;
  staffId: string | null;
}

export interface BusinessRow {
  id: string;
  name: string;
  slug: string;
  public_booking: number;
  ics_token: string | null;
  created_at: number;
}

export function publicUser(u: UserRow) {
  return { id: u.id, email: u.email, name: u.name, isAdmin: !!u.is_admin, totpEnabled: !!u.totp_enabled, disabled: !!u.disabled, createdAt: Number(u.created_at), lastLoginAt: u.last_login_at ? Number(u.last_login_at) : null };
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'negocio'
  );
}

/** Consultas de la base del sistema (válidas en SQLite y PostgreSQL). */
export class SystemRepo {
  constructor(readonly db: SerialDb) {}

  countUsers = async () => Number((await this.db.get<{ n: number }>('SELECT count(*) AS n FROM users'))?.n ?? 0);
  userByEmail = (email: string) => this.db.get<UserRow>('SELECT * FROM users WHERE lower(email) = lower(?)', [email.trim()]);
  userById = (id: string) => this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
  listUsers = () => this.db.all<UserRow>('SELECT * FROM users ORDER BY created_at');

  async createUser(p: { email: string; name: string; passwordHash: string; isAdmin?: boolean }): Promise<UserRow> {
    const id = newId();
    await this.db.run('INSERT INTO users (id, email, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      id,
      p.email.trim().toLowerCase(),
      p.name.trim(),
      p.passwordHash,
      p.isAdmin ? 1 : 0,
      Date.now(),
    ]);
    return (await this.userById(id))!;
  }

  async updateUser(id: string, patch: Partial<Pick<UserRow, 'name' | 'password_hash' | 'is_admin' | 'totp_secret' | 'totp_enabled' | 'disabled' | 'last_login_at'>>) {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (!keys.length) return;
    await this.db.run(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => patch[k] as never), id]);
  }

  // ---------- negocios ----------

  async createBusiness(name: string): Promise<BusinessRow> {
    const id = newId();
    let slug = slugify(name);
    if (await this.db.get('SELECT 1 FROM businesses WHERE slug = ?', [slug])) slug = `${slug}-${id.slice(0, 4)}`;
    await this.db.run('INSERT INTO businesses (id, name, slug, ics_token, created_at) VALUES (?, ?, ?, ?, ?)', [id, name.trim(), slug, randomToken(18), Date.now()]);
    return (await this.businessById(id))!;
  }
  businessById = (id: string) => this.db.get<BusinessRow>('SELECT * FROM businesses WHERE id = ?', [id]);
  businessBySlug = (slug: string) => this.db.get<BusinessRow>('SELECT * FROM businesses WHERE slug = ?', [slug]);
  listBusinesses = () => this.db.all<BusinessRow>('SELECT * FROM businesses ORDER BY created_at');
  async updateBusiness(id: string, patch: Partial<Pick<BusinessRow, 'name' | 'slug' | 'public_booking' | 'ics_token'>>) {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (!keys.length) return;
    await this.db.run(`UPDATE businesses SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => patch[k] as never), id]);
  }

  // ---------- membresías ----------

  async setMembership(userId: string, businessId: string, role: Role, staffId: string | null = null) {
    await this.db.run(
      `INSERT INTO memberships (user_id, business_id, role, staff_id) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, business_id) DO UPDATE SET role = excluded.role, staff_id = excluded.staff_id`,
      [userId, businessId, role, staffId],
    );
  }
  removeMembership = (userId: string, businessId: string) => this.db.run('DELETE FROM memberships WHERE user_id = ? AND business_id = ?', [userId, businessId]);

  async memberships(userId: string): Promise<Membership[]> {
    const rows = await this.db.all<{ business_id: string; name: string; slug: string; role: Role; staff_id: string | null }>(
      `SELECT m.business_id, b.name, b.slug, m.role, m.staff_id FROM memberships m JOIN businesses b ON b.id = m.business_id WHERE m.user_id = ? ORDER BY b.name`,
      [userId],
    );
    return rows.map((r) => ({ businessId: r.business_id, businessName: r.name, slug: r.slug, role: r.role, staffId: r.staff_id }));
  }

  async membership(userId: string, businessId: string): Promise<Membership | null> {
    return (await this.memberships(userId)).find((m) => m.businessId === businessId) ?? null;
  }

  businessMembers = (businessId: string) =>
    this.db.all<{ user_id: string; email: string; name: string; role: Role; staff_id: string | null }>(
      'SELECT m.user_id, u.email, u.name, m.role, m.staff_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.business_id = ? ORDER BY u.email',
      [businessId],
    );

  // ---------- sesiones (refresh tokens rotatorios) ----------

  async issueRefresh(userId: string, device: string, ttlMs = 30 * 86_400_000): Promise<string> {
    const token = randomToken(32);
    await this.db.run('INSERT INTO refresh_tokens (id, user_id, token_hash, device, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      newId(),
      userId,
      sha256(token),
      device.slice(0, 200),
      Date.now() + ttlMs,
      Date.now(),
    ]);
    return token;
  }

  /** Rota el token. Si se presenta uno ya revocado (posible robo) se revocan todas las sesiones del usuario. */
  async rotateRefresh(token: string, device: string): Promise<{ userId: string; token: string } | null> {
    const row = await this.db.get<{ id: string; user_id: string; expires_at: number; revoked_at: number | null }>(
      'SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = ?',
      [sha256(token)],
    );
    if (!row) return null;
    if (row.revoked_at) {
      await this.revokeAll(row.user_id);
      return null;
    }
    if (Number(row.expires_at) < Date.now()) return null;
    await this.db.run('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?', [Date.now(), row.id]);
    return { userId: row.user_id, token: await this.issueRefresh(row.user_id, device) };
  }

  revokeRefresh = (token: string) => this.db.run('UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL', [Date.now(), sha256(token)]);
  revokeAll = (userId: string) => this.db.run('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [Date.now(), userId]);

  // ---------- auditoría ----------

  async audit(e: { userId?: string | null; businessId?: string | null; action: string; entity?: string; entityId?: string; detail?: unknown; ip?: string }) {
    await this.db.run('INSERT INTO audit_log (id, at, user_id, business_id, action, entity, entity_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      newId(),
      Date.now(),
      e.userId ?? null,
      e.businessId ?? null,
      e.action,
      e.entity ?? '',
      e.entityId ?? '',
      JSON.stringify(e.detail ?? {}).slice(0, 4000),
      e.ip ?? '',
    ]);
  }

  listAudit = (businessId: string | null, limit = 200) =>
    businessId
      ? this.db.all('SELECT * FROM audit_log WHERE business_id = ? ORDER BY at DESC LIMIT ' + Number(limit), [businessId])
      : this.db.all('SELECT * FROM audit_log ORDER BY at DESC LIMIT ' + Number(limit));

  // ---------- proveedores y ajustes ----------

  getProvider = (businessId: string, kind: string) =>
    this.db.get<{ config: string; enabled: number }>('SELECT config, enabled FROM providers WHERE business_id = ? AND kind = ?', [businessId, kind]);
  listProviders = (businessId: string) => this.db.all<{ kind: string; config: string; enabled: number; updated_at: number }>('SELECT * FROM providers WHERE business_id = ?', [businessId]);
  async setProvider(businessId: string, kind: string, sealed: string, enabled: boolean) {
    await this.db.run(
      `INSERT INTO providers (business_id, kind, config, enabled, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(business_id, kind) DO UPDATE SET config = excluded.config, enabled = excluded.enabled, updated_at = excluded.updated_at`,
      [businessId, kind, sealed, enabled ? 1 : 0, Date.now()],
    );
  }

  async getSetting<T>(key: string): Promise<T | null> {
    const r = await this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return r ? (JSON.parse(r.value) as T) : null;
  }
  async setSetting(key: string, value: unknown) {
    await this.db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
  }
}
