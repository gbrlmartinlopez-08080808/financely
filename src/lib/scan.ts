// Scanned (picture-only) PDFs: found and read automatically, in the background, from the moment they are added.
// The result (readable text, paragraphs and page numbers) is saved, so Liquid mode, Listen, Search and Ask just work.
import { useSyncExternalStore } from 'react';
import * as db from './db';
import { getFile } from './library';
import { openPdf } from './formats/pdf';
import { pdfToLiquid, type LBlock } from './formats/liquidPdf';
import type { DocMeta } from './types';

export const LQ_VERSION = 'lq8';

export interface ScanJob {
  id: string;
  title: string;
  /** checking = looking for a text layer · running = reading the pages · done = text ready · none = nothing readable · text = ordinary PDF */
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
const set = (id: string, patch: Partial<ScanJob>) => {
  const j = jobs.get(id);
  if (j) {
    jobs.set(id, { ...j, ...patch });
    emit();
  }
};

export const scanState = (id: string) => jobs.get(id);
export function useScan(id?: string): ScanJob | undefined {
  return useSyncExternalStore(
    (l) => (subs.add(l), () => subs.delete(l)),
    () => (id ? jobs.get(id) : undefined),
  );
}
/** the job that is reading pages right now (for the little progress badge) */
export function useActiveScan(): ScanJob | undefined {
  return useSyncExternalStore(
    (l) => (subs.add(l), () => subs.delete(l)),
    () => [...jobs.values()].find((j) => j.status === 'running'),
  );
}
/** Reports progress of reading some scanned pages of a mixed document (used by the reader). */
export function reportScan(id: string, title: string, done: number, total: number, finished = false) {
  if (!jobs.has(id)) jobs.set(id, { id, title, status: 'running', progress: 0, done: 0, total, startedAt: Date.now() });
  set(id, { status: finished ? 'done' : 'running', done, total, progress: total ? done / total : 0 });
}

let chain: Promise<void> = Promise.resolve();
const queued = new Set<string>();

/** Look at a PDF, picture or scan once and read whatever text is in it. Safe to call again and again. */
export function queueScan(doc: DocMeta) {
  if (!['pdf', 'image', 'scan'].includes(doc.kind) || queued.has(doc.id)) return;
  queued.add(doc.id);
  const job = doc.kind === 'pdf' ? run : doc.kind === 'image' ? runImage : runScanDoc;
  chain = chain.then(() => job(doc)).catch((e) => (console.warn('scan failed', doc.name, e), jobs.delete(doc.id), emit()));
}

const done = (doc: DocMeta, status: 'done' | 'none') => {
  jobs.set(doc.id, { id: doc.id, title: doc.name, status, progress: 1, done: 1, total: 1, startedAt: Date.now() });
  emit();
};
const finish = (doc: DocMeta) => window.dispatchEvent(new CustomEvent('frogity:scan', { detail: { id: doc.id, title: doc.name } }));

/** Runs `fn` over the items with a few at a time (the OCR pool decides how many really run at once). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/** A photo or screenshot: read its text once, keep where every word sits so the reader can select it. */
async function runImage(doc: DocMeta) {
  const remembered = await db.get<string>('kv', `scan:${doc.id}`);
  if (remembered === 'done' || remembered === 'none') return done(doc, remembered);
  const blob = await getFile(doc.id);
  if (!blob) return;
  jobs.set(doc.id, { id: doc.id, title: doc.name, status: 'running', progress: 0.02, done: 0, total: 1, startedAt: Date.now() });
  emit();
  const { readImage } = await import('./ocr');
  const r = await readImage(blob, (p, st) => st.includes('recogni') && set(doc.id, { progress: 0.05 + 0.95 * p }));
  if (r.text.trim().length < 12) {
    await db.put('kv', `scan:${doc.id}`, 'none');
    return done(doc, 'none');
  }
  await db.put('cache', `${doc.id}:imgocr`, { words: r.words, w: r.w, h: r.h, text: r.text });
  await db.put('kv', `scan:${doc.id}`, 'done');
  done(doc, 'done');
  finish(doc);
}

/** Pages from the camera scanner: the pages are saved at once, the text (and the searchable PDF) follow here. */
async function runScanDoc(doc: DocMeta) {
  const remembered = await db.get<string>('kv', `scan:${doc.id}`);
  if (remembered === 'skip' || remembered === 'done' || remembered === 'none' || (await db.get('cache', `${doc.id}:ocr`))) return;
  const pages = (await Promise.all((doc.scanPages ?? []).map((p) => db.get<Blob>('blobs', p)))).filter(Boolean) as Blob[];
  if (!pages.length) return;
  jobs.set(doc.id, { id: doc.id, title: doc.name, status: 'running', progress: 0.02, done: 0, total: pages.length, startedAt: Date.now() });
  emit();
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
  done(doc, 'done');
  finish(doc);
}

async function run(doc: DocMeta) {
  const remembered = await db.get<string>('kv', `scan:${doc.id}`);
  const key = `${doc.id}:${LQ_VERSION}`;
  const cached = await db.get<{ blocks: LBlock[]; scanned: number[] }>('cache', key);
  if (remembered === 'text') return;
  if (remembered === 'done' || (cached && cached.scanned.length === 0 && cached.blocks.some((b) => b.t === 'p') && remembered)) {
    jobs.set(doc.id, { id: doc.id, title: doc.name, status: 'done', progress: 1, done: 1, total: 1, startedAt: Date.now() });
    return emit();
  }
  if (remembered === 'none') {
    jobs.set(doc.id, { id: doc.id, title: doc.name, status: 'none', progress: 1, done: 1, total: 1, startedAt: Date.now() });
    return emit();
  }
  jobs.set(doc.id, { id: doc.id, title: doc.name, status: 'checking', progress: 0, done: 0, total: 0, startedAt: Date.now() });
  emit();
  const blob = await getFile(doc.id);
  if (!blob) return void (jobs.delete(doc.id), emit());
  const buf = await blob.arrayBuffer();

  // does it have a text layer? look at a handful of pages
  const pdf = await openPdf(buf.slice(0));
  let withText = 0;
  let sample = 0;
  try {
    const n = pdf.numPages;
    const pick = [1, 2, 3, Math.ceil(n / 2), n].filter((v, i, a) => v >= 1 && v <= n && a.indexOf(v) === i);
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
    jobs.delete(doc.id);
    return emit();
  }

  if (cached && cached.scanned.length === 0 && !cached.blocks.some((b) => b.t === 'img' && b.kind === 'scan')) {
    // recognised before this version existed
    await db.put('kv', `scan:${doc.id}`, cached.blocks.some((b) => b.t === 'p') ? 'done' : 'none');
    return set(doc.id, { status: cached.blocks.some((b) => b.t === 'p') ? 'done' : 'none', progress: 1 });
  }
  set(doc.id, { status: 'running', progress: 0.02 });
  let blocks = cached?.blocks;
  if (!blocks) {
    // phase 1 (30%): turn every page into a picture block
    blocks = (await pdfToLiquid(buf, (_b, p) => set(doc.id, { progress: 0.02 + 0.28 * (p.page / p.pages), done: 0, total: p.pages }))).blocks;
  }
  // phase 2 (70%): read each picture (two at a time on phones that can)
  const { readImage, OCR_POOL } = await import('./ocr');
  const pics = blocks.filter((b): b is Extract<LBlock, { t: 'img' }> => b.t === 'img' && b.kind === 'scan');
  const total = pics.length;
  let doneN = 0;
  const reads = await mapLimit(pics, OCR_POOL, async (b) => {
    const r = await readImage(b.blob);
    doneN++;
    set(doc.id, { done: doneN, total, progress: 0.3 + 0.7 * (doneN / Math.max(1, total)) });
    return r;
  });
  let chars = 0;
  const out: LBlock[] = [];
  let k = 0;
  for (const b of blocks) {
    if (b.t === 'img' && b.kind === 'scan') {
      const r = reads[k++];
      chars += r.text.length;
      for (const para of r.text.split(/\n\n+/)) if (para.trim()) out.push({ t: 'p', html: para.replace(/&/g, '&amp;').replace(/</g, '&lt;'), page: b.page });
    } else out.push(b);
  }
  if (chars < 60) {
    await db.put('kv', `scan:${doc.id}`, 'none');
    return set(doc.id, { status: 'none', progress: 1 });
  }
  await db.put('cache', key, { blocks: out, scanned: [] });
  await db.put('kv', `scan:${doc.id}`, 'done');
  set(doc.id, { status: 'done', progress: 1 });
  window.dispatchEvent(new CustomEvent('frogity:scan', { detail: { id: doc.id, title: doc.name } }));
}
