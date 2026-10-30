// Getting a document ready, in the background, from the moment it is added.
//
// For every PDF: look at each page (does it have a text layer or is it only a picture?), build the Liquid view page by
// page, and read the picture-only pages. Every finished page is saved straight away, so leaving the book, locking the
// phone or closing the app never loses progress: the next start carries on where it stopped. Photos and camera scans are
// read the same way. Everything heavy goes through one queue, so nothing fights anything else.
import { useSyncExternalStore } from 'react';
import * as db from './db';
import { getFile } from './library';
import { openPdfBlob } from './formats/pdf';
import { pdfToLiquid, type LBlock } from './formats/liquidPdf';
import { mapLimit } from './ocrpage';
import { slice } from './ocr';
import type { DocMeta } from './types';

export const LQ_VERSION = 'lq9';
/** bump to have every document looked at again (the page check changed) */
const PLAN_V = 4;

export type JobKind = 'scan' | 'liquid' | 'images' | 'voice';

export interface ScanJob {
  id: string;
  title: string;
  /** what the work is: reading a scan, preparing Liquid mode, looking at pictures, or downloading a voice */
  kind: JobKind;
  /** checking = looking at the pages · running = at work · done = finished · none = nothing readable */
  status: 'checking' | 'running' | 'done' | 'none' | 'text';
  /** a book that is mostly ordinary text with some picture-only pages */
  mixed?: boolean;
  /** 0‥1 */
  progress: number;
  done: number;
  total: number;
  startedAt: number;
}

let jobs = new Map<string, ScanJob>();
const subs = new Set<() => void>();
const emit = () => {
  jobs = new Map(jobs);
  subs.forEach((s) => s());
};
const key = (kind: JobKind, id: string) => (kind === 'scan' ? id : `${kind}:${id}`);
const set = (id: string, patch: Partial<ScanJob>, kind: JobKind = 'scan') => {
  const j = jobs.get(key(kind, id));
  if (j) {
    jobs.set(key(kind, id), { ...j, ...patch });
    emit();
  }
};
const start = (id: string, title: string, kind: JobKind, status: ScanJob['status'], total = 0) => {
  jobs.set(key(kind, id), { id, title, kind, status, progress: status === 'running' ? 0.02 : 0, done: 0, total, startedAt: Date.now() });
  emit();
};
const end = (id: string, kind: JobKind = 'scan') => {
  jobs.delete(key(kind, id));
  emit();
};

export const scanState = (id: string) => jobs.get(id);
export function useScan(id?: string): ScanJob | undefined {
  return useSyncExternalStore(
    (l) => (subs.add(l), () => subs.delete(l)),
    () => (id ? jobs.get(id) : undefined),
  );
}
/** every job that is at work (for the list behind the badge) */
export function useRunningJobs(): ScanJob[] {
  const all = useSyncExternalStore(
    (l) => (subs.add(l), () => subs.delete(l)),
    () => jobs,
  );
  return [...all.values()].filter((j) => j.status === 'running');
}
export const runningJobs = () => [...jobs.values()].filter((j) => j.status === 'running');
export const subscribeJobs = (f: () => void) => (subs.add(f), () => subs.delete(f));

/** Progress of a download or other background work that is not about a document (used by the voice download). */
export function reportJob(id: string, title: string, kind: JobKind, done: number, total: number, finished = false) {
  if (finished) return end(id, kind);
  if (!jobs.has(key(kind, id))) start(id, title, kind, 'running', total);
  set(id, { status: 'running', done, total, progress: total ? Math.min(1, done / total) : 0.05 }, kind);
}
export const reportScan = (id: string, title: string, done: number, total: number, finished = false) => reportJob(id, title, 'scan', done, total, finished);

