import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { cx } from '../lib/util';

interface ToastItem {
  id: number;
  message: string;
  tone: 'info' | 'error';
  action?: { label: string; onClick(): void };
}
interface ToastApi {
  show(message: string, opts?: { action?: ToastItem['action']; tone?: ToastItem['tone']; duration?: number }): void;
  error(e: unknown): void;
}
const Ctx = createContext<ToastApi | null>(null);

/** Avisos efímeros con acción opcional (p. ej. «Deshacer» tras borrar). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = (id: number) => setItems((l) => l.filter((x) => x.id !== id));
  const show = useCallback<ToastApi['show']>((message, opts = {}) => {
    const id = ++seq.current;
    setItems((l) => [...l.slice(-2), { id, message, tone: opts.tone ?? 'info', action: opts.action }]);
    setTimeout(() => dismiss(id), opts.duration ?? (opts.action ? 6000 : 3000));
  }, []);
  const error = useCallback((e: unknown) => show(e instanceof Error ? e.message : String(e), { tone: 'error', duration: 6000 }), [show]);
  return (
    <Ctx.Provider value={{ show, error }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cx(
              'glass glass-strong pointer-events-auto flex max-w-md items-center gap-4 rounded-full px-5 py-3 text-sm text-white animate-slide-up',
              t.tone === 'error' && '[--glass-film:rgb(220_38_38/0.55)]',
            )}
          >
            <span>{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="press rounded-full bg-white px-3 py-1 text-xs font-semibold text-black"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast fuera de ToastProvider');
  return v;
}
