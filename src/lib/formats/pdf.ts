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

interface ImgBox {
  frac: number; // share of the page area
  box: [number, number, number, number]; // x0,y0,x1,y1 in scale-1 viewport px
}

/** Largest picture on a page (found from the drawing commands, so it works for photos and embedded art). */
async function largestImage(page: PDFPageProxy): Promise<ImgBox | null> {
  const OPS = pdfjs.OPS as Record<string, number>;
  const vp = page.getViewport({ scale: 1 });
  const ops = await page.getOperatorList();
  type M = [number, number, number, number, number, number];
  const mul = (m: M, n: M): M => [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  let best: ImgBox | null = null;
  const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].filter((x) => x !== undefined));
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args as M);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (args?.[0]) ctm = mul(ctm, args[0] as M);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (imageOps.has(fn)) {
      const pts = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
      const T = vp.transform as number[];
      const vpts = pts.map((p) => [T[0] * p[0] + T[2] * p[1] + T[4], T[1] * p[0] + T[3] * p[1] + T[5]]);
      const xs = vpts.map((p) => p[0]);
      const ys = vpts.map((p) => p[1]);
      const x0 = Math.max(0, Math.min(...xs));
      const x1 = Math.min(vp.width, Math.max(...xs));
      const y0 = Math.max(0, Math.min(...ys));
      const y1 = Math.min(vp.height, Math.max(...ys));
      const frac = Math.max(0, x1 - x0) * Math.max(0, y1 - y0) / (vp.width * vp.height);
      if (!best || frac > best.frac) best = { frac, box: [x0, y0, x1, y1] };
    }
  }
  return best;
}

/** Share of pixels that are not (near-)white: a real cover is mostly ink, a bare title page almost none. */
function inkShare(c: HTMLCanvasElement): number {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  let ink = 0;
  for (let i = 0; i < d.length; i += 16) {
    n++;
    if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 232) ink++;
  }
  return n ? ink / n : 0;
}

export async function pdfCover(data: ArrayBuffer): Promise<{ cover: Blob | null; pages: number; title?: string; author?: string }> {
  const pdf = await openPdf(data);
  try {
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const encode = (c: HTMLCanvasElement) => new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.88));
    // Page one is the cover unless it is a bare, nearly empty title page. (A vector-art cover has few words and no
    // embedded picture, so "how much of the page is inked" is the test, not "does it contain an image".)
    const { canvas: first } = await renderPage(page, 420 / vp.width);
    let cover: Blob | null = null;
    try {
      const ink = inkShare(first);
      const words = (await page.getTextContent()).items.reduce((n, i) => n + ('str' in i ? i.str.split(/\s+/).filter(Boolean).length : 0), 0);
      if (ink < 0.035 && words < 120 && pdf.numPages > 1) {
        for (let p = 2; p <= Math.min(pdf.numPages, 8); p++) {
          const pg = await pdf.getPage(p);
          const found = await largestImage(pg);
          if (found && found.frac >= 0.35) {
            const v = pg.getViewport({ scale: 1 });
            const { canvas } = await renderPage(pg, 720 / v.width);
            const s = canvas.width / v.width;
            const [x0, y0, x1, y1] = found.box.map((n) => n * s);
            const w = x1 - x0;
            const h = y1 - y0;
            let out = canvas;
            if (found.frac < 0.9 && w / h > 0.45 && w / h < 1.8) {
              out = document.createElement('canvas');
              out.width = Math.round(w);
              out.height = Math.round(h);
              out.getContext('2d')!.drawImage(canvas, x0, y0, w, h, 0, 0, out.width, out.height);
            }
            cover = await encode(out);
            break;
          }
          pg.cleanup();
        }
      }
    } catch (e) {
      console.warn('cover search failed', e);
    }
    if (!cover) cover = await encode(first);
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
