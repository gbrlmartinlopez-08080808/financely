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

/** Look at a PDF once; if it is a scan, read it. Safe to call again and again. */
export function queueScan(doc: DocMeta) {
  if (doc.kind !== 'pdf' || queued.has(doc.id)) return;
  queued.add(doc.id);
  chain = chain.then(() => run(doc)).catch((e) => console.warn('scan failed', doc.name, e));
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
  // phase 2 (70%): read each picture
  const { recognize } = await import('./ocr');
  const total = blocks.filter((b) => b.t === 'img' && b.kind === 'scan').length;
  let done = 0;
  let chars = 0;
  const out: LBlock[] = [];
  for (const b of blocks) {
    if (b.t === 'img' && b.kind === 'scan') {
      const r = await recognize(b.blob);
      done++;
      chars += r.text.length;
      set(doc.id, { done, total, progress: 0.3 + 0.7 * (done / Math.max(1, total)) });
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
