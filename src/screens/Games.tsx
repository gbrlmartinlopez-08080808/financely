import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dayKey, earnBlock, freezeStatus, useStore } from '../lib/store';
import { frogLevel, getLevels, mindLevel, rng, setLevels, type GameKind, type Levels, type Question } from '../lib/games';
import { froggyFace, type Mood } from '../lib/froggy';
import { onBack, tap } from '../lib/native';
import { Icon } from '../ui/Icon';
import { Froggy } from '../ui/Froggy';
import { toast } from '../ui/kit';

const dayNo = () => Math.floor(Date.now() / 864e5);

/** the five blocks on the way to a freeze day */
export function Blocks({ n, big = false }: { n: number; big?: boolean }) {
  return (
    <span className={`blocks5${big ? ' big' : ''}`} aria-label={`${n} of 5 blocks`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} className={i < n ? 'on' : ''} />
      ))}
    </span>
  );
}

/** The Play tab: the blocks, the freeze day, and the two games. */
export function Play() {
  const freeze = useStore((s) => s.freeze);
  const fz = freezeStatus(freeze);
  const [lv, setLv] = useState<Levels | null>(null);
  const [game, setGame] = useState<GameKind | null>(null);
  useEffect(() => {
    getLevels().then(setLv);
  }, [game]);
  const today = freeze.blockDay === dayKey();
  return (
    <div className="int-scroll">
      <div className="tcard play-hero">
        <div className="play-top">
          <Froggy mood={today ? 'smug' : 'happy'} size="sm" />
          <div>
            <b>Win blocks, keep your streak</b>
            <span className="mono">five blocks make one freeze day</span>
          </div>
        </div>
        <Blocks n={fz.blocks} big />
        <p className="mono">
          {fz.blocks}/5 blocks · {today ? 'today’s block is won — come back tomorrow' : 'win a level to earn today’s block'}
        </p>
        <div className="play-freeze">
          <span>
            <b>{fz.available}</b> freeze day{fz.available === 1 ? '' : 's'} ready
          </span>
          <small className="mono">{fz.weekly ? 'your free one is ready (it comes back 15 days after you use it)' : `your free one is back in ${fz.back} day${fz.back === 1 ? '' : 's'}`}{fz.bonus > 0 ? ` · +${fz.bonus} won` : ''}</small>
        </div>
      </div>

      <button className="tcard game-card" onClick={() => (tap('select'), setGame('frog'))}>
        <pre className="game-art" aria-hidden>{`  x  ~    *\n     (@) (@)\n     ( \\_/ )   x`}</pre>
        <span className="tag mono">frog game · level {lv?.frog ?? 1}</span>
        <h3>Fly catch</h3>
        <p>Tap the flies to flick Froggy’s tongue at them. Beat the clock, and watch out for the bees.</p>
        <span className="more mono">play →</span>
      </button>

      <button className="tcard game-card" onClick={() => (tap('select'), setGame('mind'))}>
        <pre className="game-art" aria-hidden>{`  2, 4, 8, 16, ?\n  ( @ ) ( @ )\n  (  ~~~  )   = 32`}</pre>
        <span className="tag mono">knowledge game · level {lv?.mind ?? 1}</span>
        <h3>Brain teasers</h3>
        <p>Five questions a level: facts, patterns, sums and the odd one out. Every level is a new set, and a little harder.</p>
        <span className="more mono">play →</span>
      </button>
      <p className="int-foot mono">· · ·{'\n'}one block a day · five blocks = one freeze day</p>
      {game && <GameShell kind={game} level={lv?.[game] ?? 1} onClose={() => setGame(null)} />}
    </div>
  );
}

/** what happens when a level is won: the block, the next level */
async function won(kind: GameKind) {
  const lv = await getLevels();
  lv[kind] += 1;
  await setLevels(lv);
  return earnBlock();
}

