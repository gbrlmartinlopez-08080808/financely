// Reads one scanned page properly: find the columns and pictures first, then read each text block at the size the
// recogniser likes best, rebuild paragraphs and headings from where the lines sit, and keep every picture (diagram,
// photo, table) as a picture instead of letting the OCR scribble over it.
import type { LBlock } from './formats/liquidPdf';
import { breathe, flattenSource, recognize, slice, type OcrLine } from './ocr';
import { estimateSkew, rotateCanvas, segmentPage, type Leaf } from './layout';
import { escapeHtml } from './sanitize';

/** Height (px) the recogniser sees for one line of ink: big enough to be exact, small enough to be quick. */
const TARGET_LINE = 27;

const median = (a: number[]) => {
  if (!a.length) return 0;
  const b = [...a].sort((x, y) => x - y);
  return b[b.length >> 1];
};

interface Read {
  lines: (OcrLine & { h: number })[]; // positions in source px, h = height of the line
  conf: number;
  chars: number;
}

function crop(src: HTMLCanvasElement, l: Leaf, pad: number, scale: number, soften = 0): HTMLCanvasElement {
  const x0 = Math.max(0, Math.floor(l.x0 - pad));
  const y0 = Math.max(0, Math.floor(l.y0 - pad));
  const x1 = Math.min(src.width, Math.ceil(l.x1 + pad));
  const y1 = Math.min(src.height, Math.ceil(l.y1 + pad));
  const c = document.createElement('canvas');
  c.width = Math.max(8, Math.round((x1 - x0) * scale));
  c.height = Math.max(8, Math.round((y1 - y0) * scale));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  if (soften) ctx.filter = `blur(${soften}px)`; // grainy scans: a little blur takes the grain out before reading
  ctx.drawImage(src, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
  return Object.assign(c, { _ox: x0, _oy: y0 });
}

async function readLeaf(flat: HTMLCanvasElement, l: Leaf, scale: number, soften = 0): Promise<Read> {
  const pad = Math.max(6, l.lh * 0.6);
  const c = crop(flat, l, pad, scale, soften) as HTMLCanvasElement & { _ox: number; _oy: number };
  const r = await recognize(c, undefined, l.lines <= 1 ? 7 : 6);
  const lines = r.lines
    .map((ln) => ({ ...ln, x0: c._ox + ln.x0 / scale, x1: c._ox + ln.x1 / scale, y0: c._oy + ln.y0 / scale, y1: c._oy + ln.y1 / scale, h: (ln.y1 - ln.y0) / scale }))
    .filter((ln) => ln.text.trim());
  const chars = lines.reduce((a, ln) => a + ln.text.length, 0);
  const conf = chars ? lines.reduce((a, ln) => a + ln.conf * ln.text.length, 0) / chars : 0;
  return { lines, conf, chars };
}

/** Is this line real writing, or specks the recogniser mistook for letters? */
function sane(t: string, conf: number) {
  const alnum = (t.match(/[\p{L}\p{N}]/gu) ?? []).length;
  if (alnum < 2 && t.length < 4) return false;
  if (alnum / t.length < 0.45) return false;
  if (conf < 30) return false;
  return true;
}

function tidy(t: string) {
  return t
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/(^|\s)[|_~]+(?=\s|$)/g, ' ') // stray rules read as bars
    .replace(/[‘’]/g, '’')
    .trim();
}

/** Joins the lines of one paragraph, undoing line-end hyphens. */
function joinLines(ls: string[]) {
  let out = '';
  for (const t of ls) {
    if (!out) out = t;
    else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(t)) out = out.slice(0, -1) + t;
    else out += ' ' + t;
  }
  return out;
}

export interface PageOut {
  blocks: LBlock[];
  /** share of the page the recogniser could read (0‥1); low means "keep it as a picture" */
  readable: number;
}

/**
 * `page` is a rendered picture of the page (any size; a bigger render reads better). Returns the blocks in reading
 * order: headings, paragraphs and pictures. If nothing on it reads as text, `blocks` is empty and the caller keeps the page.
 */
