import type { Prep } from '../lib/scan';
import { tap } from '../lib/native';
import { Icon } from '../ui/Icon';
import { PixelBar } from '../ui/kit';

const R = 18;
const C = 2 * Math.PI * R;
const pctOf = (p: Prep) => Math.round(p.progress * 100);
const eta = (s: number | null) => (s ? ` · about ${s < 90 ? s + ' s' : Math.round(s / 60) + ' min'} left` : '');

/**
 * Switches a PDF between its pages and Liquid mode. It always switches at once; while the Liquid view is still being
 * made, a thin ring around it fills up (and a dot says when it stopped).
 */
export function ViewButton({ active, prep, onClick }: { active: boolean; prep: Prep; onClick: () => void }) {
  const busy = prep.known && prep.busy && !prep.ready && !prep.error;
  const pct = pctOf(prep);
  return (
    <button
      className={`r-ibtn viewbtn${active ? ' on' : ''}`}
      onClick={() => {
        tap('select');
        onClick();
      }}
      aria-pressed={active}
      aria-label={active ? 'Back to the pages' : busy ? `Liquid mode, ${pct}% ready` : 'Liquid mode'}
    >
      {busy && (
        <svg className="viewbtn-ring" viewBox="0 0 40 40" aria-hidden>
          <circle className="track" cx="20" cy="20" r={R} />
          <circle className="run" cx="20" cy="20" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0.03, prep.progress))} />
        </svg>
      )}
      <Icon name="liquid" size={21} />
      {prep.error && <i className="viewbtn-dot" aria-hidden />}
    </button>
  );
}

/**
 * How far a PDF's Liquid view is, in one calm block: at the end of a Liquid view that is still growing, and in the
 * reading sheet. When something went wrong it says what, and offers to try again.
 */
export function LiquidStatus({ prep, pages, onRetry, onPages, compact }: { prep: Prep; pages?: number; onRetry: () => void; onPages?: () => void; compact?: boolean }) {
  if (prep.error)
    return (
      <div className="lq-status err" role="alert">
        <b>Liquid couldn’t be finished</b>
        <p>{prep.error} The original pages are untouched.</p>
        <div className="lq-status-act">
          <button className="pill sm" onClick={onRetry}>
            Try again
          </button>
          {onPages && (
            <button className="pill sm ghost" onClick={onPages}>
              Back to the pages
            </button>
          )}
        </div>
      </div>
    );
  if (prep.none)
    return (
      <div className="lq-status" role="status">
        <b>No text to reflow</b>
        <p>This PDF is made of pictures only, and no writing was found in them. The pages view shows it as it is.</p>
        {onPages && (
          <div className="lq-status-act">
            <button className="pill sm ghost" onClick={onPages}>
              Back to the pages
            </button>
          </div>
        )}
      </div>
    );
  const pct = pctOf(prep);
  return (
    <div className="lq-status" role="status" aria-live="polite">
      <div className="lq-status-top">
        <b>{prep.known ? 'Converting to Liquid' : 'Getting Liquid ready'}</b>
        <span className="mono">{pct}%</span>
      </div>
      <PixelBar value={prep.progress} cells={24} />
      <small className="mono">
        {prep.info || (pages ? `${pages} pages` : 'starting')}
        {eta(prep.eta)}
      </small>
      {!compact && <p>New pages appear here by themselves as they’re ready — keep reading. Listen opens once the whole book is done.</p>}
    </div>
  );
}
