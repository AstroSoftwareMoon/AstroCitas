import { ConflictError, ValidationError, type Conflict } from '@astrocitas/core';
import type { TKey } from '../i18n';

export function conflictMessages(conflicts: Conflict[], t: (k: TKey) => string): string[] {
  return [...new Set(conflicts.map((c) => t(`conflict.${c.kind}` as TKey)))];
}

export function errorMessage(e: unknown, t: (k: TKey, v?: Record<string, string | number>) => string): string {
  if (e instanceof ConflictError) return conflictMessages(e.conflicts, t).join(' ');
  if (e instanceof ValidationError) return e.issues.map((i) => i.message).join(' · ');
  return t('error.generic', { msg: e instanceof Error ? e.message : String(e) });
}
