/** Intervalos semiabiertos [start, end) en epoch ms. */
export interface Interval {
  start: number;
  end: number;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function contains(outer: Interval, inner: Interval): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

/** Ordena y fusiona intervalos solapados o contiguos. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** Resta `busy` de `free`. */
export function subtractIntervals(free: Interval[], busy: Interval[]): Interval[] {
  const b = mergeIntervals(busy);
  const out: Interval[] = [];
  for (const f of mergeIntervals(free)) {
    let cursor = f.start;
    for (const x of b) {
      if (x.end <= cursor || x.start >= f.end) continue;
      if (x.start > cursor) out.push({ start: cursor, end: x.start });
      cursor = Math.max(cursor, x.end);
      if (cursor >= f.end) break;
    }
    if (cursor < f.end) out.push({ start: cursor, end: f.end });
  }
  return out;
}
