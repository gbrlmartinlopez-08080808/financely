import { useEffect, useRef, useState } from 'react';
import { deepLevel, rng, slingLevel } from '../lib/games';
import { deepestOf, PROMPTS, scoreAnswer, type Prompt } from '../data/deepcuts';
import { froggyFace, type Mood } from '../lib/froggy';
import { tap } from '../lib/native';
import { Icon } from '../ui/Icon';

const dayNo = () => Math.floor(Date.now() / 864e5);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const ease = { out: (k: number) => 1 - Math.pow(1 - k, 3), expo: (k: number) => (k >= 1 ? 1 : 1 - Math.pow(2, -9 * k)), inq: (k: number) => k * k, io: (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2) };

// ------------------------------------------------------------------------------------------------ drawing, in the app's own ink-on-paper style
interface Ink {
  ink: string;
  ink2: string;
  muted: string;
  paper: string;
  line: string;
}
function inkOf(el: HTMLElement): Ink {
  const cs = getComputedStyle(el);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return { ink: v('--ink', '#111'), ink2: v('--ink-2', '#3b3b3b'), muted: v('--muted', '#8b8a87'), paper: v('--surface', '#fff'), line: v('--line-2', 'rgba(17,17,17,.14)') };
}
const MONO = '600 15px "JetBrains Mono", ui-monospace, monospace';
function text(c: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, font = MONO, align: CanvasTextAlign = 'center') {
  c.font = font;
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = 'middle';
  c.fillText(s, x, y);
}
// a muted palette that sits on both the light and the dark paper
const CO = { gold: '#d9a21b', coral: '#e2664a', blue: '#5f9bd0', violet: '#9a73d6', green: '#6aa56a', petal: '#e8907a' };
export const TIER_COLOR: Record<string, string> = { unknown: '#8a8a86', common: '#8a8a86', known: CO.blue, uncommon: CO.gold, 'deep cut': CO.coral, 'deepest cut': CO.violet };
const mono = (px: number, w = 700) => `${w} ${px}px "JetBrains Mono", ui-monospace, monospace`;