export async function ocrPage(page: HTMLCanvasElement, pageNo: number): Promise<PageOut> {
  const t0 = performance.now();
  const tick = () => slice(0); // let the screen breathe between the heavy steps
  let flat = await flattenSource(page, 2400);
  await tick();
  // a crooked scan or photo: straighten it first (lines of text must run level for everything that follows)
  const t1 = performance.now();
  const tilt = await estimateSkew(flat);
  const t2 = performance.now();
  let color = page; // pictures are cut from the original, in colour
  if (Math.abs(tilt) >= 0.3) {
    flat = rotateCanvas(flat, tilt);
    color = rotateCanvas(page, tilt);
  }
  await tick();
  const leaves = await segmentPage(flat);
  const t3 = performance.now();
  await tick();
  const soften = leaves.noise > 0.45 ? 1.1 : leaves.noise > 0.25 ? 0.7 : 0;
  console.debug(`[ocr] page ${pageNo}: ${page.width}×${page.height}, tilt ${tilt.toFixed(1)}°, noise ${leaves.noise.toFixed(2)}, blocks: ${leaves.map((l) => `${l.kind[0]}${l.lines}`).join(' ')}`);
  const f = color.width / flat.width;

  // read the text blocks, a few at a time (the OCR pool decides how many really run at once)
  const reads: (Read | null)[] = new Array(leaves.length).fill(null);
  await Promise.all(
    leaves.map(async (l, i) => {
      if (l.kind !== 'text') return;
      let scale = Math.max(0.45, Math.min(3, TARGET_LINE / Math.max(8, l.lh)));
      let r = await readLeaf(flat, l, scale, soften);
      // low confidence: look again at another size before giving up on the block
      if (r.conf < 62 && l.lines >= 1) {
        const r2 = await readLeaf(flat, l, Math.min(3.2, scale * (scale < 1.2 ? 1.4 : 0.75)), soften ? 0 : 0.8);
        if (r2.conf > r.conf) r = r2;
      }
      reads[i] = r;
    }),
  );

  const t4 = performance.now();
  console.debug(`[ocr] timing page ${pageNo}: flatten ${(t1 - t0).toFixed(0)} skew ${(t2 - t1).toFixed(0)} layout ${(t3 - t2).toFixed(0)} read ${(t4 - t3).toFixed(0)} ms`);
  // line height of the body text on this page → what counts as a heading
  const allH: number[] = [];
  reads.forEach((r) => r && r.conf >= 55 && r.lines.forEach((ln) => allH.push(ln.h)));
  const body = median(allH) || 1;

  const blocks: LBlock[] = [];
  let readChars = 0;
  let figures = 0;
  const pageArea = flat.width * flat.height;
  let textArea = 0;

  for (let i = 0; i < leaves.length; i++) {
    const l = leaves[i];
    const r = reads[i];
    const asPicture = async (kind: 'figure' | 'table') => {
      const pad = 8;
      const x0 = Math.max(0, Math.floor((l.x0 - pad) * f));
      const y0 = Math.max(0, Math.floor((l.y0 - pad) * f));
      const w = Math.min(color.width - x0, Math.ceil((l.x1 - l.x0 + 2 * pad) * f));
      const h = Math.min(color.height - y0, Math.ceil((l.y1 - l.y0 + 2 * pad) * f));
      if (w < 24 || h < 24) return;
      const k = Math.min(1, 1400 / w);
      const c = document.createElement('canvas');
      c.width = Math.round(w * k);
      c.height = Math.round(h * k);
      c.getContext('2d')!.drawImage(color, x0, y0, w, h, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.86));
      const frac = (l.x1 - l.x0) / flat.width;
      blocks.push({ t: 'img', blob, w: c.width, h: c.height, em: Math.max(6, Math.round(frac * 240) / 10), mask: false, kind, page: pageNo, alt: kind === 'table' ? `Table on page ${pageNo}` : `Figure on page ${pageNo}` });
      figures++;
    };
    if (l.kind !== 'text') {
      await asPicture(l.kind);
      continue;
    }
    if (!r || !r.chars) continue;
    // a "text" block the recogniser could not read is really a picture (or a smudge): keep it as one
    if (r.conf < 42 && (l.y1 - l.y0) * (l.x1 - l.x0) > pageArea * 0.01) {
      await asPicture('figure');
      continue;
    }
    // running heads and page numbers at the very top or bottom
    const single = r.lines.length === 1;
    const edge = l.y1 < flat.height * 0.07 || l.y0 > flat.height * 0.93;
    if (single && edge && r.chars < 60) continue;
    const good = r.lines.filter((ln) => sane(ln.text, ln.conf));
    if (!good.length) continue;
    // paragraphs from the geometry: a bigger gap, an indent, or a short line that ends a sentence starts a new one
    const left = Math.min(...good.map((ln) => ln.x0));
    const right = Math.max(...good.map((ln) => ln.x1));
    const mh = median(good.map((ln) => ln.h)) || body;
    type Para = { text: string[]; hs: number[] };
    const paras: Para[] = [];
    let prev: (typeof good)[number] | null = null;
    for (const ln of good) {
      const t = tidy(ln.text);
      if (!t) continue;
      const gap = prev ? ln.y0 - prev.y1 : 0;
      const indent = ln.x0 - left > mh * 0.9;
      const prevShort = prev ? prev.x1 < left + (right - left) * 0.72 && /[.!?:”"’)]$/.test(prev.text.trim()) : false;
      const bigger = prev ? Math.abs(ln.h - prev.h) > Math.max(ln.h, prev.h) * 0.22 : false; // a heading beside body text
      if (!prev || gap > mh * 0.75 || indent || prevShort || bigger) paras.push({ text: [t], hs: [ln.h] });
      else {
        paras[paras.length - 1].text.push(t);
        paras[paras.length - 1].hs.push(ln.h);
      }
      prev = ln;
    }
    for (const p of paras) {
      const text = joinLines(p.text);
      if (!text) continue;
      readChars += text.length;
      textArea += (l.x1 - l.x0) * (l.y1 - l.y0) * (text.length / Math.max(1, r.chars));
      const ph = median(p.hs);
      const head = p.text.length <= 2 && text.length < 110 && ph >= body * 1.2 && !/[,;]$/.test(text);
      if (head) blocks.push({ t: 'h', level: ph >= body * 1.65 ? 0 : 1, html: escapeHtml(text), page: pageNo });
      else blocks.push({ t: 'p', html: escapeHtml(text), page: pageNo });
    }
  }

  // join a paragraph that was cut by a column or page break (it carries on in lower case)
  for (let i = 1; i < blocks.length; i++) {
    const a = blocks[i - 1];
    const b = blocks[i];
    if (a.t === 'p' && b.t === 'p' && !/[.!?:”"’)]\s*$/.test(a.html) && /^[a-zà-ÿ]/.test(b.html)) {
      a.html = /[A-Za-z]-$/.test(a.html) ? a.html.slice(0, -1) + b.html : `${a.html} ${b.html}`;
      blocks.splice(i, 1);
      i--;
    }
  }

  const readable = Math.min(1, textArea / (pageArea * 0.25));
  // nothing readable at all (and nothing worth keeping as a figure): the caller keeps the whole page as a picture
  if (readChars < 25 && figures === 0) return { blocks: [], readable: 0 };
  return { blocks, readable };
}

/** Runs `fn` over the items a few at a time. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
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

/** What a page read came to. `failed` means something went wrong (a crashed worker, an out-of-memory render): try again later. */
interface PageRead {
  blocks: LBlock[];
  failed: boolean;
}

/** Renders one PDF page for reading and runs the page reader on it. A page with nothing readable comes back as its picture. */
async function readPdfPage(pdf: import('./formats/pdf').PDFDocumentProxy, pageNo: number, renderPage: typeof import('./formats/pdf').renderPage): Promise<PageRead> {
  let canvas: HTMLCanvasElement | null = null;
  try {
    const page = await pdf.getPage(pageNo);
    const vp = page.getViewport({ scale: 1 });
    // about 220 dpi on a normal page: plenty to read, and half the pixels of the bigger render this used to make
    const S = Math.max(1.2, Math.min(3.2, 1800 / vp.width));
    ({ canvas } = await renderPage(page, S));
    page.cleanup();
    const out = await ocrPage(canvas, pageNo);
    if (out.blocks.length) return { blocks: out.blocks, failed: false };
    // nothing readable (a blank sheet, a photo page): keep the page as a picture
    const k = Math.min(1, 1400 / canvas.width);
    const c = document.createElement('canvas');
    c.width = Math.round(canvas.width * k);
    c.height = Math.round(canvas.height * k);
    c.getContext('2d')!.drawImage(canvas, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.82));
    return { blocks: [{ t: 'img', blob, w: c.width, h: c.height, em: 0, mask: false, kind: 'scan', page: pageNo, alt: `Scanned page ${pageNo}` }], failed: false };
  } catch (e) {
    console.warn('page not read', pageNo, e);
    return { blocks: [], failed: true };
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
  }
}

