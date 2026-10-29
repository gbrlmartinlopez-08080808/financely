import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { define, origin, wiki, normalizeWord, sameSubject, type Definition, type Origin, type WikiCard, type WikiImage } from '../lib/lookup';
import { texToHtml } from '../lib/mathtext';
import { onBack, openExternal, tap } from '../lib/native';
import { Icon } from '../ui/Icon';
import { PixelLoader } from '../ui/kit';

type Tab = 'define' | 'origin' | 'wiki';

export function LookupCard({ word, onClose }: { word: string | null; onClose: () => void }) {
  const w = word ? normalizeWord(word) : '';
  const [tab, setTab] = useState<Tab>('define');
  const [def, setDef] = useState<Definition | null | undefined>();
  const [ety, setEty] = useState<Origin | null | undefined>();
  const [wk, setWk] = useState<WikiCard | null | undefined>();
  const [failed, setFailed] = useState<Record<Tab, boolean>>({ define: false, origin: false, wiki: false });
  const [attempt, setAttempt] = useState(0);
  const [closing, setClosing] = useState(false);
  const [bad, setBad] = useState<Set<string>>(new Set());
  const [zoomImg, setZoomImg] = useState<WikiImage | null>(null);
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

  useEffect(() => {
    if (!w) return;
    setDef(undefined);
    setEty(undefined);
    setWk(undefined);
    setClosing(false);
    setBad(new Set());
    setZoomImg(null);
    const multi = /\s/.test(w);
    setTab(multi ? 'wiki' : 'define');
    setFailed({ define: false, origin: false, wiki: false });
    const fail = (t: Tab) => () => setFailed((f) => ({ ...f, [t]: true }));
    define(w).then(setDef, () => (setDef(null), fail('define')()));
    origin(w).then(setEty, () => (setEty(null), fail('origin')()));
    wiki(w).then(setWk, () => (setWk(null), fail('wiki')()));
  }, [w, attempt]);

  // If there's no dictionary entry but Wikipedia knows it, lead with Wikipedia.
  useEffect(() => {
    if (def === null && !failed.define && wk && tab === 'define') setTab('wiki');
  }, [def, wk]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    setClosing(true);
    setTimeout(onClose, 200);
  };
  useEffect(() => {
    if (!w) return;
    return onBack(() => {
      close();
      return true;
    });
  }, [w]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!w) return null;
  const gallery = wk && (tab === 'wiki' || sameSubject(w, wk)) ? wk.images.filter((i) => !bad.has(i.src)) : [];
  const rawTitle = wk?.title && tab === 'wiki' ? wk.title : def?.word ?? w;
  const title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);
  const loading = (tab === 'define' && def === undefined) || (tab === 'origin' && ety === undefined) || (tab === 'wiki' && wk === undefined);
  const moreUrl = tab === 'wiki' && wk ? wk.url : tab === 'origin' ? `https://en.wiktionary.org/wiki/${encodeURIComponent(w)}#Etymology` : `https://en.wiktionary.org/wiki/${encodeURIComponent(w)}`;

  return createPortal(
    <>
      <div className={`scrim${closing ? ' out' : ''}`} style={{ background: 'rgba(0,0,0,.08)' }} onClick={close} />
      <div className={`lookup${closing ? ' out' : ''}`} role="dialog" aria-label={`Lookup ${w}`}>
        <div className="lk-word">{w.toLowerCase()}</div>
        {gallery.length > 0 && <Gallery key={`${w}-${tab === 'wiki'}`} images={gallery} onOpen={setZoomImg} onBroken={(src) => setBad((b) => new Set(b).add(src))} />}
        <div className="lk-title">
          <h2>{title}</h2>
          {tab === 'define' && def?.phonetic && <span className="lk-sub mono">{def.phonetic}</span>}
          {tab === 'wiki' && wk?.description && <span className="lk-sub">{wk.description}</span>}
          {tab === 'define' && !def?.phonetic && def?.source && <span className="lk-sub">via {def.source}</span>}
          {tab === 'origin' && <span className="lk-sub">word origin & roots</span>}
        </div>
        <div className="lk-tabs">
          {(['define', 'origin', 'wiki'] as Tab[]).map((t) => (
            <button
              key={t}
              className={tab === t ? 'on' : ''}
              onClick={() => {
                tap('select');
                setTab(t);
              }}
            >
              {t === 'define' ? 'Define' : t === 'origin' ? 'Origin' : 'Wikipedia'}
            </button>
          ))}
        </div>
        <div className="lk-body">
          {failed[tab] ? (
            <p className="lk-muted">
              Couldn’t reach {tab === 'wiki' ? 'Wikipedia' : tab === 'origin' ? 'Wiktionary' : 'the dictionary'} right now.{' '}
              <button style={{ color: '#6fa8ff', fontWeight: 600 }} onClick={() => setAttempt((a) => a + 1)}>
                Try again
              </button>
            </p>
          ) : offline && loading ? (
            <p className="lk-muted">You're offline. Lookups need a connection — everything else works offline.</p>
          ) : loading ? (
            <div style={{ padding: '18px 0' }}>
              <PixelLoader size={5} label="looking up" />
            </div>
          ) : tab === 'define' ? (
            def ? (
              <>
                {def.meanings.slice(0, 3).map((m) => (
                  <div key={m.pos} className="lk-mean">
                    <div className="lk-pos mono">{m.pos}</div>
                    <ol>
                      {m.defs.slice(0, 3).map((d, i) => (
                        <li key={i}>
                          <span dangerouslySetInnerHTML={{ __html: texToHtml(d.d) }} />
                          {d.ex && <em dangerouslySetInnerHTML={{ __html: ` “${texToHtml(d.ex)}”` }} />}
                        </li>
                      ))}
                    </ol>
                    {m.synonyms.length > 0 && <div className="lk-syn mono">≈ {m.synonyms.slice(0, 5).join(', ')}</div>}
                  </div>
                ))}
              </>
            ) : (
              <p className="lk-muted">No dictionary entry for “{w}”.</p>
            )
          ) : tab === 'origin' ? (
            ety ? (
              <>
                {ety.roots.length > 0 && (
                  <div className="lk-roots">
                    {ety.roots.map((r, i) => (
                      <span key={i} className={/Greek/.test(r.lang) ? 'greek' : ''}>
                        <small>{r.lang}</small>
                        <b>{r.form}</b>
                        {r.gloss && <i>{r.gloss}</i>}
                      </span>
                    ))}
                  </div>
                )}
                {ety.text.map((p, i) => (
                  <p key={i} dangerouslySetInnerHTML={{ __html: texToHtml(p) }} />
                ))}
              </>
            ) : (
              <p className="lk-muted">No etymology found for “{w}”.</p>
            )
          ) : wk ? (
            wk.html ? (
              <div className="lk-rich" dangerouslySetInnerHTML={{ __html: wk.html }} />
            ) : (
              <p className="lk-muted">No article for “{w}”, but here are pictures from Wikimedia Commons.</p>
            )
          ) : (
            <p className="lk-muted">Nothing on Wikipedia for “{w}”.</p>
          )}
        </div>
        <div className="lk-foot">
          <span className="lk-credit">{tab === 'define' || tab === 'origin' ? 'Wiktionary · CC BY-SA 4.0' : 'Wikipedia · CC BY-SA 4.0 · pictures: Wikimedia'}</span>
          <button onClick={() => openExternal(moreUrl)}>
            More <Icon name="right" size={14} />
          </button>
        </div>
      </div>
      <ZoomViewer src={zoomImg ? zoomImg.full ?? zoomImg.src : null} onClose={() => setZoomImg(null)} />
    </>,
    document.body,
  );
}

