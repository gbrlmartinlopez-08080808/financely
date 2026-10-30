import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { onBack, tap } from '../lib/native';

interface Step {
  sel: string;
  title: string;
  text: string;
}

const STEPS: Step[] = [
  { sel: '.carousel', title: 'Your shelf', text: 'What you are reading sits here in frosted holders. Swipe through them, tap one to open it, press and hold for more options.' },
  { sel: '.ring-btn', title: 'Daily goal ring', text: 'It fills as you read. Fill it to light today’s place on your reading globe.' },
  { sel: '.streak-strip', title: 'Your streak', text: 'Read a minute a day to keep it alive. A free freeze day each week saves you when life gets in the way.' },
  { sel: '.shelf-head', title: 'Sort, select, search', text: 'Reorder the shelf, pick several books to remove at once, or search by title and author.' },
  { sel: '.filters', title: 'Filters', text: 'Jump between what you are reading, PDFs, books, documents and finished titles.' },
  { sel: '.dock .pill:not(.round)', title: 'Add anything', text: 'Files, whole folders, web links, pasted text — or find free books to read right now.' },
  { sel: '.dock [aria-label="Scan a document"]', title: 'Scan paper', text: 'Photograph pages. Frogity cleans them up and reads the words in the background.' },
  { sel: '.dock [aria-label="Streak and stats"]', title: 'Streak and globe', text: 'Your calendar, the globe that lights up with every day you reach your goal, and the frog that carries your lights.' },
  { sel: '.dock [aria-label="Settings"]', title: 'Settings', text: 'Fonts, voices, reminders and your daily goal. You can replay this tour from here any time.' },
];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

/**
 * A guided tour of the home screen. The whole page is blurred and dimmed except the one thing being explained; the
 * clear window glides from one element to the next.
 */
export function Tour({ onDone }: { onDone: () => void }) {
  const steps = useMemo(() => STEPS.filter((s) => document.querySelector(s.sel)), []);
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [vp, setVp] = useState({ w: innerWidth, h: innerHeight });
  const card = useRef<HTMLDivElement>(null);
  const step = steps[i];
  // the clear window glides from one element to the next
  const [shown, setShown] = useState<Box | null>(null);
  useEffect(() => {
    if (!box) return;
    let raf = 0;
    const tick = () => {
      let done = false;
      setShown((cur) => {
        if (!cur) return box;
        const k = 0.28;
        const nx: Box = { x: cur.x + (box.x - cur.x) * k, y: cur.y + (box.y - cur.y) * k, w: cur.w + (box.w - cur.w) * k, h: cur.h + (box.h - cur.h) * k, r: cur.r + (box.r - cur.r) * k };
        done = Math.abs(nx.x - box.x) + Math.abs(nx.y - box.y) + Math.abs(nx.w - box.w) + Math.abs(nx.h - box.h) < 0.6;
        return done ? box : nx;
      });
      if (!done) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [box]);

  useEffect(() => onBack(() => (onDone(), true)), [onDone]);

  const measure = () => {
    const el = step && document.querySelector<HTMLElement>(step.sel);
    setVp({ w: innerWidth, h: innerHeight });
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    const rad = parseFloat(getComputedStyle(el).borderRadius) || 0;
    setBox({ x: Math.max(4, r.left - pad), y: Math.max(4, r.top - pad), w: Math.min(innerWidth - 8, r.width + pad * 2), h: r.height + pad * 2, r: Math.min(30, rad + pad) });
  };

  useLayoutEffect(() => {
    const el = step && document.querySelector<HTMLElement>(step.sel);
    if (!el) return;
    // bring it into view first (the dock is fixed; the rest scrolls with the page)
    if (!el.closest('.dock')) el.scrollIntoView({ block: 'center', behavior: 'auto' });
    measure();
    const t = setTimeout(measure, 120);
    addEventListener('resize', measure);
    return () => {
      clearTimeout(t);
      removeEventListener('resize', measure);
    };
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!step || !box || !shown) return null;
  const last = i === steps.length - 1;
  // one blurred sheet over the whole page with a rounded window cut out of it
  const hole = `M${shown.x + shown.r} ${shown.y}h${shown.w - 2 * shown.r}a${shown.r} ${shown.r} 0 0 1 ${shown.r} ${shown.r}v${shown.h - 2 * shown.r}a${shown.r} ${shown.r} 0 0 1 -${shown.r} ${shown.r}h-${shown.w - 2 * shown.r}a${shown.r} ${shown.r} 0 0 1 -${shown.r} -${shown.r}v-${shown.h - 2 * shown.r}a${shown.r} ${shown.r} 0 0 1 ${shown.r} -${shown.r}z`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${vp.w}' height='${vp.h}'><path fill-rule='evenodd' d='M0 0H${vp.w}V${vp.h}H0Z ${hole}'/></svg>`;
  const mask = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  const below = box.y + box.h + 190 < vp.h || box.y < 220;
  const cardTop = below ? box.y + box.h + 14 : undefined;
  const cardBottom = below ? undefined : vp.h - box.y + 14;
  const cx = Math.max(24, Math.min(vp.w - 24, box.x + box.w / 2));

  const next = () => {
    tap('select');
    if (last) onDone();
    else setI(i + 1);
  };

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={`Tour: ${step.title}`}>
      <i className="veil" style={{ WebkitMaskImage: mask, maskImage: mask }} />
      <i className="ringhole" style={{ left: shown!.x, top: shown!.y, width: shown!.w, height: shown!.h, borderRadius: shown!.r }} />
      <div className="tour-card" ref={card} style={{ top: cardTop, bottom: cardBottom }} key={i}>
        <i className={`arrow ${below ? 'up' : 'down'}`} style={{ left: cx - 20 }} />
        <div className="mono tour-count">
          {i + 1} / {steps.length}
        </div>
        <h3>{step.title}</h3>
        <p>{step.text}</p>
        <div className="tour-row">
          <button className="tour-skip" onClick={onDone}>
            skip
          </button>
          <span className="tour-dots" aria-hidden>
            {steps.map((_, k) => (
              <b key={k} className={k === i ? 'on' : ''} />
            ))}
          </span>
          <button className="tour-next" onClick={next}>
            {last ? 'Start reading' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
