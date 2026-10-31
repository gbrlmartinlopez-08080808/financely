import type { Prep } from '../lib/scan';
import { tap } from '../lib/native';
import { Icon } from '../ui/Icon';
import { PixelBar, Sheet } from '../ui/kit';

/** a rounded square, drawn from the middle of the top edge, clockwise (so the fill starts where a clock starts) */
const EDGE = 'M20 1.5H27.5A11 11 0 0 1 38.5 12.5V27.5A11 11 0 0 1 27.5 38.5H12.5A11 11 0 0 1 1.5 27.5V12.5A11 11 0 0 1 12.5 1.5Z';
const pctOf = (p: Prep) => Math.round(p.progress * 100);
const eta = (s: number | null) => (s ? ` · about ${s < 90 ? s + ' s' : Math.round(s / 60) + ' min'} left` : '');

/**
 * Switches a PDF between its pages and Liquid mode. It always switches at once; while the Liquid view is still being
 * made, a thin edge around it fills up (and a dot says when it stopped).
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
          <path className="track" d={EDGE} />
          <path className="run" d={EDGE} pathLength={100} strokeDasharray={100} strokeDashoffset={100 * (1 - Math.max(0.03, prep.progress))} />
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

/**
 * Shown the first time a PDF is opened: what Liquid mode is, why it is instant for some files and takes a while for
 * others, and that nothing has to be waited for.
 */
export function LiquidIntro({ open, prep, onClose, onTry }: { open: boolean; prep: Prep; onClose: () => void; onTry: () => void }) {
  const now = prep.ready ? 'This one is ready already.' : prep.known && prep.busy ? `This one is on its way: ${pctOf(prep)}% so far.` : '';
  return (
    <Sheet open={open} onClose={onClose} title="Liquid mode">
      <div className="sheet-body lq-intro" style={{ paddingBottom: 18 }}>
        <div className="lq-intro-key" aria-hidden>
          <Icon name="liquid" size={22} />
        </div>
        <p style={{ marginTop: 0 }}>
          The square key at the top turns a PDF’s fixed pages into text that flows to fit your screen: your font and size, night colours, tap a word
          to look it up, and Listen.
        </p>
        <div className="lq-intro-two">
          <div>
            <b>Snappy</b>
            <span>When the PDF has real text inside, it is ready in seconds.</span>
          </div>
          <div>
            <b>Takes a while</b>
            <span>When the pages are photos or scans, Frogity reads each page letter by letter — on your phone, nothing is uploaded. That is a few seconds a page, so a long book takes minutes.</span>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 13.5 }}>
          You never have to wait: open it any time and read what is ready, while the rest arrives by itself. The key’s edge fills up as it goes, the
          work carries on in the background, and the sources at the back are folded away so they don’t slow it down.
        </p>
        {now && <p className="mono" style={{ fontSize: 12.5 }}>{now}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button className="pill" style={{ flex: 1 }} onClick={onTry}>
            Try Liquid
          </button>
          <button className="pill ghost" style={{ flex: 1 }} onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </Sheet>
  );
}