type Pose = 'sit' | 'air' | 'swing' | 'none';
const FEET: Record<Exclude<Pose, 'none'>, string> = { sit: '_/|_ _|\\_', air: ' /_/ \\_\\ ', swing: ' //   \\\\ ' };
/** Froggy, as in the rest of the app: the ASCII face (three lines) and a line of legs, centred on x, with its feet at y */
function frog(c: CanvasRenderingContext2D, k: Ink, x: number, y: number, mood: Mood, mouth?: string, squash = 1, pose: Pose = 'sit') {
  const lines = froggyFace(mood, { mouth }).split('\n');
  c.save();
  c.translate(x, y - 6);
  c.scale(1 / squash, squash);
  lines.forEach((l, i) => text(c, l, 0, -38 + i * 15, k.ink, mono(16)));
  if (pose !== 'none') text(c, FEET[pose], 0, 7, k.ink2, mono(16));
  c.restore();
}
/** a lily pad: a flat ellipse with a notch and veins, a ripple either side */
function pad(c: CanvasRenderingContext2D, k: Ink, x: number, y: number, w: number, alpha = 1, label?: string, grow = 1, labelCol?: string) {
  c.save();
  c.globalAlpha = alpha;
  c.translate(x, y);
  c.scale(grow, grow);
  c.beginPath();
  c.ellipse(0, 8, w / 2, 8, 0, 0, Math.PI * 2);
  c.fillStyle = k.paper;
  c.fill();
  c.fillStyle = CO.green;
  c.globalAlpha = alpha * 0.16;
  c.fill();
  c.globalAlpha = alpha;
  c.strokeStyle = k.ink;
  c.lineWidth = 1.6;
  c.stroke();
  // the notch every lily pad has
  c.beginPath();
  c.moveTo(w * 0.1, 8);
  c.lineTo(w / 2 - 2, 5);
  c.lineWidth = 1.3;
  c.stroke();
  // veins
  c.lineWidth = 1;
  c.globalAlpha = alpha * 0.16;
  for (const a of [-0.9, -0.3, 0.45]) {
    c.beginPath();
    c.moveTo(0, 8);
    c.lineTo(Math.cos(a + Math.PI) * (w / 2 - 8), 8 + Math.sin(a + Math.PI) * 5);
    c.stroke();
  }
  c.beginPath();
  c.ellipse(0, 11, w / 2 - 12, 3.5, 0, 0.2, Math.PI - 0.2);
  c.stroke();
  c.globalAlpha = alpha * 0.5;
  text(c, '~', -w / 2 - 9, 14, k.muted, mono(12, 500));
  text(c, '~', w / 2 + 9, 14, k.muted, mono(12, 500));
  c.globalAlpha = alpha;
  if (label) text(c, label, 0, 30, labelCol ?? k.ink2, mono(11, 700));
  c.restore();
}
/** a few specks that drift past at half the speed of the world, so climbing feels like climbing */
function dust(c: CanvasRenderingContext2D, k: Ink, W: number, H: number, cam: number) {
  c.save();
  c.fillStyle = k.muted;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = '500 12px "JetBrains Mono", ui-monospace, monospace';
  const par = 0.55;
  const j0 = Math.floor((cam * par) / 70) - 1;
  for (let j = j0; j < j0 + H / 70 + 3; j++) {
    const h1 = Math.abs(Math.sin(j * 12.9898) * 43758.5453) % 1;
    const h2 = Math.abs(Math.sin(j * 78.233 + 1) * 24634.6345) % 1;
    const y = H - (j * 70 + h2 * 50 - cam * par);
    c.globalAlpha = 0.28 + h2 * 0.3;
    c.fillText(h1 > 0.82 ? '+' : h1 > 0.7 ? '°' : '.', 26 + h1 * (W - 52), y);
  }
  c.restore();
}
function water(c: CanvasRenderingContext2D, k: Ink, W: number, y: number, H: number, t: number) {
  if (y > H + 20) return;
  c.save();
  c.strokeStyle = k.ink;
  c.lineWidth = 1.4;
  for (let row = 0; row < 3; row++) {
    c.globalAlpha = 1 - row * 0.3;
    c.beginPath();
    for (let x = 0; x <= W; x += 6) {
      const yy = y + row * 11 + Math.sin(x / 17 + t * (2 + row * 0.5) + row) * 2.6;
      x === 0 ? c.moveTo(x, yy) : c.lineTo(x, yy);
    }
    c.stroke();
  }
  c.globalAlpha = 0.1;
  c.fillStyle = CO.blue;
  c.fillRect(0, y + 8, W, H);
  // a few ASCII glints on the surface and fish shapes under it
  c.globalAlpha = 0.5;
  for (let i = 0; i < 6; i++) text(c, i % 3 ? '~' : '≈', ((i * 83 + t * 14 * (i % 2 ? 1 : -1)) % (W + 40) + W + 40) % (W + 40) - 20, y + 16 + (i % 3) * 11, k.muted, mono(11, 500));
  text(c, '><>', ((t * 22) % (W + 80)) - 40, y + 42, k.muted, mono(11, 500));
  c.restore();
}
/** reeds and a cattail or two at the banks, standing on the water line */
function reeds(c: CanvasRenderingContext2D, k: Ink, W: number, y: number, H: number, t: number) {
  if (y > H + 70 || y < -10) return;
  const stalk = (x: number, h: number, tail: boolean, ph: number) => {
    for (let i = 0; i < h; i++) {
      const sway = Math.sin(t * 1.3 + ph + i * 0.35) * (i * 0.5);
      text(c, i === h - 1 ? (tail ? '8' : 'Y') : '|', x + sway, y - 4 - i * 12, tail && i === h - 1 ? CO.gold : k.ink2, mono(14, 600));
    }
  };
  c.save();
  c.globalAlpha = 0.8;
  stalk(14, 5, true, 0);
  stalk(27, 3, false, 1.1);
  stalk(W - 15, 6, true, 2);
  stalk(W - 29, 3, false, 3);
  c.restore();
}
/** height marks down the left edge, like a ruler: every 10 m a tick, every 50 m a number */
function ruler(c: CanvasRenderingContext2D, k: Ink, H: number, cam: number, ppm: number, until: number) {
  c.save();
  c.strokeStyle = k.muted;
  c.lineWidth = 1;
  const first = Math.max(0, Math.floor(cam / ppm / 10) * 10);
  for (let m = first; m <= until && (m * ppm - cam) < H + 20; m += 10) {
    const y = H - (m * ppm - cam);
    if (y < -10) continue;
    const big = m % 50 === 0;
    c.globalAlpha = big ? 0.9 : 0.5;
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(big ? 14 : 8, y);
    c.stroke();
    if (big) text(c, `${m} m`, 18, y, k.muted, '500 10px "JetBrains Mono", ui-monospace, monospace', 'left');
  }
  c.restore();
}
/** the blossom at the top: a closed bud, which opens (ASCII petals, then a shower of confetti) once Froggy gets there */
function blossom(c: CanvasRenderingContext2D, k: Ink, x: number, y: number, open = 0, t = 0) {
  pad(c, k, x, y, 150, 1);
  const o = clamp(open, 0, 1);
  const sway = Math.sin(t * 2) * 1.2;
  if (o < 0.05) {
    text(c, '\\ | /', x, y - 30, k.ink, mono(15));
    text(c, '-(*)-', x, y - 15, k.ink, mono(15));
    return;
  }
  const spread = 10 + 34 * ease.out(o);
  c.globalAlpha = 1;
  text(c, '\\', x - spread, y - 34, CO.petal, mono(17));
  text(c, '/', x + spread, y - 34, CO.petal, mono(17));
  text(c, '\\', x - spread * 0.5, y - 46, CO.petal, mono(17));
  text(c, '/', x + spread * 0.5, y - 46, CO.petal, mono(17));
  text(c, '|', x + sway, y - 46, CO.petal, mono(17));
  text(c, '--(', x - spread - 8, y - 17, k.ink, mono(15));
  text(c, ')--', x + spread + 8, y - 17, k.ink, mono(15));
  text(c, '*', x, y - 17, CO.gold, mono(20));
  c.globalAlpha = 0.9 * o;
  text(c, '.  *  .', x, y - 62 - 6 * o, CO.gold, mono(13));
  c.globalAlpha = 1;
}
/** a shower of confetti glyphs: a fixed set that bursts upward from (x, y) and falls back */
function confetti(c: CanvasRenderingContext2D, x: number, y: number, e: number, spread = 1) {
  const cols = [CO.gold, CO.coral, CO.blue, CO.green, CO.violet, CO.petal];
  const glyphs = ['*', '+', '.', '~', 'o', '°'];
  for (let i = 0; i < 34; i++) {
    const a = -Math.PI / 2 + ((i * 2.399) % 2.4) - 1.2;
    const sp = (210 + ((i * 53) % 160)) * spread;
    const px = x + Math.cos(a) * sp * e * 0.8 + Math.sin(i * 7 + e * 5) * 6;
    const py = y + Math.sin(a) * sp * e + 360 * e * e * 0.8;
    c.globalAlpha = clamp(1.6 - e * 0.65, 0, 1);
    text(c, glyphs[i % glyphs.length], px, py, cols[i % cols.length], mono(14 + (i % 3) * 3));
  }
  c.globalAlpha = 1;
}
/** bubbles rising from where Froggy went under */
function bubbles(c: CanvasRenderingContext2D, k: Ink, x: number, y: number, e: number) {
  for (let i = 0; i < 9; i++) {
    const d = e - i * 0.12;
    if (d < 0) continue;
    c.globalAlpha = clamp(1 - d * 0.7, 0, 0.9);
    text(c, i % 3 === 0 ? 'O' : i % 3 === 1 ? 'o' : '.', x + Math.sin(i * 2.1 + d * 5) * 14 + (i - 4) * 3, y - d * 62, i % 2 ? k.muted : CO.blue, mono(12 + (i % 3) * 2, 600));
  }
  c.globalAlpha = 1;
}
/** rings that spread over the water where something fell in */
function ripples(c: CanvasRenderingContext2D, k: Ink, x: number, y: number, e: number) {
  c.save();
  c.strokeStyle = k.ink;
  c.lineWidth = 1.4;
  for (let i = 0; i < 3; i++) {
    c.globalAlpha = Math.max(0, 1 - e * 0.8 - i * 0.12);
    c.beginPath();
    c.ellipse(x, y, 20 + e * 70 + i * 16, 5 + e * 9 + i * 2, 0, 0, Math.PI * 2);
    c.stroke();
  }
  c.restore();
}
/** flies: wings and body each in their own colour; a bee is amber and striped; a golden fly glows */
function fly(c: CanvasRenderingContext2D, k: Ink, x: number, y: number, ph: number, bee: boolean, a = 1, gold = false) {
  const up = Math.sin(ph) > 0;
  c.globalAlpha = a;
  const f = mono(15);
  if (bee) {
    text(c, up ? '=' : '-', x - 11, y, CO.gold, f);
    text(c, 'B', x, y, CO.coral, f);
    text(c, up ? '=' : '-', x + 11, y, CO.gold, f);
  } else if (gold) {
    text(c, up ? '\\' : '/', x - 10, y, CO.gold, f);
    text(c, '*', x, y, CO.gold, mono(19));
    text(c, up ? '/' : '\\', x + 10, y, CO.gold, f);
    c.globalAlpha = a * (0.5 + 0.4 * Math.sin(ph * 0.8));
    text(c, '.  .', x, y - 14, CO.gold, mono(11));
  } else {
    text(c, up ? '\\' : '/', x - 10, y, CO.blue, f);
    text(c, 'x', x, y, k.ink, f);
    text(c, up ? '/' : '\\', x + 10, y, CO.blue, f);
  }
  c.globalAlpha = 1;
}
function tongueLine(c: CanvasRenderingContext2D, k: Ink, x0: number, y0: number, x1: number, y1: number, tip = true, w = 7) {
  c.save();
  c.lineCap = 'round';
  c.strokeStyle = CO.coral;
  c.lineWidth = w;
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.stroke();
  c.strokeStyle = k.paper;
  c.globalAlpha = 0.45;
  c.lineWidth = w - 4;
  c.stroke();
  c.restore();
  if (tip) text(c, '@', x1, y1, CO.coral, mono(18));
}

