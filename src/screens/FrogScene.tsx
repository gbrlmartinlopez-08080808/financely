import { useEffect, useRef, useState } from 'react';
import { displayName } from '../lib/cheer';
import { tap } from '../lib/native';

// The reward scene: the frog hops off its pad, lights its jetpack and flies across the night sky with one @ behind
// it for every day you have reached your goal. The newest one (yesterday's) is yellow and joins the line last.
const W = 46;
const H = 14;
const GROUND = 12;
const esc = (c: string) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c);

const SIT = ['    (o)(o)   ', ' []  ( -- )   ', ' []  /|  |\\   ', ' ##  ^^  ^^   '];
const CROUCH = ['             ', '    (o)(o)   ', ' []  (____)   ', ' ##  /\\  /\\   '];
const FLY = ['    (O)(O)   ', ' []  ( -- )   ', ' []  /|  |\\   ', ' ##   ||  || '];
const FLAMES = [[' vv', ' VV'], [' VV', ' vv'], [' ww', ' VV'], [' VV', ' ww']];

type Cell = { c: string; k?: 'y' | 'f' | 's' };
const ease = (x: number) => x * x * (3 - 2 * x);

function render(t: number, trailCount: number, shown: number): string {
  const g: Cell[][] = Array.from({ length: H }, () => Array.from({ length: W }, () => ({ c: ' ' }) as Cell));
  const put = (x: number, y: number, s: string, k?: Cell['k'], solid = false) => {
    for (let i = 0; i < s.length; i++) {
      const xx = Math.round(x) + i;
      const yy = Math.round(y);
      if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
      if (s[i] === ' ' && !solid) continue;
      g[yy][xx] = { c: s[i], k };
    }
  };
  // parallax stars (three layers scrolling left, faster the nearer they are)
  const layers: [number, string, number][] = [[3, '.', 4], [6, '+', 9], [11, '*', 15]];
  const fly = Math.max(0, Math.min(1, (t - 1.0) / 1.4));
  layers.forEach(([speed, ch, n], li) => {
    for (let i = 0; i < n; i++) {
      const bx = (i * 37 + li * 11) % (W * 2);
      const x = (((bx - t * speed * (0.25 + 0.75 * fly)) % (W * 2)) + W * 2) % (W * 2);
      if (x < W) put(x, (i * 5 + li * 3) % (GROUND - 1), ch, 's');
    }
  });
  // the pad it starts from
  const padX = 3 - Math.max(0, (t - 0.8) * 7);
  put(padX, GROUND + 1, '(______)');
  put(0, GROUND + 2, '~-'.repeat(W / 2));

  // How far it carries the lights depends on how many there are: a single light is a short hop, a hundred a long haul.
  const f = Math.min(1, Math.log(1 + trailCount) / Math.log(1 + 60));
  const endX = 5 + Math.round(6 + 20 * f);
  // frog path: sit → crouch → jump → cruise → glide down → land
  let x = 5;
  let y = GROUND - 3;
  let sprite = SIT;
  let jet = false;
  const LAND0 = 5.4; // the glide down starts
  const LAND1 = 7.3; // paws on the pad
  if (t >= 0.45 && t < 0.8) sprite = CROUCH;
  if (t >= 0.8) {
    const u = ease(Math.min(1, (t - 0.8) / 1.5));
    x = 5 + u * (endX - 5);
    const arc = Math.sin(Math.PI * Math.min(1, (t - 0.8) / 0.9)) * 3;
    const climb = u * 6;
    const cruise = t > 2.3 && t < LAND0 ? Math.sin(t * 2.4) * 0.9 : 0;
    y = GROUND - 3 - climb - arc + cruise;
    sprite = t >= 1.1 ? FLY : SIT;
    jet = t >= 1.1;
  }
  let landed = false;
  if (t >= LAND0) {
    const v = ease(Math.min(1, (t - LAND0) / (LAND1 - LAND0)));
    const top = GROUND - 9 + Math.sin(LAND0 * 2.4) * 0.9;
    y = top + (GROUND - 3 - top) * v;
    x = endX + Math.sin(v * Math.PI) * 1.5; // a little sway on the way down
    jet = v < 0.82; // the flames sputter out just before touchdown
    sprite = v < 0.82 ? FLY : v < 1 ? CROUCH : SIT;
    landed = v >= 1;
  }
  // the pad it lands on appears under it
  if (t >= LAND0 - 0.4) put(endX - 1, GROUND + 1, '(______)');
  // trail of @ (one per light), a gentle wave behind the frog. A long streak is drawn tighter, and in more lines.
  const total = Math.min(trailCount, 120);
  if (t >= 1.3) {
    const avail = Math.max(4, endX - 6); // columns the trail can span
    const rows = Math.max(1, Math.min(4, Math.ceil(total / avail)));
    const perRow = Math.ceil(total / rows);
    const spacing = Math.max(1, Math.min(3, Math.floor(avail / perRow)));
    const stagger = Math.min(0.16, 2.6 / Math.max(1, total));
    for (let i = 0; i < total; i++) {
      const born = 1.5 + i * stagger;
      if (t < born) continue;
      const row = i % rows;
      const k = Math.floor(i / rows);
      const tx = x - 2 - (k + 1) * spacing + 1;
      const ty = y + 1.4 + row * 1.7 + Math.sin(t * 4 - k * 0.7) * (spacing === 1 ? 0.8 : 1.3);
      // after touchdown the lights drift up and settle into the sky, the oldest first, ready to be lit on the globe
      const settle = t - (LAND1 - 0.2) - k * 0.05;
      if (i !== 0 && settle > 0) {
        if (settle > 0.9) continue;
        put(tx, ty - settle * 6, settle < 0.3 ? '@' : settle < 0.6 ? '*' : '.', settle < 0.3 ? undefined : 's');
        continue;
      }
      const fresh = i === 0; // the newest light is the one just earned: yellow
      put(tx, ty, '@', fresh ? 'y' : undefined);
    }
  }
  // sprite and jet flames
  sprite.forEach((row, i) => put(x, y + i, row, undefined));
  if (jet) {
    const fl = FLAMES[Math.floor(t * 14) % FLAMES.length];
    put(x + 1, y + 4, fl[0], 'f');
    put(x + 1, y + 5, fl[1], 'f');
    put(x + 8, y + 4, 'v', 'f');
  }
  if (landed && t < LAND1 + 0.5) put(x + 3, GROUND, '. *  * .', 's'); // a puff of dust
  // sparkle when the newest light joins at the end
  if (landed && Math.floor(t * 8) % 2 === 0) put(x - 1, y - 1, '+', 'y');
  void shown;
  return g
    .map((row) =>
      row
        .map((cell) => {
          const ch = esc(cell.c);
          return cell.k === 'y' ? `<b class="y">${ch}</b>` : cell.k === 'f' ? `<i class="f">${ch}</i>` : cell.k === 's' ? `<u class="s">${ch}</u>` : ch;
        })
        .join(''),
    )
    .join('\n');
}

