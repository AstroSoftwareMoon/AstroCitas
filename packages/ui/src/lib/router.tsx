import { useEffect, useState } from 'react';

/** Router mínimo por hash: funciona igual en Tauri, PWA y hosting estático. */
export function useRoute(): [string, URLSearchParams] {
  const parse = (): [string, URLSearchParams] => {
    const raw = window.location.hash.replace(/^#/, '') || '/calendar';
    const [path, qs] = raw.split('?');
    return [path || '/calendar', new URLSearchParams(qs)];
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(path: string) {
  window.location.hash = path;
}
