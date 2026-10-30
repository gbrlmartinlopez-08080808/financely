import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { pixelRects, type PixelName } from '../lib/pixels';
import { onBack, tap } from '../lib/native';
import { Icon } from './Icon';

// ------------------------------------------------------------------ pixel icon
export function Pixel({ name, size = 18, className, style }: { name: PixelName; size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} width={size} height={size} viewBox="0 0 9 9" shapeRendering="crispEdges" fill="currentColor" aria-hidden dangerouslySetInnerHTML={{ __html: pixelRects(name) }} />
  );
}

// ------------------------------------------------------------------ pixel loader (snake through a 3×3 / 4×4 grid)
const SNAKE3 = [0, 1, 2, 5, 8, 7, 6, 3, 4];
export function PixelLoader({ size = 6, grid = 3, gap = 3, label }: { size?: number; grid?: 3 | 4; gap?: number; label?: string }) {
  const n = grid * grid;
  const order = grid === 3 ? SNAKE3 : [0, 1, 2, 3, 7, 11, 15, 14, 13, 12, 8, 4, 5, 6, 10, 9];
  const delay = (i: number) => (order.indexOf(i) / n) * 1.2;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <span className="pixload" style={{ gridTemplateColumns: `repeat(${grid}, ${size}px)`, gap }} role="progressbar" aria-label={label ?? 'Loading'}>
        {Array.from({ length: n }, (_, i) => (
          <i key={i} style={{ width: size, height: size, animationDelay: `${delay(i)}s` }} />
        ))}
      </span>
      {label && <span className="mono" style={{ fontSize: 12 }}>{label}</span>}
    </span>
  );
}

/** A determinate pixel bar: ▮▮▮▮▯▯▯ */
export function PixelBar({ value, cells = 16 }: { value: number; cells?: number }) {
  const on = Math.round(Math.max(0, Math.min(1, value)) * cells);
  return (
    <span style={{ display: 'inline-flex', gap: 2 }} role="progressbar" aria-valuenow={Math.round(value * 100)}>
      {Array.from({ length: cells }, (_, i) => (
        <i key={i} style={{ width: 6, height: 10, background: 'currentColor', opacity: i < on ? 1 : 0.14, transition: 'opacity .2s' }} />
      ))}
    </span>
  );
}

// ------------------------------------------------------------------ bottom sheet
export function Sheet({
  open,
  onClose,
  title,
  children,
  onBackBtn,
  className,
  dark,
  noGrip,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  onBackBtn?: () => void;
  className?: string;
  dark?: boolean;
  noGrip?: boolean;
}) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number; scroll: boolean } | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
      const t = setTimeout(() => {
        setMounted(false);
        setClosing(false);
      }, 240);
      return () => clearTimeout(t);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    return onBack(() => {
      onClose();
      return true;
    });
  }, [open, onClose]);

  if (!mounted) return null;
  const onStart = (e: React.TouchEvent) => {
    const body = ref.current?.querySelector('.sheet-body');
    drag.current = { y: e.touches[0].clientY, dy: 0, scroll: !!body && body.scrollTop > 0 && body.contains(e.target as Node) };
  };
  const onMove = (e: React.TouchEvent) => {
    const d = drag.current;
    if (!d || d.scroll) return;
    d.dy = Math.max(0, e.touches[0].clientY - d.y);
    if (ref.current) ref.current.style.transform = `translateY(${d.dy}px)`;
  };
  const onEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (!ref.current) return;
    ref.current.style.transition = 'transform .3s cubic-bezier(.2,.8,.2,1)';
    if (d && d.dy > 110) {
      ref.current.style.transform = 'translateY(100%)';
      setTimeout(onClose, 200);
    } else ref.current.style.transform = '';
    setTimeout(() => ref.current && (ref.current.style.transition = ''), 320);
  };
  return createPortal(
    <>
      <div className={`scrim${closing ? ' out' : ''}${className?.includes('over') ? ' over' : ''}`} onClick={onClose} />
      <div ref={ref} className={`sheet${closing ? ' out' : ''} ${className ?? ''}`} data-dark={dark ? '1' : undefined} onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} role="dialog">
        {!noGrip && <div className="sheet-grip" />}
        {title !== undefined && (
          <div className="sheet-head">
            {onBackBtn ? (
              <button className="sheet-back" onClick={onBackBtn} aria-label="Back">
                <Icon name="back" size={22} />
              </button>
            ) : (
              <span />
            )}
            <h3>{title}</h3>
            <span />
          </div>
        )}
        {children}
      </div>
    </>,
    document.body,
  );
}

