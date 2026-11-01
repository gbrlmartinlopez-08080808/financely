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

const MAX_PIXELS = 4_200_000; // full page canvas budget
const devPx = () => Math.min(window.devicePixelRatio || 1, 3.5);
/** Snap a CSS length to whole device pixels so the canvas maps 1:1 onto the screen (no resampling blur). */
const snap = (css: number) => Math.round(css * devPx()) / devPx();
const MAX_HI_PIXELS = 3_600_000; // zoomed-in detail tile budget

/** Soft page pictures stay with the open document (it stays open a while, see pdfCache): a book opened again shows every page at once. */
const previewStore = new WeakMap<PDFDocumentProxy, Map<number, HTMLCanvasElement>>();
const previewsOf = (pdf: PDFDocumentProxy) => {
  let m = previewStore.get(pdf);
  if (!m) previewStore.set(pdf, (m = new Map()));
  return m;
};

export const PdfView = forwardRef<PdfViewHandle, Props>(function PdfView({ pdf, scroller, initialPage = 1, thumbs, onPage, onProgress, onTap }, ref) {
  const n = pdf.numPages;
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [zoom, setZoom] = useState(1);
  const [vw, setVw] = useState(() => window.innerWidth);
  const [cur, setCur] = useState(initialPage);
  const curRef = useRef(initialPage);
  curRef.current = cur;
  const wrap = useRef<HTMLDivElement>(null);
  const pageEls = useRef<(HTMLDivElement | null)[]>([]);
  const done = useRef(new Map<number, number>()); // page index -> scale already rendered at
  const hiDone = useRef(new Map<number, { x0: number; y0: number; x1: number; y1: number; s: number }>());
  const hiQueue = useRef(new Set<number>());
  const visible = useRef(new Set<number>());
  const queue = useRef(new Set<number>());
  const busy = useRef(false);
  const findQ = useRef('');
  const tasks = useRef(new Set<{ cancel: () => void }>()); // renders in flight (so a new gesture can stop them at once)
  /** quick, soft pictures of pages (kept for many pages around you, so flipping back and forth is instant) */
  const previews = useRef(previewsOf(pdf));
  /** a fast flick is under way: only previews are drawn until it slows down */
  const flinging = useRef(false);
  const gesturing = useRef(false); // true while fingers are pinching: no canvas work, so the gesture stays at 60fps
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const pending = useRef<{ i: number; fx: number; fy: number; ex: number; ey: number } | null>(null); // the page point to keep under the fingers
  const anchor = useRef<{ i: number; off: number } | null>(null); // which page (and how far into it) is at the top of the view
  const lastZoom = useRef(zoom);
  const lastSizes = useRef(sizes);
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
  const pageW = (i: number) => snap(sizes[i] ? baseW * zoom * Math.min(1.4, sizes[i].w / (sizes[0]?.w || sizes[i].w)) : baseW * zoom);
  const pageH = (i: number) => snap(sizes[i] ? (pageW(i) * sizes[i].h) / sizes[i].w : pageW(i) * 1.3);

  // ---- render queue -----------------------------------------------------------------------------
  const targetScale = (i: number) => {
    const wPx = Math.round(pageW(i) * devPx());
    return Math.min(wPx / sizes[i].w, Math.sqrt(MAX_PIXELS / (sizes[i].w * sizes[i].h)));
  };

  const ensureText = async (i: number) => {
    const el = pageEls.current[i];
    if (!el || el.querySelector('.textLayer')) return;
    const page = await pdf.getPage(i + 1);
    if (!alive.current || !pageEls.current[i] || !visible.current.has(i)) return;
    const tl = document.createElement('div');
    tl.className = 'textLayer';
    // built once at this size; later zooms just scale the whole layer (one cheap transform, no re-layout of the words)
    const w0 = pageW(i);
    tl.dataset.w0 = String(w0);
    const h0 = pageH(i);
    const fix = () => {
      const st = tl.style;
      st.inset = 'auto';
      st.left = '0';
      st.top = '0';
      st.width = `${w0}px`;
      st.height = `${h0}px`;
      st.transformOrigin = '0 0';
      st.setProperty('--total-scale-factor', String(w0 / sizes[i].w));
    };
    fix();
    el.appendChild(tl);
    const cssScale = w0 / sizes[i].w;
    try {
      const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: page.getViewport({ scale: cssScale }) });
      fix(); // pdf.js sizes the layer itself; keep the size this layer was built at
      await layer.render();
      fix();
      if (findQ.current) markFind(tl, findQ.current);
    } catch {
      /* page was recycled */
    }
  };

  /** A soft picture of the page, drawn at a fraction of the cost: what you see while the sharp one is made. */
  const drawPreview = async (i: number) => {
    const el = pageEls.current[i];
    if (!el || !sizes[i]) return;
    let pv = previews.current.get(i);
    if (!pv) {
      const page = await pdf.getPage(i + 1);
      if (!alive.current || !pageEls.current[i]) return;
      const scale = Math.max(0.25, Math.min(0.7, 250 / sizes[i].w)); // ~250 px wide: enough to recognise the page, quick to draw
      const viewport = page.getViewport({ scale });
      pv = document.createElement('canvas');
      pv.className = 'pv';
      pv.width = Math.round(viewport.width);
      pv.height = Math.round(viewport.height);
      const task = page.render({ canvas: pv, canvasContext: pv.getContext('2d', { alpha: false })!, viewport });
      tasks.current.add(task);
      try {
        await task.promise;
      } catch {
        return;
      } finally {
        tasks.current.delete(task);
      }
      previews.current.set(i, pv);
      // previews of pages far away are let go (memory)
      if (previews.current.size > Math.max(60, Math.min(n, 130))) {
        for (const k of previews.current.keys()) {
          if ([...visible.current].every((v) => Math.abs(v - k) > 25)) previews.current.delete(k);
          if (previews.current.size <= Math.max(50, Math.min(n, 120))) break;
        }
      }
    }
    if (!el.querySelector('canvas')) el.prepend(pv);
  };

  const draw = async (i: number) => {
    const el = pageEls.current[i];
    if (!el || !sizes[i] || !visible.current.has(i)) return;
    // nothing on the page yet: the soft picture first (instant), the sharp one next
    if (!el.querySelector('canvas:not(.pv):not(.hi)')) {
      await drawPreview(i);
      if (flinging.current) {
        queue.current.add(i); // sharpened once the page stops flying past
        return;
      }
    }
    // When zoomed in, the full page is drawn at "fit width" sharpness only; detail tiles (below) carry the zoom.
    // So zooming never means re-drawing whole pages, and zooming out never re-draws anything.
    const zoomedIn = zoomRef.current > 1.15;
    const scale = zoomedIn ? Math.min(Math.round((pageW(i) / zoomRef.current) * devPx()) / sizes[i].w, targetScale(i)) : targetScale(i);
    const prev = done.current.get(i);
    if (prev !== undefined && (zoomedIn || (prev >= scale * 0.92 && prev <= scale * 2.6))) {
      await ensureText(i);
      return;
    }
    const page = await pdf.getPage(i + 1);
    if (!alive.current || !visible.current.has(i)) return;
    const canvas = document.createElement('canvas');
    try {
      const viewport = page.getViewport({ scale });
      // exact device-pixel size of the page box: one canvas pixel per screen pixel
      const exact = !zoomedIn && Math.abs(viewport.width - pageW(i) * devPx()) < 1.5;
      canvas.width = exact ? Math.round(pageW(i) * devPx()) : Math.round(viewport.width);
      canvas.height = exact ? Math.round(pageH(i) * devPx()) : Math.round(viewport.height);
      const ctx = canvas.getContext('2d', { alpha: false })!;
      const task = page.render({ canvas, canvasContext: ctx, viewport });
      tasks.current.add(task);
      try {
        await task.promise;
      } finally {
        tasks.current.delete(task);
      }
      if (!alive.current || !pageEls.current[i] || !visible.current.has(i)) return;
      const old = el.querySelector('canvas:not(.hi)');
      if (old) old.replaceWith(canvas); // (a preview goes back to its store and can be shown again later)
      else el.prepend(canvas);
      done.current.set(i, scale);
      hiDone.current.delete(i);
      hiQueue.current.add(i);
    } catch {
      return;
    }
    await ensureText(i);
  };

  /** When zoomed past what the full-page canvas can hold, render just the visible window at full detail. */
  const drawHi = async (i: number) => {
    const el = pageEls.current[i];
    const sc = scroller;
    const base = done.current.get(i);
    if (!el || !sc || !sizes[i] || base === undefined || !visible.current.has(i)) return;
    const dpr = devPx();
    const cssW = pageW(i);
    const cssPerPdf = cssW / sizes[i].w;
    const wanted = dpr * cssPerPdf;
    const clear = () => {
      el.querySelector('canvas.hi')?.remove();
      hiDone.current.delete(i);
    };
    if (wanted <= base * 1.12) return clear();
    const pr = el.getBoundingClientRect();
    const vr = sc.getBoundingClientRect();
    const zoomed = pr.width / el.offsetWidth || 1; // 1 unless a pinch transform is mid-flight
    const mx = vr.width * 0.18;
    const my = vr.height * 0.18;
    // tile edges sit on whole device pixels, like the page itself
    const x0 = Math.floor(Math.max(0, (vr.left - mx - pr.left) / zoomed) * dpr) / dpr;
    const y0 = Math.floor(Math.max(0, (vr.top - my - pr.top) / zoomed) * dpr) / dpr;
    const x1 = Math.ceil(Math.min(el.offsetWidth, (vr.right + mx - pr.left) / zoomed) * dpr) / dpr;
    const y1 = Math.ceil(Math.min(el.offsetHeight, (vr.bottom + my - pr.top) / zoomed) * dpr) / dpr;
    if (x1 - x0 < 20 || y1 - y0 < 20) return clear();
    const rw = x1 - x0;
    const rh = y1 - y0;
    const s = Math.min(wanted, cssPerPdf * Math.sqrt(MAX_HI_PIXELS / (rw * rh)));
    if (s <= base * 1.05) return clear();
    const prev = hiDone.current.get(i);
    if (prev && Math.abs(prev.s - s) / s < 0.03 && x0 >= prev.x0 - 1 && y0 >= prev.y0 - 1 && x1 <= prev.x1 + 1 && y1 <= prev.y1 + 1) return;
    const page = await pdf.getPage(i + 1);
    if (!alive.current || !visible.current.has(i)) return;
    const k = s / cssPerPdf; // device pixels per css pixel
    const viewport = page.getViewport({ scale: s, offsetX: -x0 * k, offsetY: -y0 * k });
    const canvas = document.createElement('canvas');
    canvas.className = 'hi';
    canvas.width = Math.round(rw * k);
    canvas.height = Math.round(rh * k);
    // percentages of the page box, so the tile scales with the page if the size changes before it is replaced
    const cssH = pageH(i);
    // (inset first: the shorthand would otherwise wipe out left/top)
    canvas.style.cssText = `inset:auto;left:${(x0 / cssW) * 100}%;top:${(y0 / cssH) * 100}%;width:${(rw / cssW) * 100}%;height:${(rh / cssH) * 100}%`;
    const task = page.render({ canvas, canvasContext: canvas.getContext('2d', { alpha: false })!, viewport });
    tasks.current.add(task);
    try {
      await task.promise;
    } catch {
      return;
    } finally {
      tasks.current.delete(task);
    }
    if (!alive.current || !visible.current.has(i) || Math.abs(pageW(i) - cssW) > 1) return;
    el.querySelector('canvas.hi')?.remove();
    el.insertBefore(canvas, el.querySelector('.textLayer'));
    hiDone.current.set(i, { x0, y0, x1, y1, s });
  };

  const pump = useCallback(async () => {
    if (busy.current || gesturing.current) return;
    busy.current = true;
    try {
      const nearest = (set: Set<number>, ok: (i: number) => boolean = () => true) => {
        const sc = scroller;
        const mid = sc ? sc.scrollTop + sc.clientHeight / 2 : 0;
        let best = -1;
        let bd = Infinity;
        for (const i of set) {
          if (!ok(i)) continue;
          const el = pageEls.current[i];
          const d = el ? Math.abs(el.offsetTop + el.offsetHeight / 2 - mid) : 1e9;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        return best;
      };
      const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
      while ((queue.current.size || hiQueue.current.size) && alive.current && !gesturing.current) {
        const zoomedIn = zoomRef.current > 1.15;
        // zoomed in: the sharp tile for what you are looking at comes before anything else
        const hiFirst = zoomedIn ? nearest(hiQueue.current, (i) => done.current.has(i)) : -1;
        if (hiFirst >= 0) {
          hiQueue.current.delete(hiFirst);
          await drawHi(hiFirst);
        } else if (queue.current.size) {
          const i = nearest(queue.current);
          queue.current.delete(i);
          await draw(i);
        } else {
          const i = nearest(hiQueue.current);
          if (i < 0) break;
          hiQueue.current.delete(i);
          await drawHi(i);
        }
        await frame();
      }
    } finally {
      busy.current = false;
    }
  }, [scroller, sizes, zoom, vw, pdf]); // eslint-disable-line react-hooks/exhaustive-deps

  const pumpRef = useRef(pump);
  pumpRef.current = pump;

  // Soft pictures of the pages around you are made ahead of time, in the quiet moments (the whole book when it is
  // short), so a page that flies into view already shows something — never a blank sheet.
  useEffect(() => {
    if (!sizes.length) return;
    let stop = false;
    const idle = () => new Promise<void>((r) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 300 }) : setTimeout(r, 30)));
    (async () => {
      await new Promise((r) => setTimeout(r, 700)); // the page you opened on goes first
      for (;;) {
        if (stop || !alive.current) return;
        if (busy.current || gesturing.current) {
          await new Promise((r) => setTimeout(r, 120));
          continue;
        }
        const here = curRef.current - 1;
        const span = n <= 120 ? n : 30;
        let next = -1;
        for (let d = 0; d <= span && next < 0; d++)
          for (const i of [here + d, here - d]) if (i >= 0 && i < n && !previews.current.has(i)) {
            next = i;
            break;
          }
        if (next < 0) {
          await new Promise((r) => setTimeout(r, 800)); // all done around here: look again when the reader has moved
          continue;
        }
        await drawPreview(next);
        await idle();
      }
    })();
    return () => {
      stop = true;
    };
  }, [sizes.length, pdf]); // eslint-disable-line react-hooks/exhaustive-deps

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
              // the sharp picture goes (memory); the soft one stays, so coming back shows the page at once
              el.querySelectorAll('canvas:not(.pv)').forEach((c) => c.remove());
              el.querySelector('.textLayer')?.remove();
              const pv = previews.current.get(i);
              if (pv && !el.contains(pv)) el.prepend(pv);
              done.current.delete(i);
              hiDone.current.delete(i);
              hiQueue.current.delete(i);
            }
          }
        }
        pumpRef.current();
      },
      { root: scroller, rootMargin: '140% 0px' },
    );
    pageEls.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [scroller, sizes.length]);

  // zoom / width / page sizes changed: keep what's on screen, rescale text layers by CSS, then sharpen
  useLayoutEffect(() => {
    pageEls.current.forEach((el, i) => {
      const tl = el?.querySelector<HTMLElement>(':scope > .textLayer');
      if (!tl || !sizes[i]) return;
      const r = pageW(i) / Number(tl.dataset.w0 || pageW(i));
      tl.style.transform = Math.abs(r - 1) < 0.001 ? '' : `scale(${r})`;
    });
    const wr = wrap.current;
    if (wr) {
      wr.style.transition = '';
      wr.style.transform = '';
      wr.style.willChange = '';
    }
    // detail tiles belong to the old size: drop them at once (new ones follow)
    wr?.querySelectorAll('canvas.hi').forEach((c) => c.remove());
    hiDone.current.clear();
    if (scroller) scroller.style.overflowX = zoom > 1.01 ? 'auto' : 'hidden';
    const zoomChanged = lastZoom.current !== zoom;
    const sizesChanged = lastSizes.current !== sizes;
    lastZoom.current = zoom;
    lastSizes.current = sizes;
    const p = pending.current;
    if (p && scroller) {
      // the point of the page that was under your fingers stays under them, whatever the gaps and padding do
      pending.current = null;
      const el = pageEls.current[p.i];
      if (el) {
        scroller.scrollTop = el.offsetTop + p.fy * pageH(p.i) - p.ey;
        scroller.scrollLeft = el.offsetLeft + p.fx * pageW(p.i) - p.ex;
      }
    } else if (!zoomChanged && sizesChanged && anchor.current && scroller) {
      // real page sizes arrived after the first layout: stay on the same page, same spot in it
      const a = anchor.current;
      const el = pageEls.current[a.i];
      if (el) scroller.scrollTop = el.offsetTop + a.off * pageH(a.i);
    }
    const t = window.setTimeout(() => {
      visible.current.forEach((i) => {
        queue.current.add(i);
        hiQueue.current.add(i);
        hiDone.current.delete(i);
      });
      pumpRef.current();
    }, 60);
    return () => clearTimeout(t);
  }, [zoom, vw, sizes]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- current page + progress (one rAF-throttled listener, state only when the page changes)
  useEffect(() => {
    if (!scroller) return;
    let raf = 0;
    let lastPage = 0;
    let idle = 0;
    let lastY = scroller.scrollTop;
    let lastT = performance.now();
    let calm = 0;
    const on = () => {
      // how fast are the pages going by? past ~2.5 screens a second, only soft pictures are drawn
      const t = performance.now();
      const v = Math.abs(scroller.scrollTop - lastY) / Math.max(1, t - lastT);
      lastY = scroller.scrollTop;
      lastT = t;
      if (v * 1000 > scroller.clientHeight * 2.5) flinging.current = true;
      clearTimeout(calm);
      calm = window.setTimeout(() => {
        if (!flinging.current) return;
        flinging.current = false;
        visible.current.forEach((i) => queue.current.add(i));
        pumpRef.current();
      }, 120);
      clearTimeout(idle);
      idle = window.setTimeout(() => {
        if (zoomRef.current <= 1.01 && !hiDone.current.size) return;
        visible.current.forEach((i) => hiQueue.current.add(i));
        pumpRef.current();
      }, 110);
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
        const top = pageEls.current[lo];
        if (top && !gesturing.current) anchor.current = { i: lo, off: (scroller.scrollTop - top.offsetTop) / Math.max(1, top.offsetHeight) };
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
      clearTimeout(idle);
      clearTimeout(calm);
    };
  }, [scroller, onPage, onProgress]);

  // restore position once sizes are known
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (restored.current || !sizes.length || !scroller) return;
    restored.current = true;
    if (initialPage > 1) {
      pageEls.current[initialPage - 1]?.scrollIntoView({ block: 'start' });
      anchor.current = { i: initialPage - 1, off: 0 };
    }
  }, [sizes, scroller, initialPage]);

  // ---- pinch zoom + double tap
  // The gesture only moves a CSS transform on the page stack (scale AND pan, so the page follows your fingers);
  // layout happens once, when the fingers lift. Past the limits it stretches softly and springs back, close to
  // "fit width" it snaps, and nothing is drawn while fingers are down. Every timer belongs to a gesture number,
  // so a new touch always cleanly takes over from an unfinished one.
  useEffect(() => {
    const el = scroller;
    const inner = wrap.current;
    if (!el || !inner) return;
    const MIN = 0.6;
    const MAX = 5;
    let gen = 0;
    let start: { d: number; cx: number; cy: number; sl: number; st: number } | null = null;
    let live = { scale: 1, dx: 0, dy: 0 };
    let raf = 0;
    let lastTap = 0;
    let lastTapAt = { x: 0, y: 0 };
    let finish: (() => void) | null = null; // completes an animation that is still running
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t: TouchList, r: DOMRect) => ({ x: (t[0].clientX + t[1].clientX) / 2 - r.left, y: (t[0].clientY + t[1].clientY) / 2 - r.top });
    const soft = (factor: number) => {
      const z = zoomRef.current * factor;
      if (z < MIN) return (MIN * Math.pow(z / MIN, 0.45)) / zoomRef.current;
      if (z > MAX) return (MAX * Math.pow(z / MAX, 0.45)) / zoomRef.current;
      return factor;
    };
    const clampTotal = (factor: number) => {
      let z = Math.max(MIN, Math.min(MAX, zoomRef.current * factor));
      if (Math.abs(z - 1) < 0.07) z = 1;
      return z / zoomRef.current;
    };
    const clearTransform = () => {
      inner.style.transition = '';
      inner.style.transform = '';
      inner.style.willChange = '';
    };
    const paint = () => {
      raf = 0;
      inner.style.transform = `translate(${live.dx}px, ${live.dy}px) scale(${live.scale})`;
    };
    /** Which page, and where in it, sits at content point (x, y) of the unzoomed layout. */
    const anchorAt = (x: number, y: number) => {
      const pages = pageEls.current;
      let i = 0;
      for (let k = 0; k < pages.length; k++) {
        const p = pages[k];
        if (!p) continue;
        i = k;
        if (p.offsetTop + p.offsetHeight >= y) break;
      }
      const p = pages[i];
      if (!p) return null;
      return { i, fx: (x - p.offsetLeft) / Math.max(1, p.offsetWidth), fy: Math.max(0, Math.min(1, (y - p.offsetTop) / Math.max(1, p.offsetHeight))) };
    };
    /** Apply the new size for real: one React render, and the page point under the fingers stays there. */
    const commit = (factor: number, fcx: number, fcy: number, ex: number, ey: number) => {
      const real = clampTotal(factor);
      gesturing.current = false;
      if (Math.abs(real - 1) < 0.01) {
        const sl = el.scrollLeft;
        const st = el.scrollTop;
        clearTransform();
        el.scrollLeft = sl + (fcx - el.scrollLeft) - ex;
        el.scrollTop = st + (fcy - el.scrollTop) - ey;
        pumpRef.current();
        return;
      }
      const a = anchorAt(fcx, fcy);
      if (!a) return clearTransform();
      pending.current = { ...a, ex, ey };
      setZoom(Math.round(zoomRef.current * real * 1000) / 1000);
    };
    const abandon = () => {
      // a new touch arrived while something was animating: finish it instantly, then carry on
      const f = finish;
      finish = null;
      gen++;
      f?.();
    };
    const settle = (s: NonNullable<typeof start>, ex: number, ey: number) => {
      const my = ++gen;
      const real = clampTotal(live.scale);
      const fcx = s.sl + s.cx;
      const fcy = s.st + s.cy;
      const go = () => {
        finish = null;
        commit(real, fcx, fcy, ex, ey);
      };
      if (Math.abs(real - live.scale) < 0.015) return go();
      // spring back from the rubber band
      inner.style.transition = 'transform 0.16s cubic-bezier(0.2, 0.8, 0.2, 1)';
      inner.style.transform = `translate(${ex - s.cx}px, ${ey - s.cy}px) scale(${real})`;
      finish = go;
      window.setTimeout(() => my === gen && go(), 170);
    };
    const ts = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        abandon();
        const r = el.getBoundingClientRect();
        const m = mid(e.touches, r);
        start = { d: dist(e.touches), cx: m.x, cy: m.y, sl: el.scrollLeft, st: el.scrollTop };
        live = { scale: 1, dx: 0, dy: 0 };
        gesturing.current = true;
        tasks.current.forEach((t) => t.cancel());
        tasks.current.clear();
        inner.style.transition = '';
        inner.style.transformOrigin = `${start.cx + start.sl}px ${start.cy + start.st}px`;
        inner.style.willChange = 'transform';
        lastTap = 0;
      } else if (e.touches.length === 1) {
        const now = Date.now();
        const x = e.touches[0].clientX;
        const y = e.touches[0].clientY;
        if (now - lastTap < 300 && Math.hypot(x - lastTapAt.x, y - lastTapAt.y) < 40 && !start) {
          abandon();
          const r = el.getBoundingClientRect();
          const cx = x - r.left;
          const cy = y - r.top;
          const sl = el.scrollLeft;
          const st = el.scrollTop;
          const want = zoomRef.current > 1.05 ? 1 / zoomRef.current : 2.2 / zoomRef.current;
          const real = clampTotal(want);
          const my = ++gen;
          gesturing.current = true;
          tasks.current.forEach((t) => t.cancel());
          tasks.current.clear();
          // glide to the new size, then lay out once
          inner.style.transformOrigin = `${cx + sl}px ${cy + st}px`;
          inner.style.willChange = 'transform';
          inner.style.transition = 'transform 0.26s cubic-bezier(0.2, 0.8, 0.2, 1)';
          inner.style.transform = `scale(${real})`;
          const go = () => {
            finish = null;
            commit(real, sl + cx, st + cy, cx, cy);
          };
          finish = go;
          window.setTimeout(() => my === gen && go(), 270);
          lastTap = 0;
        } else {
          lastTap = now;
          lastTapAt = { x, y };
        }
      }
    };
    const tm = (e: TouchEvent) => {
      if (!start || e.touches.length < 2) return;
      if (e.cancelable) e.preventDefault();
      const r = el.getBoundingClientRect();
      const m = mid(e.touches, r);
      live = { scale: soft(dist(e.touches) / start.d), dx: m.x - start.cx, dy: m.y - start.cy };
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const te = () => {
      if (!start) return;
      const s = start;
      start = null;
      cancelAnimationFrame(raf);
      raf = 0;
      const ex = s.cx + live.dx;
      const ey = s.cy + live.dy;
      if (Math.abs(live.scale - 1) > 0.015 || Math.abs(live.dx) + Math.abs(live.dy) > 4) settle(s, ex, ey);
      else {
        gesturing.current = false;
        clearTransform();
        pumpRef.current();
      }
    };
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    el.addEventListener('touchcancel', te);
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      commit(e.deltaY < 0 ? 1.1 : 0.9, el.scrollLeft + cx, el.scrollTop + cy, cx, cy);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      gen++;
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', te);
      el.removeEventListener('touchcancel', te);
      el.removeEventListener('wheel', wheel);
      cancelAnimationFrame(raf);
      gesturing.current = false;
    };
  }, [scroller]);

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