/** Where finished pages are kept as they are read, so that nothing is lost when the app is closed or the phone locks. */
export interface PageStore {
  load(page: number): Promise<LBlock[] | undefined>;
  save(page: number, blocks: LBlock[]): Promise<void>;
}

/**
 * Reads a whole picture-only PDF page by page, without first building the Liquid view of it. Every finished page is
 * saved straight away, so a restart carries on from where it stopped. A page that fails is tried again before it is
 * given up on. Returns the document's blocks, page markers included.
 */
export async function ocrPages(
  data: ArrayBuffer | Blob,
  onProgress?: (done: number, total: number) => void,
  store?: PageStore,
): Promise<{ blocks: LBlock[]; chars: number; failedPages: number[] }> {
  const { openPdf, openPdfBlob, renderPage } = await import('./formats/pdf');
  const { OCR_POOL } = await import('./ocr');
  const pdf = data instanceof Blob ? await openPdfBlob(data) : await openPdf(data);
  const total = pdf.numPages;
  const per: LBlock[][] = new Array(total);
  const failed: number[] = [];
  let n = 0;
  try {
    const todo: number[] = [];
    for (let pn = 1; pn <= total; pn++) {
      const have = await store?.load(pn);
      if (have) {
        per[pn - 1] = have;
        n++;
      } else todo.push(pn);
    }
    onProgress?.(n, total);
    const pass = async (pages: number[], isRetry: boolean) => {
      await mapLimit(pages, OCR_POOL, async (pn) => {
        const r = await readPdfPage(pdf, pn, renderPage);
        if (r.failed) {
          if (!isRetry) failed.push(pn);
          else per[pn - 1] = []; // gave up: the page stays empty and is reported
          return;
        }
        per[pn - 1] = r.blocks;
        await store?.save(pn, r.blocks);
        onProgress?.(++n, total);
        await breathe(40); // a breath, so the rest of the app stays quick
      });
    };
    await pass(todo, false);
    if (failed.length) {
      const again = failed.splice(0);
      await pass(again, true);
    }
  } finally {
    pdf.loadingTask.destroy();
  }
  const blocks: LBlock[] = [];
  const lost: number[] = [];
  let chars = 0;
  for (let i = 0; i < total; i++) {
    const bs = per[i] ?? [];
    if (!bs.length) lost.push(i + 1);
    blocks.push({ t: 'page', page: i + 1 }, ...bs);
    for (const x of bs) if (x.t === 'p' || x.t === 'h') chars += x.html.length;
  }
  return { blocks, chars, failedPages: lost };
}