/** a canvas that fills its box, is sharp on any screen, and calls `frame` every animation frame */
function useStage(frame: (c: CanvasRenderingContext2D, W: number, H: number, dt: number, k: Ink) => void, ptr?: { down: (x: number, y: number) => void; move: (x: number, y: number) => void; up: (x: number, y: number) => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const f = useRef(frame);
  f.current = frame;
  const p = useRef(ptr);
  p.current = ptr;
  useEffect(() => {
    const el = cv.current!;
    const c = el.getContext('2d')!;
    let W = 0;
    let H = 0;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const d = Math.min(2.5, window.devicePixelRatio || 1);
      W = r.width;
      H = r.height;
      el.width = Math.round(W * d);
      el.height = Math.round(H * d);
      c.setTransform(d, 0, 0, d, 0, 0);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    let k = inkOf(el);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const th = () => (k = inkOf(el));
    mq.addEventListener('change', th);
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.04, (now - last) / 1000);
      last = now;
      c.clearRect(0, 0, W, H);
      f.current(c, W, H, dt, k);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const pos = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const dn = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      p.current?.down(...pos(e));
    };
    const mv = (e: PointerEvent) => p.current?.move(...pos(e));
    const up = (e: PointerEvent) => p.current?.up(...pos(e));
    el.addEventListener('pointerdown', dn);
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mq.removeEventListener('change', th);
      el.removeEventListener('pointerdown', dn);
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, []);
  return cv;
}

// ------------------------------------------------------------------------------------------------ variant one: the sling
interface Fly {
  x0: number;
  y0: number;
  x: number;
  y: number;
  ph: number;
  sp: number;
  amp: number;
  bee: boolean;
  gold: boolean;
  gone: number; // seconds since it flew off (0 = still there)
}
export function Sling({ level, onEnd }: { level: number; onEnd: (win: boolean, text: string) => void }) {
  const cfg = useRef(slingLevel(level)).current;
  const [hud, setHud] = useState({ m: 0, goal: Math.round(cfg.goal / 10), hint: true, saves: 1 });
  const S = useRef(null as null | ReturnType<typeof initSling>);
  if (!S.current) S.current = initSling(cfg, level);
  const s = S.current;
  const done = useRef(false);
  const hudT = useRef(0);
  const cv = useStage(
    (c, W, H, dt, k) => {
      s.W = W;
      s.H = H;
      stepSling(s, cfg, dt, W);
      if (!s.started) s.frog.x = W / 2;
      drawSling(c, k, s, cfg, W, H);
      hudT.current += dt;
      if (hudT.current > 0.1) {
        hudT.current = 0;
        setHud((h) => {
          const m = Math.max(0, Math.round(s.frog.y / 10));
          return m === h.m && h.hint === !s.started && h.saves === s.saves ? h : { ...h, m, hint: !s.started, saves: s.saves };
        });
      }
      if (!done.current && s.mode === 'won' && s.t - s.endAt > 2.6) {
        done.current = true;
        onEnd(true, `Froggy swung up to the blossom, ${s.catches} fly${s.catches === 1 ? '' : 's'} caught on the way${s.saved ? ` and saved ${s.saved} time${s.saved === 1 ? '' : 's'} from a fall` : ''}.`);
      }
      if (!done.current && s.mode === 'dead' && s.t - s.endAt > 1.9) {
        done.current = true;
        onEnd(false, `It fell from ${Math.max(0, Math.round(s.best / 10))} m of ${Math.round(cfg.goal / 10)} m into the water.`);
      }
    },
    {
      down: (x, y) => {
        if (s.mode === 'won' || s.mode === 'dead') return;
        s.aim = { sx: x, sy: y, cx: x, cy: y };
        s.started = true;
      },
      move: (x, y) => {
        if (s.aim) (s.aim.cx = x), (s.aim.cy = y);
      },
      up: () => {
        const a = s.aim;
        s.aim = null;
        if (!a) return;
        const vx = a.sx - a.cx;
        const vy = a.sy - a.cy;
        const d = Math.hypot(vx, vy);
        const power = clamp(d / 120, 0, 1);
        if (power < 0.14) return;
        const max = 170 + 330 * power;
        const dir = assist(s, vx / d, -vy / d, max);
        s.tongue = { dx: dir.dx, dy: dir.dy, len: 0, max, out: true };
        tap('medium');
      },
    },
  );
  return (
    <div className="stagebox">
      <div className="game-hud mono">
        <span>
          {hud.m} m of {hud.goal} m
        </span>
        <span>
          {s.mode === 'rope' ? 'swinging' : s.mode === 'rest' ? 'on the pad' : s.mode === 'free' ? 'falling · shoot a fly!' : ''}
        </span>
        <span title="a lily rises under Froggy once if it is about to hit the water">
          <b style={{ color: hud.saves ? CO.green : undefined }}>{'●'.repeat(Math.max(0, hud.saves))}{'○'.repeat(Math.max(0, 1 - hud.saves))}</b> save
        </span>
      </div>
      <div className="stage">
        <canvas ref={cv} aria-label="Froggy on a lily pad, slinging its tongue at flies" />
        {hud.hint && <p className="stage-hint mono">pull back anywhere with your thumb, aim at a fly, let go{'\n'}falling? shoot another fly — time slows down while you aim</p>}
      </div>
    </div>
  );
}

