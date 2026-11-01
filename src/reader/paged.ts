// Flipping pages instead of scrolling. A Liquid view is laid out in columns, one column per page; the scroller moves
// sideways by whole pages. Because it is still an ordinary scroller (just with its overflow hidden), everything that
// scrolls to a place — the contents, find, reading aloud — keeps working; this only adds the turning.
//
// Turning a page is drawn as a real page curl: the page being turned is a copy of the text (a "leaf", kept ready in
// the background) that is folded back along a line that follows the finger, with the next page — the real reader —
// showing underneath. If the copy is not ready (the text just changed) or the book is huge, the page slides instead.
//
// Two things the old version got wrong, and this one does not:
//  • the last page could not be reached exactly (the columns do not end on a whole page), so it stopped between pages;
//  • a tap during a turn left the reader between two pages. Whatever happens, a page always ends on a whole page.
import { useEffect } from 'react';
import { tap } from '../lib/native';

const flowOf = (sc: HTMLElement) => sc.querySelector<HTMLElement>('.flow.paged');
const width = (sc: HTMLElement) => Math.max(1, sc.clientWidth);

/** Number of pages. Also pads the scroller so the last page can be reached exactly (columns end a margin short). */
export function pageCount(sc: HTMLElement): number {
  const f = flowOf(sc);
  const w = width(sc);
  const n = Math.max(1, Math.ceil(((f ? f.scrollWidth : sc.scrollWidth) - 2) / w));
  let pad = sc.querySelector<HTMLElement>(':scope > .pg-pad');
  if (!pad) {
    pad = document.createElement('i');
    pad.className = 'pg-pad';
    sc.appendChild(pad);
  }
  const left = `${n * w - 1}px`;
  if (pad.style.left !== left) pad.style.left = left;
  return n;
}
export const pageIndex = (sc: HTMLElement) => Math.max(0, Math.min(pageCount(sc) - 1, Math.round(sc.scrollLeft / width(sc))));

// ---------------------------------------------------------------------------------------------------------------- slide
let anim = 0;
let animEnd = 0;
function cancelSlide(sc: HTMLElement) {
  cancelAnimationFrame(anim);
  clearTimeout(animEnd);
  sc.classList.remove('flipping');
}
function slideTo(sc: HTMLElement, to: number, animate: boolean) {
  cancelSlide(sc);
  if (!animate || Math.abs(sc.scrollLeft - to) < 2) {
    sc.scrollLeft = to;
    return;
  }
  const from = sc.scrollLeft;
  const t0 = performance.now();
  const dur = Math.min(440, 230 + (Math.abs(to - from) / width(sc)) * 90);
  sc.classList.add('flipping');
  const done = () => {
    cancelSlide(sc);
    sc.scrollLeft = to; // always ends exactly on the page, even if frames were skipped
  };
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / dur);
    sc.scrollLeft = from + (to - from) * (1 - Math.pow(1 - k, 3));
    if (k < 1) anim = requestAnimationFrame(step);
    else done();
  };
  anim = requestAnimationFrame(step);
  animEnd = window.setTimeout(done, dur + 120);
}

// ----------------------------------------------------------------------------------------------------------------- curl
interface Pt {
  x: number;
  y: number;
}
/** the part of a rectangle on one side of a line (n·p ≤ c keeps the "behind" side, or the other with `ahead`) */
function clipRect(W: number, H: number, n: Pt, c: number, ahead: boolean): Pt[] {
  let poly: Pt[] = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: H },
    { x: 0, y: H },
  ];
  const side = (p: Pt) => (ahead ? 1 : -1) * (n.x * p.x + n.y * p.y - c);
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const sa = side(a);
    const sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const k = sa / (sa - sb);
      out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
    }
  }
  poly = out;
  return poly;
}
const css = (p: Pt[]) => (p.length < 3 ? 'polygon(0 0, 0 0, 0 0)' : `polygon(${p.map((q) => `${q.x.toFixed(1)}px ${q.y.toFixed(1)}px`).join(',')})`);

