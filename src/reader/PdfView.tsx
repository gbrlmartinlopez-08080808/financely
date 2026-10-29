import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { pdfjs, renderPage, type PDFDocumentProxy } from '../lib/formats/pdf';

export interface PdfViewHandle {
  goTo: (page: number, smooth?: boolean) => void;
  page: () => number;
  highlight: (q: string) => void;
}

interface Props {
  pdf: PDFDocumentProxy;
  scroller: HTMLElement | null;
  initialPage?: number;
  thumbs: boolean;
  onPage: (page: number, progress: number) => void;
  onTap: (e: React.MouseEvent) => void;
}

const MAX_PIXELS = 5_000_000;

export const PdfView = forwardRef<PdfViewHandle, Props>(function PdfView({ pdf, scroller, initialPage = 1, thumbs, onPage, onTap }, ref) {
  const n = pdf.numPages;
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [zoom, setZoom] = useState(1);
  const [vw, setVw] = useState(() => window.innerWidth);
  const [cur, setCur] = useState(initialPage);
  const wrap = useRef<HTMLDivElement>(null);
  const pageEls = useRef<(HTMLDivElement | null)[]>([]);
  const rendered = useRef(new Map<number, { scale: number; task?: { cancel: () => void } }>());
  const findQ = useRef('');

  // page sizes (first page immediately, the rest lazily)
  useEffect(() => {
    let alive = true;
    (async () => {
      const p1 = await pdf.getPage(1);
      const v = p1.getViewport({ scale: 1 });
      if (!alive) return;
      setSizes(Array.from({ length: n }, () => ({ w: v.width, h: v.height })));
      const out: { w: number; h: number }[] = [];
      for (let i = 1; i <= n; i++) {
        const p = await pdf.getPage(i);
        const vp = p.getViewport({ scale: 1 });
        out.push({ w: vp.width, h: vp.height });
        if (!alive) return;
      }
      if (out.some((s) => s.w !== v.width || s.h !== v.height)) setSizes(out);
    })();
    return () => {
      alive = false;
    };
  }, [pdf, n]);

  useEffect(() => {
    const on = () => setVw(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  const baseW = Math.min(vw - 16, 920);
  const pageW = (i: number) => (sizes[i] ? baseW * zoom * Math.min(1.4, sizes[i].w / (sizes[0]?.w || sizes[i].w)) : baseW * zoom);
  const pageH = (i: number) => (sizes[i] ? (pageW(i) * sizes[i].h) / sizes[i].w : pageW(i) * 1.3);

  // render visible pages
  useEffect(() => {
    if (!scroller || !sizes.length) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const visible = new Set<number>();
    const draw = async (i: number) => {
      const el = pageEls.current[i];
      if (!el) return;
      const cssW = pageW(i);
      const scale = Math.min((cssW * dpr) / sizes[i].w, Math.sqrt(MAX_PIXELS / (sizes[i].w * sizes[i].h)));
      const prev = rendered.current.get(i);
      if (prev && Math.abs(prev.scale - scale) < 0.01) return;
      prev?.task?.cancel();
      const page = await pdf.getPage(i + 1);
      const canvas = document.createElement('canvas');
      const entry: { scale: number; task?: { cancel: () => void } } = { scale };
      rendered.current.set(i, entry);
      try {
        const viewport = page.getViewport({ scale });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d')!;
        const task = page.render({ canvas, canvasContext: ctx, viewport });
        entry.task = task;
        await task.promise;
        if (rendered.current.get(i) !== entry) return;
        el.querySelector('canvas')?.remove();
        el.prepend(canvas);
        // text layer for selection, lookup and search
        el.querySelector('.textLayer')?.remove();
        const tl = document.createElement('div');
        tl.className = 'textLayer';
        const cssScale = cssW / sizes[i].w;
        el.style.setProperty('--total-scale-factor', String(cssScale));
        el.style.setProperty('--scale-round-x', '1px');
        el.style.setProperty('--scale-round-y', '1px');
        el.appendChild(tl);
        const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: page.getViewport({ scale: cssScale }) });
        await layer.render();
        if (findQ.current) markFind(tl, findQ.current);
      } catch {
        /* cancelled */
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.i);
          if (e.isIntersecting) {
            visible.add(i);
            draw(i);
          } else {
            visible.delete(i);
            // free memory for pages far away
            const near = [...visible].some((v) => Math.abs(v - i) < 4);
            if (!near) {
              rendered.current.get(i)?.task?.cancel();
              rendered.current.delete(i);
              const el = pageEls.current[i];
              el?.querySelector('canvas')?.remove();
              el?.querySelector('.textLayer')?.remove();
            }
          }
        }
      },
      { root: scroller, rootMargin: '120% 0px' },
    );
    pageEls.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [scroller, sizes, zoom, vw, pdf]); // eslint-disable-line react-hooks/exhaustive-deps

  // current page tracking
  useEffect(() => {
    if (!scroller) return;
    const on = () => {
      const mid = scroller.scrollTop + scroller.clientHeight * 0.4;
      let p = 0;
      for (let i = 0; i < pageEls.current.length; i++) {
        const el = pageEls.current[i];
        if (el && el.offsetTop <= mid) p = i;
        else break;
      }
      setCur(p + 1);
      const max = scroller.scrollHeight - scroller.clientHeight;
      onPage(p + 1, max > 0 ? scroller.scrollTop / max : 0);
    };
    scroller.addEventListener('scroll', on, { passive: true });
    return () => scroller.removeEventListener('scroll', on);
  }, [scroller, onPage]);

  // restore position once sizes are known
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (restored.current || !sizes.length || !scroller) return;
    restored.current = true;
    if (initialPage > 1) pageEls.current[initialPage - 1]?.scrollIntoView({ block: 'start' });
  }, [sizes, scroller, initialPage]);

  // pinch zoom + double tap
  useEffect(() => {
    const el = scroller;
    const inner = wrap.current;
    if (!el || !inner) return;
    let start: { d: number; cx: number; cy: number; sl: number; st: number } | null = null;
    let scale = 1;
    let lastTap = 0;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const ts = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const r = el.getBoundingClientRect();
        start = {
          d: dist(e.touches),
          cx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left,
          cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top,
          sl: el.scrollLeft,
          st: el.scrollTop,
        };
        inner.style.transformOrigin = `${start.cx + start.sl}px ${start.cy + start.st}px`;
      } else if (e.touches.length === 1) {
        const now = Date.now();
        if (now - lastTap < 280) {
          const r = el.getBoundingClientRect();
          const cx = e.touches[0].clientX - r.left;
          const cy = e.touches[0].clientY - r.top;
          applyZoom(zoomRef.current > 1.05 ? 1 / zoomRef.current : 2 / zoomRef.current, cx, cy);
          lastTap = 0;
        } else lastTap = now;
      }
    };
    const tm = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      scale = Math.max(0.5 / zoomRef.current, Math.min(5 / zoomRef.current, dist(e.touches) / start.d));
      inner.style.transform = `scale(${scale})`;
    };
    const te = () => {
      if (!start) return;
      const s = start;
      start = null;
      inner.style.transform = '';
      if (Math.abs(scale - 1) > 0.02) applyZoom(scale, s.cx, s.cy, s.sl, s.st);
      scale = 1;
    };
    const applyZoom = (factor: number, cx: number, cy: number, sl = el.scrollLeft, st = el.scrollTop) => {
      const next = Math.max(0.6, Math.min(4, zoomRef.current * factor));
      const real = next / zoomRef.current;
      setZoom(next);
      requestAnimationFrame(() => {
        el.scrollLeft = (sl + cx) * real - cx;
        el.scrollTop = (st + cy) * real - cy;
      });
    };
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    el.addEventListener('touchcancel', te);
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      applyZoom(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', te);
      el.removeEventListener('touchcancel', te);
      el.removeEventListener('wheel', wheel);
    };
  }, [scroller]);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useEffect(() => {
    if (scroller) scroller.style.overflowX = zoom > 1.01 ? 'auto' : 'hidden';
  }, [zoom, scroller]);

  useImperativeHandle(ref, () => ({
    goTo: (p, smooth) => pageEls.current[p - 1]?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' }),
    page: () => cur,
    highlight: (q) => {
      findQ.current = q;
      pageEls.current.forEach((el) => {
        const tl = el?.querySelector<HTMLElement>('.textLayer');
        if (tl) markFind(tl, q);
      });
    },
  }));

  return (
    <>
      <div className="pages" ref={wrap} onClick={onTap} style={{ minWidth: zoom > 1 ? baseW * zoom + 16 : undefined }}>
        {sizes.map((_, i) => (
          <div key={i} className="pdf-page" data-i={i} ref={(el) => {
              pageEls.current[i] = el;
            }} style={{ width: pageW(i), height: pageH(i) }}>
            <span className="pnum">{i + 1}</span>
          </div>
        ))}
      </div>
      {thumbs && <Thumbs pdf={pdf} cur={cur} onGo={(p) => pageEls.current[p - 1]?.scrollIntoView({ block: 'start' })} />}
    </>
  );
});

