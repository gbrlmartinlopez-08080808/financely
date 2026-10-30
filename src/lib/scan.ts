// Background reading of files: scanned (picture-only) PDFs, photos, camera scans — and the same kind of care for the
// pictures inside ordinary documents. The result (readable text, paragraphs and page numbers) is saved, so Liquid
// mode, Listen, Search and Ask just work. Everything heavy goes through one queue, so reading a scan, preparing the
// Liquid view and looking at pictures never fight each other (they used to, and the results collided).
import { useSyncExternalStore } from 'react';
import * as db from './db';
import { getFile } from './library';
import { openPdf } from './formats/pdf';
import type { LBlock } from './formats/liquidPdf';
import { mapLimit } from './ocrpage';
import type { DocMeta } from './types';

export const LQ_VERSION = 'lq9';

export type JobKind = 'scan' | 'liquid' | 'images';

export interface ScanJob {
  id: string;
  title: string;
  /** what the work is: reading a scan, preparing Liquid mode, or looking at the pictures in a document */
  kind: JobKind;
  /** checking = looking for a text layer · running = at work · done = finished · none = nothing readable · text = ordinary PDF */
  status: 'checking' | 'running' | 'done' | 'none' | 'text';
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
/** the job that is at work right now (for the little progress badge) */
export function useActiveScan(): ScanJob | undefined {
  return useSyncExternalStore(
    (l) => (subs.add(l), () => subs.delete(l)),
    () => [...jobs.values()].find((j) => j.status === 'running'),
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

/** Reports progress of reading some scanned pages of a mixed document (used by the reader). */
export function reportScan(id: string, title: string, done: number, total: number, finished = false) {
  if (!jobs.has(id)) start(id, title, 'scan', 'running', total);
  set(id, { status: finished ? 'done' : 'running', done, total, progress: total ? done / total : 0 });
}
/** Progress of preparing Liquid mode (the reader reports it here instead of drawing its own bar). */
export function reportLiquid(id: string, title: string, done: number, total: number, finished = false) {
  if (finished) return end(id, 'liquid');
  if (!jobs.has(key('liquid', id))) start(id, title, 'liquid', 'running', total);
  set(id, { status: 'running', done, total, progress: total ? Math.min(1, done / total) : 0.05 }, 'liquid');
}

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

/** How a document turned out to be, once it has been looked at (so Liquid mode knows whether to wait for the reading). */
export type Verdict = 'text' | 'scanning' | 'done' | 'none' | 'other';
const verdicts = new Map<string, { p: Promise<Verdict>; ok: (v: Verdict) => void }>();
const verdictOf = (id: string) => {
  let v = verdicts.get(id);
  if (!v) {
    let ok!: (x: Verdict) => void;
    const p = new Promise<Verdict>((r) => (ok = r));
    v = { p, ok };
    verdicts.set(id, v);
  }
  return v;
};
/** Resolves as soon as the document has been looked at: a normal PDF, a scan being read, or already read. */
export function scanVerdict(doc: DocMeta): Promise<Verdict> {
  if (doc.kind !== 'pdf') return Promise.resolve('other');
  queueScan(doc);
  return verdictOf(doc.id).p;
}

/** Look at a PDF, picture or scan once and read whatever text is in it. Safe to call again and again. */
export function queueScan(doc: DocMeta) {
  if (!['pdf', 'image', 'scan'].includes(doc.kind) || queued.has(doc.id)) return;
  queued.add(doc.id);
  const job = doc.kind === 'pdf' ? run : doc.kind === 'image' ? runImage : runScanDoc;
  void enqueue(() => job(doc)).catch((e) => {
    console.warn('scan failed', doc.name, e);
    end(doc.id);
    verdictOf(doc.id).ok('other');
  });
}

const settle = (doc: DocMeta, status: 'done' | 'none') => {
  jobs.set(doc.id, { id: doc.id, title: doc.name, kind: 'scan', status, progress: 1, done: 1, total: 1, startedAt: Date.now() });
  emit();
};
const finish = (doc: DocMeta) => window.dispatchEvent(new CustomEvent('frogity:scan', { detail: { id: doc.id, title: doc.name } }));

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

async function run(doc: DocMeta) {
  const v = verdictOf(doc.id);
  const remembered = await db.get<string>('kv', `scan:${doc.id}`);
  const ckey = `${doc.id}:${LQ_VERSION}`;
  const cached = await db.get<{ blocks: LBlock[]; scanned: number[] }>('cache', ckey);
  if (remembered === 'text') return v.ok('text');
  if (remembered === 'done2') {
    settle(doc, 'done');
    return v.ok('done');
  }
  if (remembered === 'none') {
    settle(doc, 'none');
    return v.ok('none');
  }
  start(doc.id, doc.name, 'scan', 'checking');
  const blob = await getFile(doc.id);
  if (!blob) return void (end(doc.id), v.ok('other'));
  const buf = await blob.arrayBuffer();

  // does it have a text layer? look at a handful of pages
  const pdf = await openPdf(buf.slice(0));
  let withText = 0;
  let sample = 0;
  let numPages = 0;
  try {
    const n = (numPages = pdf.numPages);
    const pick = [1, 2, 3, Math.ceil(n / 2), n].filter((x, i, a) => x >= 1 && x <= n && a.indexOf(x) === i);
    sample = pick.length;
    for (const pn of pick) {
      const tc = await (await pdf.getPage(pn)).getTextContent();
      if (tc.items.reduce((a, it) => a + ('str' in it ? it.str.trim().length : 0), 0) > 25) withText++;
    }
  } finally {
    pdf.loadingTask.destroy();
  }
  if (withText / Math.max(1, sample) > 0.4) {
    await db.put('kv', `scan:${doc.id}`, 'text');
    end(doc.id);
    return v.ok('text');
  }

  if (cached && cached.scanned.length === 0 && !cached.blocks.some((b) => b.t === 'img' && b.kind === 'scan')) {
    // recognised before this version existed
    const has = cached.blocks.some((b) => b.t === 'p');
    await db.put('kv', `scan:${doc.id}`, has ? 'done2' : 'none');
    set(doc.id, { status: has ? 'done' : 'none', progress: 1 });
    return v.ok(has ? 'done' : 'none');
  }
  // a picture-only document: from here on Liquid mode waits for this reading instead of doing the same work again
  set(doc.id, { status: 'running', progress: 0.02, total: numPages });
  v.ok('scanning');
  window.dispatchEvent(new CustomEvent('frogity:started', { detail: { title: doc.name, pages: numPages } }));
  const { ocrBlocks, ocrPages } = await import('./ocrpage');
  const progress = (d: number, total: number) => set(doc.id, { done: d, total, progress: 0.02 + 0.98 * (d / Math.max(1, total)) });
  // if Liquid mode already made the page pictures, read those places; otherwise go straight to the pages
  const res = cached?.blocks ? await ocrBlocks(buf, cached.blocks, progress) : await ocrPages(buf, progress);
  if (res.chars < 60) {
    await db.put('kv', `scan:${doc.id}`, 'none');
    return set(doc.id, { status: 'none', progress: 1 });
  }
  await db.put('cache', ckey, { blocks: res.blocks, scanned: [] });
  await db.put('kv', `scan:${doc.id}`, 'done2');
  set(doc.id, { status: 'done', progress: 1 });
  finish(doc);
}

/**
 * Pictures inside an ordinary document: after Liquid mode has been made, look at each one; writing that sits in a
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
