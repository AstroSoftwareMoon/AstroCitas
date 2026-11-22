import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Repeat } from 'lucide-react';
import { MINUTE, minutesToHHMM, toLocalMinutes, type Appointment, type Client, type Service, type Staff } from '@astrocitas/core';
import { alpha, cx } from '../lib/util';
import { computeLanes } from './layout';

export interface GridColumn {
  key: string;
  date: string;
  staffId: string | null;
  header: ReactNode;
  /** Tramos laborables en minutos locales (para sombrear el resto). */
  working: { start: number; end: number }[];
  /** Ausencias en minutos locales. */
  blocked: { start: number; end: number; label: string }[];
  appointments: Appointment[];
  isToday: boolean;
}

export interface TimeGridProps {
  columns: GridColumn[];
  startMin: number;
  endMin: number;
  tz: string;
  hourHeight?: number;
  snap?: number;
  services: Map<string, Service>;
  staff: Map<string, Staff>;
  clients: Map<string, Client>;
  colorBy: 'staff' | 'service';
  now: number;
  onSlot(col: GridColumn, minutes: number): void;
  onOpen(a: Appointment): void;
  onMove(a: Appointment, col: GridColumn, startMinutes: number): void;
  onResize(a: Appointment, durationMin: number): void;
  minColWidth?: number;
}

interface DragState {
  id: string;
  mode: 'move' | 'resize';
  originX: number;
  originY: number;
  colIndex: number;
  startMin: number;
  durMin: number;
  active: boolean;
  /** Columna y minutos provisionales mientras se arrastra. */
  curCol: number;
  curStart: number;
  curDur: number;
}

