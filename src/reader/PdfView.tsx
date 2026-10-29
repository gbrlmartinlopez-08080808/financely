import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
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
  onPage: (page: number) => void;
  onProgress: (progress: number) => void;
  onTap: (e: React.MouseEvent) => void;
}

const MAX_PIXELS = 2_800_000;

export const PdfView = forwardRef<PdfViewHandle, Props>(function PdfView({ pdf, scroller, initialPage = 1, thumbs, onPage, onProgress, onTap }, ref) {
  const n = pdf.numPages;
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [zoom, setZoom] = useState(1);
  const [vw, setVw] = useState(() => window.innerWidth);
  const [cur, setCur] = useState(initialPage);
  const wrap = useRef<HTMLDivElement>(null);
  const pageEls = useRef<(HTMLDivElement | null)[]>([]);
  const done = useRef(new Map<number, number>()); // page index -> scale already rendered at
  const visible = useRef(new Set<number>());
  const queue = useRef(new Set<number>());
  const busy = useRef(false);
  const findQ = useRef('');
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const pending = useRef<{ real: number; cx: number; cy: number; sl: number; st: number } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // ---- page sizes: first page immediately, the rest in the background in small slices
  useEffect(() => {
    let live = true;
    (async () => {
      const p1 = await pdf.getPage(1);
      const v = p1.getViewport({ scale: 1 });
      if (!live) return;
      setSizes(Array.from({ length: n }, () => ({ w: v.width, h: v.height })));
      const out: { w: number; h: number }[] = [];
      for (let i = 1; i <= n; i++) {
        const p = await pdf.getPage(i);
        const vp = p.getViewport({ scale: 1 });
        out.push({ w: vp.width, h: vp.height });
        if (!live) return;
        if (i % 12 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      if (out.some((s) => s.w !== v.width || s.h !== v.height)) setSizes(out);
    })();
    return () => {
      live = false;
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

  // ---- render queue -----------------------------------------------------------------------------
  const targetScale = (i: number) => {
    // zoomed-in pages are huge: trade a little sharpness for a lot of speed
    const dpr = Math.min(window.devicePixelRatio || 1, zoomRef.current > 1.4 ? 1.5 : 2);
    const cssW = pageW(i);
    return Math.min((cssW * dpr) / sizes[i].w, Math.sqrt(MAX_PIXELS / (sizes[i].w * sizes[i].h)));
  };

  const ensureText = async (i: number) => {
    const el = pageEls.current[i];
    if (!el || el.querySelector('.textLayer')) return;
    const page = await pdf.getPage(i + 1);
    if (!alive.current || !pageEls.current[i] || !visible.current.has(i)) return;
    const tl = document.createElement('div');
    tl.className = 'textLayer';
    el.appendChild(tl);
    const cssScale = pageW(i) / sizes[i].w;
    try {
      const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: page.getViewport({ scale: cssScale }) });
      await layer.render();
      if (findQ.current) markFind(tl, findQ.current);
    } catch {
      /* page was recycled */
    }
  };

  const draw = async (i: number) => {
    const el = pageEls.current[i];
    if (!el || !sizes[i] || !visible.current.has(i)) return;
    const scale = targetScale(i);
    const prev = done.current.get(i);
    if (prev !== undefined && Math.abs(prev - scale) / scale < 0.04) {
      await ensureText(i);
      return;
    }
    const page = await pdf.getPage(i + 1);
    if (!alive.current || !visible.current.has(i)) return;
    const canvas = document.createElement('canvas');
    try {
      const viewport = page.getViewport({ scale });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d', { alpha: false })!;
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      if (!alive.current || !pageEls.current[i] || !visible.current.has(i)) return;
      const old = el.querySelector('canvas');
      if (old) old.replaceWith(canvas);
      else el.prepend(canvas);
      done.current.set(i, scale);
    } catch {
      return;
    }
    await ensureText(i);
  };

  const pump = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      while (queue.current.size && alive.current) {
        const sc = scroller;
        const mid = sc ? sc.scrollTop + sc.clientHeight / 2 : 0;
        let best = -1;
        let bd = Infinity;
        for (const i of queue.current) {
          const el = pageEls.current[i];
          const d = el ? Math.abs(el.offsetTop + el.offsetHeight / 2 - mid) : 1e9;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        queue.current.delete(best);
        await draw(best);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
    } finally {
      busy.current = false;
    }
  }, [scroller, sizes, zoom, vw, pdf]); // eslint-disable-line react-hooks/exhaustive-deps

  const pumpRef = useRef(pump);
  pumpRef.current = pump;

  // visibility tracking: only pages near the viewport are kept rendered
  useEffect(() => {
    if (!scroller || !sizes.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.i);
          if (e.isIntersecting) {
            visible.current.add(i);
            queue.current.add(i);
          } else {
            visible.current.delete(i);
            queue.current.delete(i);
            const el = pageEls.current[i];
            const far = [...visible.current].every((v) => Math.abs(v - i) > 3);
            if (el && far) {
              el.querySelector('canvas')?.remove();
              el.querySelector('.textLayer')?.remove();
              done.current.delete(i);
            }
          }
        }
        pumpRef.current();
      },
      { root: scroller, rootMargin: '60% 0px' },
    );
    pageEls.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [scroller, sizes.length]);

  // zoom / width changed: keep what's on screen, rescale text layers by CSS, then sharpen
  useLayoutEffect(() => {
    sizes.forEach((s, i) => {
      const el = pageEls.current[i];
      if (el && s) el.style.setProperty('--total-scale-factor', String(pageW(i) / s.w));
    });
    const wr = wrap.current;
    if (wr) {
      wr.style.transform = '';
      wr.style.willChange = '';
    }
    const p = pending.current;
    if (p && scroller) {
      pending.current = null;
      scroller.scrollLeft = (p.sl + p.cx) * p.real - p.cx;
      scroller.scrollTop = (p.st + p.cy) * p.real - p.cy;
    }
    const t = window.setTimeout(() => {
      visible.current.forEach((i) => queue.current.add(i));
      pumpRef.current();
    }, 220);
    return () => clearTimeout(t);
  }, [zoom, vw, sizes]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- current page + progress (one rAF-throttled listener, state only when the page changes)
  useEffect(() => {
    if (!scroller) return;
    let raf = 0;
    let lastPage = 0;
    const on = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const mid = scroller.scrollTop + scroller.clientHeight * 0.4;
        let lo = 0;
        let hi = pageEls.current.length - 1;
        while (lo < hi) {
          const m = (lo + hi + 1) >> 1;
          const el = pageEls.current[m];
          if (el && el.offsetTop <= mid) lo = m;
          else hi = m - 1;
        }
        const max = scroller.scrollHeight - scroller.clientHeight;
        onProgress(max > 0 ? scroller.scrollTop / max : 0);
        if (lo + 1 !== lastPage) {
          lastPage = lo + 1;
          setCur(lastPage);
          onPage(lastPage);
        }
      });
    };
    scroller.addEventListener('scroll', on, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', on);
      cancelAnimationFrame(raf);
    };
  }, [scroller, onPage, onProgress]);

  // restore position once sizes are known
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (restored.current || !sizes.length || !scroller) return;
    restored.current = true;
    if (initialPage > 1) pageEls.current[initialPage - 1]?.scrollIntoView({ block: 'start' });
  }, [sizes, scroller, initialPage]);

  // ---- pinch zoom + double tap: the gesture only moves a CSS transform; layout happens once at the end
  useEffect(() => {
    const el = scroller;
    const inner = wrap.current;
    if (!el || !inner) return;
    let start: { d: number; cx: number; cy: number; sl: number; st: number } | null = null;
    let scale = 1;
    let raf = 0;
    let lastTap = 0;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const commit = (factor: number, cx: number, cy: number, sl: number, st: number) => {
      const next = Math.max(0.6, Math.min(4, zoomRef.current * factor));
      const real = next / zoomRef.current;
      if (Math.abs(real - 1) < 0.01) {
        inner.style.transform = '';
        inner.style.willChange = '';
        return;
      }
      pending.current = { real, cx, cy, sl, st };
      setZoom(next);
    };
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
        inner.style.willChange = 'transform';
      } else if (e.touches.length === 1) {
        const now = Date.now();
        if (now - lastTap < 280) {
          const r = el.getBoundingClientRect();
          commit(zoomRef.current > 1.05 ? 1 / zoomRef.current : 2 / zoomRef.current, e.touches[0].clientX - r.left, e.touches[0].clientY - r.top, el.scrollLeft, el.scrollTop);
          lastTap = 0;
        } else lastTap = now;
      }
    };
    const tm = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      scale = Math.max(0.5 / zoomRef.current, Math.min(4 / zoomRef.current, dist(e.touches) / start.d));
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          inner.style.transform = `scale(${scale})`;
        });
    };
    const te = () => {
      if (!start) return;
      const s = start;
      start = null;
      cancelAnimationFrame(raf);
      raf = 0;
      if (Math.abs(scale - 1) > 0.02) commit(scale, s.cx, s.cy, s.sl, s.st);
      else {
        inner.style.transform = '';
        inner.style.willChange = '';
      }
      scale = 1;
    };
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    el.addEventListener('touchcancel', te);
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      commit(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - r.left, e.clientY - r.top, el.scrollLeft, el.scrollTop);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', te);
      el.removeEventListener('touchcancel', te);
      el.removeEventListener('wheel', wheel);
      cancelAnimationFrame(raf);
    };
  }, [scroller]);

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
          <div
            key={i}
            className="pdf-page"
            data-i={i}
            ref={(el) => {
              pageEls.current[i] = el;
            }}
            style={{ width: pageW(i), height: pageH(i) }}
          >
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
          const { canvas } = await renderPage(page, 100 / v.width);
          const url = canvas.toDataURL('image/jpeg', 0.6);
          setUrls((u) => ({ ...u, [i]: url }));
        }
      },
      { root: el, rootMargin: '200px 0px' },
    );
    el.querySelectorAll('button').forEach((b) => io.observe(b));
    return () => io.disconnect();
  }, [pdf]);
  useEffect(() => {
    box.current?.querySelector(`[data-p="${cur}"]`)?.scrollIntoView({ block: 'nearest' });
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
