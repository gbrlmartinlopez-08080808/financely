import { useEffect, useRef, useState } from 'react';
import { useActiveScan, useRunningJobs } from '../lib/scan';
import { kindLabel, left } from '../lib/workNotice';
import { PixelBar, PixelLoader, Sheet, toast } from '../ui/kit';

/**
 * Shows that a scanned PDF is being read. It announces itself for three seconds, then folds into a small
 * progress ring in the corner so it stays out of the way of whatever you are reading. Tap it to see the details again.
 */
export function ScanBadge() {
  const job = useActiveScan();
  const all = useRunningJobs();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(false);
  const t = useRef(0);
  const id = job?.id;
  const pop = () => {
    setOpen(true);
    clearTimeout(t.current);
    t.current = window.setTimeout(() => setOpen(false), 3000);
  };
  useEffect(() => {
    if (id) pop();
    else {
      clearTimeout(t.current);
      setOpen(false);
    }
    return () => clearTimeout(t.current);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const done = (e: Event) => {
      const d = (e as CustomEvent<{ title: string }>).detail;
      toast(`“${d.title.length > 28 ? d.title.slice(0, 28) + '…' : d.title}” is readable now — Liquid mode and Listen are ready`);
    };
    // a book was added and needs reading: say so, and let a tap show what is left
    const began = (e: Event) => {
      const d = (e as CustomEvent<{ title: string; pages: number }>).detail;
      toast(`Reading ${d.pages > 1 ? d.pages + ' pages of ' : ''}“${d.title.length > 24 ? d.title.slice(0, 24) + '…' : d.title}” in the background — tap to follow`, undefined, () => setList(true));
    };
    window.addEventListener('frogity:scan', done);
    window.addEventListener('frogity:started', began);
    return () => {
      window.removeEventListener('frogity:scan', done);
      window.removeEventListener('frogity:started', began);
    };
  }, []);
  const sheet = (
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
          It keeps going while the app is open or in your recent apps. A notification shows how far it has got.
        </p>
      </div>
    </Sheet>
  );
  if (!job) return sheet;

  const pct = Math.round(job.progress * 100);
  const R = 17;
  const C = 2 * Math.PI * R;
  return (
    <>
    {sheet}
    <button className={`scan-badge${open ? ' open' : ''}`} onClick={() => (open ? setList(true) : pop())} aria-label={`${kindLabel(job.kind)}: ${job.title}, ${pct}%`}>
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
          {job.title.length > 24 ? job.title.slice(0, 24) + '…' : job.title} · {pct}%
        </small>
      </span>
    </button>
    </>
  );
}
