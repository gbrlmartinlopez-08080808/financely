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

export const LQ_VERSION = 'lq10';
/** bump to have every document looked at again (the page check changed) */
const PLAN_V = 4;

export type JobKind = 'scan' | 'liquid' | 'images' | 'voice' | 'sync';

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
    jobs = new Map(jobs).set(key(kind, id), { ...j, ...patch });
    softEmit();
  }
};
/** Progress is shown a few times a second, not on every page: each showing redraws what is on screen. */
let softTimer = 0;
const softEmit = () => {
  if (!softTimer && typeof window !== 'undefined') softTimer = window.setTimeout(() => ((softTimer = 0), emit()), 300);
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
  /** what is happening right now, in words ("typed pages 12 of 40") */
  info: string;
  /** seconds left, once it can be told */
  eta: number | null;
  /** why the preparation stopped, in words (shown with "Try again"); empty while all is well */
  error: string;
}
const IDLE: Prep = { known: false, ready: false, none: false, progress: 0, busy: false, info: '', eta: null, error: '' };
let preps = new Map<string, Prep>();
const setPrep = (id: string, patch: Partial<Prep>) => {
  const was = preps.get(id) ?? IDLE;
  preps = new Map(preps).set(id, { ...was, ...patch });
  if (patch.progress !== undefined && patch.progress !== was.progress) moved.set(id, Date.now());
  // a bar moving on is shown a few times a second, not on every page: each showing redraws the reader, and the
  // reader must stay smooth while the work goes on (a change of state — ready, failed — is shown at once)
  const soft = Object.keys(patch).every((k) => k === 'progress' || k === 'eta' || k === 'info');
  if (!soft) return emit();
  softEmit();
};
// a book whose preparation has not moved for a while is looked at again, so nothing can sit at 0% for ever
const moved = new Map<string, number>();
const docsById = new Map<string, DocMeta>();
if (typeof window !== 'undefined')
  setInterval(() => {
    const now = Date.now();
    for (const [id, pr] of preps) {
      if (!pr.busy || pr.ready || pr.error) continue;
      const idle = now - Math.max(moved.get(id) ?? now, shownAt);
      if (idle > 20_000 && !pr.info.startsWith('waiting')) setPrep(id, { info: 'waiting for its turn' });
      const working = [...jobs.values()].some((j) => j.id === id && j.status === 'running') || lanes.some((l) => l.busyWith === id);
      const d = docsById.get(id);
      if (idle > 60_000 && !working && d) {
        moved.set(id, now); // try once a minute
        prepareNow(d);
      }
    }
  }, 6000);
/** Readiness of one document's Liquid view (drives the button that fills up like a glass). */
export function useLiquid(id: string): Prep {
  return useSyncExternalStore(
    (l) => (subs.add(l), () => subs.delete(l)),
    () => preps.get(id) ?? IDLE,
  );
}
export const liquidState = (id: string) => preps.get(id) ?? IDLE;

// ---------------------------------------------------------------- lanes for the heavy work
const queued = new Set<string>();
let focused = '';
/** The book that is open on screen: its work goes first in every lane. */
export const focusDoc = (id: string) => {
  focused = id;
};
// time spent frozen in the background (screen off, app switched) doesn't count as being stuck
let shownAt = 0;
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && (shownAt = Date.now()));

/** A job's way of saying "still moving" (every page it finishes); a job that stays silent too long is let go. */
export type Touch = () => void;
export class Stalled extends Error {
  constructor() {
    super('stalled');
  }
}

/**
 * A lane runs one job at a time, the open book's first. Liquid building (the screen's own thread) and text reading
 * (workers) are different lanes, so a long scan never makes another book wait at 0%. A job that stops reporting for
 * `stallMs` is given up (the lane moves on and the book says so), so one stuck file can never block all the others.
 */