const MAX_NODES = 24000; // a book bigger than this slides instead (a copy of it would be too heavy)

interface Curl {
  root: HTMLElement; // the overlay
  host: HTMLElement; // the copy of the text (the page being turned)
  front: HTMLElement;
  under: HTMLElement; // shade cast on the page beneath
  flapWrap: HTMLElement;
  flap: HTMLElement;
  src: HTMLElement;
  stale: boolean;
  mo: MutationObserver;
  timer: number;
  nodes: number;
}
const curls = new WeakMap<HTMLElement, Curl>();

function makeCurl(sc: HTMLElement): Curl | null {
  const src = flowOf(sc);
  const parent = sc.parentElement;
  if (!src || !parent) return null;
  const nodes = src.getElementsByTagName('*').length;
  if (nodes > MAX_NODES) return null;
  const root = document.createElement('div');
  root.className = 'curl';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = '<div class="curl-front"></div><div class="curl-under"></div><div class="curl-flapwrap"><div class="curl-flap"></div></div>';
  const front = root.querySelector<HTMLElement>('.curl-front')!;
  const host = document.createElement('div');
  host.className = 'reader-scroll paged leaf';
  front.appendChild(host);
  parent.insertBefore(root, sc.nextSibling);
  const c: Curl = {
    root,
    host,
    front,
    under: root.querySelector<HTMLElement>('.curl-under')!,
    flapWrap: root.querySelector<HTMLElement>('.curl-flapwrap')!,
    flap: root.querySelector<HTMLElement>('.curl-flap')!,
    src,
    stale: true,
    mo: new MutationObserver(() => {
      c.stale = true;
      schedule(sc, c);
    }),
    timer: 0,
    nodes,
  };
  c.mo.observe(src, { childList: true, subtree: true, characterData: true });
  schedule(sc, c, 120);
  return c;
}
/** (re)make the copy of the text when things have been quiet for a moment */
function schedule(sc: HTMLElement, c: Curl, wait = 650) {
  clearTimeout(c.timer);
  c.timer = window.setTimeout(() => {
    const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    const go = () => refresh(sc, c);
    if (ric) ric(go, { timeout: 1500 });
    else go();
  }, wait);
}
function refresh(sc: HTMLElement, c: Curl) {
  if (!c.stale || c.root.dataset.on) return;
  const copy = c.src.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
  copy.querySelectorAll('.saying, .cur').forEach((e) => e.classList.remove('saying', 'cur'));
  c.host.replaceChildren(copy);
  c.stale = false;
  void c.host.scrollWidth; // lay it out now, in the background, not when a finger is waiting
}
const curlFor = (sc: HTMLElement) => {
  let c = curls.get(sc);
  if (c === undefined) {
    c = makeCurl(sc) ?? undefined;
    if (c) curls.set(sc, c);
  }
  return c;
};
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Draws the page curl at `t` (0 = the page lies flat, 1 = turned away). `y0` is where on the page it is held. */
function drawCurl(sc: HTMLElement, c: Curl, t: number, y0: number) {
  const W = sc.clientWidth;
  const H = sc.clientHeight;
  t = Math.max(0, Math.min(1, t));
  if (t <= 0.0005) {
    c.front.style.clipPath = 'none';
    c.under.style.display = 'none';
    c.flapWrap.style.display = 'none';
    return;
  }
  // the corner being held, and where the finger has brought it
  const hold = y0 > H * 0.62 ? Math.min(H, y0) : y0 * 0.5 + H * 0.5;
  const C: Pt = { x: W, y: hold };
  const d = 2.04 * W * (t * t * (3 - 2 * t) * 0.35 + t * 0.65); // a little slower at the start, so a small pull shows a small curl
  const P: Pt = { x: W - d, y: hold - d * 0.2 * (1 - t * 0.6) };
  const M: Pt = { x: (C.x + P.x) / 2, y: (C.y + P.y) / 2 };
  const len = Math.hypot(C.x - P.x, C.y - P.y) || 1;
  const n: Pt = { x: (C.x - P.x) / len, y: (C.y - P.y) / len }; // from the finger toward the held corner
  const k = M.x * n.x + M.y * n.y;
  const stay = clipRect(W, H, n, k, false);
  const lifted = clipRect(W, H, n, k, true);
  c.front.style.clipPath = css(stay);
  // the page beneath is shaded where the leaf has just left it
  const ang = (Math.atan2(n.x, -n.y) * 180) / Math.PI;
  const L = Math.abs(W * Math.sin((ang * Math.PI) / 180)) + Math.abs(H * Math.cos((ang * Math.PI) / 180));
  const s = k - ((W / 2) * n.x + (H / 2) * n.y); // distance of the fold from the middle of the page, along n
  const at = (px: number) => `${(((s + px) / L) * 100 + 50).toFixed(2)}%`;
  c.under.style.display = 'block';
  c.under.style.clipPath = css(lifted);
  c.under.style.background = `linear-gradient(${ang.toFixed(1)}deg, rgba(0,0,0,${(0.34 * (1 - t * 0.5)).toFixed(3)}) ${at(0)}, rgba(0,0,0,0) ${at(70)})`;
  // the back of the leaf: the lifted corner folded over along the line
  c.flapWrap.style.display = 'block';
  const a = 1 - 2 * n.x * n.x;
  const b = -2 * n.x * n.y;
  const dd = 1 - 2 * n.y * n.y;
  c.flap.style.clipPath = css(lifted);
  c.flap.style.transform = `matrix(${a.toFixed(5)},${b.toFixed(5)},${b.toFixed(5)},${dd.toFixed(5)},${(2 * k * n.x).toFixed(2)},${(2 * k * n.y).toFixed(2)})`;
  c.flap.style.background = `linear-gradient(${ang.toFixed(1)}deg, rgba(0,0,0,.18) ${at(0)}, rgba(0,0,0,.04) ${at(22)}, rgba(255,255,255,.22) ${at(60)}, rgba(0,0,0,.025) ${at(240)}), var(--curl-back)`;
}

