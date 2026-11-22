import { useEffect, useState } from 'react';

/**
 * La interfaz es siempre negra. Lo único configurable es el cristal: con
 * "Reducir transparencia" (o la preferencia del sistema) el Liquid Glass pasa a sólido.
 */
const KEY = 'astrocitas.reduceGlass';

function read(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v !== null) return v === '1';
  } catch {
    /* ignore */
  }
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches;
}

function apply(reduce: boolean) {
  const root = document.documentElement;
  root.classList.add('dark');
  root.classList.toggle('no-glass', reduce);
  root.style.colorScheme = 'dark';
}

export function useReduceGlass(): [boolean, (v: boolean) => void] {
  const [reduce, setReduce] = useState(read);
  useEffect(() => {
    apply(reduce);
    try {
      localStorage.setItem(KEY, reduce ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [reduce]);
  return [reduce, setReduce];
}

export function initTheme() {
  apply(read());
}