// ---------------------------------------------------------------- is a document's Liquid view ready?
export interface Prep {
  /** has the document been looked at yet (so the button knows what to show) */
  known: boolean;
  /** the Liquid view is complete and can be opened */
  ready: boolean;
  /** nothing readable was found (a photo-only PDF) */
  none: boolean;
  /** 0‥1, over everything that has to be done */
  progress: number;
  busy: boolean;
}
const IDLE: Prep = { known: false, ready: false, none: false, progress: 0, busy: false };
let preps = new Map<string, Prep>();
const setPrep = (id: string, patch: Partial<Prep>) => {
  preps = new Map(preps).set(id, { ...(preps.get(id) ?? IDLE), ...patch });
  emit();
};
/** Readiness of one document's Liquid view (drives the button that fills up like a glass). */
export function useLiquid(id: string): Prep {
  return useSyncExternalStore(
    (l) => (subs.add(l), () => subs.delete(l)),
    () => preps.get(id) ?? IDLE,
  );
}
export const liquidState = (id: string) => preps.get(id) ?? IDLE;

// ---------------------------------------------------------------- one queue for the heavy work
let chain: Promise<void> = Promise.resolve();
const queued = new Set<string>();
/** Runs `fn` after everything queued before it. */
export function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const r = chain.then(fn, fn);
  chain = r.then(
    () => {},
    () => {},
  );
  return r;
}
/** A second, light queue: finding out what a file is takes a moment and must never wait behind hours of reading. */
let lookChain: Promise<void> = Promise.resolve();
const look = <T>(fn: () => Promise<T>): Promise<T> => {
  const r = lookChain.then(fn, fn);
  lookChain = r.then(
    () => {},
    () => {},
  );
  return r;
};

/** Look at a PDF, picture or scan once and get it ready. Safe to call again and again. */
export function queueScan(doc: DocMeta) {
  if (!['pdf', 'image', 'scan'].includes(doc.kind) || queued.has(doc.id)) return;
  queued.add(doc.id);
  const fail = (e: unknown) => {
    console.warn('preparing failed', doc.name, e);
    end(doc.id);
    end(doc.id, 'liquid');
    setPrep(doc.id, { busy: false });
    queued.delete(doc.id); // opening the book again tries again
  };
  if (doc.kind === 'pdf') {
    // 1) a quick look, straight away  2) the long work goes into the queue (and picks up where it left off)
    void look(() => plan(doc))
      .then((p) => p && enqueue(() => prepareDoc(doc, p)))
      .catch(fail);
  } else void enqueue(() => (doc.kind === 'image' ? runImage(doc) : runScanDoc(doc))).catch(fail);
}

/** After the app starts: carry on with anything that was still being prepared when it was closed (or the phone locked). */
export async function resumeScans(docs: DocMeta[]) {
  for (const d of docs) {
    if (!['pdf', 'image', 'scan'].includes(d.kind)) continue;
    const pending = (await db.get<string>('kv', `scan:${d.id}`)) === 'pending' || (await db.get<string>('kv', `liquid:${d.id}`)) === 'pending';
    if (pending) queueScan(d);
  }
}

const store = (prefix: string, id: string) => ({
  load: async (p: number) => (await db.get<{ blocks: LBlock[] }>('cache', `${prefix}:${id}:${p}`))?.blocks,
  save: (p: number, blocks: LBlock[]) => db.put('cache', `${prefix}:${id}:${p}`, { blocks }),
});
/** where the readings of picture-only pages wait until they are put into the Liquid view */
export const pageStore = (id: string) => store('ocrpg', id);

const settle = (doc: DocMeta, status: 'done' | 'none') => {
  jobs.set(doc.id, { id: doc.id, title: doc.name, kind: 'scan', status, progress: 1, done: 1, total: 1, startedAt: Date.now() });
  emit();
};
const finish = (doc: DocMeta) => window.dispatchEvent(new CustomEvent('frogity:scan', { detail: { id: doc.id, title: doc.name } }));

// ---------------------------------------------------------------- photos and camera scans
/** A photo or screenshot: read its text once, keep where every word sits so the reader can select it. */
async function runImage(doc: DocMeta) {
  const remembered = await db.get<string>('kv', `scan:${doc.id}`);
  if (remembered === 'done' || remembered === 'none') return settle(doc, remembered);
  const blob = await getFile(doc.id);
  if (!blob) return;
  start(doc.id, doc.name, 'scan', 'running', 1);
  const { readImage } = await import('./ocr');
  const r = await readImage(blob, (p, st) => st.includes('recogni') && set(doc.id, { progress: 0.05 + 0.95 * p }));
  if (r.text.trim().length < 12) {
    await db.put('kv', `scan:${doc.id}`, 'none');
    return settle(doc, 'none');
  }
  await db.put('cache', `${doc.id}:imgocr`, { words: r.words, w: r.w, h: r.h, text: r.text });
  await db.put('kv', `scan:${doc.id}`, 'done');
  settle(doc, 'done');
  finish(doc);
}