// ------------------------------------------------------------------ segmented control
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  light,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode; aria?: string }[];
  onChange: (v: T) => void;
  light?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  const idx = options.findIndex((o) => o.value === value);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const el = root.querySelectorAll('button')[idx] as HTMLElement | undefined;
      if (el) setThumb((t) => (t && t.x === el.offsetLeft - 4 && t.w === el.offsetWidth ? t : { x: el.offsetLeft - 4, w: el.offsetWidth }));
    };
    measure();
    // a font that arrives late, or a label that changes, must not leave the thumb half a button off
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    root.querySelectorAll('button').forEach((b) => ro?.observe(b));
    return () => ro?.disconnect();
  }, [idx, options.length]);
  return (
    <div ref={ref} className={`seg${light ? ' light' : ''} ${className ?? ''}`} role="tablist">
      {thumb && <span className="seg-thumb" style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }} />}
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          aria-label={o.aria}
          className={o.value === value ? 'on' : ''}
          onClick={() => {
            if (o.value !== value) tap('select');
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ toggle
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      className={`toggle${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => {
        tap('select');
        onChange(!on);
      }}
    />
  );
}

// ------------------------------------------------------------------ tick ruler slider (reference: "6s" duration picker)
export function Ruler({
  value,
  min,
  max,
  step,
  onChange,
  format,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const count = Math.round((max - min) / step) + 1;
  const SPACING = 14;
  const idx = Math.round((value - min) / step);
  const drag = useRef<{ x: number; idx: number } | null>(null);
  const last = useRef(idx);
  const set = useCallback(
    (i: number) => {
      const c = Math.max(0, Math.min(count - 1, i));
      if (c !== last.current) {
        last.current = c;
        tap('select');
        onChange(+(min + c * step).toFixed(4));
      }
    },
    [count, min, step, onChange],
  );
  const start = (x: number) => (drag.current = { x, idx });
  const move = (x: number) => {
    if (!drag.current) return;
    set(drag.current.idx - Math.round((x - drag.current.x) / SPACING));
  };
  return (
    <div className="ruler" aria-label={label}>
      <div
        ref={ref}
        className="ruler-track"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          start(e.clientX);
        }}
        onPointerMove={(e) => move(e.clientX)}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onWheel={(e) => set(idx + (e.deltaY > 0 ? 1 : -1))}
        role="slider"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') set(idx - 1);
          if (e.key === 'ArrowRight') set(idx + 1);
        }}
      >
        <div className="ruler-ticks" style={{ transform: `translateX(${-idx * SPACING}px)` }}>
          {Array.from({ length: count }, (_, i) => {
            const d = Math.abs(i - idx);
            return <i key={i} className={i === idx ? 'cur' : ''} style={{ opacity: i === idx ? 1 : Math.max(0.12, 0.55 - d * 0.07), height: i === idx ? 26 : d === 1 ? 16 : 12 }} />;
          })}
        </div>
      </div>
      <span className="ruler-value mono">{format ? format(value) : value}</span>
    </div>
  );
}

// ------------------------------------------------------------------ toasts
let toastMsg: { text: string; id: number; kind?: 'award'; onClick?: () => void } | null = null;
const toastSubs = new Set<() => void>();
export function toast(text: string, kind?: 'award', onClick?: () => void) {
  toastMsg = { text, id: Date.now(), kind, onClick };
  toastSubs.forEach((s) => s());
  const id = toastMsg.id;
  setTimeout(() => {
    if (toastMsg?.id === id) {
      toastMsg = null;
      toastSubs.forEach((s) => s());
    }
  }, onClick ? 9000 : kind ? 4200 : 2400);
}
/**
 * Where a message goes: just above whatever sits at the bottom right now (an open sheet, or the reader's controls at
 * their resting place). Measured once when the message appears, so it never slides around while it is up.
 */
function toastBottom(): number | null {
  const H = window.innerHeight;
  const sheets = Array.from(document.querySelectorAll<HTMLElement>('.sheet:not(.out)'));
  // offsetTop ignores the sheets' slide-in transform: this is where they come to rest
  if (sheets.length) return Math.round(H - Math.min(...sheets.map((s) => s.offsetTop)) + 12);
  const dock = document.querySelector<HTMLElement>('.r-dock');
  const host = dock?.offsetParent as HTMLElement | null;
  if (dock && host) {
    // offsets, not the box on screen: the reader may still be sliding in, and the controls may be tucked away
    return Math.round(H - (host.offsetTop + dock.offsetTop) + 12);
  }
  return null;
}

export function Toasts() {
  const msg = useSyncExternalStore(
    (l) => {
      toastSubs.add(l);
      return () => toastSubs.delete(l);
    },
    () => toastMsg,
  );
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const b = msg && ref.current ? toastBottom() : null;
    if (ref.current) ref.current.style.bottom = b === null ? '' : `max(${b}px, calc(var(--safe-b) + 24px))`;
  }, [msg?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return msg ? (
    <div
      ref={ref}
      className={`toast${msg.kind ? ' ' + msg.kind : ''}${msg.onClick ? ' tappable' : ''}`}
      key={msg.id}
      role={msg.onClick ? 'button' : 'status'}
      onClick={() => {
        const f = msg.onClick;
        if (!f) return;
        toastMsg = null;
        toastSubs.forEach((x) => x());
        f();
      }}
    >
      {msg.text}
      {msg.onClick && <span aria-hidden> →</span>}
    </div>
  ) : null;
}

// ------------------------------------------------------------------ misc hooks
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data?: T; error?: unknown; loading: boolean } {
  const [s, setS] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  useEffect(() => {
    let alive = true;
    setS({ loading: true });
    fn().then(
      (data) => alive && setS({ data, loading: false }),
      (error) => alive && setS({ error, loading: false }),
    );
    return () => {
      alive = false;
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return s;
}

/** Four little screws for the translucent acrylic pockets. */
export function Screws() {
  return (
    <>
      {['tl', 'tr', 'bl', 'br'].map((p) => (
        <span key={p} className={`screw ${p}`} aria-hidden>
          <i />
        </span>
      ))}
    </>
  );
}