function GameShell({ kind, level, onClose }: { kind: GameKind; level: number; onClose: () => void }) {
  const [lvl, setLvl] = useState(level);
  const [round, setRound] = useState(0);
  const [result, setResult] = useState<null | { win: boolean; text: string; block?: string }>(null);
  useEffect(() => onBack(() => (onClose(), true)), [onClose]);
  const finish = useCallback(
    async (win: boolean, text: string) => {
      let block: string | undefined;
      if (win) {
        const r = await won(kind);
        block = r.ok ? (r.freeze ? 'Five blocks — you won a freeze day!' : `A block for your freeze day · ${r.blocks}/5`) : r.reason;
        if (r.freeze) toast('You won a freeze day', 'award');
        setLvl((l) => l + 1);
      }
      setResult({ win, text, block });
    },
    [kind],
  );
  const again = () => {
    setResult(null);
    setRound((n) => n + 1);
  };
  return (
    <div className="game" role="dialog" aria-label={kind === 'frog' ? 'Fly catch' : 'Brain teasers'}>
      <header>
        <button className="game-x" onClick={onClose} aria-label="Close the game">
          <Icon name="back" size={22} />
        </button>
        <b>{kind === 'frog' ? 'Fly catch' : 'Brain teasers'}</b>
        <span className="mono">level {lvl}</span>
      </header>
      {!result && (kind === 'frog' ? <FrogGame key={round} level={lvl} onEnd={finish} /> : <MindGame key={round} level={lvl} onEnd={finish} />)}
      {result && (
        <div className="game-end">
          <Froggy mood={result.win ? 'bigSmile' : 'sad'} size="lg" />
          <h2>{result.win ? 'Level cleared' : 'Not this time'}</h2>
          <p>{result.text}</p>
          {result.block && <p className="blockmsg mono">{result.block}</p>}
          <Blocks n={freezeStatus().blocks} big />
          <div className="det-act" style={{ justifyContent: 'center' }}>
            <button className="pill" onClick={again}>
              {result.win ? `Level ${lvl}` : 'Try again'}
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

// ------------------------------------------------------------------------------------------------ fly catch
const W = 30;
const H = 20;
interface Bug {
  x: number;
  y: number;
  vx: number;
  bee: boolean;
  ph: number;
  hit?: number;
}
function FrogGame({ level, onEnd }: { level: number; onEnd: (win: boolean, text: string) => void }) {
  const L = useMemo(() => frogLevel(level), [level]);
  const pre = useRef<HTMLPreElement>(null);
  const [view, setView] = useState('');
  const [hud, setHud] = useState({ got: 0, lives: L.lives, left: L.seconds });
  const st = useRef({ bugs: [] as Bug[], got: 0, lives: L.lives, t: 0, tongue: null as null | { tx: number; ty: number; f: number; caught: boolean }, mood: 'neutral' as Mood, moodT: 0, done: false, seed: rng(level * 131 + dayNo()), flash: '' });

  useEffect(() => {
    const s = st.current;
    let raf = 0;
    let last = performance.now();
    let draw = 0;
    const FX = 14;
    const FY = H - 5; // where the tongue starts (the frog's mouth)
    const spawn = () => {
      const r = s.seed;
      const fromLeft = r() < 0.5;
      s.bugs.push({ x: fromLeft ? -2 : W + 1, y: 1 + r() * (H - 10), vx: (fromLeft ? 1 : -1) * L.speed * (0.7 + r() * 0.6), bee: r() < L.bees, ph: r() * 6 });
    };
    const end = (win: boolean) => {
      if (s.done) return;
      s.done = true;
      cancelAnimationFrame(raf);
      onEnd(win, win ? `You caught ${s.got} flies with ${Math.max(0, L.seconds - Math.round(s.t))} seconds to spare.` : s.lives <= 0 ? 'Too many bees — they do not taste good.' : `Time ran out with ${s.got} of ${L.target}. Froggy is still hungry.`);
    };
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      s.t += dt;
      while (s.bugs.length < L.flies) spawn();
      for (const b of s.bugs) {
        b.x += b.vx * dt;
        b.ph += dt * 6;
      }
      s.bugs = s.bugs.filter((b) => b.x > -4 && b.x < W + 4 && !(b.hit && now - b.hit > 200));
      if (s.tongue) {
        s.tongue.f += dt * 28;
        if (s.tongue.f >= 6) s.tongue = null;
        else if (s.tongue.f >= 3 && !s.tongue.caught) {
          // the tip is out: whatever is there is caught
          const { tx, ty } = s.tongue;
          for (const b of s.bugs) {
            if (!b.hit && Math.abs(b.x - tx) <= 2 && Math.abs(b.y - ty) <= 1.3) {
              b.hit = now;
              if (b.bee) {
                s.lives--;
                s.mood = 'angry';
                s.flash = 'bzzz!';
              } else {
                s.got++;
                s.mood = 'happy';
                s.flash = '+1';
              }
              s.moodT = now + 450;
            }
          }
          s.tongue.caught = true;
        }
      }
      if (s.moodT && now > s.moodT) (s.mood = 'neutral'), (s.moodT = 0), (s.flash = '');
      if (s.got >= L.target) return end(true);
      if (s.lives <= 0 || s.t >= L.seconds) return end(false);
      if (now - draw > 40) {
        draw = now;
        const g: string[][] = Array.from({ length: H }, () => Array(W).fill(' '));
        const put = (x: number, y: number, c: string) => {
          const xx = Math.round(x), yy = Math.round(y);
          if (xx >= 0 && xx < W && yy >= 0 && yy < H) g[yy][xx] = c;
        };
        for (let i = 0; i < 8; i++) put((i * 11 + 3) % W, (i * 5) % (H - 8), '.');
        for (const b of s.bugs) {
          if (b.hit) put(b.x, b.y, b.bee ? 'X' : '*');
          else if (b.bee) {
            put(b.x - 1, b.y, Math.sin(b.ph) > 0 ? '=' : '-');
            put(b.x, b.y, 'B');
            put(b.x + 1, b.y, Math.sin(b.ph) > 0 ? '=' : '-');
          } else {
            put(b.x - 1, b.y, Math.sin(b.ph) > 0 ? '\\' : '/');
            put(b.x, b.y, 'x');
            put(b.x + 1, b.y, Math.sin(b.ph) > 0 ? '/' : '\\');
          }
        }
        if (s.tongue) {
          const { tx, ty, f } = s.tongue;
          const k = f < 3 ? f / 3 : Math.max(0, 1 - (f - 3) / 3);
          const n = Math.max(Math.abs(tx - FX), Math.abs(ty - FY), 1);
          for (let i = 1; i <= n * k; i++) put(FX + ((tx - FX) * i) / n, FY + ((ty - FY) * i) / n, i >= n * k - 0.5 ? '@' : '~');
        }
        const face = froggyFace(s.mood, { mouth: s.tongue ? 'O' : undefined }).split('\n');
        face.forEach((row, i) => [...row].forEach((c, j) => c !== ' ' && put(FX - 4 + j, H - 4 + i, c)));
        for (let x = 0; x < W; x++) g[H - 1][x] = '~';
        setView(g.map((r) => r.join('')).join('\n'));
        setHud({ got: s.got, lives: s.lives, left: Math.max(0, Math.ceil(L.seconds - s.t)) });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      s.done = true;
      cancelAnimationFrame(raf);
    };
  }, [L, onEnd]);

  const shoot = (e: React.PointerEvent) => {
    const el = pre.current;
    const s = st.current;
    if (!el || s.tongue || s.done) return;
    const r = el.getBoundingClientRect();
    const tx = Math.floor(((e.clientX - r.left) / r.width) * W);
    const ty = Math.floor(((e.clientY - r.top) / r.height) * H);
    s.tongue = { tx, ty: Math.min(ty, H - 6), f: 0, caught: false };
    tap('select');
  };
  return (
    <div className="frog-game">
      <div className="game-hud mono">
        <span>
          caught {hud.got}/{L.target}
        </span>
        <span>{'● '.repeat(hud.lives).trim() || '–'}</span>
        <span>{hud.left}s</span>
      </div>
      <pre ref={pre} className="frog-field" onPointerDown={shoot} aria-label="Tap the flies to catch them">
        {view}
      </pre>
      <p className="game-tip mono">tap a fly to flick the tongue there · {L.bees ? 'leave the bees (B) alone' : 'the faster ones come later'}</p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ brain teasers
function MindGame({ level, onEnd }: { level: number; onEnd: (win: boolean, text: string) => void }) {
  const qs = useMemo<Question[]>(() => mindLevel(level, dayNo()), [level]);
  const [i, setI] = useState(0);
  const [pick, setPick] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const q = qs[i];
  const answer = (k: number) => {
    if (pick !== null) return;
    setPick(k);
    tap(k === q.a ? 'medium' : 'select');
    if (k === q.a) setScore((s) => s + 1);
  };
  const next = () => {
    if (i + 1 < qs.length) {
      setI(i + 1);
      setPick(null);
    } else {
      const ok = score >= 4;
      onEnd(ok, ok ? `${score} of ${qs.length} right.` : `${score} of ${qs.length} right — you need 4 to clear a level. A new set of questions is waiting.`);
    }
  };
  const face: Mood = pick === null ? 'neutral' : pick === q.a ? 'bigSmile' : 'worried';
  return (
    <div className="mind-game">
      <div className="game-hud mono">
        <span>
          question {i + 1}/{qs.length}
        </span>
        <span>{score} right</span>
        <span>need 4</span>
      </div>
      <div className="mind-q">
        <Froggy mood={face} size="sm" />
        <h2 key={i}>{q.q}</h2>
      </div>
      <div className="mind-opts">
        {q.options.map((o, k) => (
          <button key={k} className={pick === null ? '' : k === q.a ? 'right' : k === pick ? 'wrong' : 'dim'} onClick={() => answer(k)} disabled={pick !== null}>
            {o}
          </button>
        ))}
      </div>
      {pick !== null && (
        <div className="mind-after">
          <p>{pick === q.a ? 'Right.' : `Not quite — it is ${q.options[q.a]}.`} {q.note}</p>
          <button className="pill" onClick={next}>
            {i + 1 < qs.length ? 'Next' : 'Finish'}
          </button>
        </div>
      )}
    </div>
  );
}