/** Pages from the camera scanner: the pages are saved at once, the text (and the searchable PDF) follow here. */
async function runScanDoc(doc: DocMeta) {
  const remembered = await db.get<string>('kv', `scan:${doc.id}`);
  if (remembered === 'skip' || remembered === 'done' || remembered === 'none' || (await db.get('cache', `${doc.id}:ocr`))) return;
  const pages = (await Promise.all((doc.scanPages ?? []).map((p) => db.get<Blob>('blobs', p)))).filter(Boolean) as Blob[];
  if (!pages.length) return;
  start(doc.id, doc.name, 'scan', 'running', pages.length);
  const { readImage, OCR_POOL } = await import('./ocr');
  let n = 0;
  const reads = await mapLimit(pages, OCR_POOL, async (b) => {
    const r = await readImage(b);
    set(doc.id, { done: ++n, progress: 0.02 + 0.9 * (n / pages.length) });
    return r;
  });
  const html = reads.map((r, i) => `<section data-page="${i + 1}">${pages.length > 1 ? `<h3>Page ${i + 1}</h3>` : ''}${r.html}</section>`).join('');
  await db.put('cache', `${doc.id}:ocr`, html || '<p>No text recognised.</p>');
  const { imagesToPdf } = await import('./convert');
  const pdf = await imagesToPdf(pages, reads.map((r) => r.text)).catch(() => null);
  if (pdf) {
    await db.put('files', doc.id, pdf);
    const { patchDoc } = await import('./store');
    await patchDoc(doc.id, { size: pdf.size });
  }
  await db.put('kv', `scan:${doc.id}`, reads.some((r) => r.text.trim().length > 20) ? 'done' : 'none');
  settle(doc, 'done');
  finish(doc);
}

// ---------------------------------------------------------------- PDFs
interface Plan {
  /** text: ordinary · mixed: mostly text with some picture-only pages · scan: nearly all pictures */
  kind: 'text' | 'mixed' | 'scan';
  pages: number;
  /** the pages that are pictures only (no text layer) */
  scanned: number[];
}

/**
 * What kind of PDF is this? Every page is looked at (only its text layer, which is quick), because a book can have a
 * typed title page and a scanned body, or typed chapters among scanned notes: looking at a few pages is not enough.
 * Returns null when there is nothing left to do (already ready, or nothing readable).
 */
async function plan(doc: DocMeta): Promise<Plan | null> {
  const ready = await db.get<string>('kv', `liquid:${doc.id}`);
  if (ready === 'ready') {
    setPrep(doc.id, { known: true, ready: true, busy: false, progress: 1 });
    return null;
  }
  if (ready === 'none') {
    setPrep(doc.id, { known: true, none: true, busy: false });
    return null;
  }
  // documents prepared by an earlier version: their finished view is still good
  if ((await db.get<string>('kv', `scan:${doc.id}`)) === 'done2') {
    const c = await db.get<{ blocks: LBlock[]; scanned: number[] }>('cache', `${doc.id}:${LQ_VERSION}`);
    if (c && !c.scanned.length && !c.blocks.some((b) => b.t === 'img' && b.kind === 'scan')) {
      await db.put('kv', `liquid:${doc.id}`, 'ready');
      setPrep(doc.id, { known: true, ready: true, busy: false, progress: 1 });
      return null;
    }
  }
  const saved = await db.get<Plan & { v: number }>('kv', `plan:${doc.id}`);
  if (saved?.v === PLAN_V) {
    setPrep(doc.id, { known: true, busy: true, progress: preps.get(doc.id)?.progress ?? 0.01 });
    return saved;
  }
  const blob = await getFile(doc.id);
  if (!blob) return null;
  start(doc.id, doc.name, 'scan', 'checking');
  const pdf = await openPdfBlob(blob);
  try {
    const n = pdf.numPages;
    const scanned: number[] = [];
    for (let pn = 1; pn <= Math.min(n, 4000); pn++) {
      const page = await pdf.getPage(pn);
      const tc = await page.getTextContent();
      page.cleanup();
      if (tc.items.reduce((a, it) => a + ('str' in it ? it.str.trim().length : 0), 0) <= 25) scanned.push(pn);
      if (pn % 8 === 0) await slice(0); // let the app breathe while a long book is looked through
    }
    // a blank or picture-only cover or back page alone doesn't make a typed book a scan
    const real = scanned.filter((p) => !(n > 20 && (p === 1 || p === n)));
    const kind: Plan['kind'] = !real.length ? 'text' : scanned.length >= n * 0.85 ? 'scan' : 'mixed';
    const p: Plan = { kind, pages: n, scanned: kind === 'text' ? [] : scanned };
    await db.put('kv', `plan:${doc.id}`, { ...p, v: PLAN_V });
    end(doc.id);
    setPrep(doc.id, { known: true, busy: true, progress: 0.01 });
    return p;
  } finally {
    pdf.loadingTask.destroy();
  }
}

