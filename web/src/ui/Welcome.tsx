import { useEffect, useState } from 'react';
import { Pixel, type PixelName } from './px';
import { Mark } from './px';

const STEPS: { glow: [string, string]; icon: PixelName | 'mark'; art?: string; title: string; text: string }[] = [
  {
    glow: ['#1b3cff', '#e8cf9a'],
    icon: 'mark',
    title: 'Your phone’s library, on a big screen.',
    text: 'Every document is here: covers first, then each one the moment you click it — Frogity asks your phone for it and keeps a copy on this computer. Nothing to log into; nothing to set up again.',
  },
  {
    glow: ['#7a4cff', '#ffd23f'],
    icon: 'search',
    title: 'One key for everything.',
    text: 'Press ⌘K (Ctrl K) to search every document — and the words inside them — or run any action. Type “beside” to read two documents side by side. Tabs hold what you have open.',
  },
  {
    glow: ['#1fa2e8', '#ffd23f'],
    icon: 'page',
    title: 'Write on PDFs. Move pages around.',
    text: 'Add text, highlights, drawings, signatures and pictures. Press G to see every page at once: drag to reorder, rotate, cut pages out into a new PDF, merge another. Everything saves by itself and reaches your phone.',
  },
  {
    glow: ['#ff7a3c', '#ffd23f'],
    icon: 'note',
    title: 'Notes you can edit anywhere — and listen to.',
    text: 'Import from Word or Google Docs (or paste), and it becomes a Frogity note you can edit here and on your phone. Press the ear to hear any text read aloud.',
  },
];

/** A few cards the first time the computer app opens (and never again). */
export function Welcome({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const s = STEPS[i];
  const last = i === STEPS.length - 1;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone();
      if (e.key === 'ArrowRight' || e.key === 'Enter') (last ? onDone() : setI(i + 1));
      if (e.key === 'ArrowLeft' && i) setI(i - 1);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  return (
    <div className="wel" role="dialog" aria-label={`Welcome, step ${i + 1} of ${STEPS.length}`}>
      <div className="wel-card" style={{ ['--g1' as string]: s.glow[0], ['--g2' as string]: s.glow[1] }}>
        <div className="wel-body">
          <div className="wel-pic">{s.icon === 'mark' ? <Mark size={120} /> : <Pixel name={s.icon} size={88} className="wel-pixel" />}</div>
          <h2>{s.title}</h2>
          <p>{s.text}</p>
          <div className="wel-foot">
            <div className="wel-dots">
              {STEPS.map((_, k) => (
                <i key={k} className={k <= i ? 'on' : ''} />
              ))}
            </div>
            {!last && (
              <button className="btn ghost" onClick={onDone}>
                Skip
              </button>
            )}
            <button className="btn" onClick={() => (last ? onDone() : setI(i + 1))} autoFocus>
              {last ? 'Start reading' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
