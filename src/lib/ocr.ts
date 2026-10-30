// On-device OCR (Tesseract, English model bundled in the app — no network needed).
import { escapeHtml } from './sanitize';

type Worker = import('tesseract.js').Worker;

// A small pool: phones with enough cores and memory read two pages at once, the rest read one. Workers run off the
// main thread, so reading never freezes the screen.
const cores = navigator.hardwareConcurrency ?? 4;
const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
// how many pages are read at once: more on phones with the cores and memory for it (each reader takes about 150 MB)
const POOL = cores >= 8 && mem >= 6 ? 3 : cores >= 4 && mem >= 3 ? 2 : 1;
export const OCR_POOL = POOL;
interface Slot {
  p: Promise<Worker>;
  cb: ((p: number, status: string) => void) | null;
  busy: boolean;
  psm?: number;
}
const slots: Slot[] = [];
const waiters: ((s: Slot) => void)[] = [];

function makeSlot(): Slot {
  const slot: Slot = { cb: null, busy: true, p: null as unknown as Promise<Worker> };
  slot.p = (async () => {
    const { createWorker } = await import('tesseract.js');
    const base = new URL('./ocr/', document.baseURI).href;
    const w = await createWorker('eng', 1, {
      workerPath: base + 'worker.min.js',
      corePath: base,
      langPath: base,
      gzip: false,
      cacheMethod: 'none', // the model ships inside the app: no second copy in storage, and no stale one
      workerBlobURL: false,
      logger: (m: { progress: number; status: string }) => slot.cb?.(m.progress, m.status),
    });
    // no second "inverted" pass (we flip dark pages ourselves) and a sane dpi for photos: faster and steadier
    await w.setParameters({ tessedit_do_invert: '0', user_defined_dpi: '300' }).catch(() => {});
    return w;
  })();
  return slot;
}
async function acquire(): Promise<Slot> {
  const free = slots.find((s) => !s.busy);
  if (free) {
    free.busy = true;
    return free;
  }
  if (slots.length < POOL) {
    const s = makeSlot();
    slots.push(s);
    return s;
  }
  return new Promise((res) => waiters.push(res));
}
function release(s: Slot) {
  const next = waiters.shift();
  if (next) next(s);
  else s.busy = false;
}

