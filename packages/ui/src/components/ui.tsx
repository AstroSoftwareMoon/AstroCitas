import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { X } from 'lucide-react';
import { cx, initials } from '../lib/util';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  // Píldora blanca con texto negro: la acción principal, como la selección en AstroTune.
  primary: 'bg-white text-black hover:bg-white/90 shadow-[0_8px_24px_-8px_rgb(255_255_255/0.35)] disabled:bg-white/40 disabled:shadow-none',
  secondary: 'glass text-white hover:bg-white/[0.04]',
  ghost: 'text-white/85 hover:bg-white/[0.08]',
  danger: 'bg-red-500 text-white hover:bg-red-600',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode }
>(function Button({ variant = 'secondary', size = 'md', icon, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={cx(
        'press inline-flex select-none items-center justify-center gap-2 rounded-full font-medium disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' && 'h-8 px-3.5 text-xs',
        size === 'md' && 'h-10 px-4.5 text-sm',
        size === 'lg' && 'h-12 px-6 text-base',
        variants[variant],
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
});

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        'press inline-flex h-10 w-10 items-center justify-center rounded-full text-white/80 hover:bg-white/[0.08] hover:text-white',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(props, ref) {
  return <input ref={ref} {...props} className={cx('input', props.className)} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(props, ref) {
  return <textarea ref={ref} rows={3} {...props} className={cx('input resize-y', props.className)} />;
});

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx('input pr-8', props.className)} />;
}

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange(v: boolean): void; label: string; description?: string }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <label htmlFor={id} className="cursor-pointer">
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-ink-muted">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition',
          checked ? 'bg-white' : 'bg-white/15',
        )}
      >
        <span className={cx('absolute top-0.5 h-6 w-6 rounded-full shadow transition-all duration-300 [transition-timing-function:cubic-bezier(0.3,1.6,0.5,1)]', checked ? 'left-5.5 bg-black' : 'left-0.5 bg-white')} />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange(v: T): void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" className={cx('glass inline-flex rounded-full p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'press rounded-full px-3.5 py-1.5 text-sm font-medium',
            o.value === value ? 'bg-white text-black shadow-sm' : 'text-white/70 hover:text-white',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', !color && 'bg-white/10 text-white/85', className)}
      style={color ? { backgroundColor: `${color}2e`, color: `color-mix(in srgb, ${color} 55%, white)` } : undefined}
    >
      {children}
    </span>
  );
}

export function Avatar({ name, color = '#7c3aed', size = 36 }: { name: string; color?: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.38 }}
    >
      {initials(name) || '?'}
    </span>
  );
}

export function ColorSwatches({ value, onChange, colors }: { value: string; onChange(c: string): void; colors: string[] }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cx('press h-8 w-8 rounded-full ring-offset-2 ring-offset-black', c === value && 'ring-2 ring-white')}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center animate-fade">
      {icon && <div className="glass mb-5 rounded-full p-5 text-white">{icon}</div>}
      <h3 className="text-lg font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Diálogo modal: centrado en escritorio, hoja inferior en móvil. Cierra con Esc y clic fuera. */
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose(): void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    setTimeout(() => ref.current?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button')?.focus(), 30);
    return () => {
      window.removeEventListener('keydown', on);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/55 backdrop-blur-md animate-fade" onClick={onClose} />
      <div
        ref={ref}
        className={cx(
          'glass glass-strong relative flex max-h-[92dvh] w-full flex-col rounded-t-[32px] animate-slide-up sm:rounded-[32px]',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-lg',
        )}
      >
        <div className="flex items-center justify-between px-6 pb-2 pt-4">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          <IconButton label="Cerrar" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-3">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/[0.07] px-6 py-3.5 pb-[max(0.9rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, actions, children }: { title: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="sticky top-0 z-20 bg-gradient-to-b from-black from-60% to-black/0 px-4 pb-4 pt-5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
