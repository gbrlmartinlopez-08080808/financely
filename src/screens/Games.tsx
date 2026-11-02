import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dayKey, earnBlock, freezeStatus, useStore } from '../lib/store';
import { climbLevel, getLevels, liftFor, rng, setLevels, spendTry, SLING_LIFT, triesLeft, TRIES_PER_DAY } from '../lib/games';
import { deepestOf, PROMPTS, scoreAnswer, type Prompt, type Scored } from '../data/deepcuts';
import { froggyFace, type Mood } from '../lib/froggy';
import { onBack, tap } from '../lib/native';
import { Icon } from '../ui/Icon';
import { Froggy } from '../ui/Froggy';
import { toast } from '../ui/kit';

const dayNo = () => Math.floor(Date.now() / 864e5);

/**
 * The five blocks on the way to a freeze day. The first four are lily-pad tiles that fill with the colours of the app icon;
 * the fifth is the freeze day itself, a crystal that lights up when the others are full.
 */
export function Blocks({ n, big = false, fresh = -1 }: { n: number; big?: boolean; fresh?: number }) {
  return (
    <span className={`blocks5${big ? ' big' : ''}`} role="img" aria-label={`${n} of 5 blocks toward a freeze day`}>
      {[0, 1, 2, 3].map((i) => (
        <i key={i} className={`${i < n ? 'on' : ''}${i === fresh ? ' fresh' : ''}`} />
      ))}
      <i className={`ice${n >= 4 ? ' near' : ''}${fresh === 4 ? ' fresh on' : ''}`}>
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M9 4.5l3 2.5 3-2.5M9 19.5l3-2.5 3 2.5" />
        </svg>
      </i>
    </span>
  );
}