/** Swipeable pictures from the article (or Wikimedia Commons), with author + licence underneath. */
function Gallery({ images, onOpen, onBroken }: { images: WikiImage[]; onOpen: (i: WikiImage) => void; onBroken: (src: string) => void }) {
  const [idx, setIdx] = useState(0);
  const cur = images[Math.min(idx, images.length - 1)];
  return (
    <div className="lk-gal">
      <div
        className="lk-strip"
        onScroll={(e) => {
          const el = e.currentTarget;
          let best = 0;
          let bd = Infinity;
          Array.from(el.children).forEach((c, i) => {
            const d = Math.abs((c as HTMLElement).offsetLeft - el.scrollLeft - 14);
            if (d < bd) {
              bd = d;
              best = i;
            }
          });
          setIdx(best);
        }}
      >
        {images.map((im) => (
          <button key={im.src} className="lk-slide" onClick={() => onOpen(im)} aria-label={`Open picture: ${im.title}`}>
            <img src={im.src} alt={im.title} loading="lazy" draggable={false} onError={() => onBroken(im.src)} />
          </button>
        ))}
      </div>
      {images.length > 1 && <span className="lk-count mono">{Math.min(idx, images.length - 1) + 1}/{images.length}</span>}
      {cur && (
        <div className="lk-cap">
          {cur.title.length > 52 ? cur.title.slice(0, 52) + '…' : cur.title}
          {cur.credit ? <span> · {cur.credit}</span> : null}
        </div>
      )}
    </div>
  );
}

