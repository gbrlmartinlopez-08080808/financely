import { memo, useEffect, useRef, useState } from 'react';
import 'pdfjs-dist/web/pdf_viewer.css';
import { pdfjs, renderPage } from '../../lib/pdf';
import { shownSize, type Ann, type PageRef, type Source } from './model';

export type Tool = 'select' | 'text' | 'hl' | 'ink' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'note' | 'white' | 'img';
export interface ToolOpts {
  color: string;
  size: number;
  font: 'sans' | 'serif' | 'mono';
  bold: boolean;
  /** a picture or signature waiting to be placed */
  image?: { src: string; ratio: number };
}

interface Props {
  page: PageRef;
  num: number;
  src?: Source;
  zoom: number;
  tool: Tool;
  opts: ToolOpts;
  anns: Ann[];
  selected: string | null;
  editing: string | null;
  find: string;
  onCreate: (a: Omit<Ann, 'id' | 'page'>) => void;
  onChange: (id: string, patch: Partial<Ann>, final?: boolean) => void;
  onSelect: (id: string | null) => void;
  onEdit: (id: string | null) => void;
  onVisible: (num: number, ratio: number) => void;
}

const dpr = () => Math.min(2.5, window.devicePixelRatio || 1);

export const PageView = memo(function PageView(p: Props) {
  const { page, zoom } = p;
  const size = shownSize(page);
  const W = size.w * zoom;
  const H = size.h * zoom;
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textEl = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const drawn = useRef('');

  // is the page on (or near) the screen?
  useEffect(() => {
    const el = box.current!;
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          setNear(e.isIntersecting);
          p.onVisible(p.num, e.isIntersecting ? e.intersectionRatio : 0);
        }),
      { root: el.closest('.viewer'), rootMargin: '600px 0px', threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [p.num]); // eslint-disable-line react-hooks/exhaustive-deps

  // draw the page (again when the zoom settles), and its text for selecting and finding
  useEffect(() => {
    if (!near || !p.src || page.src === 'blank') return;
    const key = `${page.src}:${page.index}:${page.rot}:${zoom.toFixed(3)}`;
    if (drawn.current === key) return;
    let alive = true;
    const t = setTimeout(
      async () => {
        const pg = await p.src!.pdf.getPage(page.index + 1);
        if (!alive) return;
        const c = document.createElement('canvas');
        await renderPage(pg, zoom * dpr(), page.rot, c);
        if (!alive || !canvas.current) return;
        const dst = canvas.current;
        dst.width = c.width;
        dst.height = c.height;
        dst.getContext('2d')!.drawImage(c, 0, 0);
        c.width = c.height = 0;
        drawn.current = key;
        const tl = textEl.current;
        if (tl) {
          tl.innerHTML = '';
          const viewport = pg.getViewport({ scale: zoom, rotation: (pg.rotate + page.rot) % 360 });
          tl.style.setProperty('--scale-factor', String(zoom));
          const layer = new pdfjs.TextLayer({ textContentSource: pg.streamTextContent(), container: tl, viewport });
          await layer.render().catch(() => {});
          markFound(tl, p.find);
        }
      },
      drawn.current ? 140 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [near, zoom, page.src, page.index, page.rot, p.src]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (textEl.current) markFound(textEl.current, p.find);
  }, [p.find]);

  // ---------------------------------------------------------------- making marks
  const drag = useRef<{ x: number; y: number; pts: number[]; el: SVGElement | null } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; w: number; h: number; pts?: number[] } | null>(null);
  const rel = (e: React.PointerEvent | PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  };
  const creating = p.tool !== 'select';
  const down = (e: React.PointerEvent) => {
    if (!creating || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.a')) return;
    e.preventDefault(); // the press must not take the keyboard away from the box it makes
    const { x, y } = rel(e);
    const o = p.opts;
    if (p.tool === 'text') {
      p.onCreate({ type: 'text', x, y: Math.max(0, y - (o.size * 0.6) / size.h), w: 0, h: 0, color: o.color, size: o.size, text: '', font: o.font, bold: o.bold });
      return;
    }
    if (p.tool === 'note') {
      p.onCreate({ type: 'note', x, y, w: 0, h: 0, color: '#ffd23f', size: 12, text: '' });
      return;
    }
    if (p.tool === 'img' && o.image) {
      const w = 0.28;
      const h = (w * W) / o.image.ratio / H;
      p.onCreate({ type: 'img', x: Math.min(x, 1 - w), y: Math.min(y, 1 - h), w, h, color: '#000', size: 1, src: o.image.src });
      return;
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x, y, pts: [x, y], el: null };
    setGhost({ x, y, w: 0, h: 0, pts: [x, y] });
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { x, y } = rel(e);
    if (p.tool === 'ink') {
      d.pts.push(x, y);
      setGhost({ x: 0, y: 0, w: 0, h: 0, pts: [...d.pts] });
    } else if (p.tool === 'line' || p.tool === 'arrow') setGhost({ x: 0, y: 0, w: 0, h: 0, pts: [d.x, d.y, x, y] });
    else setGhost({ x: Math.min(d.x, x), y: Math.min(d.y, y), w: Math.abs(x - d.x), h: Math.abs(y - d.y) });
  };
  const up = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setGhost(null);
    if (!d) return;
    const { x, y } = rel(e);
    const o = p.opts;
    if (p.tool === 'ink') {
      if (d.pts.length >= 4) p.onCreate({ type: 'ink', ...bounds(d.pts), color: o.color, size: o.size, pts: d.pts, opacity: 1 });
      return;
    }
    if (p.tool === 'line' || p.tool === 'arrow') {
      if (Math.hypot((x - d.x) * W, (y - d.y) * H) > 6) p.onCreate({ type: p.tool, ...bounds([d.x, d.y, x, y]), color: o.color, size: o.size, pts: [d.x, d.y, x, y] });
      return;
    }
    const r = { x: Math.min(d.x, x), y: Math.min(d.y, y), w: Math.abs(x - d.x), h: Math.abs(y - d.y) };
    if (r.w * W < 5 || r.h * H < 4) return;
    if (p.tool === 'hl') p.onCreate({ type: 'hl', ...r, color: o.color, size: 1, opacity: 0.38 });
    else if (p.tool === 'white') p.onCreate({ type: 'white', ...r, color: '#ffffff', size: 1 });
    else if (p.tool === 'rect' || p.tool === 'ellipse') p.onCreate({ type: p.tool, ...r, color: o.color, size: o.size });
  };

  return (
    <div className="page" ref={box} style={{ width: W, height: H }} data-num={p.num} data-key={page.key}>
      <canvas className="pc" ref={canvas} />
      <div className="textLayer" ref={textEl} style={{ display: creating ? 'none' : undefined }} />
      <div className={`ann${creating ? '' : ' passive'}`} style={{ cursor: creating ? (p.tool === 'text' ? 'text' : p.tool === 'img' ? 'copy' : 'crosshair') : undefined }} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        <svg viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
          {p.anns.map((a) => (
            <Shape key={a.id} a={a} sw={size.w} sh={size.h} sel={p.selected === a.id} onSelect={() => p.onSelect(a.id)} tool={p.tool} />
          ))}
          {ghost && <Ghost g={ghost} tool={p.tool} opts={p.opts} sw={size.w} sh={size.h} />}
        </svg>
        {p.anns
          .filter((a) => ['text', 'hl', 'white', 'note', 'img'].includes(a.type))
          .map((a) => (
            <Box key={a.id} a={a} W={W} H={H} zoom={zoom} sel={p.selected === a.id} editing={p.editing === a.id} tool={p.tool} onSelect={p.onSelect} onChange={p.onChange} onEdit={p.onEdit} />
          ))}
        {p.anns
          .filter((a) => p.selected === a.id && ['rect', 'ellipse', 'ink', 'line', 'arrow'].includes(a.type))
          .map((a) => (
            <Mover key={a.id} a={a} W={W} H={H} onChange={p.onChange} />
          ))}
      </div>
      <div className="num">{p.num}</div>
    </div>
  );
});