/**
 * Reads the scanned pages of a mixed PDF (the picture-only pages found by Liquid mode) and puts the result in their
 * place: text and headings where there is writing, pictures where there are diagrams. A page that has nothing
 * readable keeps its picture. Pages are drawn again from the PDF at a size made for reading, not the preview size.
 */
export async function ocrBlocks(data: ArrayBuffer, blocks: LBlock[], onProgress?: (done: number, total: number) => void): Promise<{ blocks: LBlock[]; chars: number }> {
  const { openPdf, renderPage } = await import('./formats/pdf');
  const { OCR_POOL } = await import('./ocr');
  const pics = blocks.filter((b): b is Extract<LBlock, { t: 'img' }> => b.t === 'img' && b.kind === 'scan');
  const pdf = await openPdf(data.slice(0));
  let n = 0;
  let results: LBlock[][] = [];
  try {
    results = await mapLimit(pics, OCR_POOL, async (b) => {
      const r = await readPdfPage(pdf, b.page, renderPage);
      onProgress?.(++n, pics.length);
      return r.failed ? [b] : r.blocks; // a page that could not be read keeps its picture
    });
  } finally {
    pdf.loadingTask.destroy();
  }
  const out: LBlock[] = [];
  let k = 0;
  let chars = 0;
  for (const b of blocks) {
    if (b.t === 'img' && b.kind === 'scan') {
      const r = results[k++];
      out.push(...r);
      for (const x of r) if (x.t === 'p' || x.t === 'h') chars += x.html.length;
    } else out.push(b);
  }
  return { blocks: out, chars };
}

