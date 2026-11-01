import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as db from '../lib/db';
import { addReading, patchDoc, removeDoc, useStore, updateSettings } from '../lib/store';
import { loadContent, getFile, importFile, docById, type Content } from '../lib/library';
import type { Bookmark, DocMeta, Highlight, TocEntry } from '../lib/types';
import { pdfOutline, type PDFDocumentProxy } from '../lib/formats/pdf';
import { blocksToHtml, pdfToLiquid, type LBlock } from '../lib/formats/liquidPdf';
import { onBack, setStatusBar, shareFile, shareText, tap } from '../lib/native';
import { ConfirmSheet } from '../ui/Confirm';
import { LiquidIntro, LiquidStatus, ViewButton } from './LiquidStatus';
import { foldSources } from './sources';
import { openCached } from '../lib/pdfCache';
import { Scrub } from './Scrub';
import { FrEditor } from './FrEditor';
import { goPage, pageCount, pageIndex, usePager } from './paged';
import { Icon, TypeGlyph } from '../ui/Icon';
import { PixelBar, PixelLoader, Segmented, Sheet, toast } from '../ui/kit';
import { PdfView, type PdfViewHandle } from './PdfView';
import { LookupCard, SelectionMenu, ZoomViewer } from './Lookup';
import { ListenBar } from './ListenBar';
import { ContentsSheet, MoreSheet, THEMES, TypeSheet, type MoreAction } from './sheets';
import { BinaryView, CodeView, ImageView, MediaView, SheetView } from './OtherViews';
import { anchorFromSelection, applyHighlights, clearMarks, findAll, wordAt, wrapSentences } from './dom';
import { AskSheet } from './Ask';
import { FormSheet } from './FormSheet';
import { detectForm, type FormModel } from '../lib/forms';
import { LQ_VERSION, focusDoc, liquidPageStore, pageStore, prepareNow, queueScan, rebuildLiquid, useLiquid, type Prep } from '../lib/scan';
import { KIND_LABEL } from '../lib/formats/detect';
import { fontById } from '../lib/fonts';
import { guessLang } from '../lib/tts';


const AUTO_MARK_MS = 120_000; // read for two minutes in total and the app keeps your place

/** Hyphenation follows the book's own language (not English by default), once there is enough text to tell. */
function bookLang(root: HTMLElement) {
  if (root.dataset.lang) return;
  const sample = (root.textContent ?? '').slice(0, 2400);
  if (sample.length > 300) root.lang = root.dataset.lang = guessLang(sample).slice(0, 2);
}

/** The quiet line under a PDF's title while its Liquid view is being made (empty once it is ready). */
function prepLine(p: Prep): string {
  if (p.ready || !p.known) return '';
  if (p.error) return 'liquid · couldn’t finish';
  if (p.none) return 'liquid · no text found';
  const doing = p.info.startsWith('waiting') ? 'waiting' : p.info.startsWith('checking') ? 'checking' : p.info.startsWith('reading') ? 'reading' : 'converting';
  return `liquid · ${Math.round(p.progress * 100)}% · ${doing}`;
}