function bounds(pts: number[]) {
  let x0 = 1,
    y0 = 1,
    x1 = 0,
    y1 = 0;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]);
    x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]);
    y1 = Math.max(y1, pts[i + 1]);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function markFound(tl: HTMLElement, q: string) {
  const n = q.trim().toLowerCase();
  tl.querySelectorAll('span.found').forEach((s) => s.classList.remove('found'));
  if (n.length < 2) return;
  const words = n.split(/\s+/);
  tl.querySelectorAll('span').forEach((s) => {
    const t = (s.textContent ?? '').toLowerCase();
    if (t.includes(n) || (words.length > 1 && words.some((w) => w.length > 3 && t.includes(w)))) s.classList.add('found');
  });
}

/** Drawn marks (lines, shapes, ink) in page units. */
function Shape({ a, sw, sh, sel, onSelect, tool }: { a: Ann; sw: number; sh: number; sel: boolean; onSelect: () => void; tool: Tool }) {
  const common = { stroke: a.color, strokeWidth: a.size, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, opacity: a.opacity ?? 1, style: { pointerEvents: tool === 'select' ? ('stroke' as const) : ('none' as const), cursor: 'pointer' }, onPointerDown: (e: React.PointerEvent) => (e.stopPropagation(), onSelect()) };
  const glow = sel ? { filter: 'drop-shadow(0 0 2px #2f7cf6)' } : {};
  if (a.type === 'rect') return <rect x={a.x * sw} y={a.y * sh} width={a.w * sw} height={a.h * sh} {...common} style={{ ...common.style, ...glow }} />;
  if (a.type === 'ellipse') return <ellipse cx={(a.x + a.w / 2) * sw} cy={(a.y + a.h / 2) * sh} rx={(a.w / 2) * sw} ry={(a.h / 2) * sh} {...common} style={{ ...common.style, ...glow }} />;
  if ((a.type === 'line' || a.type === 'arrow') && a.pts) {
    const [x1, y1, x2, y2] = [a.pts[0] * sw, a.pts[1] * sh, a.pts[2] * sw, a.pts[3] * sh];
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const L = Math.max(6, a.size * 4);
    return (
      <g style={glow}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} {...common} />
        {a.type === 'arrow' && <path d={`M${x2 - L * Math.cos(ang - 0.45)} ${y2 - L * Math.sin(ang - 0.45)}L${x2} ${y2}L${x2 - L * Math.cos(ang + 0.45)} ${y2 - L * Math.sin(ang + 0.45)}`} {...common} />}
      </g>
    );
  }
  if (a.type === 'ink' && a.pts) {
    let d = '';
    for (let i = 0; i < a.pts.length; i += 2) d += `${i ? 'L' : 'M'}${(a.pts[i] * sw).toFixed(1)} ${(a.pts[i + 1] * sh).toFixed(1)}`;
    return <path d={d} {...common} style={{ ...common.style, ...glow }} />;
  }
  return null;
}

