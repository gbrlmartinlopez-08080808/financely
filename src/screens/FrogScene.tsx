import { useEffect, useRef, useState } from 'react';
import { displayName } from '../lib/cheer';
import { tap } from '../lib/native';

// A small ASCII frog hops across lily pads to the glowing @ that is yesterday's reading mark.
const W = 40;
const H = 12;
const GROUND = 9; // row of the pads
const SIT = ['(o)(o)', '( -- )', '/|  |\\'];
const CROUCH = ['(o)(o)', '(____)', '/\\  /\\'];
const AIR = ['(^)(^)', '( == )', '\\\\  //'];
const HOPS = 5;
const FRAMES_PER_HOP = 15;
const esc = (c: string) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c);

function frame(f: number, done: boolean): string {
  const g: string[][] = Array.from({ length: H }, () => Array.from({ length: W }, () => ' '));
  const put = (x: number, y: number, s: string) => {
    for (let i = 0; i < s.length; i++) if (x + i >= 0 && x + i < W && y >= 0 && y < H) g[y][x + i] = s[i];
  };
  // a few stars and the water line
  [[3, 1], [11, 0], [19, 2], [27, 1], [35, 0], [7, 3], [31, 3]].forEach(([x, y], i) => put(x, y, (f + i * 7) % 24 < 3 ? '+' : '.'));
  const pads = Array.from({ length: HOPS + 1 }, (_, i) => 3 + Math.round((i * (W - 15)) / HOPS));
  pads.forEach((x) => put(x - 1, GROUND + 1, '(____)'));
  put(0, GROUND + 2, '~'.repeat(W).replace(/~~/g, '~-'));
  // the target pad: yesterday's mark
  const last = pads[HOPS];
  const pulse = Math.floor(f / 6) % 2 === 0;
  put(last + 1, GROUND, '@'); // replaced by markup below
  if (pulse || done) {
    put(last - 1, GROUND, '.');
    put(last + 3, GROUND, '.');
  }
  // the frog
  const hop = Math.min(HOPS - 1, Math.floor(f / FRAMES_PER_HOP));
  const u = (f % FRAMES_PER_HOP) / FRAMES_PER_HOP;
  const from = pads[hop];
  const to = pads[hop + 1];
  let x = from;
  let y = GROUND - 2;
  let sprite = SIT;
  if (done) {
    x = last - 1;
    sprite = SIT;
  } else if (f >= HOPS * FRAMES_PER_HOP) {
    x = last - 1;
  } else if (u < 0.22) {
    sprite = CROUCH;
    x = from - 1;
  } else if (u < 0.86) {
    const a = (u - 0.22) / 0.64;
    x = Math.round(from - 1 + (to - from) * a);
    y = GROUND - 2 - Math.round(Math.sin(Math.PI * a) * 4);
    sprite = AIR;
  } else {
    x = to - 1;
  }
  sprite.forEach((row, i) => put(x, y + i, row));
  // markup: the mark is yellow, the frog green-ish by class
  return g
    .map((row, ry) => row.map((c, cx) => (ry === GROUND && cx === last + 1 && c === '@' ? `<b class="y">@</b>` : esc(c))).join(''))
    .join('\n');
}

export function FrogScene({ minutes, goal, name, onEnd }: { minutes: number; goal: number; name: string; onEnd: () => void }) {
  const [f, setF] = useState(0);
  const total = HOPS * FRAMES_PER_HOP + 18;
  const done = f >= total - 6;
  const ended = useRef(false);
  useEffect(() => {
    const t = setInterval(() => setF((n) => Math.min(total + 30, n + 1)), 75);
    return () => clearInterval(t);
  }, [total]);
  useEffect(() => {
    if (f > 0 && f % FRAMES_PER_HOP === 0 && f < HOPS * FRAMES_PER_HOP) tap('light');
    if (f >= total + 24 && !ended.current) {
      ended.current = true;
      onEnd();
    }
  }, [f]); // eslint-disable-line react-hooks/exhaustive-deps
  const who = displayName(name);
  const extra = minutes - goal;
  const line = extra >= goal ? `${minutes} minutes — double your goal.` : extra > 0 ? `${minutes} minutes — ${extra} over your goal.` : `${minutes} minutes — right on your goal.`;
  return (
    <div
      className="ascii-card frog"
      onClick={() => {
        if (!ended.current) {
          ended.current = true;
          onEnd();
        }
      }}
      role="img"
      aria-label="A frog hops to the light you earned yesterday"
    >
      <pre dangerouslySetInnerHTML={{ __html: frame(f, done) }} />
      <p className={`frog-msg mono${done ? ' in' : ''}`}>
        <b>yesterday’s light</b>
        <span>{who ? `${who}, ${line}` : line}</span>
      </p>
      <span className="sig mono">tap to skip</span>
    </div>
  );
}