/** The Play tab: the blocks, the freeze day, and the game. */
export function Play() {
  const freeze = useStore((s) => s.freeze);
  const fz = freezeStatus(freeze);
  const [level, setLevel] = useState(1);
  const [tries, setTries] = useState(TRIES_PER_DAY);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    getLevels().then((l) => setLevel(l.climb));
    triesLeft().then(setTries);
  }, [open]);
  const won = freeze.blockDay === dayKey();
  return (
    <div className="int-scroll">
      <div className="tcard play-hero">
        <div className="play-top">
          <Froggy mood={won ? 'smug' : 'happy'} size="sm" />
          <div>
            <b>Four blocks, then a freeze day</b>
            <span className="mono">the fifth block is the freeze itself</span>
          </div>
        </div>
        <Blocks n={Math.min(4, fz.blocks)} big />
        <p className="mono">
          {fz.blocks}/5 · {won ? 'today’s block is won — another tomorrow' : 'reach the top once to earn today’s block'}
        </p>
        <div className="play-freeze">
          <span>
            <b>{fz.available}</b> freeze day{fz.available === 1 ? '' : 's'} ready
          </span>
          <small className="mono">
            {fz.weekly ? 'your free one is ready (it comes back 15 days after you use it)' : `your free one is back in ${fz.back} day${fz.back === 1 ? '' : 's'}`}
            {fz.bonus > 0 ? ` · +${fz.bonus} won` : ''}
          </small>
        </div>
      </div>

      <button className="tcard game-card" disabled={tries <= 0} onClick={() => (tap('select'), setOpen(true))}>
        <pre className="game-art" aria-hidden>{`      \\|/\n     (*)  ~ x\n  _(____)_\n (@) (@)\n (  v  )  ~~~`}</pre>
        <span className="tag mono">
          lily climb · level {level} · {tries > 0 ? `${tries} of ${TRIES_PER_DAY} tries left today` : 'no tries left today'}
        </span>
        <h3>Climb the lily</h3>
        <p>Froggy sits on a lily pad in the water and has to get up. Sling the tongue at passing flies — fast, but a miss can end in a fall — or answer a deep-cut prompt: the rarer your answer, the higher it climbs.</p>
        <span className="more mono">{tries > 0 ? 'play →' : 'come back tomorrow'}</span>
      </button>
      <p className="int-foot mono">· · ·{'\n'}two tries a day · reach the top for a block</p>
      {open && <Climb level={level} onClose={() => setOpen(false)} />}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ the climb
const W = 30;
const VH = 19;
const FR = 13; // the screen row the frog's feet are on
const FX = 14;
type Phase = 'choose' | 'sling' | 'prompt' | 'hop' | 'fall' | 'over';
interface Tongue {
  tx: number;
  ty: number;
  f: number;
  done: boolean;
}
interface Fly {
  x: number;
  y: number;
  vx: number;
  ph: number;
  bee: boolean;
}

/** the picture: the water, the reeds, the lily pads, the blossom at the top, and Froggy */
function scene(o: { h: number; goal: number; mood: Mood; mouth?: string; flies?: Fly[]; tongue?: Tongue | null; splash?: boolean; t: number }): string {
  const g: string[][] = Array.from({ length: VH }, () => Array(W).fill(' '));
  const put = (x: number, y: number, c: string) => {
    const xx = Math.round(x),
      yy = Math.round(y);
    if (xx >= 0 && xx < W && yy >= 0 && yy < VH && c !== ' ') g[yy][xx] = c;
  };
  const text = (x: number, y: number, s: string) => [...s].forEach((c, i) => put(x + i, y, c));
  const row = (world: number) => FR - (world - o.h); // world height → screen row
  // reeds on both sides, with a leaf now and then
  for (let w = Math.floor(o.h) - FR - 1; w < o.h + VH; w++) {
    const y = row(w);
    if (y < 0 || y >= VH || w < 0) continue;
    put(1, y, '|');
    put(W - 2, y, '|');
    if (w % 5 === 2) text(2, y, '/');
    if (w % 7 === 3) text(W - 4, y, '\\');
  }
  // lily pads up the way (the one under Froggy comes with it)
  for (let w = 0; w <= o.goal; w += 3) {
    const y = row(w);
    const x = 4 + ((w * 7 + 5) % 17);
    if (y >= 0 && y < VH && Math.abs(w - o.h) > 2.5) text(x, y, '(____)');
  }
  // the blossom at the top
  const gy = row(o.goal);
  if (gy > -3 && gy < VH + 1) {
    text(FX - 3, gy - 2, ' \\ | / ');
    text(FX - 3, gy - 1, '-- (*) --');
    text(FX - 3, gy, '  \\_|_/  ');
  }
  // the water below
  for (let y = row(0) + 1; y < VH; y++) {
    if (y < 0) continue;
    for (let x = 0; x < W; x++) put(x, y, (x + y + Math.floor(o.t * 2)) % 4 === 0 ? '~' : (x * 3 + y) % 5 === 0 ? '≈' : ' ');
  }
  // flies, bees and the tongue
  for (const f of o.flies ?? []) {
    if (f.bee) {
      const up = Math.sin(f.ph) > 0;
      put(f.x - 1, f.y, up ? '=' : '-');
      put(f.x, f.y, 'B');
      put(f.x + 1, f.y, up ? '=' : '-');
    } else {
      const up = Math.sin(f.ph) > 0;
      put(f.x - 1, f.y, up ? '\\' : '/');
      put(f.x, f.y, 'x');
      put(f.x + 1, f.y, up ? '/' : '\\');
    }
  }
  if (o.tongue) {
    const { tx, ty, f } = o.tongue;
    const k = f < 3 ? f / 3 : Math.max(0, 1 - (f - 3) / 3);
    const n = Math.max(Math.abs(tx - FX), Math.abs(ty - (FR - 1)), 1);
    for (let i = 1; i <= n * k; i++) put(FX + ((tx - FX) * i) / n, FR - 1 + ((ty - (FR - 1)) * i) / n, i >= n * k - 0.5 ? '@' : '~');
  }
  // Froggy on his pad
  const fy = o.splash ? row(o.h) : FR;
  if (!o.splash) text(FX - 4, fy + 1, '(_______)');
  froggyFace(o.mood, { mouth: o.mouth }).split('\n').forEach((line, i) => text(FX - 4, fy - 2 + i, line));
  if (o.splash) text(FX - 4, fy + 1, ' ~ . ~ . ~ ');
  return g.map((r) => r.join('')).join('\n');
}

function Climb({ level, onClose }: { level: number; onClose: () => void }) {
  const C = useMemo(() => climbLevel(level), [level]);
  const [lvl, setLvl] = useState(level);
  const [run, setRun] = useState(0);
  const [tries, setTries] = useState(0);
  const [result, setResult] = useState<null | { win: boolean; text: string; block?: string; fresh: number; freeze: boolean }>(null);
  // a try is spent the moment a climb starts
  const spent = useRef(-1);
  useEffect(() => {
    if (spent.current === run || result) return;
    spent.current = run;
    spendTry().then(setTries);
  }, [run, result]);
  useEffect(() => onBack(() => (onClose(), true)), [onClose]);

  const finish = useCallback(
    async (win: boolean, text: string) => {
      let block: string | undefined;
      let fresh = -1;
      let freeze = false;
      if (win) {
        const l = await getLevels();
        await setLevels({ climb: l.climb + 1 });
        setLvl(l.climb + 1);
        const before = freezeStatus().blocks;
        const r = earnBlock();
        if (r.ok) {
          freeze = r.freeze;
          fresh = r.freeze ? 4 : before;
          block = r.freeze ? 'Four blocks and the crystal — you won a freeze day.' : `A block for your freeze day · ${r.blocks}/5`;
          if (r.freeze) toast('You won a freeze day', 'award');
        } else block = r.reason;
      }
      setResult({ win, text, block, fresh, freeze });
    },
    [],
  );
  const again = async () => {
    if ((await triesLeft()) <= 0) return;
    setResult(null);
    setRun((n) => n + 1);
  };
  return (
    <div className="game" role="dialog" aria-label="Lily climb">
      <header>
        <button className="game-x" onClick={onClose} aria-label="Close the game">
          <Icon name="back" size={22} />
        </button>
        <b>Lily climb</b>
        <span className="mono">
          level {lvl} · {tries} left today
        </span>
      </header>
      {!result && <Ascent key={run} C={C} level={lvl} onEnd={finish} />}
      {result && (
        <div className="game-end">
          <Froggy mood={result.win ? 'bigSmile' : 'sad'} size="lg" />
          <h2>{result.win ? 'At the top' : 'Into the water'}</h2>
          <p>{result.text}</p>
          {result.freeze && <div className="freeze-card">A freeze day is yours — it keeps a streak alive over a missed day.</div>}
          {result.block && <p className="blockmsg mono">{result.block}</p>}
          <Blocks n={Math.min(4, freezeStatus().blocks)} fresh={result.fresh} big />
          <div className="det-act" style={{ justifyContent: 'center' }}>
            <button className="pill" onClick={again} disabled={tries <= 0}>
              {tries > 0 ? (result.win ? `Climb level ${lvl}` : 'Try again') : 'No tries left today'}
            </button>
            <button className="pill ghost" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Ascent({ C, level, onEnd }: { C: ReturnType<typeof climbLevel>; level: number; onEnd: (win: boolean, text: string) => void }) {
  const [h, setH] = useState(0); // rows climbed (what is shown glides toward this)
  const [shown, setShown] = useState(0);
  const [grip, setGrip] = useState(C.grip);
  const [phase, setPhase] = useState<Phase>('choose');
  const [mood, setMood] = useState<Mood>('neutral');
  const [view, setView] = useState('');
  const [say, setSay] = useState('Pick a way up.');
  const st = useRef({ h: 0, shown: 0, grip: C.grip, flies: [] as Fly[], tongue: null as Tongue | null, splash: false, mood: 'neutral' as Mood, t: 0, slack: C.slack, seed: rng(level * 977 + dayNo()), used: [] as string[], over: false });
  const pre = useRef<HTMLPreElement>(null);

  // the picture is redrawn about 25 times a second; the climb glides rather than jumps
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let draw = 0;
    const loop = (now: number) => {
      const s = st.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      s.t += dt;
      const d = s.h - s.shown;
      if (Math.abs(d) > 0.02) s.shown += d * Math.min(1, dt * 7);
      else s.shown = s.h;
      if (now - draw > 38) {
        draw = now;
        setView(scene({ h: s.shown, goal: C.goal, mood: s.mood, mouth: s.tongue ? 'O' : undefined, flies: s.flies, tongue: s.tongue, splash: s.splash, t: s.t }));
        setShown(s.shown);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [C.goal]);

  const face = (m: Mood, ms = 700) => {
    st.current.mood = m;
    setMood(m);
    if (ms) setTimeout(() => !st.current.over && ((st.current.mood = 'neutral'), setMood('neutral')), ms);
  };
  const climb = (rows: number) => {
    const s = st.current;
    s.h = Math.min(C.goal, s.h + rows);
    setH(s.h);
  };
  const fall = () => {
    const s = st.current;
    s.over = true;
    s.mood = 'surprised';
    setPhase('fall');
    setSay('The grip gives out…');
    const from = s.h;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 1100);
      s.h = from - (from + 4) * k * k;
      if (k < 1) requestAnimationFrame(step);
      else {
        s.splash = true;
        s.mood = 'dizzy';
        setTimeout(() => onEnd(false, `It slipped at ${Math.round(from)} of ${C.goal} rows. The water is cold.`), 900);
      }
    };
    requestAnimationFrame(step);
  };
  const settle = (after: () => void) => {
    // let the climb glide, then decide what comes next
    setPhase('hop');
    setTimeout(() => {
      const s = st.current;
      if (s.over) return;
      if (s.h >= C.goal) {
        s.over = true;
        face('bigSmile', 0);
        setTimeout(() => onEnd(true, `Froggy reached the blossom after ${s.used.length} prompt${s.used.length === 1 ? '' : 's'} and some flies.`), 600);
      } else after();
    }, 650);
  };
  const lose = (why: string) => {
    const s = st.current;
    s.grip -= 1;
    setGrip(s.grip);
    face('worried', 900);
    if (s.grip <= 0) return fall();
    setSay(why);
    settle(() => (setPhase('choose'), setSay('Pick a way up.')));
  };

  // ---------------------------------------------------------------------------- sling the tongue
  const startSling = () => {
    const s = st.current;
    const r = s.seed;
    setPhase('sling');
    setSay('Tap the fly!');
    const bee = r() < C.bees;
    const left = r() < 0.5;
    const speed = (W + 6) / C.window;
    s.flies = [{ x: left ? -2 : W + 2, y: FR - 8 + Math.floor(r() * 4), vx: (left ? 1 : -1) * speed, ph: 0, bee: false }];
    if (bee) s.flies.push({ x: left ? -9 : W + 9, y: FR - 6 + Math.floor(r() * 4), vx: (left ? 1 : -1) * speed * 0.9, ph: 2, bee: true });
    let last = performance.now();
    const t0 = last;
    let raf = 0;
    const tick = (now: number) => {
      if (s.over || s.flies.length === 0) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      for (const f of s.flies) {
        f.x += f.vx * dt;
        f.ph += dt * 24;
        f.y += Math.sin(f.ph / 5) * 0.03;
      }
      if (s.tongue) {
        s.tongue.f += dt * 26;
        if (s.tongue.f >= 6) s.tongue = null;
        else if (s.tongue.f >= 3 && !s.tongue.done) {
          s.tongue.done = true;
          const { tx, ty } = s.tongue;
          // judged where the fly was when the finger came down, with a little to spare: the tongue's trip is not held against the player
          const hit = s.flies.find((f) => Math.abs(f.x - f.vx * 0.12 - tx) <= 2.8 && Math.abs(f.y - ty) <= 1.8);
          if (hit) {
            s.flies = [];
            if (hit.bee) {
              cancelAnimationFrame(raf);
              s.tongue = null;
              return lose('A bee! That stings.');
            }
            cancelAnimationFrame(raf);
            face('happy', 800);
            climb(SLING_LIFT);
            setSay('Got it — up it goes.');
            return settle(() => (setPhase('choose'), setSay('Pick a way up.')));
          }
        }
      }
      const out = s.flies.every((f) => (f.vx > 0 ? f.x > W + 3 : f.x < -3));
      if (out || now - t0 > (C.window + 1.4) * 1000) {
        s.flies = [];
        s.tongue = null;
        return lose('Too slow — it got away.');
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };
  const shoot = (e: React.PointerEvent) => {
    const s = st.current;
    if (phase !== 'sling' || s.tongue || !pre.current) return;
    const r = pre.current.getBoundingClientRect();
    const tx = Math.floor(((e.clientX - r.left) / r.width) * W);
    const ty = Math.floor(((e.clientY - r.top) / r.height) * VH);
    s.tongue = { tx, ty: Math.min(ty, FR - 2), f: 0, done: false };
    tap('select');
  };

  // ---------------------------------------------------------------------------- the deep-cut prompts
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [answer, setAnswer] = useState('');
  const [shownScore, setShownScore] = useState<(Scored & { lift: number }) | null>(null);
  const [slack, setSlack] = useState(C.slack);
  const startPrompt = () => {
    const s = st.current;
    const left = PROMPTS.filter((p) => !s.used.includes(p.id));
    const p = left[Math.floor(s.seed() * left.length)] ?? PROMPTS[0];
    setPrompt(p);
    setAnswer('');
    setShownScore(null);
    setPhase('prompt');
    setSay('The rarer the answer, the higher you go.');
  };
  const submit = () => {
    if (!prompt || shownScore) return;
    const r = scoreAnswer(prompt, answer);
    const s = st.current;
    if (r.tier === 'unknown') {
      // not in the list: forgiven a few times, then it costs grip
      if (slack > 0) {
        setSlack(slack - 1);
        setSay(`“${answer.trim()}” is not in Froggy’s list — it only knows well-written-about names. Try another (${slack - 1} forgiven left).`);
        setAnswer('');
        return;
      }
      s.used.push(prompt.id);
      setPrompt(null);
      return lose('Froggy could not place that answer.');
    }
    const lift = liftFor(r.points);
    setSay('');
    s.used.push(prompt.id);
    setShownScore({ ...r, lift });
    face(r.points >= 75 ? 'bigSmile' : r.points >= 50 ? 'happy' : 'neutral', 900);
    climb(lift);
    tap('medium');
  };
  const afterPrompt = () => {
    setPrompt(null);
    setShownScore(null);
    settle(() => (setPhase('choose'), setSay('Pick a way up.')));
  };

  const pct = Math.round((shown / C.goal) * 100);
  return (
    <div className="climb">
      <div className="game-hud mono">
        <span>
          {Math.round(h)} / {C.goal} rows
        </span>
        <span>grip {'●'.repeat(Math.max(0, grip))}{'○'.repeat(Math.max(0, C.grip - grip))}</span>
        <span>{pct}%</span>
      </div>
      <div className="climb-bar" aria-hidden>
        <i style={{ width: `${pct}%` }} />
      </div>
      <pre ref={pre} className={`frog-field${phase === 'sling' ? ' live' : ''}`} onPointerDown={shoot} aria-label="Froggy on a lily pad, climbing">
        {view}
      </pre>
      <p className="game-say mono">{say}</p>

      {phase === 'choose' && (
        <div className="ways">
          <button onClick={startSling}>
            <b>Sling the tongue</b>
            <span>+{SLING_LIFT} rows if you catch the fly · a miss costs grip</span>
          </button>
          <button onClick={startPrompt}>
            <b>Answer a prompt</b>
            <span>name something rare · up to +5 rows, no risk</span>
          </button>
        </div>
      )}

      {phase === 'prompt' && prompt && (
        <div className="deep">
          <h2>{prompt.q}</h2>
          {!shownScore ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <input autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="the rarer, the higher" autoCapitalize="words" enterKeyHint="go" />
              <button className="pill" disabled={answer.trim().length < 2}>
                Lift
              </button>
            </form>
          ) : (
            <div className="deep-result">
              <div className={`tier ${shownScore.tier.replace(' ', '-')}`}>{shownScore.tier}</div>
              <p>
                <b>{shownScore.name}</b> is number {shownScore.rank} of {shownScore.of} in how often it turns up in print — worth <b>{shownScore.points}</b> points, so Froggy climbs <b>{shownScore.lift}</b> row{shownScore.lift === 1 ? '' : 's'}.
              </p>
              <p className="mono dim">the rarest ones: {deepestOf(prompt).join(' · ')}</p>
              <button className="pill" onClick={afterPrompt}>
                Keep climbing
              </button>
            </div>
          )}
          {!shownScore && (
            <button className="back mono" onClick={() => (setPrompt(null), setPhase('choose'), setSay('Pick a way up.'))}>
              ← choose another way
            </button>
          )}
        </div>
      )}
      <Fragment />
    </div>
  );
}
