// Flipping pages instead of scrolling. A Liquid view is laid out in columns, one column per page; the scroller moves
// sideways by whole pages. Because it is still an ordinary scroller (just with its overflow hidden), everything that
// scrolls to a place — the contents, find, reading aloud — keeps working; this only adds the swiping and the snapping.
import { useEffect } from 'react';
import { tap } from '../lib/native';

export const pageCount = (sc: HTMLElement) => Math.max(1, Math.round(sc.scrollWidth / Math.max(1, sc.clientWidth)));
export const pageIndex = (sc: HTMLElement) => Math.round(sc.scrollLeft / Math.max(1, sc.clientWidth));

let anim = 0;
/** Slides to a page (a short ease-out, like a page turned by hand). */
export function goPage(sc: HTMLElement, i: number, animate = true) {
  const w = sc.clientWidth;
  const to = Math.max(0, Math.min(pageCount(sc) - 1, i)) * w;
  cancelAnimationFrame(anim);
  if (!animate || Math.abs(sc.scrollLeft - to) < 2) {
    sc.scrollLeft = to;
    return;
  }
  const from = sc.scrollLeft;
  const t0 = performance.now();
  const dur = Math.min(420, 220 + Math.abs(to - from) / w * 90);
  sc.classList.add('flipping');
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    sc.scrollLeft = from + (to - from) * e;
    if (k < 1) anim = requestAnimationFrame(step);
    else sc.classList.remove('flipping');
  };
  anim = requestAnimationFrame(step);
}

/** Swipes, edge taps and snapping for a scroller that is showing pages. */
export function usePager(sc: HTMLElement | null, on: boolean) {
  useEffect(() => {
    if (!sc || !on) return;
    sc.scrollLeft = Math.round(sc.scrollLeft / Math.max(1, sc.clientWidth)) * sc.clientWidth;
    let x0 = 0;
    let y0 = 0;
    let sl0 = 0;
    let mode: '' | 'drag' | 'skip' = '';
    let last = { x: 0, t: 0 };
    let v = 0;
    let blockClick = 0;
    let settle = 0;
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return void (mode = 'skip');
      cancelAnimationFrame(anim);
      sc.classList.remove('flipping');
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      sl0 = sc.scrollLeft;
      last = { x: x0, t: performance.now() };
      v = 0;
      mode = '';
    };
    const move = (e: TouchEvent) => {
      if (mode === 'skip' || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - x0;
      const dy = e.touches[0].clientY - y0;
      if (!mode) {
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.3) mode = 'drag';
        else if (Math.abs(dy) > 12) mode = 'skip';
        else return;
      }
      if (mode !== 'drag') return;
      e.preventDefault();
      const max = sc.scrollWidth - sc.clientWidth;
      // a little give past the first and last page, like a real book
      let to = sl0 - dx;
      if (to < 0) to *= 0.35;
      if (to > max) to = max + (to - max) * 0.35;
      sc.scrollLeft = to;
      const now = performance.now();
      v = (e.touches[0].clientX - last.x) / Math.max(1, now - last.t);
      last = { x: e.touches[0].clientX, t: now };
    };
    const end = () => {
      if (mode !== 'drag') return;
      const w = sc.clientWidth;
      const dx = sc.scrollLeft - sl0;
      const from = Math.round(sl0 / w);
      let to = from;
      if (dx > w * 0.2 || v < -0.45) to = from + 1;
      else if (dx < -w * 0.2 || v > 0.45) to = from - 1;
      if (to !== from) tap('select');
      blockClick = performance.now() + 350; // the finger lifting is not a tap
      goPage(sc, to);
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
      const f = e.clientX / sc.clientWidth;
      if (f < 0.26) {
        e.stopPropagation();
        e.preventDefault();
        tap('select');
        goPage(sc, pageIndex(sc) - 1);
      } else if (f > 0.74) {
        e.stopPropagation();
        e.preventDefault();
        tap('select');
        goPage(sc, pageIndex(sc) + 1);
      }
    };
    // anything else that moves the scroller (a contents entry, a search hit, reading aloud) ends up on a whole page
    const scrolled = () => {
      clearTimeout(settle);
      settle = window.setTimeout(() => {
        if (mode === 'drag' || sc.classList.contains('flipping')) return;
        const w = sc.clientWidth;
        if (Math.abs(sc.scrollLeft / w - Math.round(sc.scrollLeft / w)) > 0.02) goPage(sc, Math.round(sc.scrollLeft / w));
      }, 160);
    };
    sc.addEventListener('touchstart', start, { passive: true });
    sc.addEventListener('touchmove', move, { passive: false });
    sc.addEventListener('touchend', end, { passive: true });
    sc.addEventListener('touchcancel', end, { passive: true });
    sc.addEventListener('click', click, true);
    sc.addEventListener('scroll', scrolled, { passive: true });
    const onResize = () => goPage(sc, pageIndex(sc), false);
    window.addEventListener('resize', onResize);
    return () => {
      sc.removeEventListener('touchstart', start);
      sc.removeEventListener('touchmove', move);
      sc.removeEventListener('touchend', end);
      sc.removeEventListener('touchcancel', end);
      sc.removeEventListener('click', click, true);
      sc.removeEventListener('scroll', scrolled);
      window.removeEventListener('resize', onResize);
      clearTimeout(settle);
      cancelAnimationFrame(anim);
      sc.classList.remove('flipping');
      sc.scrollLeft = 0;
    };
  }, [sc, on]);
}
