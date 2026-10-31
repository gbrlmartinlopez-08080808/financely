import { memo, useEffect, useRef, useState } from 'react';
import { renderPage } from '../../lib/pdf';
import { shownSize, type PageRef, type Source } from './model';
import { showMenu } from '../bits';
import { Icon } from '../Icon';

const cache = new Map<string, HTMLCanvasElement>();
/** A small picture of a page (kept, so scrolling back and forth is instant). */
export async function thumb(src: Source | undefined, p: PageRef, width: number): Promise<HTMLCanvasElement> {
  const w = width <= 140 ? 140 : width <= 260 ? 260 : 420;
  const key = `${p.src}:${p.index}:${p.rot}:${w}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let c: HTMLCanvasElement;
  if (!src || p.src === 'blank') {
    const s = shownSize(p);
    c = document.createElement('canvas');
    c.width = w;
    c.height = Math.round((w * s.h) / s.w);
    const x = c.getContext('2d')!;
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
  } else {
    const pg = await src.pdf.getPage(p.index + 1);
    const vp = pg.getViewport({ scale: 1, rotation: (pg.rotate + p.rot) % 360 });
    c = await renderPage(pg, (w / vp.width) * Math.min(2, devicePixelRatio || 1), p.rot);
  }
  if (cache.size > 600) cache.delete(cache.keys().next().value!);
  cache.set(key, c);
  return c;
}

export const Thumb = memo(function Thumb({ src, page, width }: { src?: Source; page: PageRef; width: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setNear(true)), { rootMargin: '400px' });
    io.observe(host.current!);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!near) return;
    let alive = true;
    void thumb(src, page, width).then((c) => {
      if (!alive || !host.current) return;
      const copy = document.createElement('canvas');
      copy.width = c.width;
      copy.height = c.height;
      copy.getContext('2d')!.drawImage(c, 0, 0);
      host.current.replaceChildren(copy);
    });
    return () => {
      alive = false;
    };
  }, [near, src, page.src, page.index, page.rot, width]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = shownSize(page);
  return <div ref={host} className="ph" style={{ aspectRatio: `${s.w} / ${s.h}` }} />;
});

interface Props {
  pages: PageRef[];
  sources: Map<string, Source>;
  sel: string[];
  setSel: (s: string[]) => void;
  cols: number;
  onMove: (keys: string[], before: number) => void;
  onOpen: (i: number) => void;
  ops: { rotate: (keys: string[], d: number) => void; remove: (keys: string[]) => void; duplicate: (keys: string[]) => void; extract: (keys: string[]) => void; blank: (after: number) => void; insertPdf: (after: number) => void };
}

/** Every page at once: pick, drag to a new place, rotate, remove, copy out. */
export function Glance({ pages, sources, sel, setSel, cols, onMove, onOpen, ops }: Props) {
  const [over, setOver] = useState<number | null>(null);
  const dragging = useRef<string[]>([]);
  const width = Math.round((innerWidth - 120) / cols);
  const click = (e: React.MouseEvent, k: string, i: number) => {
    if (e.metaKey || e.ctrlKey) setSel(sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k]);
    else if (e.shiftKey && sel.length) {
      const a = pages.findIndex((p) => p.key === sel[sel.length - 1]);
      const [x, y] = a < i ? [a, i] : [i, a];
      setSel([...new Set([...sel, ...pages.slice(x, y + 1).map((p) => p.key)])]);
    } else setSel([k]);
  };
  const menu = (e: React.MouseEvent, k: string, i: number) => {
    const keys = sel.includes(k) ? sel : [k];
    if (!sel.includes(k)) setSel([k]);
    const n = keys.length;
    showMenu(e, [
      { label: 'Open this page', icon: <Icon name="book" size={15} />, run: () => onOpen(i), hidden: n > 1 },
      { label: 'Rotate right', icon: <Icon name="rotR" size={15} />, run: () => ops.rotate(keys, 90) },
      { label: 'Rotate left', icon: <Icon name="rotL" size={15} />, run: () => ops.rotate(keys, -90) },
      { label: n > 1 ? `Duplicate ${n} pages` : 'Duplicate', icon: <Icon name="dup" size={15} />, run: () => ops.duplicate(keys) },
      { label: n > 1 ? `Make a new PDF of these ${n} pages` : 'Make a new PDF of this page', icon: <Icon name="cut" size={15} />, run: () => ops.extract(keys) },
      { label: 'Insert a blank page after', icon: <Icon name="blank" size={15} />, run: () => ops.blank(i) },
      { label: 'Insert pages from another PDF after…', icon: <Icon name="merge" size={15} />, run: () => ops.insertPdf(i) },
      { sep: true },
      { label: n > 1 ? `Remove ${n} pages` : 'Remove page', icon: <Icon name="trash" size={15} />, danger: true, run: () => ops.remove(keys) },
    ]);
  };
  return (
    <div className="glance" onClick={(e) => e.target === e.currentTarget && setSel([])}>
      <div className="glance-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {pages.map((p, i) => (
          <div
            key={p.key}
            className={`gp${sel.includes(p.key) ? ' sel' : ''}${over === i ? ' drag-over' : ''}`}
            draggable
            onDragStart={(e) => {
              dragging.current = sel.includes(p.key) ? sel : [p.key];
              if (!sel.includes(p.key)) setSel([p.key]);
              e.dataTransfer.setData('text/x-frogity-pages', '1');
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('text/x-frogity-pages')) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              setOver(e.clientX > r.left + r.width / 2 ? i + 1 : i);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              if (!e.dataTransfer.types.includes('text/x-frogity-pages')) return;
              e.preventDefault();
              const at = over ?? i;
              setOver(null);
              if (dragging.current.length) onMove(dragging.current, at);
              dragging.current = [];
            }}
            onClick={(e) => click(e, p.key, i)}
            onDoubleClick={() => onOpen(i)}
            onContextMenu={(e) => menu(e, p.key, i)}
          >
            <div className="box" style={{ aspectRatio: `${shownSize(p).w} / ${shownSize(p).h}` }}>
              <Thumb src={sources.get(p.src)} page={p} width={width} />
            </div>
            {p.src !== 'self' && <span className="badge">{p.src === 'blank' ? 'blank' : 'added'}</span>}
            {i + 1}
          </div>
        ))}
      </div>
    </div>
  );
}
