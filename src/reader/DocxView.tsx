import { useEffect, useRef, useState } from 'react';
import { PixelLoader } from '../ui/kit';

/**
 * A Word document as its own pages: the sheet size, margins, fonts, colours, tables and pictures the author made (rendered by
 * docx-preview), fitted to the width of the phone. Liquid mode is the same text, reflowed.
 */
export function DocxView({
  blob,
  scroller,
  initial,
  onProgress,
  onTap,
  onFail,
}: {
  blob: Blob;
  scroller: HTMLElement | null;
  /** where to resume, 0‥1 */
  initial: number;
  onProgress: (p: number) => void;
  onTap: () => void;
  onFail: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const mul = useRef(1); // pinch zoom on top of "fit to width"
  const fit = () => {
    const h = host.current;
    if (!h || !scroller) return;
    const wrap = h.querySelector<HTMLElement>('.docx-wrapper');
    const sec = wrap?.querySelector<HTMLElement>('section.docx');
    if (!wrap || !sec) return;
    wrap.style.zoom = '1';
    const w = sec.offsetWidth || 816;
    const z = Math.max(0.2, Math.min(1.8, (scroller.clientWidth - 14) / w)) * mul.current;
    wrap.style.zoom = String(z);
    scroller.style.overflowX = mul.current > 1.02 ? 'auto' : '';
  };
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const { renderAsync } = await import('docx-preview');
        if (!host.current) return;
        host.current.innerHTML = '';
        await renderAsync(blob, host.current, undefined, { className: 'docx', inWrapper: true, ignoreWidth: false, ignoreHeight: false, breakPages: true, renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true, useBase64URL: true, experimental: false });
        if (dead) return;
        fit();
        setReady(true);
        requestAnimationFrame(() => {
          if (!scroller) return;
          const max = scroller.scrollHeight - scroller.clientHeight;
          if (initial > 0 && max > 0) scroller.scrollTop = initial * max;
        });
      } catch (e) {
        console.warn('docx page view failed', e);
        if (!dead) onFail();
      }
    })();
    return () => {
      dead = true;
    };
  }, [blob]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!scroller) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(scroller);
    const on = () => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      onProgress(max > 0 ? scroller.scrollTop / max : 0);
    };
    scroller.addEventListener('scroll', on, { passive: true });
    // two fingers zoom the page (1× is the whole width of the sheet); a double tap toggles between 1× and 2.4×
    let d0 = 0;
    let m0 = 1;
    let lastTap = 0;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const ts = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        d0 = dist(e.touches);
        m0 = mul.current;
      } else if (e.touches.length === 1) {
        const now = Date.now();
        if (now - lastTap < 280) {
          mul.current = mul.current > 1.2 ? 1 : 2.4;
          fit();
          if (mul.current === 1) scroller.scrollLeft = 0;
          else scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
        }
        lastTap = now;
      }
    };
    const tm = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !d0) return;
      e.preventDefault();
      mul.current = Math.max(1, Math.min(4, (m0 * dist(e.touches)) / d0));
      fit();
    };
    const te = () => (d0 = 0);
    scroller.addEventListener('touchstart', ts, { passive: true });
    scroller.addEventListener('touchmove', tm, { passive: false });
    scroller.addEventListener('touchend', te, { passive: true });
    return () => {
      scroller.style.overflowX = '';
      scroller.removeEventListener('touchstart', ts);
      scroller.removeEventListener('touchmove', tm);
      scroller.removeEventListener('touchend', te);
      ro.disconnect();
      scroller.removeEventListener('scroll', on);
    };
  }, [scroller, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="docx-host" onClick={onTap}>
      {!ready && (
        <div style={{ display: 'grid', placeItems: 'center', height: '60vh' }}>
          <PixelLoader grid={4} size={7} label="laying out the pages" />
        </div>
      )}
      <div ref={host} style={{ visibility: ready ? 'visible' : 'hidden' }} />
    </div>
  );
}