export function TimeGrid(p: TimeGridProps) {
  const hourHeight = p.hourHeight ?? 64;
  const snap = p.snap ?? 15;
  const ppm = hourHeight / 60;
  const totalHeight = (p.endMin - p.startMin) * ppm;
  const colsRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const longPress = useRef<number | null>(null);
  dragRef.current = drag;

  // Al montar, desplazar a la hora actual (o al inicio del horario).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nowMin = toLocalMinutes(p.now, p.tz);
    const target = nowMin > p.startMin && nowMin < p.endMin ? (nowMin - p.startMin - 60) * ppm : 0;
    el.scrollTop = Math.max(0, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hours = useMemo(() => {
    const out: number[] = [];
    for (let m = Math.ceil(p.startMin / 60) * 60; m < p.endMin; m += 60) out.push(m);
    return out;
  }, [p.startMin, p.endMin]);

  const roundSnap = (m: number) => Math.round(m / snap) * snap;

  function colIndexAt(clientX: number): number {
    const el = colsRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const w = r.width / p.columns.length;
    return Math.min(p.columns.length - 1, Math.max(0, Math.floor((clientX - r.left) / w)));
  }

  function beginDrag(e: React.PointerEvent, a: Appointment, colIndex: number, mode: 'move' | 'resize') {
    if (e.button !== 0) return;
    e.stopPropagation();
    const startMin = toLocalMinutes(a.startsAt, p.tz);
    const durMin = Math.round((a.endsAt - a.startsAt) / MINUTE);
    const state: DragState = {
      id: a.id,
      mode,
      originX: e.clientX,
      originY: e.clientY,
      colIndex,
      startMin,
      durMin,
      active: false,
      curCol: colIndex,
      curStart: startMin,
      curDur: durMin,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag(state);
    if (e.pointerType === 'touch') {
      // En táctil: mantener pulsado para arrastrar, deslizar para hacer scroll.
      longPress.current = window.setTimeout(() => {
        const d = dragRef.current;
        if (d) setDrag({ ...d, active: true });
        navigator.vibrate?.(15);
      }, 350);
    }
  }

  function moveDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.originX;
    const dy = e.clientY - d.originY;
    if (!d.active) {
      if (e.pointerType === 'touch') {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) cancelDrag();
        return;
      }
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    }
    const deltaMin = roundSnap(dy / ppm);
    if (d.mode === 'move') {
      const maxStart = p.endMin - d.durMin;
      const curStart = Math.min(maxStart, Math.max(p.startMin, d.startMin + deltaMin));
      setDrag({ ...d, active: true, curStart, curCol: colIndexAt(e.clientX) });
    } else {
      setDrag({ ...d, active: true, curDur: Math.max(snap, Math.min(p.endMin - d.startMin, d.durMin + deltaMin)) });
    }
  }

  function cancelDrag() {
    if (longPress.current) clearTimeout(longPress.current);
    longPress.current = null;
    setDrag(null);
  }

  function endDrag(a: Appointment) {
    const d = dragRef.current;
    cancelDrag();
    if (!d) return;
    if (!d.active) {
      if (d.mode === 'move') p.onOpen(a);
      return;
    }
    if (d.mode === 'move') {
      if (d.curStart !== d.startMin || d.curCol !== d.colIndex) p.onMove(a, p.columns[d.curCol]!, d.curStart);
    } else if (d.curDur !== d.durMin) p.onResize(a, d.curDur);
  }

  // Bloquea el scroll táctil mientras se arrastra.
  useEffect(() => {
    if (!drag?.active) return;
    const prevent = (e: TouchEvent) => e.preventDefault();
    document.addEventListener('touchmove', prevent, { passive: false });
    return () => document.removeEventListener('touchmove', prevent);
  }, [drag?.active]);

  const nowMin = toLocalMinutes(p.now, p.tz);
  const colTemplate = { gridTemplateColumns: `repeat(${p.columns.length}, minmax(${p.minColWidth ?? 0}px, 1fr))` };

  return (
    <div ref={scrollRef} className="relative mx-2 mb-2 flex-1 overflow-auto rounded-[28px] border border-white/[0.07] bg-white/[0.025] sm:mx-3 md:mb-0" data-testid="time-grid">
      <div className="min-w-fit">
        {/* Cabeceras */}
        <div className="sticky top-0 z-20 flex border-b border-white/[0.07] bg-[#0b0b0c]/80 backdrop-blur-2xl backdrop-saturate-150">
          <div className="w-14 shrink-0" />
          <div className="grid flex-1" style={colTemplate}>
            {p.columns.map((c) => (
              <div key={c.key} className="border-l border-white/[0.05] px-2 py-2.5 text-center">
                {c.header}
              </div>
            ))}
          </div>
        </div>

        <div className="flex">
          {/* Regla horaria */}
          <div className="relative w-14 shrink-0" style={{ height: totalHeight }}>
            {hours.map((m) => (
              <div key={m} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-white/40" style={{ top: (m - p.startMin) * ppm }}>
                {m === p.startMin ? '' : minutesToHHMM(m)}
              </div>
            ))}
          </div>

          <div ref={colsRef} className="relative grid flex-1" style={{ ...colTemplate, height: totalHeight }}>
            {p.columns.map((col, ci) => {
              const lanes = computeLanes(col.appointments.map((a) => ({ id: a.id, start: a.startsAt, end: a.endsAt })));
              return (
                <div
                  key={col.key}
                  className={cx('relative border-l border-white/[0.05]', col.isToday && 'bg-white/[0.03]')}
                  onClick={(e) => {
                    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.slot) return;
                    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                    const m = Math.floor(y / ppm / snap) * snap + p.startMin;
                    p.onSlot(col, m);
                  }}
                  data-testid={`col-${col.key}`}
                >
                  {/* Líneas de horas y medias horas */}
                  {hours.map((m) => (
                    <div key={m} data-slot="1" className="absolute inset-x-0 border-t border-white/[0.06]" style={{ top: (m - p.startMin) * ppm, height: hourHeight }}>
                      <div data-slot="1" className="absolute inset-x-0 top-1/2 border-t border-dashed border-white/[0.03]" />
                    </div>
                  ))}
                  {/* Fuera de horario */}
                  {invert(col.working, p.startMin, p.endMin).map((r, i) => (
                    <div key={i} data-slot="1" className="hatch absolute inset-x-0 bg-black/40" style={{ top: (r.start - p.startMin) * ppm, height: (r.end - r.start) * ppm }} />
                  ))}
                  {/* Ausencias */}
                  {col.blocked.map((b, i) => (
                    <div
                      key={`b${i}`}
                      className="hatch pointer-events-none absolute inset-x-1 flex items-start rounded-2xl border border-dashed border-white/15 bg-white/[0.04] px-2 py-1 text-[11px] text-ink-muted"
                      style={{ top: (Math.max(b.start, p.startMin) - p.startMin) * ppm, height: (Math.min(b.end, p.endMin) - Math.max(b.start, p.startMin)) * ppm }}
                    >
                      {b.label}
                    </div>
                  ))}
                  {/* Hora actual */}
                  {col.isToday && nowMin >= p.startMin && nowMin <= p.endMin && (
                    <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-[#ff2d6f] shadow-[0_0_10px_#ff2d6f]" style={{ top: (nowMin - p.startMin) * ppm }}>
                      <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-[#ff2d6f]" />
                    </div>
                  )}
                  {/* Citas */}
                  {col.appointments.map((a) => {
                    const isDragging = drag?.id === a.id && drag.active;
                    const lp = lanes.get(a.id) ?? { lane: 0, lanes: 1 };
                    const startMin = toLocalMinutes(a.startsAt, p.tz);
                    const dur = Math.round((a.endsAt - a.startsAt) / MINUTE);
                    return (
                      <ApptBlock
                        key={a.id}
                        a={a}
                        top={(startMin - p.startMin) * ppm}
                        height={Math.max(dur * ppm, 18)}
                        left={`calc(${(lp.lane / lp.lanes) * 100}% + 2px)`}
                        width={`calc(${100 / lp.lanes}% - 4px)`}
                        faded={isDragging}
                        {...p}
                        onPointerDown={(e, mode) => beginDrag(e, a, ci, mode)}
                        onPointerMove={moveDrag}
                        onPointerUp={() => endDrag(a)}
                        onPointerCancel={cancelDrag}
                      />
                    );
                  })}
                </div>
              );
            })}

            {/* Fantasma de arrastre */}
            {drag?.active && (() => {
              const a = p.columns.flatMap((c) => c.appointments).find((x) => x.id === drag.id);
              if (!a) return null;
              const col = drag.mode === 'move' ? drag.curCol : drag.colIndex;
              const start = drag.mode === 'move' ? drag.curStart : drag.startMin;
              const dur = drag.mode === 'move' ? drag.durMin : drag.curDur;
              const color = colorFor(a, p);
              return (
                <div
                  className="glass pointer-events-none absolute z-30 rounded-2xl border-2 px-2 py-1 text-xs font-semibold text-white"
                  style={{
                    top: (start - p.startMin) * ppm,
                    height: dur * ppm,
                    left: `calc(${(col / p.columns.length) * 100}% + 2px)`,
                    width: `calc(${100 / p.columns.length}% - 4px)`,
                    borderColor: color,
                    backgroundColor: alpha(color, 0.25),
                  }}
                >
                  {minutesToHHMM(start)} – {minutesToHHMM(start + dur)}
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

function colorFor(a: Appointment, p: Pick<TimeGridProps, 'colorBy' | 'services' | 'staff'>): string {
  return (p.colorBy === 'service' ? p.services.get(a.serviceId)?.color : p.staff.get(a.staffId)?.color) ?? '#7c3aed';
}

function invert(ranges: { start: number; end: number }[], from: number, to: number) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  let cur = from;
  for (const r of sorted) {
    if (r.start > cur) out.push({ start: cur, end: Math.min(r.start, to) });
    cur = Math.max(cur, r.end);
  }
  if (cur < to) out.push({ start: cur, end: to });
  return out.filter((r) => r.end > r.start);
}

function ApptBlock(
  props: {
    a: Appointment;
    top: number;
    height: number;
    left: string;
    width: string;
    faded: boolean;
    onPointerDown(e: React.PointerEvent, mode: 'move' | 'resize'): void;
    onPointerMove(e: React.PointerEvent): void;
    onPointerUp(): void;
    onPointerCancel(): void;
  } & TimeGridProps,
) {
  const { a, services, clients, staff, tz } = props;
  const color = colorFor(a, props);
  const svc = services.get(a.serviceId);
  const client = a.clientId ? clients.get(a.clientId) : null;
  const compact = props.height < 40;
  const startMin = toLocalMinutes(a.startsAt, tz);
  const endMin = startMin + Math.round((a.endsAt - a.startsAt) / MINUTE);
  const title = `${minutesToHHMM(startMin)}–${minutesToHHMM(endMin)} · ${client?.name ?? '—'} · ${svc?.name ?? ''} · ${staff.get(a.staffId)?.name ?? ''}`;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={title}
      title={title}
      data-testid="appt"
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && props.onOpen(a)}
      onPointerDown={(e) => props.onPointerDown(e, 'move')}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
      className={cx(
        'group absolute z-[5] cursor-grab touch-manipulation select-none overflow-hidden rounded-xl border-l-[3px] px-2 text-left text-xs transition-[opacity,box-shadow,transform] hover:z-10 hover:shadow-[0_8px_24px_-8px_rgb(0_0_0/0.8)] active:cursor-grabbing',
        compact ? 'py-0' : 'py-1',
        props.faded && 'opacity-40',
        a.status === 'completed' && 'opacity-70',
        a.status === 'no_show' && 'opacity-60',
      )}
      style={{ top: props.top, height: props.height, left: props.left, width: props.width, borderColor: color, background: `linear-gradient(180deg, ${alpha(color, 0.34)}, ${alpha(color, 0.22)})` }}
    >
      <div className={cx('flex items-center gap-1 font-semibold text-white', a.status === 'no_show' && 'line-through')}>
        {a.status === 'confirmed' && <Check size={12} className="shrink-0 text-emerald-300" aria-hidden />}
        {a.seriesId && <Repeat size={11} className="shrink-0 opacity-60" aria-hidden />}
        <span className="truncate">{client?.name ?? svc?.name ?? '—'}</span>
        {compact && <span className="ml-auto shrink-0 font-normal tabular-nums text-white/70">{minutesToHHMM(startMin)}</span>}
      </div>
      {!compact && (
        <div className="truncate text-white/70">
          <span className="tabular-nums">{minutesToHHMM(startMin)}</span> · {svc?.name}
        </div>
      )}
      <div
        aria-hidden
        onPointerDown={(e) => props.onPointerDown(e, 'resize')}
        className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100"
        style={{ background: `linear-gradient(transparent, ${alpha(color, 0.5)})` }}
      />
    </div>
  );
}
