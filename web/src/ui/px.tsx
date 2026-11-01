// Frogity's small pieces, as on the phone: pixel icons, the pixel loader and bar, the frog mark, ASCII touches.
import type { CSSProperties } from 'react';
import { PIXELS, pixelRects, type PixelName } from '../lib/pixels';

export type { PixelName };
export function Pixel({ name, size = 18, className, style }: { name: PixelName; size?: number; className?: string; style?: CSSProperties }) {
  return <svg className={className} style={style} width={size} height={size} viewBox="0 0 9 9" shapeRendering="crispEdges" fill="currentColor" aria-hidden dangerouslySetInnerHTML={{ __html: pixelRects(name) }} />;
}
export const hasPixel = (n: string): n is PixelName => n in PIXELS;

const SNAKE3 = [0, 1, 2, 5, 8, 7, 6, 3, 4];
const SNAKE4 = [0, 1, 2, 3, 7, 11, 15, 14, 13, 12, 8, 4, 5, 6, 10, 9];
/** The little snake of squares that says "working on it". */
export function PixelLoader({ size = 6, grid = 3, gap = 3, label }: { size?: number; grid?: 3 | 4; gap?: number; label?: string }) {
  const n = grid * grid;
  const order = grid === 3 ? SNAKE3 : SNAKE4;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <span className="pixload" style={{ gridTemplateColumns: `repeat(${grid}, ${size}px)`, gap }} role="progressbar" aria-label={label ?? 'Loading'}>
        {Array.from({ length: n }, (_, i) => (
          <i key={i} style={{ width: size, height: size, animationDelay: `${(order.indexOf(i) / n) * 1.2}s` }} />
        ))}
      </span>
      {label && <span className="mono" style={{ fontSize: 12 }}>{label}</span>}
    </span>
  );
}
/** ▮▮▮▮▯▯▯ */
export function PixelBar({ value, cells = 16, h = 10 }: { value: number; cells?: number; h?: number }) {
  const on = Math.round(Math.max(0, Math.min(1, value)) * cells);
  return (
    <span style={{ display: 'inline-flex', gap: 2 }} role="progressbar" aria-valuenow={Math.round(value * 100)}>
      {Array.from({ length: cells }, (_, i) => (
        <i key={i} style={{ width: 6, height: h, background: 'currentColor', opacity: i < on ? 1 : 0.14, transition: 'opacity .2s' }} />
      ))}
    </span>
  );
}

/** The Frogity mark (the frog and its rider), for light or dark backgrounds. */
export function Mark({ size = 28, light = false, className }: { size?: number; light?: boolean; className?: string }) {
  return <img className={className} src={light ? '/mark-tight-light.png' : '/mark-tight.png'} alt="Frogity" height={size} style={{ height: size, width: 'auto', display: 'block' }} draggable={false} />;
}

/** ASCII pictures for empty places (the phone's shelf and book). */
export const ASCII = {
  shelf: String.raw`
     _______     _______
    |       |   |  ___  |
    |  ...  |   | |   | |
    |  ...  |   | |___| |
    |_______|   |_______|
  ==========================`,
  plug: String.raw`
      ___________           ___________
     |  _______  |  . . .  |  _______  |
     | |       | | ======> | |       | |
     | |_______| |  . . .  | |_______| |
     |___________|         |___________|
        phone                computer`,
  hop: String.raw`
              @
          @        @
      @   _  _
     ____(o)(o)___
    /   \  ..  /  \
   '-----\____/----'`,
};
export function Ascii({ art, className = '' }: { art: keyof typeof ASCII; className?: string }) {
  return <pre className={`ascii ${className}`} aria-hidden>{ASCII[art]}</pre>;
}
