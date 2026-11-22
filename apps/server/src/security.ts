import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { jwtVerify, SignJWT } from 'jose';
import * as OTPAuth from 'otpauth';

export const newId = () => randomBytes(12).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, 'x');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

// ---------- contraseñas (argon2id) ----------

export const hashPassword = (pw: string) => argonHash(pw, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (hash: string, pw: string) => argonVerify(hash, pw).catch(() => false);

export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return 'La contraseña debe tener al menos 10 caracteres';
  if (/^(.)\1+$/.test(pw)) return 'La contraseña es demasiado simple';
  return null;
}

// ---------- JWT de acceso (15 min) ----------

export interface AccessClaims {
  sub: string;
  adm: boolean;
}

const key = (secret: string) => new TextEncoder().encode(sha256(`jwt:${secret}`));

export async function signAccess(secret: string, claims: AccessClaims, ttlSec = 15 * 60): Promise<string> {
  return new SignJWT({ adm: claims.adm })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer('astrocitas')
    .setExpirationTime(`${ttlSec}s`)
    .sign(key(secret));
}

export async function verifyAccess(secret: string, token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { issuer: 'astrocitas', algorithms: ['HS256'] });
    return { sub: String(payload.sub), adm: !!payload.adm };
  } catch {
    return null;
  }
}

// ---------- 2FA (TOTP) ----------

export function newTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function totpUri(secret: string, email: string): string {
  return new OTPAuth.TOTP({ issuer: 'AstroCitas', label: email, secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 }).toString();
}

export function verifyTotp(secret: string, code: string): boolean {
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 });
  return totp.validate({ token: code.replace(/\s/g, ''), window: 1 }) !== null;
}

// ---------- cifrado de credenciales de proveedores (AES-256-GCM) ----------

const boxKey = (secret: string) => createHash('sha256').update(`providers:${secret}`).digest();

export function seal(secret: string, value: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', boxKey(secret), iv);
  const data = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${data.toString('base64url')}`;
}

export function unseal<T = unknown>(secret: string, sealed: string): T {
  const [v, iv, tag, data] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Formato cifrado no válido');
  const d = createDecipheriv('aes-256-gcm', boxKey(secret), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8')) as T;
}

// ---------- enlaces firmados (Confirmo / Cancelar / Cambiar) ----------

export function signLink(secret: string, payload: Record<string, string | number>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', `link:${secret}`).update(body).digest('base64url').slice(0, 22);
  return `${body}.${sig}`;
}

export function verifyLink<T = Record<string, string | number>>(secret: string, token: string): T | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', `link:${secret}`).update(body).digest('base64url').slice(0, 22);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}