/**
 * Pictures inside an ordinary document: some are really pages of writing (a screenshot, a pasted scan), others are
 * diagrams or photos. Look at each one with the same layout step; writing becomes text, anything else stays a picture.
 */
export async function triageFigures(blocks: LBlock[], onProgress?: (done: number, total: number) => void): Promise<{ blocks: LBlock[]; changed: number }> {
  type Img = Extract<LBlock, { t: 'img' }>;
  const isPic = (b: LBlock): b is Img => b.t === 'img' && b.kind === 'figure' && !b.mask;
  // a picture of writing is often cut into several strips when the page is made reflowable: look at neighbours together
  const groups: Img[][] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!isPic(b)) continue;
    const g = [b];
    while (i + 1 < blocks.length && isPic(blocks[i + 1]) && (blocks[i + 1] as Img).page === b.page) g.push(blocks[++i] as Img);
    if (g.reduce((a, x) => a + x.h, 0) >= 60 && Math.max(...g.map((x) => x.w)) >= 300) groups.push(g);
  }
  let n = 0;
  let changed = 0;
  const replace = new Map<Img, LBlock[] | null>(); // first picture of a group → what replaces the group
  const drop = new Set<Img>();
  for (const g of groups) {
    onProgress?.(++n, groups.length);
    try {
      const W = Math.max(...g.map((x) => x.w));
      const bmps = await Promise.all(g.map((x) => createImageBitmap(x.blob)));
      const gap = 14;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = bmps.reduce((a, m) => a + m.height + gap, 0);
      const cx = c.getContext('2d')!;
      cx.fillStyle = '#fff';
      cx.fillRect(0, 0, c.width, c.height);
      let y = 0;
      for (const m of bmps) {
        cx.drawImage(m, 0, y);
        y += m.height + gap;
        m.close();
      }
      const flat = await flattenSource(c, 2000);
      const leaves = await segmentPage(flat);
      const area = (l: Leaf) => (l.x1 - l.x0) * (l.y1 - l.y0);
      const total = leaves.reduce((a, l) => a + area(l), 0) || 1;
      const textArea = leaves.filter((l) => l.kind === 'text').reduce((a, l) => a + area(l), 0);
      const pics = leaves.filter((l) => l.kind !== 'text').reduce((a, l) => a + area(l), 0);
      // mostly lines of writing and hardly any drawing: worth reading
      if (textArea / total < 0.6 || pics / total > 0.3) continue;
      const out = await ocrPage(c, g[0].page);
      const chars = out.blocks.reduce((a, x) => a + (x.t === 'p' || x.t === 'h' ? x.html.length : 0), 0);
      if (chars >= 60 && out.blocks.some((x) => x.t === 'p')) {
        replace.set(g[0], out.blocks);
        g.slice(1).forEach((x) => drop.add(x));
        changed++;
      }
    } catch (e) {
      console.warn('picture not read', e);
    }
    await slice(0);
  }
  if (!changed) return { blocks, changed: 0 };
  return { blocks: blocks.flatMap((b) => (b.t === 'img' && drop.has(b) ? [] : b.t === 'img' && replace.get(b) ? replace.get(b)! : [b])), changed };
}
