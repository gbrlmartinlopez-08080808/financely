import { useEffect, useRef, useState } from 'react';
import { useActiveScan } from '../lib/scan';
import { PixelLoader, toast } from '../ui/kit';

/**
 * Shows that a scanned PDF is being read. It announces itself for three seconds, then folds into a small
 * progress ring in the corner so it stays out of the way of whatever you are reading. Tap it to see the details again.
 */
export function ScanBadge() {
  const job = useActiveScan();
  const [open, setOpen] = useState(false);
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
    window.addEventListener('frogity:scan', done);
    return () => window.removeEventListener('frogity:scan', done);
  }, []);
  if (!job) return null;
  const pct = Math.round(job.progress * 100);
  const R = 17;
  const C = 2 * Math.PI * R;
  return (
    <button className={`scan-badge${open ? ' open' : ''}`} onClick={() => (open ? setOpen(false) : pop())} aria-label={`Reading the scanned pages of ${job.title}: ${pct}%`}>
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
        <b>Reading the scan</b>
        <small>
          {job.title.length > 24 ? job.title.slice(0, 24) + '…' : job.title} · {pct}%
        </small>
      </span>
    </button>
  );
}
