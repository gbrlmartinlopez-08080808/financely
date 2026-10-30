import { useEffect, useState } from 'react';
import { Sheet, toast } from '../ui/kit';
import { APP_VERSION, PLAY_URL, SUPPORT_EMAIL } from '../lib/config';
import { grantFreeze } from '../lib/store';
import { openExternal, tap } from '../lib/native';

/**
 * Shown once, after the first streak milestone. The stars are only a mood check: the reward (a freeze day)
 * is for sending us feedback, never for rating on Google Play, which Play's policy doesn't allow.
 */
export function RateSheet({ open, onClose, streak }: { open: boolean; onClose: (sent: boolean) => void; streak: number }) {
  const [stars, setStars] = useState(0);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) {
      setStars(0);
      setNote('');
    }
  }, [open]);

  const send = () => {
    const body = `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)} (${stars}/5)\n\n${note.trim()}\n\n—\nFrogity ${APP_VERSION} · ${streak}-day streak`;
    openExternal(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Frogity feedback')}&body=${encodeURIComponent(body)}`);
    grantFreeze(1);
    tap('medium');
    toast('Thank you — you won a freeze day', 'award');
    onClose(true);
  };

  return (
    <Sheet open={open} onClose={() => onClose(false)} title={`${streak} days in a row`}>
      <div className="sheet-body rate">
        <p className="rate-lead">Enjoying Frogity so far?</p>
        <div className="rate-stars" role="radiogroup" aria-label="Your rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={stars === n}
              aria-label={`${n} star${n > 1 ? 's' : ''}`}
              className={n <= stars ? 'on' : ''}
              onClick={() => {
                setStars(n);
                tap('select');
              }}
            >
              ★
            </button>
          ))}
        </div>
        {stars > 0 && (
          <>
            <p className="rate-sub">{stars >= 4 ? 'Lovely. What do you like most?' : 'Sorry about that. What would make it better?'}</p>
            <textarea className="field rate-note" rows={3} placeholder="A line is plenty (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="action rate-send" onClick={send}>
              Send feedback — win a freeze day
            </button>
            {stars >= 4 && (
              <button className="rate-play" onClick={() => (openExternal(PLAY_URL), onClose(true))}>
                Rate on Google Play
              </button>
            )}
          </>
        )}
        <button className="rate-later" onClick={() => onClose(false)}>
          Not now
        </button>
      </div>
    </Sheet>
  );
}
