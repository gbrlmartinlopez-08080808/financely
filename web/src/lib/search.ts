// Full-text search over the whole library, in the browser. Each document's text is taken out once (quietly, one at
// a time, when the computer is idle), kept in this browser's copy, and searched locally: nothing is sent anywhere.
import * as db from './db';
import { getState, type LocalDoc } from './store';
import { getFile } from '../sync/engine';

interface TextEntry {
  ver: string | null;
  pages: string[];
}

export async function extractText(d: LocalDoc, blob: Blob): Promise<string[]> {
  const k = d.meta.doc.kind;
  if (k === 'pdf') {
    const { openPdf, pageTexts } = await import('./pdf');
    const doc = await openPdf(new Uint8Array(await blob.arrayBuffer()));
    try {
      return await pageTexts(doc);
    } finally {
      void doc.loadingTask.destroy();
    }
  }
  if (k === 'docx') {
    const mammoth = await import('mammoth');
    return [(await mammoth.extractRawText({ arrayBuffer: await blob.arrayBuffer() })).value];
  }
  if (k === 'epub') {
    const { epubChapters } = await import('./epub');
    return (await epubChapters(blob)).map((c) => c.text);
  }
  if (k === 'html') return [new DOMParser().parseFromString(await blob.text(), 'text/html').body.textContent ?? ''];
  if (['markdown', 'text', 'code', 'sheet', 'rtf'].includes(k)) return [await blob.text()];
  return [];
}

/** The text of a document (from the saved copy, or taken out now). */
export async function textOf(d: LocalDoc): Promise<string[]> {
  if (d.meta.text && (d.meta.doc.kind === 'scan' || d.meta.doc.kind === 'image')) return [d.meta.text];
  const have = await db.get<TextEntry>('text', d.id);
  if (have && have.ver === d.fileVer) return have.pages;
  const blob = await getFile(d.id);
  const pages = await extractText(d, blob);
  // a scanned PDF has no text of its own: what the phone read in it stands in
  if (d.meta.text && pages.join('').trim().length < 40) pages.splice(0, pages.length, d.meta.text);
  await db.put('text', d.id, { ver: d.fileVer, pages });
  return pages;
}

let indexing = false;
/** Takes the text out of every document that hasn't been yet (small files first). */
export async function indexLibrary(onProgress?: (done: number, total: number) => void) {
  if (indexing) return;
  indexing = true;
  try {
    const todo: LocalDoc[] = [];
    for (const d of getState().docs) {
      if (!d.fileVer || d.meta.doc.size > 80 * 1024 * 1024) continue;
      // a big file that lives only on the phone is not fetched just to search it: it is searched once it has been opened
      if (d.fileStored === false && (await db.get<{ ver: string | null }>('files', d.id))?.ver !== d.fileVer) continue;
      if (!['pdf', 'docx', 'epub', 'html', 'markdown', 'text', 'code', 'sheet', 'rtf'].includes(d.meta.doc.kind)) continue;
      const have = await db.get<TextEntry>('text', d.id);
      if (!have || have.ver !== d.fileVer) todo.push(d);
    }
    todo.sort((a, b) => a.meta.doc.size - b.meta.doc.size);
    let n = 0;
    for (const d of todo) {
      await new Promise((r) => (typeof window.requestIdleCallback === "function" ? requestIdleCallback(() => r(0), { timeout: 2000 }) : setTimeout(r, 50)));
      try {
        await textOf(d);
      } catch {
        /* not readable now: next time */
      }
      onProgress?.(++n, todo.length);
    }
  } finally {
    indexing = false;
  }
}

export interface Hit {
  id: string;
  page: number;
  snippet: [string, string, string];
}
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Every place the words appear, best documents first (at most `max` hits). */
export async function searchText(q: string, max = 60): Promise<Hit[]> {
  const needle = fold(q.trim());
  if (needle.length < 2) return [];
  const hits: Hit[] = [];
  for (const d of getState().docs) {
    const t = d.meta.text && !(await db.get<TextEntry>('text', d.id)) ? { ver: d.fileVer, pages: [d.meta.text] } : await db.get<TextEntry>('text', d.id);
    if (!t) continue;
    let perDoc = 0;
    for (let p = 0; p < t.pages.length && perDoc < 6; p++) {
      const page = t.pages[p];
      const f = fold(page);
      let at = f.indexOf(needle);
      while (at >= 0 && perDoc < 6) {
        const a = Math.max(0, at - 70);
        const b = Math.min(page.length, at + needle.length + 90);
        hits.push({ id: d.id, page: p + 1, snippet: [(a > 0 ? '…' : '') + page.slice(a, at).replace(/\s+/g, ' '), page.slice(at, at + needle.length), page.slice(at + needle.length, b).replace(/\s+/g, ' ') + (b < page.length ? '…' : '')] });
        perDoc++;
        at = f.indexOf(needle, at + needle.length);
      }
    }
    if (hits.length >= max) break;
  }
  return hits;
}