class Lane {
  private q: { id: string; fn: (touch: Touch) => Promise<unknown>; res: (v: unknown) => void; rej: (e: unknown) => void }[] = [];
  /** the document being worked on, if any */
  busyWith: string | null = null;
  constructor(private stallMs: number) {}
  add<T>(id: string, fn: (touch: Touch) => Promise<T>): Promise<T> {
    return new Promise<T>((res, rej) => {
      this.q.push({ id, fn, res: res as (v: unknown) => void, rej });
      this.pump();
    });
  }
  waiting = (id: string) => this.q.some((t) => t.id === id);
  private pump() {
    if (this.busyWith !== null) return;
    const i = this.q.findIndex((t) => t.id === focused);
    const t = this.q.splice(i >= 0 ? i : 0, 1)[0];
    if (!t) return;
    this.busyWith = t.id;
    let over = false;
    let last = Date.now();
    let timer = 0;
    const finish = () => {
      if (over) return;
      over = true;
      clearInterval(timer);
      this.busyWith = null;
      emit();
      this.pump();
    };
    timer = window.setInterval(() => {
      if (document.hidden || Date.now() - Math.max(last, shownAt) < this.stallMs) return;
      t.rej(new Stalled());
      finish();
    }, 2000);
    emit();
    Promise.resolve()
      .then(() => t.fn(() => (last = Date.now())))
      .then(
        (v) => !over && t.res(v),
        (e) => !over && t.rej(e),
      )
      .finally(finish);
  }
}
/** finding out what a file is: quick, so it never waits behind hours of reading (the limit allows reading a big file) */
const lookLane = new Lane(60_000);
const liquidLane = new Lane(90_000);
const ocrLane = new Lane(120_000);
const miscLane = new Lane(120_000);
const lanes = [lookLane, liquidLane, ocrLane, miscLane];
/** Runs `fn` after the other small jobs (kept for the small things: pictures in documents, photos). */
export const enqueue = <T,>(fn: () => Promise<T>): Promise<T> => miscLane.add('', () => fn());

/** Why preparing stopped, in words a reader can act on. */
function whyFailed(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  if (e instanceof Stalled) return 'It stopped making progress.';
  if (/file missing|moved or deleted|not found/i.test(m)) return 'The file couldn’t be read — it may have been moved or deleted.';
  if (/password/i.test(m)) return 'This PDF is protected with a password.';
  if (/invalid pdf|corrupt|unexpected/i.test(m)) return 'This PDF looks damaged.';
  return 'Something went wrong while converting it.';
}
/** each book is started again once by itself before it asks for help */
const retried = new Set<string>();