export function initSling(cfg: ReturnType<typeof slingLevel>, level: number) {
  const r = rng(level * 911 + dayNo());
  const flies: Fly[] = [];
  let y = 190;
  while (y < cfg.goal + 240) {
    const n = r() < 0.3 + cfg.bees ? 2 : 1; // bees only ever come as the second fly of a pair: there is always a safe one to catch
    for (let i = 0; i < n; i++) {
      const bee = i > 0 && r() < 0.8;
      const gold = !bee && i === 0 && r() < 0.1;
      flies.push({ x0: 0.12 + r() * 0.76, y0: y + i * 40, x: 0, y: y + i * 40, ph: r() * 6, sp: 0.6 + r() * 0.9, amp: cfg.drift * (0.6 + r() * 0.8), bee, gold, gone: 0 });
    }
    y += cfg.gap * (0.8 + r() * 0.5);
  }
  return {
    W: 360,
    H: 520,
    t: 0,
    started: false,
    mode: 'rest' as 'rest' | 'free' | 'rope' | 'won' | 'dead',
    frog: { x: 180, y: 46, vx: 0, vy: 0 },
    anchor: null as Fly | null,
    L: 0,
    Lt: 0,
    grab: 0,
    flies,
    tongue: null as null | { dx: number; dy: number; len: number; max: number; out: boolean },
    aim: null as null | { sx: number; sy: number; cx: number; cy: number },
    cam: -110,
    best: 0,
    mood: 'neutral' as Mood,
    moodT: 0,
    endAt: 0,
    catches: 0,
    shock: 0,
    saves: 1,
    saved: 0,
    leaf: null as null | { x: number; t0: number },
    pops: [] as { x: number; y: number; t0: number; s: string; col: string }[],
  };
}
type SlingState = ReturnType<typeof initSling>;

/** the tongue leans toward the fly you were aiming at, if one is close to the line (a gentle help, most of all in a fall) */
function assist(s: SlingState, dx: number, dy: number, max: number) {
  const f = s.frog;
  const ox = f.x;
  const oy = f.y + 8;
  let best: Fly | null = null;
  let bestA = s.mode === 'free' ? 0.34 : 0.22; // radians
  for (const fl of s.flies) {
    if (fl.gone || fl.bee) continue;
    const vx = fl.x - ox;
    const vy = fl.y - oy;
    const d = Math.hypot(vx, vy);
    if (d > max + 30 || d < 20) continue;
    const ang = Math.acos(clamp((vx * dx + vy * dy) / d, -1, 1));
    if (ang < bestA) (bestA = ang), (best = fl);
  }
  if (!best) return { dx, dy, fly: null as Fly | null };
  const vx = best.x - ox;
  const vy = best.y - oy;
  const d = Math.hypot(vx, vy);
  return { dx: vx / d, dy: vy / d, fly: best as Fly | null };
}
export const aimTarget = (s: SlingState, dx: number, dy: number, max: number) => assist(s, dx, dy, max).fly;

const G = 1750;
export function stepSling(s: SlingState, cfg: ReturnType<typeof slingLevel>, dtRaw: number, W: number) {
  // the world slows to a crawl while a shot is being aimed, so there is time to aim in mid-air
  const slow = s.aim && (s.mode === 'free' || s.mode === 'rope') ? 0.2 : 1;
  const dt = dtRaw * slow;
  s.t += dtRaw;
  const f = s.frog;
  // flies drift (and follow the width of the screen)
  for (const fl of s.flies) {
    if (fl.gone > 0) {
      fl.gone += dtRaw;
      fl.y += 380 * dtRaw;
      continue;
    }
    fl.ph += dt * 5;
    fl.x = fl.x0 * W + Math.sin(s.t * fl.sp + fl.ph) * fl.amp;
    fl.y = fl.y0 + Math.cos(s.t * fl.sp * 0.8 + fl.ph) * fl.amp * 0.45;
  }
  if (s.moodT && s.t > s.moodT) (s.mood = 'neutral'), (s.moodT = 0);
  const face = (m: Mood, secs = 0.8) => ((s.mood = m), (s.moodT = secs ? s.t + secs : 0));
  if (s.mode === 'won') return;
  if (s.mode === 'dead') {
    f.y = Math.max(-40, f.y - 55 * dtRaw);
    return;
  }
  // the tongue
  const o = { x: f.x, y: f.y + 8 };
  const tg = s.tongue;
  if (tg) {
    if (tg.out) {
      tg.len += 2600 * dtRaw;
      const tx = o.x + tg.dx * tg.len;
      const ty = o.y + tg.dy * tg.len;
      // while Froggy is falling, the tongue is much easier to land
      const r = s.mode === 'free' ? 1.35 : 1;
      const hit = s.flies.find((fl) => fl.gone === 0 && Math.hypot(fl.x - tx, fl.y - ty) < (fl.bee ? 20 : 32 * r));
      if (hit) {
        s.tongue = null;
        if (hit.bee) {
          // a bee: a sting, and the grip is gone
          face('surprised', 1);
          s.shock = s.t;
          if (s.anchor) s.anchor.gone = 0.01;
          s.anchor = null;
          s.mode = 'free';
          f.vy = Math.min(f.vy, -120);
          f.vx *= 0.3;
          hit.gone = 0.01;
          s.pops.push({ x: hit.x, y: hit.y, t0: s.t, s: 'bzz!', col: CO.coral });
        } else {
          if (s.anchor && s.anchor !== hit) s.anchor.gone = 0.01; // the old fly wriggles off
          const wasFalling = s.mode === 'free' && f.vy < -300;
          s.anchor = hit;
          s.grab = 0;
          s.catches++;
          const d = Math.hypot(hit.x - f.x, hit.y - f.y);
          s.L = Math.max(60, d);
          s.Lt = Math.max(56, d * 0.38);
          s.mode = 'rope';
          if (d < 90) f.vy += 300; // a short grab still throws it up
          if (hit.gold) {
            // a golden fly: a big kick upward, and a lily in reserve
            f.vy += 520;
            s.saves = Math.min(2, s.saves + 1);
            s.pops.push({ x: hit.x, y: hit.y + 16, t0: s.t, s: '+1 save', col: CO.gold });
          } else if (wasFalling) {
            s.saved++;
            s.pops.push({ x: hit.x, y: hit.y + 16, t0: s.t, s: 'saved!', col: CO.green });
          }
          face(wasFalling || hit.gold ? 'smug' : 'happy', 1);
        }
        return;
      }
      if (tg.len >= tg.max) tg.out = false;
    } else {
      tg.len -= 3400 * dtRaw;
      if (tg.len <= 0) s.tongue = null;
    }
  }
  if (s.mode === 'rest') {
    f.vx = f.vy = 0;
    return;
  }
  // physics
  f.vy -= G * dt;
  if (s.mode === 'rope' && s.anchor) {
    const a = s.anchor;
    s.grab += dt;
    if (s.grab > cfg.hold) {
      // the fly wriggles free
      a.gone = 0.01;
      s.anchor = null;
      s.mode = 'free';
      face('worried', 1);
    } else {
      s.L += (s.Lt - s.L) * Math.min(1, 6 * dt);
      const dx = f.x - a.x;
      const dy = f.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > s.L * 1.25) {
        // the line pulls hard while it is being reeled in
        f.vx -= (dx / d) * 2600 * dt;
        f.vy -= (dy / d) * 2600 * dt;
      }
      f.vx *= 1 - 0.3 * dt;
      f.vy *= 1 - 0.3 * dt;
    }
  }
  f.x += f.vx * dt;
  f.y += f.vy * dt;
  if (s.mode === 'rope' && s.anchor) {
    const a = s.anchor;
    const dx = f.x - a.x;
    const dy = f.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > s.L) {
      const nx = dx / d;
      const ny = dy / d;
      f.x = a.x + nx * s.L;
      f.y = a.y + ny * s.L;
      const vn = f.vx * nx + f.vy * ny;
      if (vn > 0) {
        f.vx -= nx * vn;
        f.vy -= ny * vn;
      }
    }
  }
  f.x = clamp(f.x, 16, W - 16);
  if (f.x === 16 || f.x === W - 16) f.vx *= -0.3;
  s.best = Math.max(s.best, f.y);
  // the last chance: a lily pad rises under Froggy and flings it back up, once (twice with a golden fly)
  if (s.saves > 0 && f.y < 52 && f.vy < 0 && s.mode !== 'rope' && s.started && s.best > 120) {
    s.saves--;
    s.saved++;
    s.leaf = { x: f.x, t0: s.t };
    f.y = 52;
    f.vy = 1180;
    f.vx *= 0.4;
    face('surprised', 1);
    s.pops.push({ x: f.x, y: 70, t0: s.t, s: 'a lily saves it!', col: CO.green });
    tap('medium');
  }
  if (f.y >= cfg.goal - 14) {
    s.mode = 'won';
    s.endAt = s.t;
    face('bigSmile', 0);
    s.anchor = null;
    s.tongue = null;
    f.y = cfg.goal + 8;
    f.vx = f.vy = 0;
    f.x = W / 2;
  } else if (f.y < 14) {
    s.mode = 'dead';
    s.endAt = s.t;
    s.anchor = null;
    face('dizzy', 0);
  }
  // the camera follows, and never leaves the water or the blossom
  const target = clamp(f.y - s.H * 0.42, -110, cfg.goal - s.H * 0.55);
  s.cam += (target - s.cam) * Math.min(1, dtRaw * 5);
}

