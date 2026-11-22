/**
 * Copias cifradas (.astrocitas con contraseña): PBKDF2-SHA256 (310 000 iteraciones) + AES-256-GCM.
 * Usa WebCrypto, disponible en navegadores, Tauri y Node ≥ 20 → mismo formato en todas partes.
 */

export const ENCRYPTED_FORMAT = 'astrocitas-encrypted';
const ITERATIONS = 310_000;

export interface EncryptedFile {
  format: typeof ENCRYPTED_FORMAT;
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  data: string;
}

const b64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptJson(value: unknown, password: string): Promise<EncryptedFile> {
  if (!password) throw new Error('La contraseña no puede estar vacía');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return { format: ENCRYPTED_FORMAT, v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(cipher) };
}

export async function decryptJson<T = unknown>(file: EncryptedFile, password: string): Promise<T> {
  const key = await deriveKey(password, unb64(file.salt), file.iterations);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(file.iv) as BufferSource }, key, unb64(file.data) as BufferSource);
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    throw new Error('Contraseña incorrecta o archivo dañado');
  }
}

export function isEncryptedFile(x: unknown): x is EncryptedFile {
  return !!x && typeof x === 'object' && (x as EncryptedFile).format === ENCRYPTED_FORMAT;
}

/** SHA-256 hex (checksums de copias y de releases). */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}
