import { invoke } from '@tauri-apps/api/core';
import type { Row, SqlDriver, SqlValue } from '@astrocitas/core/sql';

/**
 * Driver SQLite nativo: los comandos Rust usan rusqlite con SQLCipher (cifrado en reposo opcional).
 * Mismo contrato que el driver web, así que SqlAdapter no sabe en qué plataforma corre.
 */
export async function openNativeSqlite(password?: string, name?: string): Promise<SqlDriver> {
  await invoke('db_open', { key: password ?? null, name: name ?? null });
  return {
    exec: (sql) => invoke<void>('db_exec', { sql }),
    run: (sql, params: SqlValue[] = []) => invoke<{ changes: number }>('db_run', { sql, params }),
    all: <T = Row,>(sql: string, params: SqlValue[] = []) => invoke<T[]>('db_all', { sql, params }),
  };
}

export const isEncrypted = () => invoke<boolean>('db_is_encrypted');
export const setPassword = (newKey: string | null) => invoke<void>('db_rekey', { newKey });
