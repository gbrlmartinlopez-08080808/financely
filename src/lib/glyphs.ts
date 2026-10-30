// One character per day, measured against your own daily goal: the closer you got, the heavier the mark.
// Reaching the goal earns the yellow @ (and a light on the globe once the day is over).
/** What each mark means in minutes for YOUR daily goal (e.g. goal 20: ":" from 1 min, "+" from 5, "*" from 10, "%" from 15, "@" at 20). */
export function legendFor(goalMin: number): { ch: string; from: number }[] {
  const m = (f: number) => Math.max(1, Math.ceil(goalMin * f));
  const raw = [
    { ch: ':', from: 1 },
    { ch: '+', from: m(0.25) },
    { ch: '*', from: m(0.5) },
    { ch: '%', from: m(0.75) },
    { ch: '@', from: Math.max(1, goalMin) },
  ];
  // very small goals can collapse two marks onto one minute: keep each mark at least one minute above the last
  for (let i = 1; i < raw.length; i++) if (raw[i].from <= raw[i - 1].from) raw[i].from = raw[i - 1].from + 1;
  return raw;
}
export const GLYPHS = legendFor(15);

export interface Glyph {
  ch: string;
  level: number; // 0‥5 → ink strength
  met: boolean; // goal reached → yellow @
}

export function glyphFor(ms: number, goalMs: number): Glyph {
  if (ms <= 0) return { ch: '·', level: 0, met: false };
  const lg = legendFor(Math.max(1, Math.round(goalMs / 60000)));
  for (let i = lg.length - 1; i >= 0; i--) if (ms >= lg[i].from * 60_000) return { ch: lg[i].ch, level: i + 1, met: i === lg.length - 1 };
  return { ch: '.', level: 1, met: false };
}

export const fmtMs = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`;
};