export interface OcrWord {
  t: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface OcrLine {
  text: string;
  conf: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface OcrResult {
  lines: OcrLine[];
  text: string;
  html: string;
  confidence: number;
  words: OcrWord[];
  w: number;
  h: number;
}

/** Tesseract sometimes calls every line a paragraph: glue lines back together when a sentence plainly continues. */
export function mergeParas(paras: string[]): string[] {
  const out: string[] = [];
  for (const p of paras) {
    const prev = out[out.length - 1];
    if (prev && !/[.!?:;"”’)\]]$/.test(prev) && /^[\p{Ll}\d(“"‘']/u.test(p)) out[out.length - 1] = `${prev} ${p}`;
    else out.push(p);
  }
  return out;
}

/** Recognise one image. Returns plain text and paragraph HTML. */
/** `psm`: 3 = find the layout itself (default), 6 = one block of text, 7 = one line. */
export async function recognize(img: Blob | HTMLCanvasElement, onProgress?: (p: number, status: string) => void, psm = 3): Promise<OcrResult> {
  const slot = await acquire();
  let data: Awaited<ReturnType<Worker['recognize']>>['data'];
  try {
    slot.cb = onProgress ?? null;
    const w = await slot.p;
    if (slot.psm !== psm) {
      await w.setParameters({ tessedit_pageseg_mode: String(psm) as never });
      slot.psm = psm;
    }
    ({ data } = await w.recognize(img as Blob, {}, { text: true, blocks: true }));
  } catch (e) {
    // a worker that failed to start must not stay in the pool
    const i = slots.indexOf(slot);
    if (i >= 0) slots.splice(i, 1);
    throw e;
  } finally {
    slot.cb = null;
    if (slots.includes(slot)) release(slot);
    else {
      const next = waiters.shift();
      if (next) {
        const s = makeSlot();
        slots.push(s);
        next(s);
      }
    }
  }
  const words: OcrWord[] = [];
  const lines: OcrLine[] = [];
  for (const b of data.blocks ?? [])
    for (const p of b.paragraphs ?? [])
      for (const l of p.lines ?? []) if (l.text.trim()) lines.push({ text: l.text.replace(/\s+/g, ' ').trim(), conf: l.confidence, x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1 });
  for (const b of data.blocks ?? [])
    for (const p of b.paragraphs ?? [])
      for (const l of p.lines ?? [])
        for (const wd of l.words ?? []) if (wd.text.trim() && wd.confidence > 25) words.push({ t: wd.text, x0: wd.bbox.x0, y0: wd.bbox.y0, x1: wd.bbox.x1, y1: wd.bbox.y1 });
  let iw = 0;
  let ih = 0;
  if (img instanceof Blob) {
    const bmp = await createImageBitmap(img);
    iw = bmp.width;
    ih = bmp.height;
    bmp.close();
  } else {
    iw = img.width;
    ih = img.height;
  }
  const paras: string[] = [];
  for (const b of data.blocks ?? []) for (const p of b.paragraphs ?? []) {
    const t = p.lines
      .map((l) => l.text.trim())
      .join(' ')
      .replace(/(\w)- (\w)/g, '$1$2')
      .replace(/\s+/g, ' ')
      .trim();
    if (t) paras.push(t);
  }
  if (!paras.length && data.text.trim()) paras.push(...data.text.split(/\n\s*\n/).map((t) => t.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean));
  paras.splice(0, paras.length, ...mergeParas(paras));
  const html = paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
  return { lines, text: paras.join('\n\n'), html, confidence: data.confidence, words, w: iw, h: ih };
}

/**
 * Gets a photo or page ready for reading: grayscale, uneven lighting evened out (a shadow across a page no longer
 * turns half of it grey), dark-mode screenshots flipped to dark-on-light, contrast stretched, size kept in a range
 * where the letters are big enough to read but the page isn't slow (small pictures are enlarged a little).
 */
export async function prepareCanvas(blob: Blob, maxSide = 2400): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  const out = await flattenSource(bmp, maxSide);
  bmp.close();
  return out;
}

/** The same preparation for anything already drawn (a rendered PDF page, a canvas). */
let sliceAt = 0;
const chan = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
const turns: (() => void)[] = [];
if (chan) chan.port1.onmessage = () => turns.shift()?.();
/** A turn for the screen without a timer (timers are slowed to a crawl when the app is in the background; messages are not). */
const turn = () =>
  new Promise<void>((resolve) => {
    if (!chan) return void setTimeout(resolve, 0);
    turns.push(resolve); // several pages can be waiting at once: each message frees the oldest one
    chan.port2.postMessage(0);
  });
/** Gives the screen a turn if the current stretch of work has been running a while (keeps the app smooth while it reads). */
export async function slice(ms = 9) {
  if (document.hidden) return; // nobody is looking: just get on with it
  const now = performance.now();
  if (!sliceAt) sliceAt = now;
  if (now - sliceAt > ms) {
    await turn();
    sliceAt = performance.now();
  }
}
/** A short pause between pages while the app is on screen (none when it is in the background). */
export const breathe = (ms = 40) => (document.hidden ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, ms)));

export async function flattenSource(bmp: { width: number; height: number } & CanvasImageSource, maxSide = 2400): Promise<HTMLCanvasElement> {
  const longest = Math.max(bmp.width, bmp.height);
  const scale = longest > maxSide ? maxSide / longest : longest < 1400 ? Math.min(1.6, 1800 / longest) : 1;
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  const n = w * h;
  const gray = new Uint8ClampedArray(n);
  let sum = 0;
  for (let y0 = 0; y0 < h; y0 += 96) {
    const y1 = Math.min(h, y0 + 96);
    for (let j = y0 * w, i = j * 4; j < y1 * w; i += 4, j++) {
      const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
      gray[j] = l;
      sum += l;
    }
    await slice();
  }
  // a dark page with light letters: flip it
  if (sum / n < 105) for (let j = 0; j < n; j++) gray[j] = 255 - gray[j];

  // a blurred, much smaller copy tells us how bright the paper is around each spot
  const bw = Math.max(8, Math.round(w / 28));
  const bh = Math.max(8, Math.round(h / 28));
  const g = document.createElement('canvas');
  g.width = w;
  g.height = h;
  const gctx = g.getContext('2d')!;
  const gid = gctx.createImageData(w, h);
  for (let y0 = 0; y0 < h; y0 += 128) {
    const y1 = Math.min(h, y0 + 128);
    for (let j = y0 * w, i = j * 4; j < y1 * w; i += 4, j++) gid.data[i] = gid.data[i + 1] = gid.data[i + 2] = gray[j], (gid.data[i + 3] = 255);
    await slice();
  }
  gctx.putImageData(gid, 0, 0);
  const small = document.createElement('canvas');
  small.width = bw;
  small.height = bh;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(g, 0, 0, bw, bh);
  const sm = sctx.getImageData(0, 0, bw, bh).data;
  // paper level near each cell = the brightest of its neighbours (ink only pulls a cell's average down)
  const bg = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(bw - 1, Math.max(0, x + dx));
          const yy = Math.min(bh - 1, Math.max(0, y + dy));
          m = Math.max(m, sm[(yy * bw + xx) * 4]);
        }
      bg[y * bw + x] = Math.max(40, m);
    }
  // bilinear lookup of that level for every pixel
  const out = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(bh - 1.001, Math.max(0, (y + 0.5) * (bh / h) - 0.5));
    const y0 = fy | 0;
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1.001, Math.max(0, (x + 0.5) * (bw / w) - 0.5));
      const x0 = fx | 0;
      const tx = fx - x0;
      const a = bg[y0 * bw + x0] * (1 - tx) + bg[y0 * bw + x0 + 1] * tx;
      const b = bg[(y0 + 1) * bw + x0] * (1 - tx) + bg[(y0 + 1) * bw + x0 + 1] * tx;
      const level = a * (1 - ty) + b * ty;
      const v = Math.min(255, (gray[y * w + x] / level) * 250);
      out[y * w + x] = v;
      hist[v | 0]++;
    }
    if ((y & 63) === 63) await slice();
  }
  // finish with a gentle stretch so the ink is properly dark
  let lo = 0;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc > n * 0.015) {
      lo = i;
      break;
    }
  }
  const span = Math.max(40, 245 - lo);
  for (let y0 = 0; y0 < h; y0 += 128) {
    const y1 = Math.min(h, y0 + 128);
    for (let j = y0 * w, i = j * 4; j < y1 * w; i += 4, j++) {
      const v = Math.max(0, Math.min(255, ((out[j] - lo) / span) * 255));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    await slice();
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

/** Prepare a photo or page and read it. The one call for everything that reads in the background. */
export async function readImage(blob: Blob, onProgress?: (p: number, status: string) => void): Promise<OcrResult> {
  const c = await prepareCanvas(blob);
  return recognize(c, onProgress);
}

/** Same preparation, as a picture file (kept for the scanner, which stores the cleaned pages). */
export async function prepareScan(blob: Blob): Promise<Blob> {
  const c = await prepareCanvas(blob);
  return new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
}