/** Builds the Liquid view page by page, saving each page as it is done (so a restart carries on, nothing is lost). */
async function buildLiquid(doc: DocMeta, progress: (f: number) => void): Promise<number[]> {
  const blob = await getFile(doc.id);
  if (!blob) throw new Error('file missing');
  const st = store('lqpg', doc.id);
  // pages finished in an earlier run
  const meta = (await db.get<{ done: number[]; scanned: number[] }>('kv', `lqmeta:${doc.id}`)) ?? { done: [], scanned: [] };
  const have = new Set(meta.done);
  let pages = 1;
  await pdfToLiquid(
    blob,
    (_b, p) => {
      pages = p.pages;
      progress(p.page / p.pages);
    },
    undefined,
    {
      have,
      onPage: async (page, blocks, scanned) => {
        await st.save(page, blocks);
        meta.done.push(page);
        if (scanned) meta.scanned.push(page);
        if (meta.done.length % 6 === 0) await db.put('kv', `lqmeta:${doc.id}`, meta); // often enough to lose little, rarely enough to stay light
      },
    },
  );
  await db.put('kv', `lqmeta:${doc.id}`, meta);
  // put the pages together in order
  const all: LBlock[] = [];
  for (let p = 1; p <= pages; p++) all.push(...((await st.load(p)) ?? [{ t: 'page', page: p } as LBlock]));
  const scanned = [...new Set(meta.scanned)].sort((a, b) => a - b);
  await db.put('cache', `${doc.id}:${LQ_VERSION}`, { blocks: all, scanned });
  await db.delPrefix('cache', `lqpg:${doc.id}:`);
  await db.del('kv', `lqmeta:${doc.id}`);
  return scanned;
}