export function SelectionMenu({
  rect,
  onDefine,
  onHighlight,
  onListen,
  onAsk,
  onCopy,
  onShare,
}: {
  rect: DOMRect | null;
  onDefine: () => void;
  onHighlight?: () => void;
  onListen?: () => void;
  onAsk?: () => void;
  onCopy: () => void;
  onShare: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // above the words when there is room; otherwise below, clear of the selection handles
  const top = rect ? (rect.top > 150 ? rect.top - 56 : Math.min(window.innerHeight - 120, rect.bottom + 46)) : 0;
  const centre = rect ? rect.left + rect.width / 2 : 0;
  // keep the whole menu on screen, however near the edge the word is
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !rect) return;
    const w = el.offsetWidth;
    el.style.left = `${Math.max(w / 2 + 8, Math.min(window.innerWidth - w / 2 - 8, centre))}px`;
  }, [rect, centre]);
  if (!rect) return null;
  return createPortal(
    <div ref={ref} className="selmenu" style={{ top, left: centre }} onMouseDown={(e) => e.preventDefault()} onTouchStart={(e) => e.stopPropagation()}>
      <button onClick={onDefine}>Define</button>
      {onHighlight && <button onClick={onHighlight}>Highlight</button>}
      {onListen && <button onClick={onListen}>Listen</button>}
      {onAsk && <button onClick={onAsk}>Ask</button>}
      <button onClick={onCopy}>Copy</button>
      <button onClick={onShare} aria-label="Share">
        <Icon name="share" size={16} />
      </button>
    </div>,
    document.body,
  );
}

export function ZoomViewer({ src, mask, ratio, onClose }: { src: string | null; mask?: boolean; ratio?: number; onClose: () => void }) {
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  useEffect(() => {
    setT({ s: 1, x: 0, y: 0 });
    if (!src) return;
    return onBack(() => {
      onClose();
      return true;
    });
  }, [src, onClose]);
  if (!src) return null;
  const pointers = new Map<number, { x: number; y: number }>();
  let start: { d: number; s: number; x: number; y: number; px: number; py: number } | null = null;
  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.values()];
    const d = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    start = { d, s: t.s, x: t.x, y: t.y, px: e.clientX, py: e.clientY };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pointers.has(e.pointerId) || !start) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.values()];
    if (pts.length > 1 && start.d) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      setT((p) => ({ ...p, s: Math.max(1, Math.min(8, (start!.s * d) / start!.d)) }));
    } else setT((p) => ({ ...p, x: start!.x + (e.clientX - start!.px), y: start!.y + (e.clientY - start!.py) }));
  };
  const onUp = (e: React.PointerEvent) => {
    pointers.delete(e.pointerId);
    start = null;
  };
  return createPortal(
    <div className="zoomer" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={() => setT((p) => (p.s > 1 ? { s: 1, x: 0, y: 0 } : { ...p, s: 2.5 }))}>
      <div style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})` }} className="zoomer-inner">
        {mask ? <span className="mask" style={{ ['--m' as string]: `url(${src})`, aspectRatio: String(ratio ?? 1) }} /> : <img src={src} alt="" draggable={false} />}
      </div>
      <button className="pill round zoomer-close" onClick={onClose} onPointerDown={(e) => e.stopPropagation()} aria-label="Close">
        <Icon name="close" size={18} />
      </button>
      <div className="zoomer-hint mono">pinch to zoom · double-tap</div>
    </div>,
    document.body,
  );
}
