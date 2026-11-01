import { useEffect, useState } from 'react';
import { froggyFace, type Mood } from '../lib/froggy';

/**
 * Froggy's face in ASCII. It blinks every few seconds, and with `talk` its mouth moves (while it is answering).
 * Always the same size on the grid, so changing mood never makes anything jump.
 */
export function Froggy({ mood = 'neutral', talk = false, size = 'md', className = '', label }: { mood?: Mood; talk?: boolean; size?: 'sm' | 'md' | 'lg'; className?: string; label?: string }) {
  const [blink, setBlink] = useState(false);
  const [mouth, setMouth] = useState<string | undefined>();
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let t = 0;
    const go = () => {
      t = window.setTimeout(() => {
        setBlink(true);
        t = window.setTimeout(() => {
          setBlink(false);
          go();
        }, 130);
      }, 2600 + Math.random() * 2600);
    };
    go();
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!talk) return setMouth(undefined);
    const seq = ['o', '-', 'O', 'v', '-'];
    let i = 0;
    const iv = window.setInterval(() => setMouth(seq[i++ % seq.length]), 170);
    return () => clearInterval(iv);
  }, [talk]);
  return (
    <pre className={`froggy ${size} ${className}`} role="img" aria-label={label ?? `Froggy, looking ${mood}`}>
      {froggyFace(mood, { blink, mouth })}
    </pre>
  );
}