/** Look at a PDF, picture or scan once and get it ready. Safe to call again and again. */
export function queueScan(doc: DocMeta) {
  if (!['pdf', 'image', 'scan'].includes(doc.kind) || queued.has(doc.id)) return;
  queued.add(doc.id);
  docsById.set(doc.id, doc);
  const fail = (e: unknown) => {
    console.warn('preparing failed', doc.name, e);
    end(doc.id);
    end(doc.id, 'liquid');
    queued.delete(doc.id);
    if (doc.kind === 'pdf' && !retried.has(doc.id)) {
      // once by itself, quietly: most hiccups (a busy phone, a file still being copied) are gone the second time
      retried.add(doc.id);
      setPrep(doc.id, { info: 'starting again' });
      return void setTimeout(() => queueScan(doc), 1500);
    }
    setPrep(doc.id, { known: true, busy: false, error: whyFailed(e) });
  };
  if (doc.kind === 'pdf') {
    void (async () => {
      if (await settled(doc)) return; // done before (or nothing to read): no queue, no flash of "checking"
      // seen at once (the button, the line under the title), long before the first page is done
      setPrep(doc.id, { known: true, busy: true, error: '', info: lookLane.busyWith && lookLane.busyWith !== doc.id ? 'waiting for another book' : 'checking pages' });
      // 1) a quick look  2) the long work goes into its lanes (and picks up where it left off)
      const p = await lookLane.add(doc.id, (touch) => plan(doc, touch));
      await prepareDoc(doc, p);
    })().catch(fail);
  } else void ocrLane.add(doc.id, (touch) => (doc.kind === 'image' ? runImage(doc, touch) : runScanDoc(doc, touch))).catch(fail);
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
export const pageStore = (id: string) => {
  const st = store('ocrpg', id);
  return {
    load: st.load,
    save: async (p: number, blocks: LBlock[]) => {
      await st.save(p, blocks);
      window.dispatchEvent(new CustomEvent('frogity:ocrpage', { detail: { id, page: p } }));
    },
  };
};
/** the finished pages of a Liquid view that is still being built (so it can be opened and read as it grows) */
export const liquidPageStore = (id: string) => store('lqpg', id);

const settle = (doc: DocMeta, status: 'done' | 'none') => {
  jobs.set(doc.id, { id: doc.id, title: doc.name, kind: 'scan', status, progress: 1, done: 1, total: 1, startedAt: Date.now() });
  emit();
};
const finish = (doc: DocMeta) => window.dispatchEvent(new CustomEvent('frogity:scan', { detail: { id: doc.id, title: doc.name } }));

// ---------------------------------------------------------------- photos and camera scans
/** A photo or screenshot: read its text once, keep where every word sits so the reader can select it. */
async function runImage(doc: DocMeta, touch: Touch) {
  const remembered = await db.get<string>('kv', `scan:${doc.id}`);
  if (remembered === 'done' || remembered === 'none') return settle(doc, remembered);
  const blob = await getFile(doc.id);
  if (!blob) return;
  start(doc.id, doc.name, 'scan', 'running', 1);
  const { readImage } = await import('./ocr');
  const r = await readImage(blob, (p, st) => {
    touch();
    if (st.includes('recogni')) set(doc.id, { progress: 0.05 + 0.95 * p });
  });
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
async function runScanDoc(doc: DocMeta, touch: Touch) {
  const remembered = await db.get<string>('kv', `scan:${doc.id}`);
  if (remembered === 'skip' || remembered === 'done' || remembered === 'none' || (await db.get('cache', `${doc.id}:ocr`))) return;
  const pages = (await Promise.all((doc.scanPages ?? []).map((p) => db.get<Blob>('blobs', p)))).filter(Boolean) as Blob[];
  if (!pages.length) return;
  start(doc.id, doc.name, 'scan', 'running', pages.length);
  const { readImage, OCR_POOL } = await import('./ocr');
  let n = 0;
  const reads = await mapLimit(pages, OCR_POOL, async (b) => {
    const r = await readImage(b, touch);
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

/** Is this PDF's Liquid view already made (or known to be impossible)? Then nothing needs to be queued. */
async function settled(doc: DocMeta): Promise<boolean> {
  let ready = await db.get<string>('kv', `liquid:${doc.id}`);
  if (ready === 'ready' && (await db.get<string>('kv', `lqv:${doc.id}`)) !== LQ_VERSION) {
    // made by an older version of the converter (pages left as pictures, words twice): made again, the better way
    await Promise.all([db.del('kv', `liquid:${doc.id}`), db.del('kv', `scan:${doc.id}`), db.del('kv', `lqmeta:${doc.id}`), db.del('kv', `figs:${doc.id}`), db.delPrefix('cache', `lqpg:${doc.id}:`)]);
    for (const v of ['lq8', 'lq9']) await db.del('cache', `${doc.id}:${v}`);
    ready = undefined;
  }
  if (ready === 'ready') {
    setPrep(doc.id, { known: true, ready: true, busy: false, progress: 1, error: '' });
    return true;
  }
  if (ready === 'none') {
    setPrep(doc.id, { known: true, none: true, busy: false, error: '' });
    return true;
  }
  // documents prepared by an earlier version: their finished view is still good
  if ((await db.get<string>('kv', `scan:${doc.id}`)) === 'done2') {
    const c = await db.get<{ blocks: LBlock[]; scanned: number[] }>('cache', `${doc.id}:${LQ_VERSION}`);
    if (c && !c.scanned.length && !c.blocks.some((b) => b.t === 'img' && b.kind === 'scan')) {
      await db.put('kv', `liquid:${doc.id}`, 'ready');
      setPrep(doc.id, { known: true, ready: true, busy: false, progress: 1, error: '' });
      return true;
    }
  }
  return false;
}

/**
 * What kind of PDF is this? Every page is looked at (only its text layer, which is quick), because a book can have a
 * typed title page and a scanned body, or typed chapters among scanned notes: looking at a few pages is not enough.
 */
async function plan(doc: DocMeta, touch: Touch): Promise<Plan> {
  const saved = await db.get<Plan & { v: number }>('kv', `plan:${doc.id}`);
  if (saved?.v === PLAN_V) {
    setPrep(doc.id, { known: true, busy: true, progress: preps.get(doc.id)?.progress ?? 0.01 });
    return saved;
  }
  setPrep(doc.id, { known: true, busy: true, info: 'opening the file' });
  const blob = await getFile(doc.id);
  if (!blob) throw new Error('file missing');
  touch();
  start(doc.id, doc.name, 'scan', 'checking');
  const pdf = await openPdfBlob(blob);
  try {
    const n = pdf.numPages;
    const scanned: number[] = [];
    for (let pn = 1; pn <= Math.min(n, 4000); pn++) {
      const page = await pdf.getPage(pn);
      const tc = await page.getTextContent();
      page.cleanup();
      touch();
      if (tc.items.reduce((a, it) => a + ('str' in it ? it.str.trim().length : 0), 0) <= 25) scanned.push(pn);
      if (pn % 8 === 0 || pn === n) {
        // the first few percent of the bar: looking through the pages
        setPrep(doc.id, { progress: Math.max(0.005, CHECK_SHARE * (pn / n)), info: `checking pages · ${pn} of ${n}` });
        await slice(0); // let the app breathe while a long book is looked through
      }
    }
    // a blank or picture-only cover or back page alone doesn't make a typed book a scan
    const real = scanned.filter((p) => !(n > 20 && (p === 1 || p === n)));
    const kind: Plan['kind'] = !real.length ? 'text' : scanned.length >= n * 0.85 ? 'scan' : 'mixed';
    const p: Plan = { kind, pages: n, scanned: kind === 'text' ? [] : scanned };
    await db.put('kv', `plan:${doc.id}`, { ...p, v: PLAN_V });
    end(doc.id);
    setPrep(doc.id, { known: true, busy: true, progress: CHECK_SHARE });
    return p;
  } finally {
    pdf.loadingTask.destroy();
  }
}

/** the share of the progress bar that is the first look through the pages */
const CHECK_SHARE = 0.03;

/** Builds the Liquid view page by page, saving each page as it is done (so a restart carries on, nothing is lost). */
async function buildLiquid(doc: DocMeta, progress: (f: number) => void, onScanned?: (page: number) => void): Promise<number[]> {
  const blob = await getFile(doc.id);
  if (!blob) throw new Error('file missing');
  const st = store('lqpg', doc.id);
  // pages finished in an earlier run
  let meta = await db.get<{ done: number[]; scanned: number[]; v?: string }>('kv', `lqmeta:${doc.id}`);
  if (meta && meta.v !== LQ_VERSION) {
    // half made by an older converter: start the pages again
    await db.delPrefix('cache', `lqpg:${doc.id}:`);
    meta = undefined;
  }
  meta ??= { done: [], scanned: [], v: LQ_VERSION };
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
        window.dispatchEvent(new CustomEvent('frogity:page', { detail: { id: doc.id, page } }));
        meta.done.push(page);
        if (scanned) {
          meta.scanned.push(page);
          onScanned?.(page);
        }
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

/** Reads picture-only pages (all of them for a scan, some for a mixed book); for a scan it also returns the whole text. */
async function readPictures(doc: DocMeta, p: Plan, pages: number[], progress: (f: number) => void, touch: Touch) {
  const blob = await getFile(doc.id);
  if (!blob) throw new Error('file missing');
  start(doc.id, doc.name, 'scan', 'running', pages.length);
  if (p.kind !== 'scan') set(doc.id, { mixed: true });
  const cb = (d: number, t: number) => {
    touch();
    set(doc.id, { done: d, total: t, progress: 0.02 + 0.98 * (d / Math.max(1, t)) });
    progress(d / Math.max(1, t));
  };
  const { ocrPages, ocrSome } = await import('./ocrpage');
  const st = pageStore(doc.id);
  // every step of a page read has its own time limit (and a page that fights is moved to the end), so a long page is
  // not a stuck job: keep telling the lane so, or it would give the whole book up and start it again and again
  const beat = window.setInterval(touch, 15_000);
  try {
    if (p.kind === 'scan') return { whole: await ocrPages(blob, cb, st), lost: [] as number[] };
    const r = await ocrSome(blob, pages, cb, st);
    return { whole: null, lost: r.lost };
  } finally {
    clearInterval(beat);
    end(doc.id);
  }
}

/**
 * Does everything a PDF needs to be ready for Liquid mode and Listen. The Liquid view of the typed pages and the reading
 * of the picture-only pages run side by side (different lanes), each page saved as it is finished; the book can be
 * opened in Liquid mode at any moment and grows as the pages arrive.
 */
async function prepareDoc(doc: DocMeta, p: Plan) {
  await db.put('kv', `liquid:${doc.id}`, 'pending');
  setPrep(doc.id, { known: true, busy: true, error: '' });
  const ckey = `${doc.id}:${LQ_VERSION}`;
  // the work, counted in pages: reading a picture page takes several times longer than converting a typed one
  const OCR_COST = 5;
  const liqTotal = p.kind === 'scan' ? 0 : p.pages;
  let ocrTotal = p.kind === 'scan' ? p.pages : p.scanned.length;
  let ocrBefore = 0; // pages read by earlier reading runs of this preparation
  let pLiq = p.kind === 'scan' ? 1 : 0;
  let ocrDone = 0;
  let last = 0;
  let t0 = 0; // from the moment real work starts (time spent waiting for another book would spoil the estimate)
  const other = (l: Lane) => (l.busyWith && l.busyWith !== doc.id ? 'waiting for another book' : '');
  let liqInfo = p.kind === 'scan' ? '' : other(liquidLane) || `converting pages · 0 of ${p.pages}`;
  let ocrInfo = p.kind === 'text' ? '' : other(ocrLane);
  const f0 = preps.get(doc.id)?.progress ?? 0;
  const bump = () => {
    // never goes backwards: a run that carries on from saved pages starts where the bar already was
    const work = (pLiq * liqTotal + OCR_COST * ocrDone) / Math.max(1, liqTotal + OCR_COST * ocrTotal);
    const f = (last = Math.max(last, f0, CHECK_SHARE + (1 - CHECK_SHARE) * Math.min(1, work)));
    if (!t0 && (pLiq || ocrDone)) t0 = Date.now() - 1000;
    const el = t0 ? (Date.now() - t0) / 1000 : 0;
    const share = f - f0;
    setPrep(doc.id, { progress: f, eta: share > 0.04 && el > 4 ? Math.max(1, Math.round((el / share) * (1 - f))) : null, info: [liqInfo, ocrInfo].filter(Boolean).join(' · ') || (f >= 0.999 ? 'finishing' : 'starting') });
  };
  bump();
  window.dispatchEvent(new CustomEvent('frogity:started', { detail: { id: doc.id, title: doc.name, pages: p.kind === 'scan' ? p.pages : p.scanned.length, kind: p.kind } }));
  const st = pageStore(doc.id);

  // the picture pages → text, in the reading lane (starts at once when their numbers are known)
  const all = Array.from({ length: p.pages }, (_, i) => i + 1);
  const read = (pages: number[]) =>
    ocrLane.add(doc.id, (touch) => {
      ocrInfo = `reading pages · ${ocrDone} of ${ocrTotal}`;
      bump();
      return readPictures(
        doc,
        p,
        pages,
        (f) => {
          ocrDone = ocrBefore + Math.round(f * pages.length);
          ocrInfo = f >= 1 ? '' : `reading pages · ${ocrDone} of ${ocrTotal}`;
          bump();
        },
        touch,
      );
    });
  const ocrNow = p.kind === 'scan' ? read(all) : p.kind === 'mixed' ? read(p.scanned) : null;
  ocrNow?.catch(() => {}); // still awaited below; this only keeps a failure of the other lane from going unheard

  // Pages that only turn out to be pictures while the Liquid view is made (writing printed as a picture under typed
  // headings, say) are read as soon as they are found, beside the conversion: no page may stay behind as a picture.
  const asked = new Set<number>(p.kind === 'scan' ? [] : p.scanned);
  const later: number[] = [];
  const lostLater: number[] = [];
  let reading: Promise<void> | null = null;
  let readErr: unknown = null;
  const pump = () => {
    if (reading || !later.length || readErr) return;
    const batch = later.splice(0).sort((a, b) => a - b);
    reading = (async () => {
      await ocrNow?.catch(() => {}); // one reading run at a time
      ocrBefore = ocrDone;
      const r = await read(batch);
      lostLater.push(...r.lost);
    })()
      .catch((e) => void (readErr = e))
      .finally(() => {
        reading = null;
        pump();
      });
  };
  function found(n: number) {
    if (p.kind === 'scan' || asked.has(n)) return;
    asked.add(n);
    later.push(n);
    ocrTotal++;
    bump();
    pump();
  }

  // the typed pages → Liquid view, in its own lane
  const liquidJob: Promise<number[]> =
    p.kind === 'scan'
      ? Promise.resolve([])
      : liquidLane.add(doc.id, async (touch) => {
          const existing = await db.get<{ blocks: LBlock[]; scanned: number[] }>('cache', ckey);
          if (existing && (await db.get<string>('kv', `lqmeta:${doc.id}`)) === undefined && existing.blocks.length > 0) {
            pLiq = 1;
            liqInfo = '';
            bump();
            return existing.scanned;
          }
          start(doc.id, doc.name, 'liquid', 'running', p.pages);
          liqInfo = `converting pages · 0 of ${p.pages}`;
          bump();
          try {
            return await buildLiquid(doc, (f) => {
              touch();
              pLiq = f;
              liqInfo = f >= 1 ? '' : `converting pages · ${Math.round(f * p.pages)} of ${p.pages}`;
              set(doc.id, { progress: f, done: Math.round(f * p.pages), total: p.pages }, 'liquid');
              bump();
            }, found);
          } finally {
            end(doc.id, 'liquid');
          }
        });

  const scanned = await liquidJob;
  let ocr = ocrNow ? await ocrNow : null;
  // whatever was found while the Liquid view was being made, and anything still missing, is read now
  for (const n of scanned) found(n);
  while (reading || later.length) {
    pump();
    await reading;
  }
  if (readErr) throw readErr;
  if (lostLater.length || (!ocr && asked.size)) ocr = { whole: ocr?.whole ?? null, lost: [...(ocr?.lost ?? []), ...lostLater] };

  // put it together
  if (ocr?.whole) {
    if (ocr.whole.chars < 60) {
      await db.put('kv', `liquid:${doc.id}`, 'none');
      await db.delPrefix('cache', `ocrpg:${doc.id}:`);
      setPrep(doc.id, { known: true, none: true, busy: false });
      return;
    }
    await db.put('cache', ckey, { blocks: ocr.whole.blocks, scanned: [] });
    if (ocr.whole.failedPages.length) await db.put('kv', `scanfail:${doc.id}`, ocr.whole.failedPages);
  } else if (ocr) {
    const { applyStored } = await import('./ocrpage');
    const cached = await db.get<{ blocks: LBlock[]; scanned: number[] }>('cache', ckey);
    if (cached) {
      const m = await applyStored(cached.blocks, st);
      await db.put('cache', ckey, { blocks: m.blocks, scanned: m.left ? cached.scanned : [] });
    }
    if (ocr.lost.length) await db.put('kv', `scanfail:${doc.id}`, ocr.lost);
  }
  await db.delPrefix('cache', `ocrpg:${doc.id}:`);
  await db.put('kv', `scan:${doc.id}`, ocr ? 'done2' : 'text');
  if (ocr) settle(doc, 'done');
  await db.put('kv', `lqv:${doc.id}`, LQ_VERSION);
  await db.put('kv', `liquid:${doc.id}`, 'ready');
  retried.delete(doc.id);
  setPrep(doc.id, { known: true, ready: true, busy: false, progress: 1, eta: null, info: '', error: '' });
  finish(doc);
  window.dispatchEvent(new CustomEvent('frogity:ready', { detail: { id: doc.id } }));
  queueFigures(doc);
}

/** The finished Liquid view went missing (storage cleared, say): make it again from the start. */
export async function rebuildLiquid(doc: DocMeta) {
  await db.del('kv', `liquid:${doc.id}`);
  preps = new Map(preps).set(doc.id, { ...IDLE, known: true, busy: true, info: 'starting' });
  emit();
  queued.delete(doc.id);
  queueScan(doc);
}

/** Starts (or restarts) the preparation of a document, e.g. "Try again" after it failed. */
export function prepareNow(doc: DocMeta) {
  const busy = lanes.some((l) => l.busyWith === doc.id || l.waiting(doc.id));
  if (busy && !liquidState(doc.id).error) return; // it is being worked on already: starting it twice only slows it down
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
  void miscLane.add(doc.id, async (touch) => {
    if ((await db.get<string>('kv', k)) === LQ_VERSION) return;
    const ckey = `${doc.id}:${LQ_VERSION}`;
    const cached = await db.get<{ blocks: LBlock[]; scanned: number[] }>('cache', ckey);
    if (!cached) return;
    const cands = cached.blocks.filter((b) => b.t === 'img' && b.kind === 'figure' && !b.mask).length;
    if (!cands) return void (await db.put('kv', k, LQ_VERSION));
    start(doc.id, doc.name, 'images', 'running', cands);
    try {
      const { triageFigures } = await import('./ocrpage');
      const r = await triageFigures(cached.blocks, (d, total) => (touch(), set(doc.id, { done: d, total, progress: d / Math.max(1, total) }, 'images')));
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
