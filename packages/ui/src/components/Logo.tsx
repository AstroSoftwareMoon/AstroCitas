/**
 * Logo AstroCitas: monocromo y minimalista. Un planeta con su órbita y una luna.
 * Usa `currentColor`, así que es negro sobre claro y blanco sobre oscuro.
 */
export function LogoMark({ size = 32, className = '', title = 'AstroCitas' }: { size?: number; className?: string; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label={title}>
      <defs>
        <mask id="astro-gap">
          <rect width="64" height="64" fill="white" />
          <g transform="rotate(-20 32 32)">
            <path d="M6 32 A26 9 0 0 0 58 32" fill="none" stroke="black" strokeWidth="8" />
          </g>
        </mask>
      </defs>
      <g transform="rotate(-20 32 32)">
        <ellipse cx="32" cy="32" rx="26" ry="9" fill="none" stroke="currentColor" strokeWidth="3" />
      </g>
      <circle cx="32" cy="32" r="14" fill="currentColor" mask="url(#astro-gap)" />
      <g transform="rotate(-20 32 32)">
        <path d="M6 32 A26 9 0 0 0 58 32" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </g>
      <circle cx="51" cy="13" r="3" fill="currentColor" />
    </svg>
  );
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-slate-950 dark:text-white ${className}`}>
      <LogoMark size={28} />
      <span className="text-lg font-semibold tracking-tight">AstroCitas</span>
    </span>
  );
}