export function FrogScene({ count, minutes, goal, name, onEnd }: { count: number; minutes: number; goal: number; name: string; onEnd: () => void }) {
  const [t, setT] = useState(0);
  const ended = useRef(false);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 55) return; // ~18 frames a second: crisp for ASCII, light on the phone
      last = now;
      setT((now - t0) / 1000);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const finish = () => {
    if (ended.current) return;
    ended.current = true;
    onEnd();
  };
  useEffect(() => {
    if (t > 0.8 && t < 0.85) tap('medium');
    if (t >= 9.4) finish();
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps
  const who = displayName(name);
  const extra = minutes - goal;
  const line = extra >= goal ? `${minutes} minutes — double your goal.` : extra > 0 ? `${minutes} minutes — ${extra} over your goal.` : `${minutes} minutes — right on your goal.`;
  return (
    <div className={`ascii-card frog${t >= 8.7 ? ' out' : ''}`} onClick={finish} role="img" aria-label="A frog with a jetpack flies across the sky, towing one @ for every day you reached your goal">
      <pre dangerouslySetInnerHTML={{ __html: render(t, count, count) }} />
      <p className={`frog-msg mono${t > 6.6 ? ' in' : ''}`}>
        <b>
          yesterday’s light · {count} on your map
        </b>
        <span>{who ? `${who}, ${line}` : line}</span>
      </p>
      <span className="sig mono">tap to skip</span>
    </div>
  );
}
