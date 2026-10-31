import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openPdf, renderPage, type PDFDocumentProxy } from '../../lib/pdf';
import { docById, toast, useStore, type LocalDoc } from '../../lib/store';
import { importFiles, saveFile, updateDoc, updateMarks, getFile } from '../../sync/engine';
import { newId } from '../../sync/core';
import { textOf } from '../../lib/search';
import { buildPdf, formFields, shownSize, type Ann, type Model, type PageRef, type Source } from './model';
import { PageView, type Tool, type ToolOpts } from './PageView';
import { Glance, Thumb } from './Glance';
import { Icon } from '../Icon';
import { Dialog, download, pickFiles, prompt } from '../bits';
import { registerCommands, dropCommands } from '../commands';
import { getUi, openDoc, setUi } from '../state';
import { renameDoc } from '../actions';

type View = 'pages' | 'glance' | 'read';
type Panel = null | 'contents' | 'marks' | 'form';
const COLORS = ['#111111', '#d6452f', '#2f7cf6', '#1f9d55', '#ffd23f', '#a347e6'];
const HL = ['#ffd23f', '#9be15d', '#7ad7ff', '#ff9ad5'];

export function PdfWorkspace({ doc, blob, secondary }: { doc: LocalDoc; blob: Blob; secondary?: boolean }) {
  const id = doc.id;
  const [sources] = useState(() => new Map<string, Source>());
  const [model, setModelState] = useState<Model | null>(null);
  const modelRef = useRef<Model | null>(null);
  const undo = useRef<Model[]>([]);
  const redo = useRef<Model[]>([]);
  const [view, setView] = useState<View>('pages');
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState<'width' | 'page' | null>('width');
  const [tool, setTool] = useState<Tool>('select');
  const [opts, setOpts] = useState<ToolOpts>({ color: '#d6452f', size: 14, font: 'sans', bold: false });
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [pageSel, setPageSel] = useState<string[]>([]);
  const [cols, setCols] = useState(5);
  const [current, setCurrent] = useState(1);
  const [thumbs, setThumbs] = useState(!secondary);
  const [panel, setPanel] = useState<Panel>(null);
  const [find, setFind] = useState<{ q: string; hits: number[]; at: number } | null>(null);
  const [dirty, setDirty] = useState<'' | 'unsaved' | 'saving' | 'saved'>('');
  const [outline, setOutline] = useState<{ title: string; page: number; depth: number }[]>([]);
  const [fields, setFields] = useState<Awaited<ReturnType<typeof formFields>>>([]);
  const [sign, setSign] = useState(false);
  const [pickPdf, setPickPdf] = useState<number | null>(null);
  const [texts, setTexts] = useState<string[] | null>(null);
  const viewer = useRef<HTMLDivElement>(null);
  const firstSig = useRef('');
  const live = useStore((s) => s.docs.find((d) => d.id === id));
  const marks = live?.meta.marks ?? doc.meta.marks;

  // ---------------------------------------------------------------- open
  useEffect(() => {
    let alive = true;
    (async () => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let pdf: PDFDocumentProxy;
      try {
        pdf = await openPdf(bytes);
      } catch (e) {
        toast('This PDF could not be opened: ' + (e as Error).message);
        return;
      }
      if (!alive) return void pdf.loadingTask.destroy();
      sources.set('self', { pdf, bytes });
      const pages: PageRef[] = [];
      for (let i = 0; i < pdf.numPages; i++) {
        const p = await pdf.getPage(i + 1);
        const [x0, y0, x1, y1] = p.view;
        pages.push({ key: newId(), src: 'self', index: i, rot: 0, w: x1 - x0, h: y1 - y0, own: p.rotate % 360 });
      }
      if (!alive) return;
      const m: Model = { pages, anns: [], form: {} };
      firstSig.current = `${pages[0]?.key}:0:0`;
      modelRef.current = m;
      setModelState(m);
      pdf.getOutline().then(async (o) => {
        const flat: { title: string; page: number; depth: number }[] = [];
        const walk = async (items: typeof o, depth: number) => {
          for (const it of items ?? []) {
            let page = 0;
            try {
              const dest = typeof it.dest === 'string' ? await pdf.getDestination(it.dest) : it.dest;
              if (dest) page = (await pdf.getPageIndex(dest[0] as never)) + 1;
            } catch {
              /* no page */
            }
            flat.push({ title: it.title, page, depth });
            if (it.items?.length && depth < 3) await walk(it.items, depth + 1);
          }
        };
        await walk(o, 0);
        if (alive) setOutline(flat);
      });
      formFields(bytes).then((f) => alive && setFields(f));
      // where to start: a page asked for (a search hit, a highlight), or where the phone left off
      const jump = getUi().jump[id] ?? (doc.meta.doc.position?.mode === 'page' ? Math.round(doc.meta.doc.position.value) : 0);
      if (jump > 1) setTimeout(() => goTo(jump, 'auto'), 80);
      if (!secondary) void updateDoc(id, { openedAt: Date.now(), pages: pdf.numPages });
    })();
    return () => {
      alive = false;
    };
  }, [blob]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      for (const s of sources.values()) void s.pdf.loadingTask.destroy();
    },
    [sources],
  );

  // ---------------------------------------------------------------- changing the model (with undo)
  const setModel = useCallback((f: (m: Model) => Model, record = true) => {
    const cur = modelRef.current;
    if (!cur) return;
    const next = f(cur);
    if (record) {
      undo.current.push(cur);
      if (undo.current.length > 200) undo.current.shift();
      redo.current = [];
    }
    modelRef.current = next;
    setModelState(next);
    setDirty('unsaved');
  }, []);
  const back = () => {
    const prev = undo.current.pop();
    if (!prev || !modelRef.current) return;
    redo.current.push(modelRef.current);
    modelRef.current = prev;
    setModelState(prev);
    setDirty('unsaved');
  };
  const fwd = () => {
    const nxt = redo.current.pop();
    if (!nxt || !modelRef.current) return;
    undo.current.push(modelRef.current);
    modelRef.current = nxt;
    setModelState(nxt);
    setDirty('unsaved');
  };

  // ---------------------------------------------------------------- saving (to this computer at once, then to the phone)
  const saving = useRef<Promise<void> | null>(null);
  const save = useCallback(async () => {
    if (saving.current) await saving.current;
    const m = modelRef.current;
    if (!m) return;
    saving.current = (async () => {
      setDirty('saving');
      try {
        const bytes = await buildPdf(m, sources);
        const out = new Blob([bytes as BlobPart], { type: 'application/pdf' });
        let cover: Blob | undefined;
        const first = m.pages[0];
        const sig = first ? `${first.key}:${first.rot}:${m.anns.filter((a) => a.page === first.key).length}` : '';
        if (sig !== firstSig.current) {
          // the first page changed (moved, turned, written on): a fresh cover
          firstSig.current = sig;
          const c = await coverOf(out);
          if (c) cover = c;
        }
        await saveFile(id, out, { pages: m.pages.length }, cover);
        if (modelRef.current === m) setDirty('saved');
        else setDirty('unsaved');
      } catch (e) {
        setDirty('unsaved');
        toast('Could not save: ' + (e as Error).message);
      }
    })();
    await saving.current;
    saving.current = null;
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // by itself: a few seconds after the last change, when leaving, and when the window loses focus
  useEffect(() => {
    if (dirty !== 'unsaved' || editing) return;
    const t = setTimeout(() => void save(), 6000);
    return () => clearTimeout(t);
  }, [dirty, model, editing, save]);
  useEffect(() => {
    const flush = () => dirtyRef.current === 'unsaved' && void save();
    window.addEventListener('blur', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('blur', flush);
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [save]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // ---------------------------------------------------------------- zoom and pages
  const maxW = useMemo(() => Math.max(1, ...(model?.pages.map((p) => shownSize(p).w) ?? [612])), [model]);
  const maxH = useMemo(() => Math.max(1, ...(model?.pages.map((p) => shownSize(p).h) ?? [792])), [model]);
  useEffect(() => {
    if (!fit || !viewer.current) return;
    const el = viewer.current;
    const apply = () => {
      const w = el.clientWidth - 64;
      const h = el.clientHeight - 60;
      setZoom(Math.max(0.2, Math.min(5, fit === 'width' ? Math.min(w, 940) / maxW : Math.min(w / maxW, h / maxH))));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, maxW, maxH, view, thumbs, panel]);
  const zoomBy = (f: number) => {
    setFit(null);
    setZoom((z) => Math.max(0.2, Math.min(6, +(z * f).toFixed(3))));
  };
  // ctrl/⌘ + wheel or pinch zooms the pages, keeping the spot under the pointer
  useEffect(() => {
    const el = viewer.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.0022));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [view]);

  const vis = useRef(new Map<number, number>());
  const onVisible = useCallback((num: number, ratio: number) => {
    if (ratio > 0) vis.current.set(num, ratio);
    else vis.current.delete(num);
    let best = 0;
    let br = 0;
    for (const [n, r] of vis.current) if (r > br || (r === br && n < best)) (best = n), (br = r);
    if (best) setCurrent(best);
  }, []);
  // reading progress goes back to the phone (a little after the page settles)
  useEffect(() => {
    if (!model || secondary) return;
    const t = setTimeout(() => void updateDoc(id, { progress: current / model.pages.length, position: { mode: 'page', value: current } }), 2000);
    return () => clearTimeout(t);
  }, [current, model?.pages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const goTo = (n: number, behavior: ScrollBehavior = 'smooth') => {
    if (view !== 'pages') setView('pages');
    requestAnimationFrame(() => viewer.current?.querySelector<HTMLElement>(`.page[data-num="${n}"]`)?.scrollIntoView({ behavior, block: 'start' }));
  };

  // ---------------------------------------------------------------- marks
  const create = useCallback(
    (key: string) => (a: Omit<Ann, 'id' | 'page'>) => {
      const ann: Ann = { ...a, id: newId(), page: key };
      setModel((m) => ({ ...m, anns: [...m.anns, ann] }));
      setSel(ann.id);
      if (ann.type === 'text') setEditing(ann.id);
      // one at a time: after a text box, a note or a picture, the pointer selects again
      if (ann.type === 'text' || ann.type === 'note' || ann.type === 'img') setTool('select');
    },
    [setModel],
  );
  const change = useCallback(
    (aid: string, patch: Partial<Ann>, final?: boolean) => {
      if (final && !Object.keys(patch).length) {
        // a move ended: one undo step for the whole move
        setDirty('unsaved');
        return;
      }
      setModel((m) => {
        const a = m.anns.find((x) => x.id === aid);
        if (!a) return m;
        if (final && patch.text !== undefined && !patch.text.trim() && (a.type === 'text' || a.type === 'note') && a.type === 'text') return { ...m, anns: m.anns.filter((x) => x.id !== aid) };
        return { ...m, anns: m.anns.map((x) => (x.id === aid ? { ...x, ...patch } : x)) };
      }, !!final);
    },
    [setModel],
  );
  const removeAnn = (aid: string) => {
    const a = modelRef.current?.anns.find((x) => x.id === aid);
    setModel((m) => ({ ...m, anns: m.anns.filter((x) => x.id !== aid) }));
    setSel(null);
    if (a?.mark) void updateMarks(id, (mk, gone) => ((mk.h = mk.h.filter((h) => h.id !== a.id)), gone.push(a.id)));
  };
  /** The words selected on a page become a highlight (drawn on the page and kept as a synced highlight). */
  const highlightSelection = (): boolean => {
    const s = getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return false;
    const range = s.getRangeAt(0);
    const text = s.toString().replace(/\s+/g, ' ').trim();
    if (!text) return false;
    const pagesEls = Array.from(viewer.current?.querySelectorAll<HTMLElement>('.page') ?? []).filter((el) => range.intersectsNode(el));
    let made = false;
    for (const el of pagesEls) {
      const r = el.getBoundingClientRect();
      const rects = Array.from(range.getClientRects())
        .filter((c) => c.width > 1 && c.height > 1 && c.top >= r.top - 2 && c.bottom <= r.bottom + 2 && c.left >= r.left - 2 && c.right <= r.right + 2)
        .map((c) => [(c.left - r.left) / r.width, (c.top - r.top) / r.height, c.width / r.width, c.height / r.height]);
      if (!rects.length) continue;
      const key = el.dataset.key!;
      const num = Number(el.dataset.num);
      const flat = rects.flat();
      const xs = rects.map((q) => q[0]);
      const ys = rects.map((q) => q[1]);
      const ann: Ann = { id: newId(), page: key, type: 'hl', x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...rects.map((q) => q[0] + q[2])) - Math.min(...xs), h: Math.max(...rects.map((q) => q[1] + q[3])) - Math.min(...ys), color: HL.includes(opts.color) ? opts.color : '#ffd23f', size: 1, opacity: 0.4, pts: flat, mark: text };
      setModel((m) => ({ ...m, anns: [...m.anns, ann] }));
      void updateMarks(id, (mk) => mk.h.push({ id: ann.id, docId: id, text, prefix: '', at: Date.now(), page: num, rects }));
      made = true;
    }
    if (made) {
      s.removeAllRanges();
      toast('Highlighted — also on your phone');
    }
    return made;
  };
  const here = marks.b.find((b) => !b.auto && b.page === current);
  const toggleBookmark = () =>
    void updateMarks(id, (mk, gone) => {
      if (here) {
        mk.b = mk.b.filter((b) => b.id !== here.id);
        gone.push(here.id);
      } else mk.b.push({ id: newId(), docId: id, page: current, progress: current / (modelRef.current?.pages.length ?? 1), label: `Page ${current}`, at: Date.now() });
    });

  // ---------------------------------------------------------------- page operations
  const ops = useMemo(
    () => ({
      rotate: (keys: string[], d: number) => setModel((m) => ({ ...m, pages: m.pages.map((p) => (keys.includes(p.key) ? { ...p, rot: (((p.rot + d) % 360) + 360) % 360 } : p)), anns: m.anns.filter((a) => !keys.includes(a.page)) })),
      remove: (keys: string[]) => {
        if (modelRef.current && keys.length >= modelRef.current.pages.length) return toast('A PDF needs at least one page');
        setModel((m) => ({ ...m, pages: m.pages.filter((p) => !keys.includes(p.key)), anns: m.anns.filter((a) => !keys.includes(a.page)) }));
        setPageSel([]);
        toast(keys.length > 1 ? `${keys.length} pages removed` : 'Page removed', { label: 'Undo', run: back });
      },
      duplicate: (keys: string[]) =>
        setModel((m) => {
          const pages: PageRef[] = [];
          const anns = [...m.anns];
          for (const p of m.pages) {
            pages.push(p);
            if (keys.includes(p.key)) {
              const k = newId();
              pages.push({ ...p, key: k });
              for (const a of m.anns.filter((x) => x.page === p.key)) anns.push({ ...a, id: newId(), page: k, mark: undefined });
            }
          }
          return { ...m, pages, anns };
        }),
      extract: async (keys: string[]) => {
        const m = modelRef.current!;
        const name = await prompt('Name of the new PDF', `${doc.meta.doc.name} — ${keys.length === 1 ? 'page ' + (m.pages.findIndex((p) => p.key === keys[0]) + 1) : keys.length + ' pages'}`, 'Create');
        if (!name) return;
        const sub: Model = { pages: m.pages.filter((p) => keys.includes(p.key)), anns: m.anns.filter((a) => keys.includes(a.page)), form: m.form };
        const bytes = await buildPdf(sub, sources);
        const [nid] = await importFiles([{ name: `${name}.pdf`, blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }) }]);
        toast('New PDF made', { label: 'Open', run: () => openDoc(nid) });
      },
      blank: (after: number) =>
        setModel((m) => {
          const ref = m.pages[after] ?? m.pages[m.pages.length - 1];
          const s = ref ? shownSize(ref) : { w: 612, h: 792 };
          const pages = [...m.pages];
          pages.splice(after + 1, 0, { key: newId(), src: 'blank', index: 0, rot: 0, w: s.w, h: s.h, own: 0 });
          return { ...m, pages };
        }),
      insertPdf: (after: number) => setPickPdf(after),
    }),
    [setModel, doc.meta.doc.name], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const insertFrom = async (after: number, from: { docId?: string; file?: File }) => {
    setPickPdf(null);
    try {
      const key = from.docId ?? 'f:' + newId();
      if (!sources.has(key)) {
        const b = from.docId ? await getFile(from.docId) : from.file!;
        const bytes = new Uint8Array(await b.arrayBuffer());
        sources.set(key, { pdf: await openPdf(bytes), bytes });
      }
      const src = sources.get(key)!;
      const add: PageRef[] = [];
      for (let i = 0; i < src.pdf.numPages; i++) {
        const p = await src.pdf.getPage(i + 1);
        const [x0, y0, x1, y1] = p.view;
        add.push({ key: newId(), src: key, index: i, rot: 0, w: x1 - x0, h: y1 - y0, own: p.rotate % 360 });
      }
      setModel((m) => {
        const pages = [...m.pages];
        pages.splice(after + 1, 0, ...add);
        return { ...m, pages };
      });
      toast(`${add.length} pages added`);
    } catch (e) {
      toast('Could not add that PDF: ' + (e as Error).message);
    }
  };
  const movePages = (keys: string[], before: number) =>
    setModel((m) => {
      const moving = m.pages.filter((p) => keys.includes(p.key));
      const at = m.pages.slice(0, before).filter((p) => !keys.includes(p.key)).length;
      const rest = m.pages.filter((p) => !keys.includes(p.key));
      rest.splice(at, 0, ...moving);
      return { ...m, pages: rest };
    });

  // ---------------------------------------------------------------- pictures and signatures
  const addImage = async () => {
    const [f] = await pickFiles('image/*', false);
    if (!f) return;
    const src = await toPngDataUrl(f);
    const img = await loadImg(src);
    setOpts((o) => ({ ...o, image: { src, ratio: img.width / img.height } }));
    setTool('img');
    toast('Click on a page to place the picture');
  };
  const useSignature = async (src: string) => {
    setSign(false);
    const img = await loadImg(src);
    setOpts((o) => ({ ...o, image: { src, ratio: img.width / img.height } }));
    setTool('img');
    toast('Click where the signature goes');
  };

  // ---------------------------------------------------------------- find
  const runFind = async (q: string) => {
    if (q.trim().length < 2) return setFind({ q, hits: [], at: 0 });
    const t = texts ?? (await textOf(docById(id) ?? doc).catch(() => [] as string[]));
    if (!texts) setTexts(t);
    const n = q.toLowerCase();
    const m = modelRef.current!;
    const hits: number[] = [];
    m.pages.forEach((p, i) => p.src === 'self' && (t[p.index] ?? '').toLowerCase().includes(n) && hits.push(i + 1));
    setFind({ q, hits, at: 0 });
    if (hits.length) goTo(hits[0]);
  };
  const stepFind = (d: number) => {
    if (!find?.hits.length) return;
    const at = (find.at + d + find.hits.length) % find.hits.length;
    setFind({ ...find, at });
    goTo(find.hits[at]);
  };

  // ---------------------------------------------------------------- the keyboard
  const active = useRef(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const u = getUi();
      if (u.palette || u.dialog || sign || pickPdf !== null) return;
      if (secondary ? u.active === id || !active.current : u.active !== id) return;
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable="true"]');
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') return e.preventDefault(), void save().then(() => toast('Saved — on its way to your phone'));
      if (mod && e.key.toLowerCase() === 'f') return e.preventDefault(), setFind((f) => f ?? { q: '', hits: [], at: 0 });
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'z') return e.preventDefault(), e.shiftKey ? fwd() : back();
      if (mod && e.key.toLowerCase() === 'y') return e.preventDefault(), fwd();
      if (mod && (e.key === '=' || e.key === '+')) return e.preventDefault(), zoomBy(1.15);
      if (mod && e.key === '-') return e.preventDefault(), zoomBy(1 / 1.15);
      if (mod && e.key === '0') return e.preventDefault(), setFit('width');
      if (mod) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) return e.preventDefault(), removeAnn(sel);
      if ((e.key === 'Delete' || e.key === 'Backspace') && view === 'glance' && pageSel.length) return e.preventDefault(), ops.remove(pageSel);
      if (e.key === 'Escape') return setSel(null), setTool('select'), setFind(null);
      const map: Record<string, Tool> = { v: 'select', t: 'text', d: 'ink', r: 'rect', e: 'ellipse', l: 'line', a: 'arrow', n: 'note', w: 'white' };
      const key = e.key.toLowerCase();
      if (key === 'h') return (highlightSelection() || setTool('hl'), undefined);
      if (key === 'g') return setView((v) => (v === 'glance' ? 'pages' : 'glance'));
      if (key === 'b') return toggleBookmark();
      if (key === 's') return setSign(true);
      if (key === 'i') return void addImage();
      if (key === '+' || key === '=') return zoomBy(1.15);
      if (key === '-') return zoomBy(1 / 1.15);
      if (map[key]) return setTool(map[key]);
      if (view === 'pages' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !(e.target as HTMLElement).closest('.viewer')) goTo(Math.max(1, Math.min(model?.pages.length ?? 1, current + (e.key === 'ArrowRight' ? 1 : -1))));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  // ---------------------------------------------------------------- commands for the palette
  useEffect(() => {
    const owner = secondary ? 'split:' + id : id;
    registerCommands(owner, [
      { id: 'save', label: 'Save changes', hint: '⌘S', icon: 'check', run: () => void save().then(() => toast('Saved')) },
      { id: 'glance', label: 'Pages at a glance (rearrange, rotate, remove)', hint: 'G', icon: 'grid', run: () => setView('glance') },
      { id: 'read', label: 'Reading view (text that flows)', icon: 'liquid', run: () => setView('read') },
      { id: 'text', label: 'Add text', hint: 'T', icon: 'type', run: () => setTool('text') },
      { id: 'hl', label: 'Highlight', hint: 'H', icon: 'hl', run: () => highlightSelection() || setTool('hl') },
      { id: 'draw', label: 'Draw', hint: 'D', icon: 'pen2', run: () => setTool('ink') },
      { id: 'sign', label: 'Sign', hint: 'S', icon: 'sign', run: () => setSign(true) },
      { id: 'img', label: 'Add a picture', hint: 'I', icon: 'img', run: () => void addImage() },
      { id: 'white', label: 'White-out (cover something)', hint: 'W', icon: 'erase', run: () => setTool('white') },
      { id: 'note', label: 'Sticky note', hint: 'N', icon: 'note', run: () => setTool('note') },
      { id: 'form', label: 'Fill in the form', icon: 'form', run: () => setPanel('form') },
      { id: 'rotate', label: 'Rotate this page', icon: 'rotR', run: () => model && ops.rotate([model.pages[current - 1].key], 90) },
      { id: 'rotall', label: 'Rotate all pages', icon: 'rotR', run: () => model && ops.rotate(model.pages.map((p) => p.key), 90) },
      { id: 'blank', label: 'Insert a blank page after this one', icon: 'blank', run: () => ops.blank(current - 1) },
      { id: 'insert', label: 'Insert pages from another PDF…', icon: 'merge', run: () => ops.insertPdf(current - 1) },
      { id: 'extract', label: 'Make a new PDF of this page', icon: 'cut', run: () => model && void ops.extract([model.pages[current - 1].key]) },
      { id: 'remove', label: 'Remove this page', icon: 'trash', run: () => model && ops.remove([model.pages[current - 1].key]) },
      { id: 'find', label: 'Find in this PDF', hint: '⌘F', icon: 'search', run: () => setFind({ q: '', hits: [], at: 0 }) },
      { id: 'bm', label: here ? 'Remove the bookmark on this page' : 'Bookmark this page', hint: 'B', icon: 'bookmark', run: toggleBookmark },
      { id: 'dl', label: 'Download as PDF (with your changes)', icon: 'download', run: async () => download(new Blob([(await buildPdf(modelRef.current!, sources)) as BlobPart], { type: 'application/pdf' }), `${doc.meta.doc.name}.pdf`) },
      { id: 'txt', label: 'Download the text (.txt)', icon: 'text', run: async () => download(new Blob([(await textOf(docById(id) ?? doc)).join('\n\n')], { type: 'text/plain' }), `${doc.meta.doc.name}.txt`) },
      { id: 'png', label: 'Download this page as a picture (PNG)', icon: 'img', run: () => void pagePng(current) },
      { id: 'beside', label: 'Open another document beside this one', icon: 'split', run: () => setUi({ palette: true }) },
      { id: 'rename', label: 'Rename', icon: 'edit', run: () => void renameDoc(id) },
    ]);
    return () => dropCommands(owner);
  });

  const pagePng = async (n: number) => {
    const m = modelRef.current!;
    const p = m.pages[n - 1];
    const src = sources.get(p.src);
    if (!src) return;
    const c = await renderPage(await src.pdf.getPage(p.index + 1), 2.5, p.rot);
    c.toBlob((b) => b && download(b, `${doc.meta.doc.name} — page ${n}.png`), 'image/png');
  };

  if (!model)
    return (
      <div className="loading">
        <i className="spin" />
      </div>
    );

  const annsOf = (key: string) => model.anns.filter((a) => a.page === key);
  const selAnn = model.anns.find((a) => a.id === sel);
  const showOpts = tool !== 'select' || !!selAnn;
  const optColor = selAnn ? selAnn.color : opts.color;
  const setColor = (c: string) => (selAnn ? change(selAnn.id, { color: c }, true) : setOpts((o) => ({ ...o, color: c })));
  const optSize = selAnn ? selAnn.size : opts.size;
  const setSize = (n: number) => (selAnn ? change(selAnn.id, { size: n }, true) : setOpts((o) => ({ ...o, size: n })));
  const isText = selAnn ? selAnn.type === 'text' : tool === 'text';

  return (
    <div className="ws" onMouseDown={() => (active.current = true)} onBlur={() => (active.current = false)}>
      <div className="toolbar">
        <button className={`ib${thumbs ? ' on' : ''}`} data-tip="Page list" onClick={() => setThumbs((t) => !t)}>
          <Icon name="sidebar" size={17} />
        </button>
        <button className="title" title="Rename" onClick={() => renameDoc(id)}>
          {live?.meta.doc.name ?? doc.meta.doc.name}
        </button>
        <span className="dirty">{dirty === 'saving' ? 'saving…' : dirty === 'unsaved' ? 'unsaved' : dirty === 'saved' ? 'saved ✓' : ''}</span>
        <div className="sep" />
        <button className={`ib${view === 'pages' ? ' on' : ''}`} data-tip="Pages" onClick={() => setView('pages')}>
          <Icon name="page" size={17} />
        </button>
        <button className={`ib${view === 'glance' ? ' on' : ''}`} data-tip="Pages at a glance  G" onClick={() => setView('glance')}>
          <Icon name="grid" size={17} />
        </button>
        <button className={`ib${view === 'read' ? ' on' : ''}`} data-tip="Reading view" onClick={() => setView('read')}>
          <Icon name="liquid" size={17} />
        </button>
        <div className="sep" />
        {view === 'pages' && (
          <>
            {(
              [
                ['select', 'cursor', 'Select  V'],
                ['text', 'type', 'Text  T'],
                ['hl', 'hl', 'Highlight  H'],
                ['ink', 'pen2', 'Draw  D'],
                ['rect', 'rect', 'Box  R'],
                ['arrow', 'arrow', 'Arrow  A'],
                ['note', 'note', 'Note  N'],
                ['white', 'erase', 'White-out  W'],
              ] as [Tool, string, string][]
            ).map(([t, icon, tip]) => (
              <button key={t} className={`ib${tool === t ? ' on' : ''}`} data-tip={tip} onClick={() => (t === 'hl' && highlightSelection()) || setTool(t)}>
                <Icon name={icon} size={17} />
              </button>
            ))}
            <button className={`ib${tool === 'img' ? ' on' : ''}`} data-tip="Sign  S" onClick={() => setSign(true)}>
              <Icon name="sign" size={17} />
            </button>
            <button className="ib" data-tip="Picture  I" onClick={addImage}>
              <Icon name="img" size={17} />
            </button>
            {showOpts && (
              <>
                <div className="sep" />
                {(tool === 'hl' || selAnn?.type === 'hl' ? HL : COLORS).map((c) => (
                  <button key={c} className="ib" onClick={() => setColor(c)} aria-label={`Colour ${c}`}>
                    <span style={{ width: 16, height: 16, borderRadius: 5, background: c, boxShadow: optColor === c ? '0 0 0 2px var(--bg), 0 0 0 3.5px var(--ink)' : 'inset 0 0 0 1px rgba(0,0,0,.2)' }} />
                  </button>
                ))}
                {isText ? (
                  <>
                    <select value={optSize} onChange={(e) => setSize(Number(e.target.value))} aria-label="Text size">
                      {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64].map((n) => (
                        <option key={n} value={n}>
                          {n} pt
                        </option>
                      ))}
                    </select>
                    <select value={selAnn?.font ?? opts.font} onChange={(e) => (selAnn ? change(selAnn.id, { font: e.target.value as ToolOpts['font'] }, true) : setOpts((o) => ({ ...o, font: e.target.value as ToolOpts['font'] })))} aria-label="Font">
                      <option value="sans">Sans</option>
                      <option value="serif">Serif</option>
                      <option value="mono">Mono</option>
                    </select>
                    <button className={`ib${(selAnn?.bold ?? opts.bold) ? ' on' : ''}`} onClick={() => (selAnn ? change(selAnn.id, { bold: !selAnn.bold }, true) : setOpts((o) => ({ ...o, bold: !o.bold })))} aria-label="Bold">
                      <Icon name="bold" size={15} />
                    </button>
                  </>
                ) : (
                  ['ink', 'rect', 'ellipse', 'line', 'arrow'].includes(selAnn?.type ?? tool) && (
                    <select value={optSize} onChange={(e) => setSize(Number(e.target.value))} aria-label="Line width">
                      {[0.75, 1, 1.5, 2, 3, 4, 6, 8].map((n) => (
                        <option key={n} value={n}>
                          {n} pt
                        </option>
                      ))}
                    </select>
                  )
                )}
                {selAnn && (
                  <button className="ib" data-tip="Remove  Delete" onClick={() => removeAnn(selAnn.id)}>
                    <Icon name="trash" size={16} />
                  </button>
                )}
              </>
            )}
          </>
        )}
        {view === 'glance' && (
          <>
            <span className="mono muted" style={{ fontSize: 12, padding: '0 6px' }}>
              {pageSel.length ? `${pageSel.length} selected` : `${model.pages.length} pages`}
            </span>
            <button className="ib" data-tip="Rotate left" disabled={!pageSel.length} onClick={() => ops.rotate(pageSel, -90)}>
              <Icon name="rotL" size={17} />
            </button>
            <button className="ib" data-tip="Rotate right" disabled={!pageSel.length} onClick={() => ops.rotate(pageSel, 90)}>
              <Icon name="rotR" size={17} />
            </button>
            <button className="ib" data-tip="Duplicate" disabled={!pageSel.length} onClick={() => ops.duplicate(pageSel)}>
              <Icon name="dup" size={17} />
            </button>
            <button className="ib" data-tip="New PDF from these pages" disabled={!pageSel.length} onClick={() => void ops.extract(pageSel)}>
              <Icon name="cut" size={17} />
            </button>
            <button className="ib" data-tip="Remove" disabled={!pageSel.length} onClick={() => ops.remove(pageSel)}>
              <Icon name="trash" size={17} />
            </button>
            <div className="sep" />
            <button className="ib" data-tip="Blank page" onClick={() => ops.blank(pageSel.length ? model.pages.findIndex((p) => p.key === pageSel[pageSel.length - 1]) : model.pages.length - 1)}>
              <Icon name="blank" size={17} />
            </button>
            <button className="ib" data-tip="Insert another PDF" onClick={() => ops.insertPdf(pageSel.length ? model.pages.findIndex((p) => p.key === pageSel[pageSel.length - 1]) : model.pages.length - 1)}>
              <Icon name="merge" size={17} />
            </button>
            <div className="sep" />
            <input type="range" min={2} max={12} value={14 - cols} onChange={(e) => setCols(14 - Number(e.target.value))} aria-label="Page size" style={{ width: 110 }} />
          </>
        )}
        <div className="grow" />
        {view !== 'glance' && (
          <>
            <button className="ib" data-tip="Undo  ⌘Z" disabled={!undo.current.length} onClick={back}>
              <Icon name="undo2" size={16} />
            </button>
            <button className="ib" data-tip="Redo  ⇧⌘Z" disabled={!redo.current.length} onClick={fwd}>
              <Icon name="redo" size={16} />
            </button>
          </>
        )}
        {view === 'pages' && (
          <>
            <div className="pg">
              <input
                value={current}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (n >= 1 && n <= model.pages.length) goTo(n);
                }}
                aria-label="Page"
              />
              / {model.pages.length}
            </div>
            <button className="ib" data-tip="Zoom out" onClick={() => zoomBy(1 / 1.15)}>
              <Icon name="zoomout" size={16} />
            </button>
            <button className="zoom" onClick={() => setFit(fit === 'width' ? 'page' : 'width')} title="Fit width / whole page">
              {Math.round(zoom * 100)}%
            </button>
            <button className="ib" data-tip="Zoom in" onClick={() => zoomBy(1.15)}>
              <Icon name="zoomin" size={16} />
            </button>
          </>
        )}
        <div className="sep" />
        <button className={`ib${here ? ' on' : ''}`} data-tip="Bookmark  B" onClick={toggleBookmark}>
          <Icon name="bookmark" size={16} />
        </button>
        <button className="ib" data-tip="Find  ⌘F" onClick={() => setFind({ q: find?.q ?? '', hits: find?.hits ?? [], at: 0 })}>
          <Icon name="search" size={16} />
        </button>
        <button className={`ib${panel === 'contents' ? ' on' : ''}`} data-tip="Contents" onClick={() => setPanel((p) => (p === 'contents' ? null : 'contents'))}>
          <Icon name="list" size={16} />
        </button>
        <button className={`ib${panel === 'marks' ? ' on' : ''}`} data-tip="Highlights & bookmarks" onClick={() => setPanel((p) => (p === 'marks' ? null : 'marks'))}>
          <Icon name="hl" size={16} />
        </button>
        {fields.length > 0 && (
          <button className={`ib${panel === 'form' ? ' on' : ''}`} data-tip="Fill in the form" onClick={() => setPanel((p) => (p === 'form' ? null : 'form'))}>
            <Icon name="form" size={16} />
          </button>
        )}
        <button className="ib" data-tip="Download with changes" onClick={async () => download(new Blob([(await buildPdf(modelRef.current!, sources)) as BlobPart], { type: 'application/pdf' }), `${doc.meta.doc.name}.pdf`)}>
          <Icon name="download" size={16} />
        </button>
        {secondary && (
          <button className="ib" data-tip="Close this side" onClick={() => setUi({ split: null })}>
            <Icon name="close" size={16} />
          </button>
        )}
      </div>

      <div className="body">
        {thumbs && view === 'pages' && (
          <div className="side">
            {model.pages.map((p, i) => (
              <button key={p.key} className={`tn${current === i + 1 ? ' on' : ''}`} onClick={() => goTo(i + 1)}>
                <Thumb src={sources.get(p.src)} page={p} width={130} />
                {i + 1}
              </button>
            ))}
          </div>
        )}

        {view === 'pages' && (
          <div className="viewer" ref={viewer} onPointerDown={(e) => !(e.target as HTMLElement).closest('.a') && tool === 'select' && setSel(null)}>
            {find && (
              <div className="findbar" onKeyDown={(e) => e.stopPropagation()}>
                <input className="field" autoFocus placeholder="Find in this PDF" defaultValue={find.q} onChange={(e) => void runFind(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' ? stepFind(e.shiftKey ? -1 : 1) : e.key === 'Escape' && setFind(null))} />
                <small>{find.q.length >= 2 ? (find.hits.length ? `${find.at + 1} of ${find.hits.length} pages` : 'not found') : ''}</small>
                <button className="ib" onClick={() => stepFind(-1)} aria-label="Previous">
                  <Icon name="up" size={15} />
                </button>
                <button className="ib" onClick={() => stepFind(1)} aria-label="Next">
                  <Icon name="down" size={15} />
                </button>
                <button className="ib" onClick={() => setFind(null)} aria-label="Close">
                  <Icon name="close" size={15} />
                </button>
              </div>
            )}
            <div className="pages">
              {model.pages.map((p, i) => (
                <PageView
                  key={p.key}
                  page={p}
                  num={i + 1}
                  src={sources.get(p.src)}
                  zoom={zoom}
                  tool={tool}
                  opts={opts}
                  anns={annsOf(p.key)}
                  selected={sel}
                  editing={editing}
                  find={find?.q ?? ''}
                  onCreate={create(p.key)}
                  onChange={change}
                  onSelect={setSel}
                  onEdit={setEditing}
                  onVisible={onVisible}
                />
              ))}
            </div>
          </div>
        )}

        {view === 'glance' && (
          <Glance pages={model.pages} sources={sources} sel={pageSel} setSel={setPageSel} cols={cols} onMove={movePages} onOpen={(i) => goTo(i + 1)} ops={ops} />
        )}

        {view === 'read' && <ReadView doc={live ?? doc} onPage={(n) => goTo(n)} />}

        {panel && (
          <div className="side r panel">
            {panel === 'contents' && (
              <>
                <h4>Contents</h4>
                {outline.length === 0 && <p className="muted">This PDF has no table of contents.</p>}
                {outline.map((o, i) => (
                  <button key={i} className="mk" style={{ paddingLeft: 10 + o.depth * 14 }} onClick={() => o.page && goTo(o.page)}>
                    {o.title} {o.page > 0 && <small> · {o.page}</small>}
                  </button>
                ))}
              </>
            )}
            {panel === 'marks' && (
              <>
                <h4>Highlights</h4>
                {marks.h.length === 0 && <p className="muted">Select words on a page and press H.</p>}
                {[...marks.h]
                  .sort((a, b) => (a.page ?? 0) - (b.page ?? 0))
                  .map((h) => (
                    <button key={h.id} className="mk" onClick={() => h.page && goTo(h.page)}>
                      <q>{h.text}</q>
                      <small>{h.page ? `page ${h.page}` : 'from the phone'}</small>
                    </button>
                  ))}
                <h4 style={{ marginTop: 20 }}>Bookmarks</h4>
                {marks.b.filter((b) => !b.auto).length === 0 && <p className="muted">Press B on a page to bookmark it.</p>}
                {marks.b
                  .filter((b) => !b.auto)
                  .map((b) => (
                    <button key={b.id} className="mk" onClick={() => b.page && goTo(b.page)}>
                      {b.label || `Page ${b.page}`}
                    </button>
                  ))}
              </>
            )}
            {panel === 'form' && (
              <>
                <h4>Form · {fields.length} fields</h4>
                <p className="muted" style={{ fontSize: 12 }}>
                  What you fill in is written into the PDF when it saves.
                </p>
                {fields.map((f) => {
                  const v = model.form[f.name] ?? f.value;
                  const set = (val: string | boolean) => setModel((m) => ({ ...m, form: { ...m.form, [f.name]: val } }));
                  return (
                    <div key={f.name}>
                      <label>{f.name}</label>
                      {f.type === 'CheckBox' ? (
                        <input type="checkbox" checked={!!v} onChange={(e) => set(e.target.checked)} />
                      ) : f.options ? (
                        <select className="field" value={String(v)} onChange={(e) => set(e.target.value)}>
                          <option value="" />
                          {f.options.map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </select>
                      ) : (
                        <input className="field" value={String(v)} onChange={(e) => set(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>

      {sign && <SignPad onClose={() => setSign(false)} onUse={useSignature} />}
      {pickPdf !== null && <PickPdf exclude={id} onClose={() => setPickPdf(null)} onPick={(from) => void insertFrom(pickPdf, from)} />}
    </div>
  );
}

async function coverOf(pdf: Blob): Promise<Blob | null> {
  const { pdfCover } = await import('../../lib/kinds');
  return (await pdfCover(new Uint8Array(await pdf.arrayBuffer())))?.cover ?? null;
}
async function toPngDataUrl(f: Blob): Promise<string> {
  const img = await loadImg(URL.createObjectURL(f));
  const c = document.createElement('canvas');
  const k = Math.min(1, 1600 / Math.max(img.width, img.height));
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}
const loadImg = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });

/** Draw a signature once; it is kept in this browser for next time. */
function SignPad({ onClose, onUse }: { onClose: () => void; onUse: (src: string) => void }) {
  const c = useRef<HTMLCanvasElement>(null);
  const [saved, setSaved] = useState(() => localStorage.getItem('frogity-sign'));
  const [has, setHas] = useState(false);
  useEffect(() => {
    const cv = c.current!;
    const x = cv.getContext('2d')!;
    x.lineWidth = 2.6;
    x.lineCap = 'round';
    x.lineJoin = 'round';
    x.strokeStyle = '#13235b';
    let drawing = false;
    const pos = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      return [((e.clientX - r.left) * cv.width) / r.width, ((e.clientY - r.top) * cv.height) / r.height];
    };
    const d = (e: PointerEvent) => {
      drawing = true;
      cv.setPointerCapture(e.pointerId);
      const [px, py] = pos(e);
      x.beginPath();
      x.moveTo(px, py);
    };
    const m = (e: PointerEvent) => {
      if (!drawing) return;
      const [px, py] = pos(e);
      x.lineTo(px, py);
      x.stroke();
      setHas(true);
    };
    const u = () => (drawing = false);
    cv.addEventListener('pointerdown', d);
    cv.addEventListener('pointermove', m);
    cv.addEventListener('pointerup', u);
    return () => {
      cv.removeEventListener('pointerdown', d);
      cv.removeEventListener('pointermove', m);
      cv.removeEventListener('pointerup', u);
    };
  }, []);
  const trimmed = () => {
    const cv = c.current!;
    const x = cv.getContext('2d')!;
    const d = x.getImageData(0, 0, cv.width, cv.height).data;
    let x0 = cv.width,
      y0 = cv.height,
      x1 = 0,
      y1 = 0;
    for (let y = 0; y < cv.height; y++)
      for (let xx = 0; xx < cv.width; xx++)
        if (d[(y * cv.width + xx) * 4 + 3] > 10) {
          x0 = Math.min(x0, xx);
          x1 = Math.max(x1, xx);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
    const o = document.createElement('canvas');
    o.width = Math.max(1, x1 - x0 + 12);
    o.height = Math.max(1, y1 - y0 + 12);
    o.getContext('2d')!.drawImage(cv, x0 - 6, y0 - 6, o.width, o.height, 0, 0, o.width, o.height);
    return o.toDataURL('image/png');
  };
  return (
    <Dialog onClose={onClose}>
      <h3>Signature</h3>
      {saved && (
        <>
          <p className="muted" style={{ fontSize: 13 }}>
            Your saved signature:
          </p>
          <button onClick={() => onUse(saved)} style={{ display: 'block', background: '#fff', borderRadius: 12, padding: 10, boxShadow: 'inset 0 0 0 1px var(--line-2)', width: '100%' }}>
            <img src={saved} alt="Saved signature" style={{ maxHeight: 80, maxWidth: '100%' }} />
          </button>
          <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
            Or draw a new one:
          </p>
        </>
      )}
      <canvas ref={c} className="sigpad" width={860} height={300} style={{ width: '100%', height: 150 }} />
      <div className="actions">
        {saved && (
          <button
            className="btn ghost"
            onClick={() => {
              localStorage.removeItem('frogity-sign');
              setSaved(null);
            }}
          >
            Forget saved
          </button>
        )}
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn"
          disabled={!has}
          onClick={() => {
            const s = trimmed();
            localStorage.setItem('frogity-sign', s);
            onUse(s);
          }}
        >
          Use this signature
        </button>
      </div>
    </Dialog>
  );
}

/** Choose a PDF to put pages from: one from the library, or a file from this computer. */
function PickPdf({ exclude, onClose, onPick }: { exclude: string; onClose: () => void; onPick: (f: { docId?: string; file?: File }) => void }) {
  const docs = useStore((s) => s.docs.filter((d) => d.meta.doc.kind === 'pdf' && d.id !== exclude));
  return (
    <Dialog onClose={onClose}>
      <h3>Insert pages from…</h3>
      <div style={{ maxHeight: 340, overflow: 'auto', margin: '12px 0' }}>
        {docs.map((d) => (
          <button key={d.id} className="hit" style={{ width: '100%' }} onClick={() => onPick({ docId: d.id })}>
            <b>{d.meta.doc.name}</b>
            <small>{d.meta.doc.pages ? `${d.meta.doc.pages} pages` : ''}</small>
          </button>
        ))}
        {!docs.length && <p className="muted">No other PDFs in the library.</p>}
      </div>
      <div className="actions">
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" onClick={async () => {
          const [f] = await pickFiles('application/pdf,.pdf', false);
          if (f) onPick({ file: f });
        }}>
          A PDF from this computer…
        </button>
      </div>
    </Dialog>
  );
}

/** The text of the PDF in a comfortable column. */
function ReadView({ doc, onPage }: { doc: LocalDoc; onPage: (n: number) => void }) {
  const [pages, setPages] = useState<string[] | null>(null);
  const [t, setT] = useState(() => localStorage.getItem('frogity-read-theme') ?? 'paper');
  const [size, setSize] = useState(() => Number(localStorage.getItem('frogity-read-size')) || 20);
  useEffect(() => {
    void textOf(doc).then(setPages, () => setPages([]));
  }, [doc.id, doc.fileVer]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    localStorage.setItem('frogity-read-theme', t);
    localStorage.setItem('frogity-read-size', String(size));
  }, [t, size]);
  if (!pages)
    return (
      <div className="loading">
        <i className="spin" />
      </div>
    );
  const paras = (s: string) =>
    s
      .split(/\n\s*\n|\n(?=[A-Z0-9“"•\-–])(?<=[.!?:”"]\n)/)
      .map((p) => p.replace(/-\n(?=[a-z])/g, '').replace(/\s*\n\s*/g, ' ').trim())
      .filter(Boolean);
  const empty = pages.join('').trim().length < 20;
  return (
    <div className="reading" data-t={t}>
      <div style={{ position: 'sticky', top: 0, display: 'flex', justifyContent: 'flex-end', gap: 6, padding: '10px 16px', zIndex: 2 }}>
        {['paper', 'white', 'night'].map((x) => (
          <button key={x} className={`chip${t === x ? ' on' : ''}`} onClick={() => setT(x)}>
            {x}
          </button>
        ))}
        <button className="chip" onClick={() => setSize((s) => Math.max(14, s - 1))}>
          A−
        </button>
        <button className="chip" onClick={() => setSize((s) => Math.min(30, s + 1))}>
          A+
        </button>
      </div>
      <div className="column" style={{ fontSize: size }}>
        {empty && <p className="muted">This PDF is made of pictures, so it has no text to show here. The phone reads scans by itself; once it has, their text appears here.</p>}
        {pages.map((pg, i) => (
          <div key={i}>
            <button className="pgmark" onClick={() => onPage(i + 1)} style={{ width: '100%' }}>
              {i + 1}
            </button>
            {paras(pg).map((p, k) => (
              <p key={k}>{p}</p>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