function Ghost({ g, tool, opts, sw, sh }: { g: { x: number; y: number; w: number; h: number; pts?: number[] }; tool: Tool; opts: ToolOpts; sw: number; sh: number }) {
  const s = { stroke: opts.color, strokeWidth: opts.size, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (tool === 'ink' && g.pts) {
    let d = '';
    for (let i = 0; i < g.pts.length; i += 2) d += `${i ? 'L' : 'M'}${g.pts[i] * sw} ${g.pts[i + 1] * sh}`;
    return <path d={d} {...s} />;
  }
  if ((tool === 'line' || tool === 'arrow') && g.pts && g.pts.length === 4) return <line x1={g.pts[0] * sw} y1={g.pts[1] * sh} x2={g.pts[2] * sw} y2={g.pts[3] * sh} {...s} />;
  if (tool === 'hl') return <rect x={g.x * sw} y={g.y * sh} width={g.w * sw} height={g.h * sh} fill={opts.color} opacity={0.38} />;
  if (tool === 'white') return <rect x={g.x * sw} y={g.y * sh} width={g.w * sw} height={g.h * sh} fill="#fff" stroke="#2f7cf6" strokeDasharray="3 2" strokeWidth={0.6} />;
  if (tool === 'ellipse') return <ellipse cx={(g.x + g.w / 2) * sw} cy={(g.y + g.h / 2) * sh} rx={(g.w / 2) * sw} ry={(g.h / 2) * sh} {...s} />;
  return <rect x={g.x * sw} y={g.y * sh} width={g.w * sw} height={g.h * sh} {...s} />;
}

/** Marks that are boxes on the page (text, highlight, white-out, note, picture): move, resize, edit. */
function Box({ a, W, H, zoom, sel, editing, tool, onSelect, onChange, onEdit }: { a: Ann; W: number; H: number; zoom: number; sel: boolean; editing: boolean; tool: Tool; onSelect: (id: string | null) => void; onChange: Props['onChange']; onEdit: Props['onEdit'] }) {
  const el = useRef<HTMLDivElement>(null);
  const start = (e: React.PointerEvent, mode: 'move' | 'size') => {
    if (editing || e.button !== 0) return;
    e.stopPropagation();
    onSelect(a.id);
    const sx = e.clientX;
    const sy = e.clientY;
    const o = { x: a.x, y: a.y, w: a.w, h: a.h, pts: a.pts };
    let moved = false;
    const mv = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / W;
      const dy = (ev.clientY - sy) / H;
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 2) moved = true;
      if (!moved) return;
      if (mode === 'move') onChange(a.id, { x: o.x + dx, y: o.y + dy, pts: o.pts?.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)) });
      else onChange(a.id, a.type === 'img' ? { w: Math.max(0.02, o.w + dx), h: Math.max(0.02, (o.w + dx) * (o.h / o.w)) } : { w: Math.max(0.01, o.w + dx), h: Math.max(0.01, o.h + dy) });
    };
    const done = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', done);
      if (moved) onChange(a.id, {}, true);
      else if (a.type === 'text' && sel) onEdit(a.id);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', done);
  };
  useEffect(() => {
    if (editing && el.current) {
      el.current.focus();
      const r = document.createRange();
      r.selectNodeContents(el.current);
      r.collapse(false);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(r);
    }
  }, [editing]);
  const passive = tool !== 'select' && !editing;
  const style: React.CSSProperties = { left: a.x * W, top: a.y * H, pointerEvents: passive ? 'none' : 'auto' };
  if (a.type === 'text') {
    return (
      <div
        ref={el}
        className={`a text${sel ? ' sel' : ''}`}
        style={{ ...style, color: a.color, fontSize: a.size * zoom, fontFamily: a.font === 'serif' ? 'Times New Roman, Times, serif' : a.font === 'mono' ? 'Courier New, Courier, monospace' : 'Helvetica, Arial, sans-serif', fontWeight: a.bold ? 700 : 400 }}
        contentEditable={editing}
        suppressContentEditableWarning
        onPointerDown={(e) => start(e, 'move')}
        onDoubleClick={() => onEdit(a.id)}
        onBlur={(e) => {
          onEdit(null);
          const t = e.currentTarget.innerText.replace(/\n$/, '');
          onChange(a.id, { text: t }, true);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') (e.currentTarget as HTMLElement).blur();
        }}
      >
        {a.text}
      </div>
    );
  }
  if (a.type === 'note') {
    return (
      <div className={`a note${sel ? ' sel' : ''}`} style={style} onPointerDown={(e) => start(e, 'move')}>
        {sel && (
          <div className="pop" onPointerDown={(e) => e.stopPropagation()}>
            <textarea autoFocus={!a.text} defaultValue={a.text} placeholder="Write a note…" onKeyDown={(e) => (e.stopPropagation(), e.key === 'Escape' && (e.currentTarget.blur(), onSelect(null)))} onBlur={(e) => onChange(a.id, { text: e.target.value }, true)} />
          </div>
        )}
      </div>
    );
  }
  const rects = a.type === 'hl' && a.pts && a.pts.length >= 4 ? chunk(a.pts) : null;
  if (rects)
    return (
      <>
        {rects.map((r, i) => (
          <div key={i} className={`a${sel ? ' sel' : ''}`} style={{ left: r[0] * W, top: r[1] * H, width: r[2] * W, height: r[3] * H, background: a.color, opacity: a.opacity ?? 0.38, mixBlendMode: 'multiply', pointerEvents: passive ? 'none' : 'auto', cursor: 'pointer' }} onPointerDown={(e) => (e.stopPropagation(), onSelect(a.id))} />
        ))}
      </>
    );
  return (
    <div
      className={`a${sel ? ' sel' : ''}`}
      style={{ ...style, width: a.w * W, height: a.h * H, cursor: 'move', ...(a.type === 'hl' ? { background: a.color, opacity: a.opacity ?? 0.38, mixBlendMode: 'multiply' } : a.type === 'white' ? { background: '#fff', boxShadow: sel ? undefined : 'inset 0 0 0 0.5px rgba(0,0,0,.06)' } : {}) }}
      onPointerDown={(e) => start(e, 'move')}
    >
      {a.type === 'img' && <img src={a.src} alt="" draggable={false} style={{ width: '100%', height: '100%', display: 'block' }} />}
      {sel && <span className="h" onPointerDown={(e) => start(e, 'size')} />}
    </div>
  );
}
const chunk = (a: number[]) => {
  const out: number[][] = [];
  for (let i = 0; i + 3 < a.length; i += 4) out.push(a.slice(i, i + 4));
  return out;
};

/** A handle to move a selected drawn mark. */
function Mover({ a, W, H, onChange }: { a: Ann; W: number; H: number; onChange: Props['onChange'] }) {
  const start = (e: React.PointerEvent) => {
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const o = { x: a.x, y: a.y, pts: a.pts };
    const mv = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / W;
      const dy = (ev.clientY - sy) / H;
      onChange(a.id, { x: o.x + dx, y: o.y + dy, pts: o.pts?.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)) });
    };
    const done = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', done);
      onChange(a.id, {}, true);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', done);
  };
  return <div className="a sel" style={{ left: a.x * W - 4, top: a.y * H - 4, width: a.w * W + 8, height: a.h * H + 8, cursor: 'move' }} onPointerDown={start} />;
}