function drawSling(c: CanvasRenderingContext2D, k: Ink, s: SlingState, cfg: ReturnType<typeof slingLevel>, W: number, H: number) {
  const Y = (y: number) => H - (y - s.cam);
  dust(c, k, W, H, s.cam);
  ruler(c, k, H, s.cam, 10, Math.ceil((s.cam + H) / 10) + 10);
  water(c, k, W, Y(0), H, s.t);
  reeds(c, k, W, Y(0), H, s.t);
  pad(c, k, W / 2, Y(18), 120);
  const won = s.mode === 'won' ? s.t - s.endAt : -1;
  blossom(c, k, W / 2, Y(cfg.goal), won < 0 ? 0 : won / 0.7, s.t);
  // the lily that rises to catch a fall
  if (s.leaf) {
    const e = s.t - s.leaf.t0;
    if (e < 1.3) {
      c.globalAlpha = clamp(1.3 - e, 0, 1);
      pad(c, k, s.leaf.x, Y(40 - e * 10), 84, 1, undefined, 0.7 + 0.3 * ease.out(Math.min(1, e * 4)));
      c.globalAlpha = 1;
    }
  }
  // where the next shot would land: flies within reach glow while aiming
  let target: Fly | null = null;
  if (s.aim) {
    const a = s.aim;
    const vx = a.sx - a.cx;
    const vy = a.sy - a.cy;
    const d = Math.hypot(vx, vy);
    if (d > 6) target = aimTarget(s, vx / d, -vy / d, 170 + 330 * clamp(d / 120, 0, 1));
  }
  // the flies
  for (const fl of s.flies) {
    const y = Y(fl.y);
    if (y < -30 || y > H + 30 || fl.gone > 1.2) continue;
    fly(c, k, fl.x, y, fl.ph, fl.bee, fl.gone ? 1 - fl.gone : 1, fl.gold);
    if (fl === target) {
      c.save();
      c.strokeStyle = fl.gold ? CO.gold : CO.blue;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(fl.x, y, 24 + Math.sin(s.t * 12) * 2, 0, Math.PI * 2);
      c.stroke();
      c.restore();
    }
  }
  const f = s.frog;
  const fx = f.x;
  const fy = Y(f.y);
  // the line to the fly that holds it (with the little ring that shows how long it will hold)
  if (s.anchor && s.mode === 'rope') {
    const a = s.anchor;
    tongueLine(c, k, fx, fy - 6, a.x, Y(a.y), false, 5);
    const left = 1 - clamp(s.grab / cfg.hold, 0, 1);
    c.save();
    c.strokeStyle = left < 0.35 ? CO.coral : k.ink;
    c.lineWidth = 2.4;
    c.beginPath();
    c.arc(a.x, Y(a.y), 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
    c.stroke();
    c.restore();
  }
  if (s.tongue) {
    const tg = s.tongue;
    tongueLine(c, k, fx, fy - 4, fx + tg.dx * tg.len, fy - 4 - tg.dy * tg.len);
  }
  // Froggy
  if (s.mode === 'dead') {
    const e = s.t - s.endAt;
    c.globalAlpha = clamp(1 - e * 0.55, 0, 1);
    frog(c, k, fx, fy + 4, 'dizzy', undefined, 1, 'air');
    c.globalAlpha = 1;
    if (e < 1.4) {
      // the water closes over it: a tint above, rings and bubbles
      c.fillStyle = CO.blue;
      c.globalAlpha = 0.2;
      c.fillRect(0, Y(0) + 8, W, H);
      c.globalAlpha = 1;
    }
    ripples(c, k, fx, Y(2), e);
    bubbles(c, k, fx, Y(-4), e);
  } else if (s.mode === 'won') {
    const e = s.t - s.endAt;
    const hop = Math.abs(Math.sin(e * 7)) * 16 * Math.max(0, 1 - e / 1.6);
    frog(c, k, fx, fy + 4 - hop, e < 1.4 ? 'bigSmile' : 'smug', undefined, 1, hop > 3 ? 'air' : 'sit');
    confetti(c, fx, fy - 30, Math.max(0, e - 0.15) * 0.75);
    if (e > 0.6) {
      c.globalAlpha = clamp((e - 0.6) * 2, 0, 1);
      text(c, 'the top!', W / 2, fy - 118 - Math.min(10, e * 6), k.ink, mono(20));
      c.globalAlpha = 1;
    }
  } else {
    const speed = Math.hypot(f.vx, f.vy);
    const air = s.mode === 'free' || (s.mode === 'rope' && speed > 160);
    const face: Mood = s.mood === 'neutral' && s.mode === 'free' && f.vy < -250 ? 'worried' : s.mood === 'neutral' && speed > 700 ? 'surprised' : s.mood;
    frog(c, k, fx, fy + 4, face, s.tongue ? 'O' : undefined, 1, s.mode === 'rest' ? 'sit' : s.mode === 'rope' ? 'swing' : air ? 'air' : 'sit');
    // a falling Froggy near the water gets a warning above the surface
    if (s.mode === 'free' && f.y < 220 && f.vy < -200 && s.started) {
      c.globalAlpha = 0.5 + 0.5 * Math.sin(s.t * 14);
      text(c, '! ! !', fx, fy - 54, CO.coral, mono(14));
      c.globalAlpha = 1;
    }
  }
  for (const p of s.pops) {
    const e = s.t - p.t0;
    if (e > 1.4) continue;
    c.globalAlpha = clamp(1.4 - e, 0, 1);
    text(c, p.s, p.x, Y(p.y) - e * 34, p.col, mono(16));
    c.globalAlpha = 1;
  }
  s.pops = s.pops.filter((p) => s.t - p.t0 < 1.4);
  // aiming: the band back to the thumb, and where the tongue would reach
  if (s.aim) {
    const a = s.aim;
    const vx = a.sx - a.cx;
    const vy = a.sy - a.cy;
    const d = Math.hypot(vx, vy);
    if (d > 6) {
      const power = clamp(d / 120, 0, 1);
      const reach = 170 + 330 * power;
      const ux = vx / d;
      const uy = vy / d;
      c.save();
      c.strokeStyle = target ? CO.blue : k.muted;
      c.lineWidth = 1.4;
      c.setLineDash([3, 6]);
      c.beginPath();
      c.moveTo(fx, fy - 4);
      c.lineTo(fx + ux * reach, fy - 4 + uy * reach);
      c.stroke();
      c.setLineDash([]);
      c.beginPath();
      c.arc(fx + ux * reach, fy - 4 + uy * reach, 5, 0, Math.PI * 2);
      c.stroke();
      c.strokeStyle = k.muted;
      c.globalAlpha = 0.6;
      c.beginPath();
      c.arc(a.sx, a.sy, 16, 0, Math.PI * 2);
      c.moveTo(a.sx, a.sy);
      c.lineTo(a.cx, a.cy);
      c.stroke();
      c.beginPath();
      c.arc(a.cx, a.cy, 9, 0, Math.PI * 2);
      c.fillStyle = CO.coral;
      c.globalAlpha = 0.15 + 0.4 * power;
      c.fill();
      c.restore();
    }
  }
}

// ------------------------------------------------------------------------------------------------ variant two: deep cuts
interface Lily {
  y: number; // world px
  m: number; // metres
  born: number;
  x: number;
  col?: string; // the colour of the answer that put it here
}
type Note =
  | { kind: 'info'; tag: string; line: string }
  | { kind: 'rank'; name: string; tier: string; rank: number; of: number; points: number; gain: number; rare: string[] };

/** how rare an answer was, as the long tail every list of names has: many bars on the left (the familiar), few on the right; the answer's own bar lit */
function RankCard({ n }: { n: Extract<Note, { kind: 'rank' }> }) {
  const col = TIER_COLOR[n.tier] ?? TIER_COLOR.common;
  const BARS = 26;
  const at = Math.round((clamp(n.points, 0, 100) / 100) * (BARS - 1));
  return (
    <div className="rank" style={{ ['--tc' as string]: col }}>
      <div className="rank-top">
        <b className="rank-name">{n.name}</b>
        <span className="rank-chip mono">{n.tier}</span>
      </div>
      <div className="rank-meter" aria-hidden>
        {Array.from({ length: BARS }, (_, i) => (
          <i key={i} className={i === at ? 'on' : i < at ? 'pre' : ''} style={{ height: `${Math.round(6 + 30 / (1 + i * 0.55))}px` }} />
        ))}
      </div>
      <div className="rank-axis mono">
        <span>familiar</span>
        <span>rare</span>
      </div>
      <div className="rank-row mono">
        <span>
          #{n.rank} of {n.of}
        </span>
        <b>+{n.gain} m</b>
      </div>
      <p>Rarest of all: {n.rare.join(', ')}.</p>
    </div>
  );
}
const PPM = 5; // pixels per metre
export function Deep({ level, onEnd }: { level: number; onEnd: (win: boolean, text: string) => void }) {
  const cfg = useRef(deepLevel(level)).current;
  const seed = useRef(rng(level * 313 + dayNo())).current;
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [answer, setAnswer] = useState('');
  const [note, setNote] = useState<null | Note>(null);
  const [slack, setSlack] = useState(cfg.slack);
  const [m, setM] = useState(0);
  const used = useRef<string[]>([]);
  const done = useRef(false);
  const S = useRef({
    t: 0,
    frogY: PPM * 0,
    frogX: 0,
    cam: -40,
    lilies: [{ y: 0, m: 0, born: -9, x: 0 }] as Lily[],
    mood: 'neutral' as Mood,
    anim: null as null | { kind: 'soar' | 'slip' | 'sink'; t0: number; from: number; to: number; apex: number; ok: boolean; text?: string; col?: string },
    pops: [] as { x: number; y: number; t0: number; s: string; col?: string }[],
    winAt: -1,
    sparks: [] as { x: number; y: number; vx: number; vy: number; t0: number; c: string }[],
    endAt: 0,
  }).current;
  const ask = () => {
    const left = PROMPTS.filter((p) => !used.current.includes(p.id));
    const p = left.length ? left[Math.floor(seed() * left.length)] : PROMPTS[Math.floor(seed() * PROMPTS.length)];
    used.current.push(p.id);
    setPrompt(p);
    setAnswer('');
    setNote(null);
  };
  useEffect(() => {
    const t = setTimeout(ask, 500);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const slip = (why: string) => {
    if (S.anim || done.current) return;
    setPrompt(null);
    const below = S.lilies.filter((l) => l.y < S.frogY - 1).sort((a, b) => b.y - a.y)[0];
    S.anim = { kind: below ? 'slip' : 'sink', t0: S.t, from: S.frogY, to: below ? below.y : -60, apex: 0, ok: false, text: why };
    S.mood = 'surprised';
    setNote({ kind: 'info', tag: below ? 'a slip' : 'a splash', line: why });
  };
  const submit = () => {
    if (!prompt || S.anim) return;
    const r = scoreAnswer(prompt, answer);
    if (r.tier === 'unknown') {
      if (slack > 0) {
        setSlack(slack - 1);
        setNote({ kind: 'info', tag: `not in Froggy’s list · ${slack - 1} forgiven left`, line: `“${answer.trim()}” fizzled. Froggy only knows names that are written about — try another.` });
        setAnswer('');
        return;
      }
      return slip('Froggy could not place that, and the tongue went limp.');
    }
    const top = cfg.goal * PPM;
    const to = Math.min(top, S.frogY + Math.max(8, r.points) * PPM);
    const gain = Math.round((to - S.frogY) / PPM);
    const col = TIER_COLOR[r.tier] ?? TIER_COLOR.common;
    S.anim = { kind: 'soar', t0: S.t, from: S.frogY, to, apex: to + 150, ok: true, col };
    S.mood = 'bigSmile';
    setPrompt(null);
    tap('medium');
    setNote({ kind: 'rank', name: r.name ?? answer.trim(), tier: r.tier, rank: r.rank ?? 0, of: r.of, points: r.points, gain, rare: deepestOf(PROMPTS.find((p) => p.id === prompt.id)!, 3) });
  };

  const cv = useStage((c, W, H, dt, k) => {
    S.t += dt;
    const ppm = PPM;
    S.frogX = W / 2;
    const A = S.anim;
    let tipY: number | null = null;
    let frogDrawY = S.frogY;
    let squash = 1;
    let mouth: string | undefined;
    if (A) {
      const e = S.t - A.t0;
      if (A.kind === 'soar') {
        // the tongue goes up very high (and a long way past the lily it is aiming for), the frog follows it and lands
        const T1 = 1.05;
        const T2 = 0.7;
        if (e < T1) {
          tipY = A.from + 40 + (A.apex - A.from - 40) * ease.expo(e / T1);
          mouth = 'O';
          // sparks fly off the tip
          if (Math.random() < 0.9) S.sparks.push({ x: W / 2 + (Math.random() - 0.5) * 16, y: tipY, vx: (Math.random() - 0.5) * 90, vy: -30 - Math.random() * 60, t0: S.t, c: Math.random() < 0.5 ? '*' : '.' });
        } else if (e < T1 + T2) {
          const k2 = ease.inq((e - T1) / T2);
          frogDrawY = A.from + (A.to - A.from) * k2;
          tipY = A.apex - (A.apex - A.to) * k2 * 0.9;
          mouth = 'O';
        } else {
          frogDrawY = A.to;
          S.frogY = A.to;
          const born = S.t;
          const top = A.to / ppm >= cfg.goal;
          if (!top) S.lilies.push({ y: A.to, m: Math.round(A.to / ppm), born, x: 0, col: A.col });
          S.pops.push({ x: S.frogX, y: A.to + 60, t0: S.t, s: `+${Math.round((A.to - A.from) / ppm)} m`, col: A.col });
          S.anim = null;
          S.mood = top ? 'bigSmile' : 'happy';
          setM(Math.round(A.to / ppm));
          if (top) {
            S.winAt = S.t;
            if (!done.current) {
              done.current = true;
              setTimeout(() => onEnd(true, `Froggy reached the blossom at ${Math.round(A.to / ppm)} m.`), 2700);
            }
          } else setTimeout(() => !done.current && ask(), 1600);
        }
        if (e > T1 && e < T1 + T2 + 0.25) squash = 1;
        if (e >= T1 + T2) squash = 1 + 0.18 * Math.max(0, 1 - (e - T1 - T2) * 6);
      } else if (A.kind === 'slip' || A.kind === 'sink') {
        // the tongue wobbles up a little, goes limp, and Froggy drops
        if (e < 0.45) {
          tipY = A.from + 30 + 90 * ease.out(e / 0.45);
          mouth = '~';
        } else {
          const k2 = ease.inq(Math.min(1, (e - 0.45) / 0.55));
          frogDrawY = A.from + (A.to - A.from) * k2;
          if (A.kind === 'slip' && e >= 1) {
            S.frogY = A.to;
            S.anim = null;
            S.mood = 'worried';
            setM(Math.round(A.to / ppm));
            setTimeout(() => !done.current && ask(), 1100);
          }
          if (A.kind === 'sink' && e >= 1.4 && !done.current) {
            done.current = true;
            setTimeout(() => onEnd(false, `Froggy slipped at ${Math.round(S.frogY / ppm)} m with nothing to land on. The water is cold.`), 500);
          }
        }
      }
    }
    // the camera glides: it follows the tongue as it soars, otherwise the frog
    const want = (tipY !== null && A?.kind === 'soar' ? Math.max(frogDrawY, tipY - H * 0.15) : frogDrawY) - H * 0.34;
    S.cam += (want - S.cam) * Math.min(1, dt * (A?.kind === 'soar' ? 7 : 4));
    const Y = (y: number) => H - (y - S.cam);
    // the scene
    dust(c, k, W, H, S.cam);
    ruler(c, k, H, S.cam, ppm, cfg.goal + 20);
    water(c, k, W, Y(-4), H, S.t);
    reeds(c, k, W, Y(-4), H, S.t);
    blossom(c, k, W / 2, Y(cfg.goal * ppm), S.winAt < 0 ? 0 : (S.t - S.winAt) / 0.7, S.t);
    // the lilies: the newest is bright; older ones drift away and fade, but still hold if Froggy slips onto them
    S.lilies.forEach((l, i) => {
      const last = i === S.lilies.length - 1 && !(A?.kind === 'soar' && S.lilies.length - 1 === i && false);
      const age = Math.min(1, (S.t - l.born) / 0.5);
      const px = W / 2 + Math.sin(S.t * 0.5 + i * 1.7) * (i === 0 ? 0 : 7);
      if (i === 0) pad(c, k, px, Y(l.y), 104, 1, undefined);
      else if (A?.kind === 'soar' && i === S.lilies.length - 1 && S.t - A.t0 < 1.7) return;
      else pad(c, k, px, Y(l.y), 92, last ? 1 : 0.55, `${l.m} m`, 0.4 + 0.6 * ease.out(age) + (age < 1 ? Math.sin(age * 3) * 0.1 : 0), l.col);
    });
    // the tongue, going up
    if (tipY !== null) {
      const x = S.frogX;
      tongueLine(c, k, x, Y(frogDrawY) - 8, x + Math.sin(S.t * 30) * (A?.kind === 'slip' ? 8 : 1), Y(tipY), true, 7);
    }
    // sparks and numbers
    S.sparks = S.sparks.filter((p) => S.t - p.t0 < 0.9);
    for (const p of S.sparks) {
      const a = 1 - (S.t - p.t0) / 0.9;
      c.globalAlpha = a;
      text(c, p.c, p.x + p.vx * (S.t - p.t0), Y(p.y) - p.vy * (S.t - p.t0), A?.col ?? k.ink2, mono(14));
      c.globalAlpha = 1;
    }
    S.pops = S.pops.filter((p) => S.t - p.t0 < 1.4);
    for (const p of S.pops) {
      const e = S.t - p.t0;
      c.globalAlpha = clamp(1.4 - e, 0, 1);
      text(c, p.s, p.x + 54, Y(p.y) - e * 30, p.col ?? k.ink, mono(22));
      c.globalAlpha = 1;
    }
    // Froggy
    const under = A?.kind === 'sink' ? clamp(-frogDrawY / 55, 0, 1) : 0;
    const air = A?.kind === 'soar' && S.t - A.t0 > 1.05;
    c.globalAlpha = 1 - under * 0.9;
    frog(c, k, S.frogX, Y(frogDrawY) + 2, A?.kind === 'sink' && under > 0 ? 'dizzy' : S.mood, mouth, squash, air || A?.kind === 'slip' || A?.kind === 'sink' ? 'air' : 'sit');
    c.globalAlpha = 1;
    if (A?.kind === 'sink' && frogDrawY < 4) {
      const e = S.t - A.t0 - 0.9;
      c.fillStyle = CO.blue;
      c.globalAlpha = 0.18;
      c.fillRect(0, Y(-4) + 8, W, H);
      c.globalAlpha = 1;
      if (e > 0) {
        ripples(c, k, S.frogX, Y(-2), e);
        bubbles(c, k, S.frogX, Y(-6), e);
      }
    }
    if (S.winAt >= 0) {
      const e = S.t - S.winAt;
      confetti(c, S.frogX, Y(cfg.goal * ppm) - 40, Math.max(0, e - 0.1) * 0.75);
      if (e > 0.6) {
        c.globalAlpha = clamp((e - 0.6) * 2, 0, 1);
        text(c, 'the top!', W / 2, Y(cfg.goal * ppm) - 100, k.ink, mono(20));
        c.globalAlpha = 1;
      }
    }
  });

  return (
    <div className="stagebox deepbox">
      <div className="game-hud mono">
        <span>
          {m} m of {cfg.goal} m
        </span>
        <span>{slack < cfg.slack ? `${slack} forgiven left` : ''}</span>
        <span>{Math.round((m / cfg.goal) * 100)}%</span>
      </div>
      <div className="stage short">
        <canvas ref={cv} aria-label="Froggy's tongue soaring up from a lily pad" />
      </div>
      <div className="deep2">
        {prompt && (
          <>
            <div className="timer" key={prompt.id} style={{ animationDuration: `${cfg.seconds}s` }} onAnimationEnd={() => slip('Time ran out, and the tongue lost its grip.')} />
            <p className="tag mono">deep cut · the rarer, the higher</p>
            <h2>{prompt.q}</h2>
            <form
              className="ask-input"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <input autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="name something rare" autoCapitalize="words" enterKeyHint="send" />
              <button className="pill round sm" disabled={answer.trim().length < 2} aria-label="Fire the tongue">
                <Icon name="up" size={18} stroke={2.4} />
              </button>
            </form>
          </>
        )}
        {note?.kind === 'rank' && <RankCard n={note} />}
        {note?.kind === 'info' && (
          <div className="deep-note">
            <span className="tag mono">{note.tag}</span>
            <p>{note.line}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ the start: Froggy on the first lily, looking up at the two ways
export function Pick({ onPick, levels }: { onPick: (v: 'sling' | 'deep') => void; levels: { sling: number; deep: number } }) {
  const box = useRef<HTMLDivElement>(null);
  const cards = useRef<Record<string, HTMLButtonElement | null>>({});
  const S = useRef({ t: 0, shot: null as null | { v: 'sling' | 'deep'; x: number; y: number; t0: number } }).current;
  const go = (v: 'sling' | 'deep') => {
    if (S.shot) return;
    const b = box.current!.getBoundingClientRect();
    const r = cards.current[v]!.getBoundingClientRect();
    S.shot = { v, x: r.left - b.left + r.width / 2, y: r.top - b.top + r.height - 6, t0: S.t };
    tap('medium');
    setTimeout(() => onPick(v), 650);
  };
  const cv = useStage((c, W, H, dt, k) => {
    S.t += dt;
    const Y = (y: number) => H - (y + 110); // the same picture as the start of the sling game
    dust(c, k, W, H, -110);
    water(c, k, W, Y(0), H, S.t);
    reeds(c, k, W, Y(0), H, S.t);
    pad(c, k, W / 2, Y(18), 120);
    const fx = W / 2;
    const fy = Y(46) + 4;
    const sh = S.shot;
    const e = sh ? S.t - sh.t0 : 0;
    // the little chevrons that say "look up"
    if (!sh) {
      for (let i = 0; i < 3; i++) {
        c.globalAlpha = 0.25 + 0.55 * Math.max(0, Math.sin(S.t * 3 - i * 0.9));
        text(c, '^', fx, fy - 70 - i * 20, TIER_COLOR.known, mono(15));
      }
      c.globalAlpha = 1;
    }
    if (sh) {
      const k1 = ease.out(clamp(e / 0.28, 0, 1));
      const k2 = e > 0.3 ? ease.io(clamp((e - 0.3) / 0.3, 0, 1)) : 0;
      const len = k1 * (1 - k2);
      tongueLine(c, k, fx, fy - 6, fx + (sh.x - fx) * len, fy - 6 + (sh.y - (fy - 6)) * len);
    }
    const blink = Math.sin(S.t * 1.7) > 0.985;
    frog(c, k, fx, fy, sh ? (e > 0.28 ? 'bigSmile' : 'surprised') : blink ? 'wink' : 'neutral', sh && e < 0.3 ? 'O' : undefined, 1, 'sit');
  });
  const ways: { id: 'sling' | 'deep'; title: string; sub: string; art: string }[] = [
    { id: 'sling', title: 'Sling', sub: 'pull back, aim, swing from fly to fly', art: '\\x/    /x\\\n  (@)--\\x/' },
    { id: 'deep', title: 'Deep cuts', sub: 'name something rare — rarer is higher', art: '  .--.\n ( ?? )\n  `--´' },
  ];
  return (
    <div className="stagebox">
      <div className="game-hud mono">
        <span>Froggy has to get up</span>
        <span />
        <span>pick a way</span>
      </div>
      <div className="stage" ref={box}>
        <canvas ref={cv} aria-label="Froggy on a lily pad, looking up at two cards" />
        <div className="pickcards">
          {ways.map((w) => (
            <button key={w.id} ref={(el) => void (cards.current[w.id] = el)} className="pickcard" onClick={() => go(w.id)}>
              <pre className="mono" aria-hidden>
                {w.art}
              </pre>
              <b>{w.title}</b>
              <small>{w.sub}</small>
              <span className="mono">level {levels[w.id]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