interface Run {
  sc: HTMLElement;
  c: Curl;
  from: number; // the page the reader was on
  to: number; // the page it goes to when finished
  forward: boolean;
  t: number;
  y0: number;
  raf: number;
  end: number;
}
let run: Run | null = null;

/** Starts a curl between the current page and the next/previous one. Returns null when the page should just slide. */
function startCurl(sc: HTMLElement, forward: boolean, y0: number): Run | null {
  if (reduced()) return null;
  const c = curlFor(sc);
  if (!c || c.stale) return null;
  const from = pageIndex(sc);
  const to = from + (forward ? 1 : -1);
  if (to < 0 || to >= pageCount(sc)) return null;
  const leafPage = forward ? from : to; // the page that is turned
  const underPage = forward ? to : from; // the page that is revealed (the real reader)
  const W = width(sc);
  cancelSlide(sc);
  c.host.scrollLeft = leafPage * W;
  sc.classList.add('flipping');
  sc.scrollLeft = underPage * W;
  c.root.dataset.on = '1';
  const r: Run = { sc, c, from, to, forward, t: forward ? 0 : 1, y0, raf: 0, end: 0 };
  drawCurl(sc, c, r.t, y0);
  run = r;
  return r;
}
function endCurl(r: Run, complete: boolean) {
  cancelAnimationFrame(r.raf);
  clearTimeout(r.end);
  const W = width(r.sc);
  // the leaf (page `leafPage`) covers everything when t = 0, and nothing when t = 1: put the real reader where the eye already is
  const land = complete ? r.to : r.from;
  r.sc.scrollLeft = land * W;
  delete r.c.root.dataset.on;
  r.c.front.style.clipPath = 'none';
  r.c.under.style.display = 'none';
  r.c.flapWrap.style.display = 'none';
  r.sc.classList.remove('flipping');
  if (run === r) run = null;
  if (r.c.stale) schedule(r.sc, r.c, 200);
}
/** lets the curl run on from where it is to its end (or back), at the pace of a hand */
function settleCurl(r: Run, complete: boolean, speed = 0) {
  const target = (r.forward ? complete : !complete) ? 1 : 0;
  const from = r.t;
  const dist = Math.abs(target - from);
  const dur = Math.max(160, Math.min(520, 150 + dist * 420 - Math.min(160, Math.abs(speed) * 90)));
  const t0 = performance.now();
  const fin = () => endCurl(r, complete);
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // ease in-out: lifts, then settles
    r.t = from + (target - from) * (dist > 0.7 ? e : 1 - Math.pow(1 - k, 3));
    drawCurl(r.sc, r.c, r.t, r.y0);
    if (k < 1) r.raf = requestAnimationFrame(step);
    else fin();
  };
  r.raf = requestAnimationFrame(step);
  r.end = window.setTimeout(fin, dur + 150);
}

