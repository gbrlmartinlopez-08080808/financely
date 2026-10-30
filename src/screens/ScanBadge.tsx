import { useEffect, useRef, useState } from 'react';
import { useRunningJobs, type ScanJob } from '../lib/scan';
import { kindLabel, left } from '../lib/workNotice';
import { PixelBar, PixelLoader, Sheet, toast } from '../ui/kit';

const short = (t: string, n: number) => (t.length > n ? t.slice(0, n) + '…' : t);

/**
 * App-wide: says when a file needs reading or is ready, and holds the "Working in the background" list. The list opens
 * from a toast, or from the small badge inside the book it belongs to. Nothing here stays on screen by itself.
 */
export function JobsHost() {
  const all = useRunningJobs();
  const [list, setList] = useState(false);
  useEffect(() => {
    const done = (e: Event) => {
      const d = (e as CustomEvent<{ title: string }>).detail;
      toast(`“${short(d.title, 28)}” is readable now — Liquid mode and Listen are ready`);
    };
    const began = (e: Event) => {
      const d = (e as CustomEvent<{ title: string; pages: number }>).detail;
      toast(`Reading ${d.pages > 1 ? d.pages + ' pages of ' : ''}“${short(d.title, 24)}” in the background — tap to follow`, undefined, () => setList(true));
    };
    const open = () => setList(true);
    window.addEventListener('frogity:scan', done);
    window.addEventListener('frogity:started', began);
    window.addEventListener('frogity:jobs', open);
    return () => {
      window.removeEventListener('frogity:scan', done);
      window.removeEventListener('frogity:started', began);
      window.removeEventListener('frogity:jobs', open);
    };
  }, []);
  return (
    <Sheet open={list} onClose={() => setList(false)} title="Working in the background">
      <div className="sheet-body" style={{ paddingBottom: 18 }}>
        {all.length === 0 && <p className="muted">All done. Nothing is waiting.</p>}
        {all.map((j) => (
          <div key={j.kind + j.id} className="job-row">
            <div className="mono job-kind">{kindLabel(j.kind)}</div>
            <div className="job-name">{j.title}</div>
            <PixelBar value={j.progress} cells={14} />
            <div className="mono job-sub">
              {j.total ? `${j.done} of ${j.total}` : 'starting'} · {left(j)}
            </div>
          </div>
        ))}
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
          Reading goes on in the background — also with the screen off or when you leave the book. A notification shows how far it has got, and where it stopped is remembered.
        </p>
      </div>
    </Sheet>
  );
}

/** The job of one document, if it has one running (used in the library to mark a book that is being read). */
export function useDocJob(id: string): ScanJob | undefined {
  return useRunningJobs().find((j) => j.id === id);
}

/** A tiny ring on a book in the library while it is being read: seen as you scroll past it, gone when it is done. */
export function JobMark({ id, className = '' }: { id: string; className?: string }) {
  const job = useDocJob(id);
  if (!job) return null;
  const R = 8;
  const C = 2 * Math.PI * R;
  return (
    <span className={`jobmark ${className}`} role="img" aria-label={`${kindLabel(job.kind)}, ${Math.round(job.progress * 100)}%`}>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
        <circle cx="11" cy="11" r={R} fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="2.4" />
        <circle cx="11" cy="11" r={R} fill="none" stroke="currentColor" strokeWidth="2.4" strokeDasharray={C} strokeDashoffset={C * (1 - job.progress)} transform="rotate(-90 11 11)" />
      </svg>
      <b className="mono">{Math.round(job.progress * 100)}%</b>
    </span>
  );
}

/**
 * Shows that THIS book is being read or prepared. It announces itself for three seconds, then folds into a small
 * progress ring in the corner; it is only ever shown inside the book it belongs to. Tap it for the full list.
 */
export function ScanBadge({ docId }: { docId: string }) {
  const job = useDocJob(docId);
  const [open, setOpen] = useState(false);
  const t = useRef(0);
  const key = job ? job.kind : '';
  const pop = () => {
    setOpen(true);
    clearTimeout(t.current);
    t.current = window.setTimeout(() => setOpen(false), 3000);
  };
  useEffect(() => {
    if (key) pop();
    else {
      clearTimeout(t.current);
      setOpen(false);
    }
    return () => clearTimeout(t.current);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!job) return null;
  const pct = Math.round(job.progress * 100);
  const R = 17;
  const C = 2 * Math.PI * R;
  return (
    <button
      className={`scan-badge${open ? ' open' : ''}`}
      onClick={() => (open ? window.dispatchEvent(new CustomEvent('frogity:jobs')) : pop())}
      aria-label={`${kindLabel(job.kind)}: ${job.title}, ${pct}%`}
    >
      <span className="ring">
        <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden>
          <circle cx="22" cy="22" r={R} fill="none" stroke="currentColor" strokeOpacity=".16" strokeWidth="3" />
          <circle cx="22" cy="22" r={R} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="butt" strokeDasharray={C} strokeDashoffset={C * (1 - job.progress)} transform="rotate(-90 22 22)" />
        </svg>
        <i>
          <PixelLoader size={3} gap={1.5} />
        </i>
      </span>
      <span className="txt">
        <b>{kindLabel(job.kind)}</b>
        <small>
          {short(job.title, 24)} · {pct}%
        </small>
      </span>
    </button>
  );
}
