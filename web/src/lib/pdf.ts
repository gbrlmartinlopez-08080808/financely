import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export type { PDFDocumentProxy, PDFPageProxy };
export { pdfjs };

const base = new URL('./pdfjs/', document.baseURI).href;
export function openPdf(data: Uint8Array): Promise<PDFDocumentProxy> {
  // pdf.js moves the bytes to its worker: give it a copy so ours stay usable (for saving)
  return pdfjs.getDocument({ data: data.slice(), cMapUrl: base + 'cmaps/', cMapPacked: true, standardFontDataUrl: base + 'standard_fonts/', wasmUrl: base + 'wasm/', enableXfa: false }).promise;
}

/** Draws one page into a canvas at `scale` (device pixels included). */
export async function renderPage(page: PDFPageProxy, scale: number, rotation = 0, canvas = document.createElement('canvas')) {
  const vp = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
  return canvas;
}

/** The text of every page (for search and for the reading view). */
export async function pageTexts(doc: PDFDocumentProxy, onPage?: (i: number) => void): Promise<string[]> {
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    let s = '';
    let lastY: number | null = null;
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) s += '\n';
      else if (s && !s.endsWith(' ') && !it.str.startsWith(' ')) s += it.hasEOL ? '\n' : '';
      s += it.str;
      if (it.hasEOL) s += '\n';
      lastY = y;
    }
    out.push(s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n'));
    p.cleanup();
    onPage?.(i);
  }
  return out;
}