/** Does everything a PDF needs to be ready for Liquid mode and Listen. */
async function prepareDoc(doc: DocMeta, p: Plan) {
  await db.put('kv', `liquid:${doc.id}`, 'pending');
  setPrep(doc.id, { known: true, busy: true });
  const ckey = `${doc.id}:${LQ_VERSION}`;
  const wLiquid = p.kind === 'text' ? 1 : p.kind === 'mixed' ? 0.55 : 0;
  let scanned = p.kind === 'scan' ? [] : p.scanned;
  window.dispatchEvent(new CustomEvent('frogity:started', { detail: { id: doc.id, title: doc.name, pages: p.kind === 'scan' ? p.pages : p.scanned.length, kind: p.kind } }));
  // 1) the Liquid view of the typed pages
  if (p.kind !== 'scan') {
    const existing = await db.get<{ blocks: LBlock[]; scanned: number[] }>('cache', ckey);
    const reuse = existing && (await db.get<string>('kv', `lqmeta:${doc.id}`)) === undefined && existing.blocks.length > 0;
    if (reuse) scanned = existing.scanned;
    else {
      start(doc.id, doc.name, 'liquid', 'running', p.pages);
      try {
        scanned = await buildLiquid(doc, (f) => {
          set(doc.id, { progress: f, done: Math.round(f * p.pages), total: p.pages }, 'liquid');
          setPrep(doc.id, { progress: Math.max(0.01, f * wLiquid) });
        });
      } finally {
        end(doc.id, 'liquid');
      }
    }
  }
  // 2) the picture-only pages: read them, and put the writing where the pictures were
  const st = pageStore(doc.id);
  const needOcr = p.kind === 'scan' || scanned.length > 0;
  if (needOcr) {
    const blob = await getFile(doc.id);
    if (!blob) throw new Error('file missing');
    const total = p.kind === 'scan' ? p.pages : scanned.length;
    start(doc.id, doc.name, 'scan', 'running', total);
    if (p.kind !== 'scan') set(doc.id, { mixed: true });
    const progress = (d: number, t: number) => {
      set(doc.id, { done: d, total: t, progress: 0.02 + 0.98 * (d / Math.max(1, t)) });
      setPrep(doc.id, { progress: wLiquid + (1 - wLiquid) * (d / Math.max(1, t)) });
    };
    const { ocrPages, ocrSome, applyStored } = await import('./ocrpage');
    if (p.kind === 'scan') {
      const res = await ocrPages(blob, progress, st);
      if (res.chars < 60) {
        await db.put('kv', `liquid:${doc.id}`, 'none');
        await db.delPrefix('cache', `ocrpg:${doc.id}:`);
        end(doc.id);
        setPrep(doc.id, { known: true, none: true, busy: false });
        return;
      }
      await db.put('cache', ckey, { blocks: res.blocks, scanned: [] });
      if (res.failedPages.length) await db.put('kv', `scanfail:${doc.id}`, res.failedPages);
    } else {
      const r = await ocrSome(blob, scanned, progress, st);
      const cached = await db.get<{ blocks: LBlock[]; scanned: number[] }>('cache', ckey);
      if (cached) {
        const m = await applyStored(cached.blocks, st);
        await db.put('cache', ckey, { blocks: m.blocks, scanned: m.left ? cached.scanned : [] });
      }
      if (r.lost.length) await db.put('kv', `scanfail:${doc.id}`, r.lost);
    }
    await db.delPrefix('cache', `ocrpg:${doc.id}:`);
    await db.put('kv', `scan:${doc.id}`, 'done2');
    settle(doc, 'done');
  } else await db.put('kv', `scan:${doc.id}`, 'text');
  // 3) done: the Liquid button is full
  await db.put('kv', `liquid:${doc.id}`, 'ready');
  setPrep(doc.id, { known: true, ready: true, busy: false, progress: 1 });
  finish(doc);
  window.dispatchEvent(new CustomEvent('frogity:ready', { detail: { id: doc.id } }));
  queueFigures(doc);
}

/** Starts (or restarts) the preparation of a document by hand, e.g. if it failed earlier. */
export function prepareNow(doc: DocMeta) {
  queued.delete(doc.id);
  queueScan(doc);
}

/**
 * Pictures inside an ordinary document: once the Liquid view is made, look at each one; writing that sits in a
 * picture becomes text and diagrams stay as they are. Runs once per document and version.
 */
export function queueFigures(doc: DocMeta) {
  const k = `figs:${doc.id}`;
  if (queued.has(k)) return;
  queued.add(k);
  void enqueue(async () => {
    if ((await db.get<string>('kv', k)) === LQ_VERSION) return;
    const ckey = `${doc.id}:${LQ_VERSION}`;
    const cached = await db.get<{ blocks: LBlock[]; scanned: number[] }>('cache', ckey);
    if (!cached) return;
    const cands = cached.blocks.filter((b) => b.t === 'img' && b.kind === 'figure' && !b.mask).length;
    if (!cands) return void (await db.put('kv', k, LQ_VERSION));
    start(doc.id, doc.name, 'images', 'running', cands);
    try {
      const { triageFigures } = await import('./ocrpage');
      const r = await triageFigures(cached.blocks, (d, total) => set(doc.id, { done: d, total, progress: d / Math.max(1, total) }, 'images'));
      if (r.changed) {
        await db.put('cache', ckey, { blocks: r.blocks, scanned: cached.scanned });
        window.dispatchEvent(new CustomEvent('frogity:figures', { detail: { id: doc.id, changed: r.changed } }));
      }
      await db.put('kv', k, LQ_VERSION);
    } finally {
      end(doc.id, 'images');
    }
  }).catch((e) => console.warn('pictures not looked at', e));
}
