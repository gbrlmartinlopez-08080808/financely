import { useRef, useState } from 'react';
import { tap } from '../lib/native';

/**
 * A bar to move through the whole book (or track) with a finger, like a music player's. While it is held, a label
 * above the thumb says where it would land; `onChange` is called as it moves (`final` when the finger lifts).
 */
export function Scrub({ value, label, onChange, className = '', ariaLabel }: { value: number; label: (v: number) => string; onChange: (v: number, final: boolean) => void; className?: string; ariaLabel: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState<number | null>(null);
  const v = held ?? value;
  const at = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (x - r.left) / r.width));
  };
  const last = useRef(0);
  return (
    <div
      className={`scrub ${className}${held !== null ? ' held' : ''}`}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-valuetext={label(v)}
      tabIndex={0}
      onKeyDown={(e) => {
        const d = e.key === 'ArrowRight' ? 0.01 : e.key === 'ArrowLeft' ? -0.01 : 0;
        if (d) onChange(Math.max(0, Math.min(1, value + d)), true);
      }}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const x = at(e.clientX);
        window.dispatchEvent(new CustomEvent('frogity:scrub', { detail: true }));
        setHeld(x);
        tap('select');
        onChange(x, false);
      }}
      onPointerMove={(e) => {
        if (held === null) return;
        const x = at(e.clientX);
        setHeld(x);
        // the content follows the finger, a few times a second (smooth on slow phones too)
        const now = performance.now();
        if (now - last.current > 90) {
          last.current = now;
          onChange(x, false);
        }
      }}
      onPointerUp={(e) => {
        if (held === null) return;
        const x = at(e.clientX);
        setHeld(null);
        window.dispatchEvent(new CustomEvent('frogity:scrub', { detail: false }));
        onChange(x, true);
      }}
      onPointerCancel={() => {
        setHeld(null);
        window.dispatchEvent(new CustomEvent('frogity:scrub', { detail: false }));
      }}
    >
      <div className="scrub-track" ref={track}>
        <i className="scrub-fill" style={{ width: `${v * 100}%` }} />
        <i className="scrub-thumb" style={{ left: `${v * 100}%` }} />
        {held !== null && (
          <span className="scrub-tip mono" style={{ left: `${Math.max(8, Math.min(92, v * 100))}%` }}>
            {label(v)}
          </span>
        )}
      </div>
    </div>
  );
}
