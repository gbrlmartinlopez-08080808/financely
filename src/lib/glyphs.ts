// One character per day, measured against your own daily goal: the closer you got, the heavier the mark.
// Reaching the goal earns the yellow @ (and a light on the globe once the day is over).
export const GLYPHS = [
  { ch: ':', label: '25' },
  { ch: '+', label: '50' },
  { ch: '*', label: '75' },
  { ch: '%', label: '99' },
  { ch: '@', label: 'goal' },
];

export interface Glyph {
  ch: string;
  level: number; // 0‥5 → ink strength
  met: boolean; // goal reached → yellow @
}

export function glyphFor(ms: number, goalMs: number): Glyph {
  if (ms <= 0) return { ch: '·', level: 0, met: false };
  const f = ms / Math.max(1, goalMs);
  if (f >= 1) return { ch: '@', level: 5, met: true };
  if (ms < 60_000) return { ch: '.', level: 1, met: false };
  if (f < 0.25) return { ch: ':', level: 1, met: false };
  if (f < 0.5) return { ch: '+', level: 2, met: false };
  if (f < 0.75) return { ch: '*', level: 3, met: false };
  return { ch: '%', level: 4, met: false };
}

export const fmtMs = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`;
};
