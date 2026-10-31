import { useEffect, useRef, useState } from 'react';
import { pair, type PairStage } from '../sync/engine';
import { useStore } from '../lib/store';
import { Frog } from './bits';

/** The only "sign in" there is: the four digits the phone shows. */
export function Pair() {
  const notice = useStore((s) => s.notice);
  const [digits, setDigits] = useState(['', '', '', '']);
  const [stage, setStage] = useState<PairStage | null>(null);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => refs.current[0]?.focus(), []);

  const go = (code: string) => void pair(code, setStage);
  const set = (i: number, v: string) => {
    const only = v.replace(/\D/g, '');
    if (only.length > 1) {
      // a pasted code
      const all = only.slice(0, 4).split('');
      const next = [0, 1, 2, 3].map((k) => all[k] ?? '');
      setDigits(next);
      if (all.length === 4) go(all.join(''));
      else refs.current[all.length]?.focus();
      return;
    }
    const next = [...digits];
    next[i] = only;
    setDigits(next);
    if (stage?.stage === 'error') setStage(null);
    if (only && i < 3) refs.current[i + 1]?.focus();
    if (next.every(Boolean)) go(next.join(''));
  };
  const key = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < 3) refs.current[i + 1]?.focus();
  };
  const busy = stage?.stage === 'joining' || stage?.stage === 'waiting';
  const bad = stage?.stage === 'error';
  useEffect(() => {
    if (bad) {
      setDigits(['', '', '', '']);
      setTimeout(() => refs.current[0]?.focus(), 50);
    }
  }, [bad]);

  return (
    <div className="pair">
      <div className="pair-l">
        <div className="brand">
          <Frog size={26} /> FROGITY · FOR THE COMPUTER
        </div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h1>
            Your library,
            <br />
            on a <i>bigger</i> screen.
          </h1>
          <p>Everything on your phone, here in seconds. Read side by side, write on PDFs, rearrange pages, edit documents — and every change is back on your phone before you put it down.</p>
          <ul>
            <li>no account, no password — four digits</li>
            <li>end-to-end encrypted: only your devices can read it</li>
            <li>edits sync both ways, almost instantly</li>
          </ul>
        </div>
        <div className="mono" style={{ fontSize: 12, color: '#77766f', position: 'relative', zIndex: 1 }}>
          Made for computers · works offline once loaded
        </div>
      </div>
      <div className="pair-r">
        <div className="pair-card">
          {notice && <div className="notice">{notice}</div>}
          <h2>Connect your phone</h2>
          <ol className="steps">
            <li>Open Frogity on your phone.</li>
            <li>Settings → Use Frogity on a computer.</li>
            <li>Type the four digits it shows.</li>
          </ol>
          <div className={`code${bad ? ' bad' : ''}`}>
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                value={d}
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label={`Digit ${i + 1}`}
                disabled={busy}
                onChange={(e) => set(i, e.target.value)}
                onKeyDown={(e) => key(i, e)}
                onFocus={(e) => e.target.select()}
              />
            ))}
          </div>
          <div className={`pair-msg${bad ? ' err' : ''}`} role="status">
            {stage?.stage === 'joining' && (
              <>
                <i className="spin" /> Checking the code…
              </>
            )}
            {stage?.stage === 'waiting' && (
              <>
                <span className="pair-emoji">{stage.emoji}</span>
                <span>
                  Connecting… your phone shows the same two pictures.
                  <br />
                  <small className="muted">Keep Frogity open on the phone for a moment.</small>
                </span>
              </>
            )}
            {stage?.stage === 'done' && 'Connected. Bringing your library over…'}
            {bad && stage.message}
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 26 }}>
            Your documents are encrypted on your phone before they leave it; the server in between only ever sees scrambled bytes. Disconnect this computer any time, here or from the phone.
          </p>
        </div>
      </div>
    </div>
  );
}
