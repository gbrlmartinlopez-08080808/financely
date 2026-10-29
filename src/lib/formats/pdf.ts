import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy };
export { pdfjs };

const base = new URL('./pdfjs/', document.baseURI).href;

export async function openPdf(data: ArrayBuffer | Uint8Array): Promise<PDFDocumentProxy> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const task = pdfjs.getDocument({
    // pdf.js transfers the buffer to its worker; pass a copy so the caller's bytes stay usable.
    data: bytes.slice(),
    cMapUrl: base + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: base + 'standard_fonts/',
    wasmUrl: base + 'wasm/',
    enableXfa: false,
    fontExtraProperties: true,
  });
  return task.promise;
}

/** Render a page into a fresh canvas at the given CSS-pixel scale (already multiplied by DPR if wanted). */
export async function renderPage(page: PDFPageProxy, scale: number, canvas?: HTMLCanvasElement) {
  const viewport = page.getViewport({ scale });
  const c = canvas ?? document.createElement('canvas');
  c.width = Math.ceil(viewport.width);
  c.height = Math.ceil(viewport.height);
  const ctx = c.getContext('2d', { willReadFrequently: false })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvas: c, canvasContext: ctx, viewport }).promise;
  return { canvas: c, viewport };
}

export async function pdfCover(data: ArrayBuffer): Promise<{ cover: Blob | null; pages: number; title?: string; author?: string }> {
  const pdf = await openPdf(data);
  try {
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const { canvas } = await renderPage(page, 360 / vp.width);
    const cover = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    let title: string | undefined;
    let author: string | undefined;
    try {
      const meta = await pdf.getMetadata();
      const info = meta.info as Record<string, unknown>;
      if (typeof info?.Title === 'string' && info.Title.trim().length > 2) title = info.Title.trim();
      if (typeof info?.Author === 'string' && info.Author.trim()) author = info.Author.trim();
    } catch {
      /* metadata is optional */
    }
    const junk = (t?: string) => !t || /^(untitled|microsoft word|document\d*|arxiv|doi|\S+\.(dvi|tex|pdf|docx?)$)/i.test(t) || /^[\w-]+:[\w./-]+/.test(t) || t.length > 180;
    if (junk(title)) {
      // Use the largest text near the top of page 1 (how humans find a title).
      try {
        const tc = await page.getTextContent();
        const items = tc.items.filter((i): i is (typeof tc.items)[number] & { str: string; transform: number[] } => 'str' in i && !!i.str.trim());
        const size = (i: { transform: number[] }) => Math.hypot(i.transform[2], i.transform[3]);
        const top = items.filter((i) => i.transform[5] > vp.height * 0.45);
        const max = Math.max(0, ...top.map(size));
        const big = top.filter((i) => size(i) > max * 0.92).sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
        const t = big.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
        if (t.length > 3 && t.length < 180 && max > 11) title = t;
        else if (junk(title)) title = undefined;
      } catch {
        title = undefined;
      }
    }
    return { cover, pages: pdf.numPages, title, author };
  } finally {
    pdf.loadingTask.destroy();
  }
}

export async function pdfOutline(pdf: PDFDocumentProxy) {
  const out: { title: string; page: number; level: number }[] = [];
  const outline = await pdf.getOutline().catch(() => null);
  if (!outline) return out;
  const walk = async (items: typeof outline, level: number) => {
    for (const it of items) {
      let page = -1;
      try {
        const dest = typeof it.dest === 'string' ? await pdf.getDestination(it.dest) : it.dest;
        if (dest && dest[0]) page = (await pdf.getPageIndex(dest[0])) + 1;
      } catch {
        /* unresolved destination */
      }
      if (page > 0) out.push({ title: it.title, page, level });
      if (it.items?.length) await walk(it.items, level + 1);
    }
  };
  await walk(outline, 1);
  return out;
}