export function Reader({ doc, onClose, onConvert, onOpenDoc }: { doc: DocMeta; onClose: () => void; onConvert: (doc: DocMeta, root?: HTMLElement | null) => void; onOpenDoc?: (id: string) => void }) {
  const id = doc.id;
  const settings = useStore((s) => s.settings);
  const [content, setContent] = useState<Content | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [mode, setMode] = useState<'page' | 'liquid'>(doc.position?.mode ?? settings.defaultPdfMode);
  const [listen, setListen] = useState(false);
  const [listening, setListening] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [sheet, setSheet] = useState<null | 'type' | 'contents' | 'more' | 'info' | 'ocr' | 'ask' | 'remove'>(null);
  const [askSel, setAskSel] = useState<string | undefined>();
  const [imgLayer, setImgLayer] = useState<{ words: { t: string; x0: number; y0: number; x1: number; y1: number }[]; w: number; h: number } | null>(null);
  const [find, setFind] = useState<string | null>(null);
  const [findHits, setFindHits] = useState<{ n: number; cur: number; pages?: number[] }>({ n: 0, cur: 0 });
  const [lookup, setLookup] = useState<string | null>(null);
  const [selRect, setSelRect] = useState<DOMRect | null>(null);
  const [zoom, setZoom] = useState<{ src: string; mask: boolean; ratio: number } | null>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [clockMode, setClockMode] = useState<'time' | 'left'>('time');
  const [now, setNow] = useState(() => new Date());
  const [progress, setProgress] = useState(doc.progress);
  const [page, setPage] = useState(doc.kind === 'pdf' && doc.position ? Math.max(1, Math.round(doc.position.value)) : 1);
  const [listenFrom, setListenFrom] = useState<number | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [thumbs, setThumbs] = useState(false);
  const [scanned, setScanned] = useState<number[]>([]);
  const [form, setForm] = useState<FormModel | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [offerGone, setOfferGone] = useState(true);
  // a PDF's Liquid view is prepared in the background from the moment it is added (scanned pages are read too)
  const liq = useLiquid(doc.id);
  useEffect(() => {
    focusDoc(doc.id); // the open book's preparation goes first
    return () => focusDoc('');
  }, [doc.id]);
  const [ocrText, setOcrText] = useState<{ text: string; busy: boolean; p: number } | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PdfViewHandle>(null);
  const urls = useRef<string[]>([]);
  const listeningRef = useRef(false);
  listeningRef.current = listening;
  const [flowReady, setFlowReady] = useState(0);

  const isPdf = doc.kind === 'pdf';
  // Liquid opens the moment it is chosen, whatever the background work is doing: what is ready is shown, the rest
  // arrives as it is finished, and the end of the text says how far it is (or what went wrong).
  const liquid = !isPdf || mode === 'liquid';
  /** a PDF's Liquid view that is still being made (it grows while you read) */
  const growing = isPdf && liquid && !liq.ready;
  // (until the book's state is known — a few milliseconds — nothing is said, so a finished book never flashes a status)
  const showGrowth = growing && liq.known;
  /** a Liquid view that flips pages (set in the typography sheet) */
  const paged = !!settings.pageFlip && liquid && (content?.type === 'flow' || content?.type === 'pdf');
  // the first PDF ever opened: a few words on what Liquid mode is, and why it is sometimes instant and sometimes slow
  const [intro, setIntro] = useState(false);
  useEffect(() => {
    if (!isPdf) return;
    const t = setTimeout(async () => {
      if (await db.get('kv', 'tip:liquid')) return;
      await db.put('kv', 'tip:liquid', Date.now());
      setIntro(true);
    }, 1200);
    return () => clearTimeout(t);
  }, [isPdf]);
  const theme = THEMES.find((t) => t.id === settings.readerTheme) ?? THEMES[0];
  const dark = settings.readerTheme === 'dusk' || settings.readerTheme === 'night';

  // ---------------------------------------------------------------- load
  useEffect(() => {
    let alive = true;
    patchDoc(id, { openedAt: Date.now() }, true);
    loadContent(doc)
      .then(async (c) => {
        if (!alive) return;
        setContent(c);
        if (c.type === 'pdf') {
          const p = await openCached(doc, c.blob);
          if (!alive) return;
          setPdf(p);
          pdfOutline(p).then((o) => alive && o.length && setToc(o.map((x, i) => ({ title: x.title, anchor: `page-${x.page}`, level: x.level, page: x.page, i }))));
        } else if (c.type === 'flow') {
          setToc(c.liquid.toc);
          urls.current.push(...c.liquid.urls);
        }
      })
      .catch((e) => alive && setError(String(e?.message ?? e)));
    db.entries<Highlight | Bookmark>('marks').then((all) => {
      if (!alive) return;
      const mine = all.filter(([k]) => k.startsWith(id + ':')).map(([, v]) => v);
      setHighlights(mine.filter((m): m is Highlight => 'text' in m).sort((a, b) => a.at - b.at));
      setBookmarks(mine.filter((m): m is Bookmark => 'label' in m).sort((a, b) => a.progress - b.progress));
    });
    return () => {
      alive = false;
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // (the PDF stays open in the little cache of recent books: coming back to it is instant)
  useEffect(
    () => () => {
      urls.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  // ---------------------------------------------------------------- liquid html
  useLayoutEffect(() => {
    const root = flowRef.current;
    if (!root || !content || !liquid) return;
    if (content.type === 'flow') {
      root.innerHTML = content.liquid.html;
      delete root.dataset.wrapped;
      bookLang(root);
      setFlowReady((n) => n + 1);
      return;
    }
    if (content.type !== 'pdf') return;
    let alive = true;
    // the view that is on screen stays until the next one is there (no blank flash, no jump back to the top)
    const keep = readingPlace();
    (async () => {
      const key = `${id}:${LQ_VERSION}`;
      const cached = liq.ready ? await db.get<{ blocks: LBlock[]; scanned: number[] }>('cache', key) : undefined;
      if (!alive) return;
      if (!cached) {
        // not complete yet: show what is ready now and let the view grow as pages arrive
        if (liq.ready) return void rebuildLiquid(doc); // "ready" but nothing saved: make it again (this view follows)
        else if (!liq.busy && !liq.none && !liq.error) queueScan(doc); // nothing is under way: start it now
        return startLive(root, () => alive);
      }
      // the growing view already holds every page: it simply stays (nothing is redrawn, nothing moves)
      if (!cached.scanned.length && liveComplete(root)) {
        setScanned([]);
        afterLiquid(root);
        return;
      }
      let { blocks: cb, scanned: cs } = cached;
      if (cs.length) {
        // pages that were read in the background since this view was made take the place of their pictures
        const { applyStored } = await import('../lib/ocrpage');
        const m = await applyStored(cb, pageStore(id));
        if (m.replaced) {
          cb = m.blocks;
          cs = m.left ? cs : [];
          await db.put('cache', key, { blocks: cb, scanned: cs });
        }
      }
      if (!alive) return;
      root.innerHTML = blocksToHtml(cb, urls.current);
      delete root.dataset.wrapped;
      setScanned(cs);
      backTo(keep);
      afterLiquid(root);
    })();
    return () => {
      alive = false;
      liveStop.current();
    };
  }, [content, liquid, liq.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A growing view with every page in it and nothing still being read. */
  const liveComplete = (root: HTMLElement) => !!doc.pages && !root.querySelector('[data-wait],[data-gap]') && !!root.querySelector(`.pg[data-page="${doc.pages}"]`);

  /**
   * Where the reader is in a Liquid view: the paragraph at the top of the screen (as "the k-th block after the marker
   * of page p", which survives a redraw) and how far it sits from the top.
   */
  const readingPlace = (): { page: number; k: number; dy: number } | null => {
    const root = flowRef.current;
    if (!root || !scroller || !root.childElementCount || !scroller.scrollTop) return null;
    const top = scroller.getBoundingClientRect().top;
    const kids = Array.from(root.children) as HTMLElement[];
    const i = kids.findIndex((el) => el.getBoundingClientRect().bottom > top + 1);
    if (i < 0) return null;
    let page = 0;
    let k = 0;
    for (let j = i; j >= 0; j--) {
      if (kids[j].matches('.pg[data-page]')) {
        page = Number(kids[j].dataset.page);
        break;
      }
      k++;
    }
    return page ? { page, k, dy: kids[i].getBoundingClientRect().top - top } : null;
  };
  /**
   * Puts that paragraph back where it was. Blocks off screen are only estimated until they are drawn, so it is pinned
   * again for a few frames while the layout settles.
   */
  const backTo = (at: { page: number; k: number; dy: number } | null) => {
    if (!at || !scroller) return;
    restoredLiquid.current = true;
    const pin = (n: number) => {
      let el = flowRef.current?.querySelector<HTMLElement>(`.pg[data-page="${at.page}"]`) ?? null;
      for (let j = 0; el && j < at.k; j++) el = el.nextElementSibling as HTMLElement | null;
      if (!el) return;
      const off = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - at.dy;
      if (Math.abs(off) > 1) scroller.scrollTop += off;
      if (n > 0) requestAnimationFrame(() => pin(n - 1));
    };
    pin(8);
  };

  /**
   * The Liquid view of a book that is still being prepared: the pages that are done are shown at once, pages that are
   * still being read show a small "being read" card, and everything is swapped in place as it arrives. The reader can
   * start reading straight away and the view is complete by the time they reach the end.
   */
  const liveStop = useRef<() => void>(() => {});
  const startLive = async (root: HTMLElement, alive: () => boolean) => {
    const total = doc.pages ?? 0;
    const lst = liquidPageStore(id);
    const ost = pageStore(id);
    const waitHtml = (pn: number) => `<figure class="lq lq-wait" data-wait="${pn}"><i></i><span>Page ${pn} is being read…</span></figure>`;
    const gapHtml = (pn: number) => `<span class="pg" data-page="${pn}"></span><figure class="lq lq-wait" data-gap="${pn}"><i></i><span>Page ${pn} is a hard one — it is read at the end</span></figure>`;
    let next = 1;
    root.innerHTML = '';
    delete root.dataset.wrapped;
    const pageHtml = async (pn: number): Promise<string | null> => {
      let bs = await lst.load(pn);
      if (!bs) {
        const read = await ost.load(pn); // a picture-only book: the pages come straight from the reading
        if (!read) return null;
        bs = [{ t: 'page', page: pn }, ...read];
      }
      const keep: LBlock[] = [];
      let waiting = false;
      for (const b of bs) {
        if (b.t === 'img' && b.kind === 'scan') {
          const read = await ost.load(pn);
          if (read?.length) keep.push(...read);
          else waiting = true;
        } else keep.push(b);
      }
      return blocksToHtml(keep, urls.current) + (waiting ? waitHtml(pn) : '');
    };
    let busy = false;
    let first = true;
    const flush = async () => {
      if (busy || !alive()) return;
      busy = true;
      let changed = false;
      try {
        // which pages are done so far (keys only, nothing big is read)
        const done = new Set<number>();
        for (const pre of ['lqpg', 'ocrpg']) for (const k of await db.keys('cache', `${pre}:${id}:`)) done.add(Number(k.slice(k.lastIndexOf(':') + 1)));
        const lastDone = done.size ? Math.max(...done) : 0;
        // new pages, in order (gathered first and put in at once: one layout instead of one per page). A page that
        // takes long (it is read at the end) holds a place, and the pages after it are shown meanwhile.
        let add = '';
        while (next <= (total || 1e6)) {
          const h = await pageHtml(next);
          if (!alive()) return;
          if (h === null) {
            if (next >= lastDone) break;
            add += gapHtml(next);
          } else add += h;
          next++;
        }
        if (add) {
          root.insertAdjacentHTML('beforeend', add);
          changed = true;
        }
        // pages that held a place and are done now
        for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-gap]'))) {
          const pn = Number(el.dataset.gap);
          const h = await pageHtml(pn);
          if (h !== null) {
            const mark = el.previousElementSibling;
            if (mark?.matches(`.pg[data-page="${pn}"]`)) mark.remove(); // the page brings its own marker
            const tpl = document.createElement('template');
            tpl.innerHTML = h;
            el.replaceWith(tpl.content);
            changed = true;
          }
        }
        // pictures that have been read since: swap them in (the browser keeps the paragraph being read where it is)
        for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-wait]'))) {
          const pn = Number(el.dataset.wait);
          const read = await ost.load(pn);
          if (read?.length) {
            const tpl = document.createElement('template');
            tpl.innerHTML = blocksToHtml(read.filter((b) => b.t !== 'page'), urls.current);
            el.replaceWith(tpl.content);
            changed = true;
          }
        }
        // the rest of the reader (contents, highlights, word count) looks again only when something new came in
        if (changed || first) afterLiquid(root);
        first = false;
      } finally {
        busy = false;
      }
    };
    let timer = 0;
    const kick = () => {
      clearTimeout(timer);
      timer = window.setTimeout(flush, 250);
    };
    const onEv = (e: Event) => (e as CustomEvent<{ id: string }>).detail.id === id && kick();
    window.addEventListener('frogity:page', onEv);
    window.addEventListener('frogity:ocrpage', onEv);
    const iv = window.setInterval(flush, 5000); // in case a message was missed
    liveStop.current = () => {
      window.removeEventListener('frogity:page', onEv);
      window.removeEventListener('frogity:ocrpage', onEv);
      clearInterval(iv);
      clearTimeout(timer);
    };
    await flush();
  };

  // pictures that turned out to be writing were turned into text in the background: show the better version (not mid-listen)
  useEffect(() => {
    const on = async (e: Event) => {
      if ((e as CustomEvent<{ id: string }>).detail.id !== id || !liquid || listen) return;
      const root = flowRef.current;
      const cached = await db.get<{ blocks: LBlock[]; scanned: number[] }>('cache', `${id}:${LQ_VERSION}`);
      if (!root || !cached) return;
      const keep = readingPlace();
      root.innerHTML = blocksToHtml(cached.blocks, urls.current);
      delete root.dataset.wrapped;
      backTo(keep);
      afterLiquid(root);
      toast('Pictures with writing in them are now text');
    };
    window.addEventListener('frogity:figures', on);
    return () => window.removeEventListener('frogity:figures', on);
  }, [id, liquid, listen, scroller]); // eslint-disable-line react-hooks/exhaustive-deps

  // does this PDF look like a form? If so, offer to fill it in
  useEffect(() => {
    if (!pdf) return;
    let alive = true;
    // not while the page is still drawing or while the phone is busy: wait for a quiet moment, and never block reading
    const t = setTimeout(async () => {
      await new Promise<void>((r) => ((window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback ? (window as unknown as { requestIdleCallback: (f: () => void, o: { timeout: number }) => void }).requestIdleCallback(() => r(), { timeout: 4000 }) : setTimeout(r, 300)));
      if (!alive) return;
      const m = await detectForm(pdf);
      if (!alive || !m) return;
      setForm(m);
      const dismissed = await db.get<boolean>('kv', `formoffer:${id}`);
      if (alive && !dismissed) setOfferGone(false);
    }, 1200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [pdf]); // eslint-disable-line react-hooks/exhaustive-deps

  // a picture's words are read in the background when it is added: pick them up as soon as they are there
  useEffect(() => {
    if (content?.type !== 'image') return;
    let alive = true;
    const load = async () => {
      const c = await db.get<{ words: { t: string; x0: number; y0: number; x1: number; y1: number }[]; w: number; h: number; text: string }>('cache', `${id}:imgocr`);
      if (!alive || !c) return;
      setImgLayer({ words: c.words, w: c.w, h: c.h });
      setOcrText((o) => (o?.busy ? o : { text: c.text, busy: false, p: 1 }));
    };
    load();
    const on = (e: Event) => (e as CustomEvent<{ id: string }>).detail.id === id && load();
    window.addEventListener('frogity:scan', on);
    return () => {
      alive = false;
      window.removeEventListener('frogity:scan', on);
    };
  }, [content, id]);

  useEffect(() => {
    queueScan(doc); // no-op if it was already looked at when it was added
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const restoredLiquid = useRef(false);
  const restoreLiquidPage = (root: HTMLElement) => {
    if (restoredLiquid.current || !scroller) return;
    if (page > 1) {
      const el = root.querySelector<HTMLElement>(`#page-${page}`);
      if (el) {
        restoredLiquid.current = true;
        if (live.current.paged) goPage(scroller, Math.round((scroller.scrollLeft + el.getBoundingClientRect().left) / Math.max(1, scroller.clientWidth)), false);
        else scroller.scrollTop = el.offsetTop - 70;
      } else if (scroller.scrollTop > 40) restoredLiquid.current = true; // the page isn't made yet and they began reading: stay
    } else restoredLiquid.current = true;
  };

  const afterLiquid = (root: HTMLElement) => {
    foldSources(root);
    bookLang(root);
    if (isPdf) {
      restoreLiquidPage(root);
      // Use liquid headings when the PDF has no outline
      setToc((t) => {
        if (t.length) return t;
        return Array.from(root.querySelectorAll<HTMLElement>('h2,h3,h4'))
          .filter((h) => (h.textContent ?? '').length < 100)
          .map((h) => ({ title: h.textContent ?? '', anchor: h.id, level: Number(h.tagName[1]) - 1, page: Number(h.dataset.page) || undefined }));
      });
    }
    setFlowReady((n) => n + 1);
  };

  // restore position for flow documents
  useEffect(() => {
    if (!flowReady || !scroller || isPdf || restoredLiquid.current) return;
    restoredLiquid.current = true;
    const v = doc.position?.value ?? doc.progress;
    if (v > 0.001)
      requestAnimationFrame(() => {
        if (live.current.paged) goPage(scroller, Math.round(v * (pageCount(scroller) - 1)), false);
        else scroller.scrollTop = v * (scroller.scrollHeight - scroller.clientHeight);
      });
  }, [flowReady, scroller]); // eslint-disable-line react-hooks/exhaustive-deps

  // highlights
  useEffect(() => {
    const root = flowRef.current;
    if (root && flowReady) applyHighlights(root, highlights);
  }, [flowReady, highlights]);

  // ---------------------------------------------------------------- status bar & theme
  useEffect(() => {
    setStatusBar(dark, theme.bg);
  }, [dark, theme.bg]);

  // ---------------------------------------------------------------- reading time (+ learns your pace, keeps a place-holder bookmark)
  useEffect(() => {
    let last = Date.now();
    let lastAct = Date.now();
    let session = 0;
    let lastProg = progRef.current;
    let lastPage = live.current.page;
    let accMs = 0;
    let accWords = 0;
    let accPages = 0;
    const act = () => (lastAct = Date.now());
    const el = scroller;
    el?.addEventListener('scroll', act, { passive: true });
    window.addEventListener('pointerdown', act);
    const tick = (final = false) => {
      const n = Date.now();
      const active = document.visibilityState === 'visible' && (n - lastAct < 120_000 || listeningRef.current);
      const st = live.current;
      if (active) {
        const dt = Math.min(n - last, 30_000);
        addReading(dt, id);
        session += dt;
        // --- learn the reader's own speed (smoothly: each minute of evidence moves it a fifth of the way)
        const dp = progRef.current - lastProg;
        const dPages = st.page - lastPage;
        if (!st.isPdf || st.liquid) {
          if (dp >= 0 && dp < 0.15) {
            accMs += dt;
            accWords += dp * wordsRef.current;
          }
        } else if (dPages >= 0 && dPages <= 3) {
          accMs += dt;
          accPages += dPages;
        }
        if (accMs >= 60_000 && (!st.isPdf || st.liquid) && wordsRef.current > 500) {
          if (accWords >= 60) {
            const sample = Math.max(60, Math.min(900, accWords / (accMs / 60_000)));
            updateSettings({ wpm: Math.round(settingsRef.current.wpm * 0.8 + sample * 0.2) });
          }
          accMs = 0;
          accWords = 0;
        } else if (accMs >= 150_000 && st.isPdf && !st.liquid) {
          if (accPages >= 1) {
            const sample = Math.max(15, Math.min(900, accMs / 1000 / accPages));
            updateSettings({ secPerPage: Math.round(settingsRef.current.secPerPage * 0.8 + sample * 0.2) });
          }
          accMs = 0;
          accPages = 0;
        }
        // --- once you have really been reading, keep a bookmark where you are
        if (!final && (liveDoc.current.readMs ?? 0) + session >= AUTO_MARK_MS) autoMark.current();
      }
      lastProg = progRef.current;
      lastPage = st.page;
      last = n;
      setNow(new Date());
    };
    const t = setInterval(() => tick(), 15_000);
    const hide = () => document.visibilityState === 'hidden' && tick();
    document.addEventListener('visibilitychange', hide);
    return () => {
      clearInterval(t);
      tick(true);
      document.removeEventListener('visibilitychange', hide);
      el?.removeEventListener('scroll', act);
      window.removeEventListener('pointerdown', act);
    };
  }, [scroller, id]);

  // ---------------------------------------------------------------- progress + chrome on scroll
  // One rAF-throttled listener; the progress bar is moved directly so scrolling never re-renders the reader.
  const saveT = useRef(0);
  const lastY = useRef(0);
  const barRef = useRef<HTMLDivElement>(null);
  const progRef = useRef(doc.progress);
  const autoMark = useRef<() => void>(() => {});
  const liveDoc = useRef(doc);
  liveDoc.current = doc;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const wordsRef = useRef(0);
  const progT = useRef(0);
  const setProg = useCallback((p: number) => {
    progRef.current = p;
    if (barRef.current) barRef.current.style.width = `${(p * 100).toFixed(1)}%`;
    clearTimeout(progT.current);
    progT.current = window.setTimeout(() => setProgress(p), 400);
  }, []);
  const live = useRef({ page, growing, finished: !!doc.finished, liquid, isPdf, paged });
  live.current = { page, growing, finished: !!doc.finished, liquid, isPdf, paged };

  const onPdfPage = useCallback(
    (p: number) => {
      setPage(p);
      clearTimeout(saveT.current);
      saveT.current = window.setTimeout(() => patchDoc(id, { progress: progRef.current, position: { mode: 'page', value: p } }), 700);
    },
    [id],
  );

  useEffect(() => {
    const el = scroller;
    if (!el) return;
    let raf = 0;
    let markers: HTMLElement[] = [];
    let markersAt = 0;
    const frame = () => {
      raf = 0;
      const st = live.current;
      const flip = st.paged;
      const y = flip ? el.scrollLeft : el.scrollTop;
      const dy = y - lastY.current;
      lastY.current = y;
      if (!flip) {
        if (y > 120 && dy > 10 && !listeningRef.current) setChrome(false);
        else if (dy < -14) setChrome(true);
      }
      if (!st.liquid) return;
      const max = flip ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
      const prog = max > 0 ? y / max : 0;
      setProg(prog);
      let p = st.page;
      if (st.isPdf && flip) {
        const ms = Array.from(flowRef.current?.querySelectorAll<HTMLElement>('.pg') ?? []);
        let at = ms[0];
        for (const m of ms) {
          if (m.getBoundingClientRect().left <= el.clientWidth * 0.8) at = m;
          else break;
        }
        if (at) {
          p = Number(at.dataset.page) || 1;
          if (p !== st.page) setPage(p);
        }
      } else if (st.isPdf) {
        const now = performance.now();
        if (!markers.length || now - markersAt > 2500) {
          markers = Array.from(flowRef.current?.querySelectorAll<HTMLElement>('.pg') ?? []);
          markersAt = now;
        }
        if (markers.length) {
          let lo = 0;
          let hi = markers.length - 1;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (markers[mid].offsetTop <= y + 120) lo = mid;
            else hi = mid - 1;
          }
          p = Number(markers[lo].dataset.page) || 1;
          if (p !== st.page) setPage(p);
        }
      }
      clearTimeout(saveT.current);
      saveT.current = window.setTimeout(() => {
        const s2 = live.current;
        patchDoc(id, {
          progress: s2.isPdf ? (doc.pages ? p / doc.pages : prog) : prog,
          position: s2.isPdf ? { mode: 'liquid', value: p } : { mode: 'liquid', value: prog },
          // the end of a view that is still growing is not the end of the book
          ...(!s2.growing && prog > 0.985 && !s2.finished ? { finished: true } : {}),
        });
      }, 800);
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    el.addEventListener('scroll', on, { passive: true });
    return () => {
      el.removeEventListener('scroll', on);
      cancelAnimationFrame(raf);
    };
  }, [scroller, id, doc.pages, setProg]);

  // ---------------------------------------------------------------- long-press a word (PDF pages, OCR'd photos)
  useEffect(() => {
    const el = scroller;
    if (!el) return;
    let t = 0;
    let sx = 0;
    let sy = 0;
    const down = (e: TouchEvent) => {
      clearTimeout(t);
      const tg = e.target as HTMLElement;
      if (e.touches.length !== 1 || !tg.closest?.('.textLayer span, .ocr-layer span')) return;
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      t = window.setTimeout(() => {
        const sel = window.getSelection();
        // if the platform already selected something, leave it alone
        if (sel && !sel.isCollapsed && sel.toString().trim()) return;
        const w = wordAt(sx, sy);
        if (!w || !sel) return;
        sel.removeAllRanges();
        sel.addRange(w.range);
        setSelRect(w.rect);
        tap('medium');
      }, 480);
    };
    const move = (e: TouchEvent) => {
      if (Math.hypot(e.touches[0].clientX - sx, e.touches[0].clientY - sy) > 10) clearTimeout(t);
    };
    const up = () => clearTimeout(t);
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', up);
    el.addEventListener('touchcancel', up);
    return () => {
      clearTimeout(t);
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', up);
      el.removeEventListener('touchcancel', up);
    };
  }, [scroller]);

  // ---------------------------------------------------------------- selection
  useEffect(() => {
    let t = 0;
    let raf = 0;
    const measure = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount || !scroller) return setSelRect(null);
      const r = sel.getRangeAt(0);
      if (!scroller.contains(r.commonAncestorContainer)) return setSelRect(null);
      const b = r.getBoundingClientRect();
      if (!b.width && !b.height) return;
      setSelRect((old) => (old && Math.abs(old.top - b.top) < 1 && Math.abs(old.left - b.left) < 1 && Math.abs(old.width - b.width) < 1 ? old : b));
    };
    // wait for the selection (and its drag handles) to settle before showing the menu
    const on = () => {
      clearTimeout(t);
      t = window.setTimeout(measure, 220);
    };
    // keep the menu attached to the words while the page scrolls
    const follow = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!window.getSelection()?.isCollapsed) measure();
      });
    };
    document.addEventListener('selectionchange', on);
    scroller?.addEventListener('scroll', follow, { passive: true });
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(raf);
      document.removeEventListener('selectionchange', on);
      scroller?.removeEventListener('scroll', follow);
    };
  }, [scroller]);

  const selectionText = () => window.getSelection()?.toString().trim() ?? '';
  const clearSel = () => {
    window.getSelection()?.removeAllRanges();
    setSelRect(null);
  };

  // ---------------------------------------------------------------- back button
  useEffect(
    () =>
      onBack(() => {
        if (find !== null) {
          closeFind();
          return true;
        }
        if (listen) {
          setListen(false);
          return true;
        }
        if (thumbs) {
          setThumbs(false);
          return true;
        }
        close();
        return true;
      }),
    [find, listen, thumbs], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const close = () => {
    clearTimeout(saveT.current);
    if ((liveDoc.current.readMs ?? 0) >= AUTO_MARK_MS) autoMark.current();
    if (scroller && liquid && !isPdf) {
      const max = scroller.scrollHeight - scroller.clientHeight;
      const prog = max > 0 ? scroller.scrollTop / max : 0;
      patchDoc(id, { progress: prog, position: { mode: 'liquid', value: prog } });
    } else if (isPdf) patchDoc(id, { position: { mode, value: page } });
    onClose();
  };

  // ---------------------------------------------------------------- actions
  const switchMode = (m: 'page' | 'liquid') => {
    if (m === mode) return;
    restoredLiquid.current = false;
    setMode(m);
    updateSettings({ defaultPdfMode: m });
    patchDoc(id, { position: { mode: m, value: page } });
    if (m === 'page') setTimeout(() => pdfRef.current?.goTo(page), 100);
  };

  const toggleListen = (v: 'read' | 'listen') => {
    if (v === 'listen') {
      if (isPdf && !liq.ready) {
        // Listen reads the whole Liquid view, which is still being made
        toast(liq.error || liq.none ? 'Listen needs the Liquid view, which isn’t available for this PDF' : `Listen opens when Liquid is ready · ${Math.round(liq.progress * 100)}%`);
        return;
      }
      if (!liquid) switchMode('liquid');
      setListen(true);
      setChrome(true);
    } else setListen(false);
  };

  const cycleTheme = () => {
    tap();
    const i = THEMES.findIndex((t) => t.id === settings.readerTheme);
    const next = THEMES[(i + 1) % THEMES.length];
    updateSettings({ readerTheme: next.id });
    toast(next.name);
  };

  const onContentTap = (e: React.MouseEvent) => {
    if (selectionText()) return;
    const target = e.target as HTMLElement;
    if (target.closest('a')) {
      const a = target.closest('a')!;
      const href = a.getAttribute('href') ?? '';
      if (href.startsWith('#')) {
        e.preventDefault();
        const el = flowRef.current?.querySelector(CSS.escape ? `#${CSS.escape(href.slice(1))}` : href);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    const fig = target.closest<HTMLElement>('figure.lq, .flow figure');
    if (fig) {
      const src = fig.dataset.src ?? fig.querySelector('img')?.getAttribute('src');
      if (src) {
        const w = Number(fig.dataset.w) || 1;
        const h = Number(fig.dataset.h) || 1;
        setZoom({ src, mask: !!fig.querySelector('.mask'), ratio: w / h });
        return;
      }
    }
    if (listening && target.closest('.s')) return;
    setChrome((c) => !c);
  };

  const addHighlight = async () => {
    const root = flowRef.current;
    const sel = window.getSelection();
    if (!root || !sel) return;
    const a = anchorFromSelection(root, sel);
    if (!a) return;
    const h: Highlight = { id: db.uid(), docId: id, text: a.text, prefix: a.prefix, at: Date.now() };
    await db.put('marks', `${id}:h:${h.id}`, h);
    clearSel();
    setHighlights((l) => [...l, h]);
    tap();
    toast('Highlighted');
  };

  const listenFromSelection = () => {
    const root = flowRef.current;
    const sel = window.getSelection();
    if (!root || !sel?.rangeCount) return;
    wrapSentences(root);
    let node: Node | null = sel.getRangeAt(0).startContainer;
    let s: HTMLElement | null = null;
    while (node && node !== root) {
      if (node instanceof HTMLElement && node.classList.contains('s')) {
        s = node;
        break;
      }
      node = node.parentNode;
    }
    if (!s) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      const all = root.querySelectorAll<HTMLElement>('.s');
      s = Array.from(all).find((x) => x.getBoundingClientRect().bottom >= r.top) ?? null;
    }
    clearSel();
    setListen(true);
    setListenFrom(s ? Number(s.dataset.i) : 0);
  };

  /** Where you are right now, as a bookmark (auto = the single "where you stopped" one). */
  const makeMark = (auto: boolean): Bookmark => {
    const prog = progRef.current;
    let label = '';
    if (isPdf) label = `Page ${page}`;
    if (liquid && scroller && flowRef.current) {
      const top = scroller.getBoundingClientRect().top + 90;
      const el = Array.from(flowRef.current.querySelectorAll<HTMLElement>('p,h2,h3,li')).find((p) => p.getBoundingClientRect().bottom > top);
      const t = (el?.textContent ?? '').trim();
      if (t) label = (isPdf ? `p.${page} · ` : '') + (t.length > 70 ? t.slice(0, 70) + '…' : t);
    }
    const b: Bookmark = { id: auto ? 'auto' : db.uid(), docId: id, progress: isPdf && !liquid ? page / (doc.pages || 1) : prog, label: label || `${Math.round(prog * 100)}%`, at: Date.now() };
    if (isPdf) b.page = page;
    if (auto) b.auto = true;
    return b;
  };
  const putMark = async (b: Bookmark) => {
    await db.put('marks', `${id}:b:${b.id}`, b);
    setBookmarks((l) => [...l.filter((x) => x.id !== b.id), b].sort((x, y) => x.progress - y.progress));
  };
  // a bookmark you placed within a hair of where you are counts as "this spot"
  const hereMark = bookmarks.find((b) => !b.auto && (isPdf && !liquid ? b.page === page : Math.abs(b.progress - progress) < 0.012));
  const addBookmark = async () => {
    tap('medium');
    if (hereMark) {
      await db.del('marks', `${id}:b:${hereMark.id}`);
      setBookmarks((l) => l.filter((x) => x.id !== hereMark.id));
      toast('Bookmark removed');
      return;
    }
    await putMark(makeMark(false));
    toast('Bookmarked');
  };
  autoMark.current = () => {
    if (flowReady || (isPdf && !liquid)) putMark(makeMark(true)).catch(() => {});
  };

  const goProgress = (p: number, pg?: number) => {
    if (isPdf && pg) {
      if (liquid) flowRef.current?.querySelector<HTMLElement>(`#page-${pg}`)?.scrollIntoView({ block: 'start' });
      else pdfRef.current?.goTo(pg);
      return;
    }
    if (scroller) scroller.scrollTop = p * (scroller.scrollHeight - scroller.clientHeight);
  };

  // ---------------------------------------------------------------- find
  const pageTexts = useRef<Map<number, string>>(new Map());
  const runFind = useCallback(
    async (q: string) => {
      if (liquid) {
        const root = flowRef.current;
        if (!root) return;
        const groups = findAll(root, q);
        setFindHits({ n: groups.length, cur: 0 });
        if (groups[0]) {
          groups[0].forEach((m) => m.classList.add('cur'));
          groups[0][0].scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      } else if (pdf) {
        const query = q.trim().toLowerCase();
        if (query.length < 2) return setFindHits({ n: 0, cur: 0 });
        const pages: number[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          let t = pageTexts.current.get(i);
          if (t === undefined) {
            const tc = await (await pdf.getPage(i)).getTextContent();
            t = tc.items.map((it) => ('str' in it ? it.str : '')).join(' ').toLowerCase();
            pageTexts.current.set(i, t);
          }
          if (t.includes(query)) pages.push(i);
        }
        pdfRef.current?.highlight(q);
        setFindHits({ n: pages.length, cur: 0, pages });
        if (pages[0]) pdfRef.current?.goTo(pages[0], true);
      }
    },
    [liquid, pdf],
  );
  const findT = useRef(0);
  const stepFind = (d: number) => {
    const n = findHits.n;
    if (!n) return;
    const cur = (findHits.cur + d + n) % n;
    setFindHits((h) => ({ ...h, cur }));
    if (liquid) {
      const root = flowRef.current!;
      root.querySelectorAll('mark.find.cur').forEach((m) => m.classList.remove('cur'));
      const marks = Array.from(root.querySelectorAll<HTMLElement>('mark.find'));
      // groups are contiguous; rebuild by order
      const groups: HTMLElement[][] = [];
      let lastEnd: HTMLElement | null = null;
      for (const m of marks) {
        if (lastEnd && lastEnd.nextSibling === m) groups[groups.length - 1].push(m);
        else groups.push([m]);
        lastEnd = m;
      }
      const g = groups[cur];
      g?.forEach((m) => m.classList.add('cur'));
      g?.[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (findHits.pages) pdfRef.current?.goTo(findHits.pages[cur], true);
  };
  const closeFind = () => {
    setFind(null);
    if (flowRef.current) clearMarks(flowRef.current, 'find');
    pdfRef.current?.highlight('');
    setFindHits({ n: 0, cur: 0 });
  };

  // ---------------------------------------------------------------- OCR (images & scanned PDF pages)
  const runOcr = async (silent = false) => {
    const { recognize, readImage } = await import('../lib/ocr');
    if (!silent) {
      setSheet('ocr');
      setOcrText({ text: '', busy: true, p: 0 });
    }
    try {
      if (content?.type === 'image') {
        const cached = await db.get<{ words: { t: string; x0: number; y0: number; x1: number; y1: number }[]; w: number; h: number; text: string }>('cache', `${id}:imgocr`);
        if (cached) {
          setImgLayer({ words: cached.words, w: cached.w, h: cached.h });
          return setOcrText({ text: cached.text, busy: false, p: 1 });
        }
        const r = await readImage(content.blob, (p) => setOcrText((o) => (o ? { ...o, p } : o)));
        await db.put('cache', `${id}:imgocr`, { words: r.words, w: r.w, h: r.h, text: r.text });
        setImgLayer({ words: r.words, w: r.w, h: r.h });
        setOcrText({ text: r.text, busy: false, p: 1 });
      }
    } catch (e) {
      if (!silent) setOcrText({ text: `OCR failed: ${(e as Error).message}`, busy: false, p: 1 });
    }
  };

  // ---------------------------------------------------------------- ask (free AI) helpers
  const docText = useRef<string | null>(null);
  const getDocText = async (): Promise<string> => {
    if (docText.current) return docText.current;
    let text = '';
    const root = flowRef.current;
    if (liquid && root && (root.textContent ?? '').length > 200) {
      text = Array.from(root.querySelectorAll('h1,h2,h3,h4,p,li,td,figcaption,blockquote'))
        .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n\n');
    } else if (pdf) {
      const parts: string[] = [];
      for (let i = 1; i <= Math.min(pdf.numPages, 400); i++) {
        const tc = await (await pdf.getPage(i)).getTextContent();
        parts.push(tc.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : '')).join('').replace(/[ \t]+/g, ' '));
      }
      text = parts.join('\n\n');
    } else if (content?.type === 'code') text = content.text;
    else if (content?.type === 'sheet') text = content.sheets.map((s) => s.name + '\n' + s.rows.slice(0, 400).map((r) => r.join(' | ')).join('\n')).join('\n\n');
    else if (ocrText?.text) text = ocrText.text;
    text = text.slice(0, 600_000);
    if (text.trim().length < 40) throw new Error('There is no readable text to ask about yet. For photos, run OCR first.');
    docText.current = text;
    return text;
  };

  usePager(scroller, paged);
  // a Frogity note: written here (and on the computer)
  const [writing, setWriting] = useState(false);
  useEffect(() => {
    if (doc.kind === 'fr' && sessionStorage.getItem('fr:edit') === id) {
      sessionStorage.removeItem('fr:edit');
      setWriting(true);
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Makes an editable Frogity note from this document's text (Word, web pages, Markdown, text…). */
  const makeNote = async () => {
    const root = flowRef.current;
    if (!root) return;
    toast('Making a note…');
    const copy = root.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('.pg, .lq-wait, .lq-status-wrap, script, style').forEach((n) => n.remove());
    copy.querySelectorAll('.s').forEach((sp) => sp.replaceWith(...Array.from(sp.childNodes)));
    // pictures inside the document come along (small ones), as data
    for (const img of Array.from(copy.querySelectorAll('img'))) {
      try {
        const b = await (await fetch(img.src)).blob();
        if (b.size > 400_000) throw new Error('large');
        const url = await new Promise<string>((res) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result));
          r.readAsDataURL(b);
        });
        img.src = url;
      } catch {
        img.remove();
      }
    }
    copy.querySelectorAll('[class], [id], [data-i], [data-page], [style]').forEach((n) => ['class', 'id', 'data-i', 'data-page', 'style', 'data-wrapped'].forEach((a) => n.removeAttribute(a)));
    const { makeFr } = await import('../lib/fr');
    const m = await importFile(makeFr(doc.name, copy.innerHTML), `${doc.name}.fr`, { title: doc.name });
    toast('Made an editable note');
    sessionStorage.setItem('fr:edit', m.id);
    onOpenDoc?.(m.id);
  };
  // while the position bar is held, the controls step aside (see reader.css)
  useEffect(() => {
    const on = (e: Event) => document.querySelector('.reader')?.classList.toggle('scrubbing', !!(e as CustomEvent<boolean>).detail);
    window.addEventListener('frogity:scrub', on);
    return () => {
      window.removeEventListener('frogity:scrub', on);
      document.querySelector('.reader')?.classList.remove('scrubbing');
    };
  }, []);

  // ---------------------------------------------------------------- derived
  const words = useMemo(() => {
    if (!flowReady || !flowRef.current) return 0;
    return (flowRef.current.textContent ?? '').split(/\s+/).length;
  }, [flowReady]);
  wordsRef.current = words;
  const minutesLeft = liquid || !isPdf ? Math.max(1, Math.round((words * (1 - progress)) / settings.wpm)) : Math.max(1, Math.round((((doc.pages ?? 1) - page + 1) * settings.secPerPage) / 60));

  const moreActions: MoreAction[] = [
    { id: 'find', label: 'Search', icon: 'search', quick: true },
    { id: 'contents', label: 'Contents', icon: 'list', quick: true },
    { id: 'share', label: 'Share', icon: 'share', quick: true },
    { id: 'convert', label: 'Convert', pixel: 'convert', quick: true },
    { id: 'edit', label: 'Edit this note', icon: 'pen', hidden: doc.kind !== 'fr' },
    { id: 'tonote', label: 'Make an editable note (Frogity)', icon: 'edit', right: 'edit anywhere', hidden: !['docx', 'odt', 'rtf', 'html', 'markdown', 'text', 'epub'].includes(doc.kind) },
    { id: 'form', label: 'Fill this form', icon: 'edit', right: form ? `${form.fields.length} fields` : undefined, hidden: !form },
    { id: 'ask', label: 'Ask this document', icon: 'ask', right: 'free ai' },
    { id: 'bookmark', label: hereMark ? 'Remove bookmark here' : 'Bookmark this spot', icon: 'bookmark' },
    { id: 'mode', label: liquid ? 'Original pages' : 'Liquid view', icon: liquid ? 'page' : 'liquid', right: !liquid && liq.busy && !liq.ready ? `${Math.round(liq.progress * 100)}%` : undefined, hidden: !isPdf },
    { id: 'thumbs', label: thumbs ? 'Hide page thumbnails' : 'Page thumbnails', icon: 'sidebar', hidden: !isPdf || liquid },
    { id: 'ocr', label: 'Recognise text (OCR)', pixel: 'scan', hidden: content?.type !== 'image' },
    { id: 'card', label: 'Share as a book card', icon: 'share' },
    { id: 'info', label: 'About this file', icon: 'info' },
    { id: 'remove', label: doc.uri ? 'Remove from shelf' : 'Delete from Frogity', icon: 'trash' },
  ];

  const onMore = async (a: string) => {
    if (a === 'ask') {
      setAskSel(undefined);
      setSheet('ask');
    } else if (a === 'find') setFind('');
    else if (a === 'contents') setSheet('contents');
    else if (a === 'bookmark') addBookmark();
    else if (a === 'mode') switchMode(liquid ? 'page' : 'liquid');
    else if (a === 'thumbs') setThumbs((t) => !t);
    else if (a === 'convert') onConvert(doc, liquid ? flowRef.current : null);
    else if (a === 'ocr') runOcr();
    else if (a === 'info') setSheet('info');
    else if (a === 'edit') setWriting(true);
    else if (a === 'tonote') void makeNote();
    else if (a === 'remove') setSheet('remove');
    else if (a === 'card') (await import('../lib/shareCard')).shareBookCard(doc).catch(() => toast('Couldn’t make the card'));
    else if (a === 'share') {
      const f = await getFile(id);
      if (f) shareFile(f, doc.fileName).catch(() => {});
    }
  };

  const style = {
    '--r-font': fontById(settings.font).family,
    '--r-fscale': fontById(settings.font).scale,
    '--r-size': `${settings.fontSize}px`,
    '--r-lh': settings.lineHeight,
    '--r-margin': `${settings.margin}px`,
    '--r-align': settings.justify ? 'justify' : 'left',
  } as React.CSSProperties;

  const showPdfPages = isPdf && !liquid && pdf;

  return (
    <div className="reader" data-theme={settings.readerTheme} data-dark={dark ? '1' : undefined} style={style}>
      <div className="r-progress" ref={barRef} style={{ width: `${Math.round(progress * 100)}%` }} />
      <div className={`reader-scroll${paged ? ' paged' : ''}`} ref={setScroller} style={{ paddingLeft: showPdfPages && thumbs ? 84 : 0 }}>
        {error ? (
          <div className="empty" style={{ paddingTop: 140 }}>
            <h2>Couldn’t open this file</h2>
            <p>{error}</p>
            <button className="pill" onClick={close}>
              Back to library
            </button>
          </div>
        ) : !content ? (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
            <PixelLoader grid={4} size={7} label="opening" />
          </div>
        ) : showPdfPages ? (
          <PdfView ref={pdfRef} pdf={pdf} scroller={scroller} initialPage={page} thumbs={thumbs} onPage={onPdfPage} onProgress={setProg} onTap={onContentTap} />
        ) : isPdf && !liquid ? (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
            <PixelLoader grid={4} size={7} label="opening" />
          </div>
        ) : content.type === 'sheet' ? (
          <div onClick={onContentTap}>
            <SheetView sheets={content.sheets} />
          </div>
        ) : content.type === 'image' ? (
          <ImageView url={content.url} onTap={() => setChrome((c) => !c)} layer={imgLayer} />
        ) : content.type === 'media' ? (
          <MediaView url={content.url} kind={content.kind} name={doc.name} />
        ) : content.type === 'code' ? (
          <CodeView text={content.text} onTap={() => setChrome((c) => !c)} />
        ) : content.type === 'binary' ? (
          <BinaryView
            hex={content.hex}
            size={content.size}
            onAsText={async () => {
              const f = await getFile(id);
              if (!f) return;
              await patchDoc(id, { kind: 'text' });
              const { textToLiquid } = await import('../lib/formats/flow');
              setContent({ type: 'flow', liquid: textToLiquid(await f.arrayBuffer()) });
            }}
          />
        ) : (
          <>
            <div className={`flow${showGrowth ? ' growing' : ''}${paged ? ' paged' : ''}`} data-font={settings.font} ref={flowRef} onClick={onContentTap} lang={settings.lang && settings.lang !== 'other' ? settings.lang : 'en'} />
            {showGrowth && (
              <div className="lq-status-wrap">
                <LiquidStatus prep={liq} pages={doc.pages} onRetry={() => prepareNow(doc)} onPages={() => switchMode('page')} />
              </div>
            )}
          </>
        )}
      </div>

      {find !== null ? (
        <div className="findbar">
          <Icon name="search" size={18} />
          <input
            autoFocus
            placeholder={liquid ? 'find in text' : 'find in pages'}
            value={find}
            onChange={(e) => {
              const v = e.target.value;
              setFind(v);
              clearTimeout(findT.current);
              findT.current = window.setTimeout(() => runFind(v), 280);
            }}
            onKeyDown={(e) => e.key === 'Enter' && stepFind(e.shiftKey ? -1 : 1)}
          />
          <span className="count">{findHits.n ? `${findHits.cur + 1}/${findHits.n}${findHits.pages ? 'p' : ''}` : find.length > 1 ? '0' : ''}</span>
          <button className="r-ibtn" onClick={() => stepFind(-1)} aria-label="Previous match">
            <Icon name="up" />
          </button>
          <button className="r-ibtn" onClick={() => stepFind(1)} aria-label="Next match">
            <Icon name="down" />
          </button>
          <button className="r-ibtn" onClick={closeFind} aria-label="Close search">
            <Icon name="close" />
          </button>
        </div>
      ) : (
        <div className={`r-top${chrome ? '' : ' hide'}`}>
          <button className="r-ibtn" onClick={close} aria-label="Back to library">
            <Icon name="back" size={24} />
          </button>
          <button className="title" onClick={() => isPdf && setSheet('type')} tabIndex={isPdf ? 0 : -1} aria-label={isPdf ? `${doc.name}, view and reading settings` : doc.name}>
            <span className="t1">
              {doc.name}
              {isPdf ? ` · ${page}/${doc.pages ?? '?'}` : ''}
            </span>
            {isPdf && <span className="t2">{prepLine(liq)}</span>}
          </button>
          <button
            className="r-ibtn"
            onClick={() => {
              setAskSel(undefined);
              setSheet('ask');
            }}
            aria-label="Ask this document"
          >
            <Icon name="ask" />
          </button>
          {isPdf && <ViewButton active={liquid} prep={liq} onClick={() => switchMode(liquid ? 'page' : 'liquid')} />}
          <button className={`r-ibtn${hereMark ? ' on' : ''}`} onClick={addBookmark} aria-label={hereMark ? 'Remove bookmark' : 'Bookmark this spot'}>
            <Icon name="bookmark" />
          </button>
          <button className="r-ibtn" onClick={() => setSheet('more')} aria-label="More">
            <Icon name="more" size={22} stroke={2.6} />
          </button>
        </div>
      )}

      {liquid && <div className="r-fade" style={{ opacity: chrome || listen ? 1 : 0.55 }} />}

      <div className={`r-dock${chrome || listen ? '' : ' hide'}`}>
        {form && !offerGone && !formOpen && (
          <div className="form-offer" role="status">
            <div className="t">
              <b>This looks like a form</b>
              <small>{form.fields.length} fields found · fill, sign and export</small>
            </div>
            <button className="pill sm" onClick={() => (setFormOpen(true), setOfferGone(true))}>
              Fill it in
            </button>
            <button
              className="pill sm round ghost offer-x"
              aria-label="Not now (this also closes by itself)"
              onClick={() => {
                setOfferGone(true);
                db.put('kv', `formoffer:${id}`, true);
              }}
            >
              {/* the ring runs down while the offer waits; it closes by itself when the ring is empty */}
              <svg className="offer-ring" viewBox="0 0 40 40" aria-hidden>
                <circle className="track" cx="20" cy="20" r="18" />
                <circle
                  className="run"
                  cx="20"
                  cy="20"
                  r="18"
                  pathLength={100}
                  onAnimationEnd={() => {
                    setOfferGone(true);
                    db.put('kv', `formoffer:${id}`, true);
                  }}
                />
              </svg>
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {listen && (
          <div style={{ width: '100%', display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
            <ListenBar root={flowRef.current} scroller={scroller} startAt={listenFrom} onPlaying={setListening} docId={id} title={doc.name} coverId={doc.coverId} key={flowReady} />
          </div>
        )}
        {!listen && (liquid || isPdf) && content?.type !== 'sheet' && content?.type !== 'image' && (
          <Scrub
            ariaLabel="Position in the book"
            value={isPdf && !liquid ? ((page - 1) / Math.max(1, (doc.pages ?? 1) - 1)) : progress}
            label={(v) => {
              if (isPdf && !liquid) return `Page ${Math.round(v * Math.max(1, (doc.pages ?? 1) - 1)) + 1} of ${doc.pages ?? '?'}`;
              const left = Math.max(1, Math.round((words * (1 - v)) / settings.wpm));
              // a Liquid view of a PDF: which page that spot belongs to
              const pg = (() => {
                if (!scroller || !isPdf) return '';
                const y = v * (scroller.scrollHeight - scroller.clientHeight);
                let n = '';
                for (const el of Array.from(flowRef.current?.querySelectorAll<HTMLElement>('.pg[data-page]') ?? [])) {
                  if (el.offsetTop > y + 40) break;
                  n = el.dataset.page ?? n;
                }
                return n ? `page ${n} · ` : '';
              })();
              return `${pg}${Math.round(v * 100)}% · ${left} min left`;
            }}
            onChange={(v, final) => {
              if (isPdf && !liquid) {
                const n = Math.round(v * Math.max(1, (doc.pages ?? 1) - 1)) + 1;
                if (final || n !== page) pdfRef.current?.goTo(n);
              } else if (scroller && paged) {
                goPage(scroller, Math.round(v * (pageCount(scroller) - 1)), final);
                if (final) setProgress(v);
              } else if (scroller) {
                scroller.scrollTop = v * (scroller.scrollHeight - scroller.clientHeight);
                if (final) setProgress(v);
              }
            }}
          />
        )}
        <div className="r-dock-row compact">
          <button className="timechip" onClick={() => setClockMode((m) => (m === 'time' ? 'left' : 'time'))} aria-label="Clock / time left">
            <Icon name="clock" size={15} />
            <span>{clockMode === 'time' ? now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : `${minutesLeft}m left`}</span>
          </button>
          {(liquid || isPdf) && content?.type !== 'sheet' ? (
            <Segmented
              className="compact"
              value={listen ? 'listen' : 'read'}
              onChange={toggleListen}
              options={[
                { value: 'read', label: 'Read' },
                { value: 'listen', label: 'Listen' },
              ]}
            />
          ) : null}
          <button className="pill round sm" onClick={cycleTheme} onContextMenu={(e) => (e.preventDefault(), setSheet('type'))} aria-label="Theme">
            <Icon name={dark ? 'moon' : 'sun'} size={20} />
          </button>
          <button className="pill round sm" onClick={() => setSheet('type')} aria-label="Typography">
            <TypeGlyph size={20} />
          </button>
        </div>
        <button className="r-chev" onClick={() => setChrome(false)} aria-label="Hide controls">
          <Icon name="down" size={20} />
        </button>
      </div>

      <SelectionMenu
        rect={selRect}
        onDefine={() => {
          const w = selectionText().split(/\s+/).slice(0, 5).join(' ');
          clearSel();
          setLookup(w);
        }}
        onHighlight={liquid ? addHighlight : undefined}
        onListen={liquid && (!isPdf || liq.ready) ? listenFromSelection : undefined}
        onAsk={() => {
          setAskSel(selectionText().slice(0, 1500));
          clearSel();
          setSheet('ask');
        }}
        onCopy={() => {
          navigator.clipboard?.writeText(selectionText());
          clearSel();
          toast('Copied');
        }}
        onShare={() => {
          shareText(`“${selectionText()}” — ${doc.name}`);
          clearSel();
        }}
      />
      <LookupCard word={lookup} onClose={() => setLookup(null)} />
      <ZoomViewer src={zoom?.src ?? null} mask={zoom?.mask} ratio={zoom?.ratio} onClose={() => setZoom(null)} />

      <TypeSheet open={sheet === 'type'} onClose={() => setSheet(null)} isPdf={isPdf} mode={mode} onMode={switchMode} prep={liq} pages={doc.pages} onRetry={() => prepareNow(doc)} />
      <ContentsSheet
        open={sheet === 'contents'}
        onClose={() => setSheet(null)}
        toc={toc}
        marks={bookmarks}
        highlights={highlights}
        onAddMark={() => {
          setSheet(null);
          addBookmark();
        }}
        onGo={(t) => {
          setSheet(null);
          if (t.page && isPdf) goProgress(0, t.page);
          else flowRef.current?.querySelector(`#${CSS.escape(t.anchor)}`)?.scrollIntoView({ block: 'start' });
        }}
        onGoMark={(b) => {
          setSheet(null);
          goProgress(b.progress, (b as Bookmark & { page?: number }).page);
        }}
        onGoHighlight={(h) => {
          setSheet(null);
          if (!liquid) switchMode('liquid');
          setTimeout(() => flowRef.current?.querySelector(`mark.hl[data-id="${h.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 200);
        }}
        onDeleteMark={async (b) => {
          await db.del('marks', `${id}:b:${b.id}`);
          setBookmarks((l) => l.filter((x) => x.id !== b.id));
        }}
        onDeleteHighlight={async (h) => {
          await db.del('marks', `${id}:h:${h.id}`);
          setHighlights((l) => l.filter((x) => x.id !== h.id));
        }}
      />
      {form && formOpen && (
        <FormSheet
          open
          onClose={() => setFormOpen(false)}
          model={form}
          docName={doc.name}
          getData={async () => (await (await getFile(id))!.arrayBuffer()) as ArrayBuffer}
          onAddToLibrary={async (blob, name) => {
            await importFile(blob, name, { title: name.replace(/\.pdf$/i, '') });
          }}
        />
      )}
      {writing && (
        <FrEditor
          doc={docById(id) ?? doc}
          onClose={async (changed) => {
            setWriting(false);
            if (changed) {
              const fresh = docById(id);
              if (fresh) setContent(await loadContent(fresh));
            }
          }}
        />
      )}
      <LiquidIntro open={intro} prep={liq} onClose={() => setIntro(false)} onTry={() => (setIntro(false), switchMode('liquid'))} />
      <MoreSheet open={sheet === 'more'} onClose={() => setSheet(null)} actions={moreActions} onAction={onMore} title={doc.name} />
      <ConfirmSheet
        open={sheet === 'remove'}
        onClose={() => setSheet(null)}
        title={doc.uri ? 'Remove from your shelf?' : 'Delete this file?'}
        body={doc.uri ? 'The file stays where it is on your phone; only its place on your shelf, with bookmarks and highlights, goes.' : 'The copy inside Frogity, with its bookmarks and highlights, is deleted. Originals you opened from other apps are untouched.'}
        names={[doc.name]}
        confirmLabel={doc.uri ? 'Remove' : 'Delete'}
        onConfirm={async () => {
          if (doc.uri) (await import('../lib/linked')).ignoreUri(doc.uri);
          await removeDoc(id);
          toast(doc.uri ? 'Removed from shelf' : 'Deleted');
          onClose();
        }}
      />
      <Sheet open={sheet === 'info'} onClose={() => setSheet(null)} title="About this file">
        <div className="sheet-body">
          {[
            ['name', doc.fileName],
            ['type', KIND_LABEL[doc.kind]],
            ['size', `${(doc.size / 1024).toFixed(0)} KB`],
            ['pages', doc.pages ? String(doc.pages) : '—'],
            ['author', doc.author ?? '—'],
            ['added', new Date(doc.addedAt).toLocaleString()],
            ['time read', `${Math.round((doc.readMs ?? 0) / 60000)} min`],
            ['progress', `${Math.round(progress * 100)}%`],
          ].map(([k, v]) => (
            <div className="row" key={k}>
              <span className="mono muted" style={{ width: 90, fontSize: 12 }}>
                {k}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{v}</span>
            </div>
          ))}
        </div>
      </Sheet>
      <AskSheet
        open={sheet === 'ask'}
        onClose={() => setSheet(null)}
        title={doc.name}
        getText={getDocText}
        selection={askSel}
        aiOk={settings.aiOk}
        onConsent={() => updateSettings({ aiOk: true })}
      />
      <Sheet open={sheet === 'ocr'} onClose={() => setSheet(null)} title="Recognised text">
        <div className="sheet-body">
          {ocrText?.busy ? (
            <div style={{ padding: '20px 0 30px', display: 'grid', gap: 14, justifyItems: 'center' }}>
              <PixelLoader grid={4} size={6} label="reading the page" />
              <PixelBar value={ocrText.p} />
            </div>
          ) : (
            <>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--serif)', fontSize: 16, lineHeight: 1.5, userSelect: 'text', WebkitUserSelect: 'text' }}>{ocrText?.text || 'No text found.'}</pre>
              {!!ocrText?.text && content?.type === 'image' && (
                <div style={{ display: 'flex', gap: 8, padding: '6px 0 12px' }}>
                  <button
                    className="pill"
                    onClick={async () => {
                      const blob = new Blob([ocrText.text], { type: 'text/plain' });
                      await importFile(blob, `${doc.name} (text).txt`);
                      setSheet(null);
                      toast('Saved to your shelf');
                    }}
                  >
                    Save as document
                  </button>
                  <button
                    className="pill ghost"
                    onClick={() => {
                      navigator.clipboard?.writeText(ocrText.text);
                      toast('Copied');
                    }}
                  >
                    Copy
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </Sheet>
    </div>
  );
}