/** Goes to a page: a curl for the next/previous page, a slide for anything further. */
export function goPage(sc: HTMLElement, i: number, animate = true) {
  if (run && run.sc === sc) endCurl(run, true);
  const w = width(sc);
  const n = pageCount(sc);
  const target = Math.max(0, Math.min(n - 1, i));
  const here = pageIndex(sc);
  if (animate && Math.abs(sc.scrollLeft - here * w) < 3 && Math.abs(target - here) === 1) {
    const r = startCurl(sc, target > here, sc.clientHeight);
    if (r) return settleCurl(r, true);
  }
  slideTo(sc, target * w, animate);
}

/** Swipes, edge taps and snapping for a scroller that is showing pages. */
export function usePager(sc: HTMLElement | null, on: boolean) {
  useEffect(() => {
    if (!sc || !on) return;
    sc.scrollLeft = Math.round(sc.scrollLeft / width(sc)) * width(sc);
    pageCount(sc);
    let x0 = 0;
    let y0 = 0;
    let sl0 = 0;
    let mode: '' | 'drag' | 'skip' = '';
    let r: Run | null = null;
    let last = { x: 0, t: 0 };
    let v = 0;
    let blockClick = 0;
    let settle = 0;
    let started = 0;
    // a page must always end on a whole page: after a tap, after a cancelled touch, after anything
    const snap = () => {
      if (mode === 'drag' || sc.classList.contains('flipping')) return;
      const w = width(sc);
      const n = pageCount(sc);
      const cur = sc.scrollLeft / w;
      const want = Math.max(0, Math.min(n - 1, Math.round(cur)));
      if (Math.abs(cur - want) > 0.004) slideTo(sc, want * w, true);
    };
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        mode = 'skip';
        if (r) {
          settleCurl(r, false);
          r = null;
        }
        return;
      }
      if (run && run.sc === sc) endCurl(run, true); // a turn still running is finished at once
      cancelSlide(sc);
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY - sc.getBoundingClientRect().top;
      sl0 = sc.scrollLeft;
      last = { x: x0, t: performance.now() };
      v = 0;
      mode = '';
      r = null;
      started = performance.now();
    };
    const move = (e: TouchEvent) => {
      if (mode === 'skip' || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - x0;
      const dy = e.touches[0].clientY - y0 - sc.getBoundingClientRect().top;
      if (!mode) {
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.3) {
          mode = 'drag';
          r = startCurl(sc, dx < 0, y0);
        } else if (Math.abs(dy) > 12) mode = 'skip';
        else return;
      }
      if (mode !== 'drag') return;
      e.preventDefault();
      const now = performance.now();
      v = (e.touches[0].clientX - last.x) / Math.max(1, now - last.t);
      last = { x: e.touches[0].clientX, t: now };
      if (r) {
        const W = width(sc);
        const p = Math.max(0, Math.min(1, Math.abs(dx) / (W * 0.8)));
        r.t = r.forward ? (dx < 0 ? p : 0) : dx > 0 ? 1 - p : 1;
        drawCurl(sc, r.c, r.t, r.y0);
        return;
      }
      // sliding (no curl available, or at the first / last page): the page follows the finger, with a little give at the ends
      const max = (pageCount(sc) - 1) * width(sc);
      let to = sl0 - dx;
      if (to < 0) to *= 0.35;
      if (to > max) to = max + (to - max) * 0.35;
      sc.scrollLeft = to;
    };
    const end = () => {
      if (mode !== 'drag') {
        snap();
        return;
      }
      blockClick = performance.now() + 350; // the finger lifting is not a tap
      mode = '';
      if (r) {
        const rr = r;
        r = null;
        const moved = rr.forward ? rr.t : 1 - rr.t;
        const flick = rr.forward ? -v : v;
        const go = moved > 0.3 || flick > 0.45;
        if (go) tap('select');
        return settleCurl(rr, go && !(flick < -0.45 && moved < 0.5), flick);
      }
      const w = width(sc);
      const dx = sc.scrollLeft - sl0;
      const from = Math.round(sl0 / w);
      let to = from;
      if (dx > w * 0.2 || v < -0.45) to = from + 1;
      else if (dx < -w * 0.2 || v > 0.45) to = from - 1;
      if (to !== from) tap('select');
      slideTo(sc, Math.max(0, Math.min(pageCount(sc) - 1, to)) * w, true);
    };
    const click = (e: MouseEvent) => {
      if (performance.now() < blockClick) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      const t = e.target as HTMLElement;
      if (t.closest('a, button, input, textarea, figure.lq, .flow figure, summary, details > *:not(summary)')) return;
      if (window.getSelection()?.toString()) return;
      if (t.closest('.listening .s') && document.querySelector('.listening')) return; // tapping a word while listening starts there
      const f = e.clientX / width(sc);
      if (f < 0.26 || f > 0.74) {
        e.stopPropagation();
        e.preventDefault();
        tap('select');
        goPage(sc, pageIndex(sc) + (f < 0.26 ? -1 : 1));
      }
    };
    // anything else that moves the scroller (a contents entry, a search hit, reading aloud) ends up on a whole page
    const scrolled = () => {
      clearTimeout(settle);
      settle = window.setTimeout(snap, 140);
    };
    const resize = () => {
      pageCount(sc);
      sc.scrollLeft = pageIndex(sc) * width(sc);
    };
    // new text arriving (a book still being prepared) changes how many pages there are
    const flow = flowOf(sc);
    const mo = flow ? new MutationObserver(() => requestAnimationFrame(() => pageCount(sc))) : null;
    if (flow) mo?.observe(flow, { childList: true, subtree: true });
    sc.addEventListener('touchstart', start, { passive: true });
    sc.addEventListener('touchmove', move, { passive: false });
    sc.addEventListener('touchend', end, { passive: true });
    sc.addEventListener('touchcancel', end, { passive: true });
    sc.addEventListener('click', click, true);
    sc.addEventListener('scroll', scrolled, { passive: true });
    window.addEventListener('resize', resize);
    // the copy of the text for the curl is made as soon as the pages are on screen
    const warm = window.setTimeout(() => curlFor(sc), 400);
    void started;
    return () => {
      sc.removeEventListener('touchstart', start);
      sc.removeEventListener('touchmove', move);
      sc.removeEventListener('touchend', end);
      sc.removeEventListener('touchcancel', end);
      sc.removeEventListener('click', click, true);
      sc.removeEventListener('scroll', scrolled);
      window.removeEventListener('resize', resize);
      mo?.disconnect();
      clearTimeout(settle);
      clearTimeout(warm);
      if (run && run.sc === sc) endCurl(run, true);
      cancelSlide(sc);
      const c = curls.get(sc);
      if (c) {
        c.mo.disconnect();
        clearTimeout(c.timer);
        c.root.remove();
        curls.delete(sc);
      }
      sc.querySelector(':scope > .pg-pad')?.remove();
      sc.scrollLeft = 0;
    };
  }, [sc, on]);
}
