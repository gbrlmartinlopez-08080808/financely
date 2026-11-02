import { useCallback, useEffect, useState } from 'react';
import { dayKey, earnBlock, freezeStatus, useStore } from '../lib/store';
import { getLevels, setLevels, type Variant } from '../lib/games';
import { onBack } from '../lib/native';
import { Icon } from '../ui/Icon';
import { Froggy } from '../ui/Froggy';
import { toast } from '../ui/kit';
import { Deep, Sling } from './Climb';

/**
 * The five blocks on the way to a freeze day, drawn the way the streak calendar draws a day: an `@` for each block won, and the
 * fifth is the `~` that the calendar uses for a freeze day. Plain ink, nothing else.
 */
export function Blocks({ n, big = false, fresh = -1 }: { n: number; big?: boolean; fresh?: number }) {
  return (
    <span className={`bk-row${big ? ' big' : ''}`} role="img" aria-label={`${n} of 5 blocks toward a freeze day`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const on = i < n;
        const last = i === 4;
        return (
          <b key={i} className={`bk mono${on ? ' on' : ''}${last ? ' freeze' : ''}${last && n >= 4 ? ' near' : ''}${i === fresh ? ' fresh' : ''}`}>
            {last ? '~' : on ? '@' : '·'}
          </b>
        );
      })}
    </span>
  );
}

const WAYS: { id: Variant; title: string; sub: string }[] = [
  { id: 'sling', title: 'Sling', sub: 'Pull back, let go: the tongue flies the other way. Catch a fly and swing from one to the next — miss, and Froggy falls.' },
  { id: 'deep', title: 'Deep cuts', sub: 'Name something rare. The rarer the answer, the higher the tongue soars, and Froggy follows it up to a new lily.' },
];

/** The Play tab: the blocks, the freeze day, and the one climb with its two ways up. */
export function Play() {
  const freeze = useStore((s) => s.freeze);
  const fz = freezeStatus(freeze);
  const [levels, setLv] = useState({ sling: 1, deep: 1 });
  const [run, setRun] = useState<Variant | null>(null);
  useEffect(() => {
    getLevels().then(setLv);
  }, [run]);
  const won = freeze.blockDay === dayKey();
  return (
    <div className="int-scroll">
      <div className="tcard play-hero">
        <div className="play-top">
          <Froggy mood={won ? 'smug' : 'happy'} size="sm" />
          <div>
            <b>Reach the top, win a block</b>
            <span className="mono">four blocks, then the fifth is a freeze day</span>
          </div>
        </div>
        <Blocks n={Math.min(4, fz.blocks)} big />
        <p className="mono">{won ? 'today’s block is won — another tomorrow' : `${fz.blocks}/5 · a block comes only when Froggy reaches the top`}</p>
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

      <div className="tcard climb-card">
        <pre className="game-art" aria-hidden>{`       \\ | /\n       -(*)-\n   x       (_____)\n  \\x/\n     (@) (@)\n     (  v  )  ~~~`}</pre>
        <span className="tag mono">the climb · try as often as you like</span>
        <h3>Froggy has to get up</h3>
        <p>It starts on a lily pad in the water. Choose how it climbs. It can fall either way, and only the top counts.</p>
        <ul className="ways2">
          {WAYS.map((w) => (
            <li key={w.id}>
              <button onClick={() => setRun(w.id)}>
                <span>
                  <b>{w.title}</b>
                  <small className="mono">level {levels[w.id]}</small>
                </span>
                <em>{w.sub}</em>
                <Icon name="right" size={16} />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p className="int-foot mono">· · ·{'\n'}unlimited tries · the top is the only way to a block, one a day</p>
      {run && <Run variant={run} onClose={() => setRun(null)} />}
    </div>
  );
}

function Run({ variant, onClose }: { variant: Variant; onClose: () => void }) {
  const [lv, setLv] = useState<number | null>(null);
  const [round, setRound] = useState(0);
  const [result, setResult] = useState<null | { win: boolean; text: string; block?: string; fresh: number; freeze: boolean }>(null);
  useEffect(() => {
    getLevels().then((l) => setLv(l[variant]));
  }, [variant]);
  useEffect(() => onBack(() => (onClose(), true)), [onClose]);

  const finish = useCallback(
    async (win: boolean, text: string) => {
      let block: string | undefined;
      let fresh = -1;
      let freeze = false;
      if (win) {
        const l = await getLevels();
        l[variant] += 1;
        await setLevels(l);
        setLv(l[variant]);
        const before = freezeStatus().blocks;
        const r = earnBlock();
        if (r.ok) {
          freeze = r.freeze;
          fresh = r.freeze ? 4 : before;
          block = r.freeze ? 'Four blocks, then the ~ — a freeze day is yours.' : `A block for your freeze day · ${r.blocks}/5`;
          if (r.freeze) toast('You won a freeze day', 'award');
        } else block = r.reason;
      }
      setResult({ win, text, block, fresh, freeze });
    },
    [variant],
  );
  const again = () => {
    setResult(null);
    setRound((n) => n + 1);
  };
  return (
    <div className="game" role="dialog" aria-label="The climb">
      <header>
        <button className="game-x" onClick={onClose} aria-label="Close the game">
          <Icon name="back" size={22} />
        </button>
        <b>{variant === 'sling' ? 'Sling' : 'Deep cuts'}</b>
        <span className="mono">
          level {lv ?? 1}
        </span>
      </header>
      {lv !== null && !result && (variant === 'sling' ? <Sling key={round} level={lv} onEnd={finish} /> : <Deep key={round} level={lv} onEnd={finish} />)}
      {result && (
        <div className="game-end">
          <Froggy mood={result.win ? 'bigSmile' : 'sad'} size="lg" />
          <h2>{result.win ? 'At the top' : 'Into the water'}</h2>
          <p>{result.text}</p>
          {result.freeze && <div className="freeze-card mono">~ a freeze day keeps a streak alive over a missed day</div>}
          {result.block && <p className="blockmsg mono">{result.block}</p>}
          {!result.win && <p className="blockmsg mono">no block — only the top counts</p>}
          <Blocks n={Math.min(4, freezeStatus().blocks)} fresh={result.fresh} big />
          <div className="det-act" style={{ justifyContent: 'center' }}>
            <button className="pill" onClick={again}>
              {result.win ? 'Climb again' : 'Try again'}
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
