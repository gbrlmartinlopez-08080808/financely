// One character per day: the more you read, the heavier the mark.
export const GLYPHS: { min: number; ch: string; label: string }[] = [
  { min: 60, ch: '@', label: '60+' },
  { min: 30, ch: '%', label: '30' },
  { min: 15, ch: '*', label: '15' },
  { min: 5, ch: '+', label: '5' },
  { min: 1, ch: ':', label: '1' },
];

/** ms read → { ch, level 0‥5 } (level drives the ink strength). */
export function glyphFor(ms: number): { ch: string; level: number } {
  const m = ms / 60000;
  const i = GLYPHS.findIndex((g) => m >= g.min);
  if (i < 0) return { ch: ms > 0 ? '.' : '·', level: 0 };
  return { ch: GLYPHS[i].ch, level: GLYPHS.length - i };
}

export const fmtMs = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`;
};
