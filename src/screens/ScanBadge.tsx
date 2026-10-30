import { useEffect, useState } from 'react';
import { useLiquid, useRunningJobs, type ScanJob } from '../lib/scan';
import { kindLabel, left } from '../lib/workNotice';
import { PixelBar, Sheet, toast } from '../ui/kit';

const short = (t: string, n: number) => (t.length > n ? t.slice(0, n) + '…' : t);

/**
 * App-wide: says when a file needs reading, and holds the "Working in the background" list (opened from that message).
 * Inside a book, its own progress is shown in the book's top bar instead, so nothing here floats over a page.
 */
export function JobsHost() {
  const all = useRunningJobs();
  const [list, setList] = useState(false);
  useEffect(() => {
    const began = (e: Event) => {
      const d = (e as CustomEvent<{ title: string; pages: number }>).detail;
      if (d.pages <= 0) return; // a book of ordinary text is just prepared quietly: the Liquid button fills up by itself
      if (document.querySelector('.reader')) return; // the open book shows its own progress under its title
      toast(`Reading “${short(d.title, 22)}”${d.pages > 1 ? ` · ${d.pages} pages` : ''} — tap to follow`, undefined, () => setList(true));
    };
    const open = () => setList(true);
    window.addEventListener('frogity:started', began);
    window.addEventListener('frogity:jobs', open);
    return () => {
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

/**
 * A tiny ring on a book in the library while it is being prepared: seen as you scroll past it, gone when it is done.
 * For a PDF it is the same percentage its Liquid button shows inside the book.
 */
export function JobMark({ id, className = '' }: { id: string; className?: string }) {
  const job = useDocJob(id);
  const prep = useLiquid(id);
  const preparing = prep.known && prep.busy && !prep.ready && !prep.error;
  if (!job && !preparing) return null;
  const progress = preparing ? prep.progress : job!.progress;
  const label = preparing ? 'Preparing Liquid mode' : kindLabel(job!.kind);
  const R = 8;
  const C = 2 * Math.PI * R;
  return (
    <span className={`jobmark ${className}`} role="img" aria-label={`${label}, ${Math.round(progress * 100)}%`}>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
        <circle cx="11" cy="11" r={R} fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="2.4" />
        <circle cx="11" cy="11" r={R} fill="none" stroke="currentColor" strokeWidth="2.4" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} transform="rotate(-90 11 11)" />
      </svg>
      <b className="mono">{Math.round(progress * 100)}%</b>
    </span>
  );
}
