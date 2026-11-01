// The last few PDFs that were open stay open, so going back to a book (or flipping between two) is instant: no file
// to read again, no pages to look up again. A book is also opened as soon as a finger touches its cover.
import { openPdfBlob, type PDFDocumentProxy } from './formats/pdf';
import { getFile } from './library';
import type { DocMeta } from './types';

const KEEP = 3;
const open = new Map<string, { key: string; p: Promise<PDFDocumentProxy> }>();
const keyOf = (d: Pick<DocMeta, 'id' | 'size' | 'modified'>) => `${d.id}:${d.size}:${d.modified ?? 0}`;

/** The document, opened (or the one already open). */
export function openCached(d: Pick<DocMeta, 'id' | 'size' | 'modified'>, blob?: Blob): Promise<PDFDocumentProxy> {
  const key = keyOf(d);
  const hit = open.get(d.id);
  if (hit && hit.key === key) {
    // most recently used goes to the end
    open.delete(d.id);
    open.set(d.id, hit);
    return hit.p;
  }
  if (hit) forget(d.id); // the file changed (an edit from the computer, a new version)
  const p = (async () => {
    const b = blob ?? (await getFile(d.id));
    if (!b) throw new Error('The file for this document is missing.');
    return openPdfBlob(b);
  })();
  p.catch(() => open.delete(d.id));
  open.set(d.id, { key, p });
  while (open.size > KEEP) forget(open.keys().next().value!);
  return p;
}

export function forget(id: string) {
  const hit = open.get(id);
  open.delete(id);
  hit?.p.then((pdf) => pdf.loadingTask.destroy()).catch(() => {});
}

/** A finger is on a book: start opening it now, so it is ready when the finger lifts. */
export function prefetch(d: DocMeta) {
  if (d.kind === 'pdf') void openCached(d).catch(() => {});
}