function markFind(tl: HTMLElement, q: string) {
  const query = q.trim().toLowerCase();
  tl.querySelectorAll('span').forEach((s) => s.classList.toggle('find', !!query && (s.textContent ?? '').toLowerCase().includes(query)));
}

function Thumbs({ pdf, cur, onGo }: { pdf: PDFDocumentProxy; cur: number; onGo: (p: number) => void }) {
  const [urls, setUrls] = useState<Record<number, string>>({});
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const made = new Set<number>();
    const io = new IntersectionObserver(
      async (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.p);
          if (!e.isIntersecting || made.has(i)) continue;
          made.add(i);
          const page = await pdf.getPage(i);
          const v = page.getViewport({ scale: 1 });
          const { canvas } = await renderPage(page, 120 / v.width);
          const url = canvas.toDataURL('image/jpeg', 0.7);
          setUrls((u) => ({ ...u, [i]: url }));
        }
      },
      { root: el, rootMargin: '200px 0px' },
    );
    el.querySelectorAll('button').forEach((b) => io.observe(b));
    return () => io.disconnect();
  }, [pdf]);
  useEffect(() => {
    box.current?.querySelector(`[data-p="${cur}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [cur]);
  return (
    <div className="thumbs" ref={box}>
      {Array.from({ length: pdf.numPages }, (_, k) => k + 1).map((p) => (
        <button key={p} data-p={p} className={p === cur ? 'cur' : ''} onClick={() => onGo(p)} style={{ minHeight: urls[p] ? undefined : 78 }}>
          {urls[p] && <img src={urls[p]} alt={`Page ${p}`} />}
          <span>{p}</span>
        </button>
      ))}
    </div>
  );
}
