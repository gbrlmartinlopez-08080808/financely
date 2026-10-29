// On-device OCR (Tesseract, English model bundled in the app — no network needed).
import { escapeHtml } from './sanitize';

type Worker = import('tesseract.js').Worker;
let workerP: Promise<Worker> | null = null;
let progressCb: ((p: number, status: string) => void) | null = null;

async function getWorker() {
  if (!workerP) {
    workerP = (async () => {
      const { createWorker } = await import('tesseract.js');
      const base = new URL('./ocr/', document.baseURI).href;
      return createWorker('eng', 1, {
        workerPath: base + 'worker.min.js',
        corePath: base,
        langPath: base,
        gzip: false,
        workerBlobURL: false,
        logger: (m: { progress: number; status: string }) => progressCb?.(m.progress, m.status),
      });
    })();
    workerP.catch(() => (workerP = null));
  }
  return workerP;
}

export interface OcrWord {
  t: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface OcrResult {
  text: string;
  html: string;
  confidence: number;
  words: OcrWord[];
  w: number;
  h: number;
}

/** Recognise one image. Returns plain text and paragraph HTML. */
export async function recognize(img: Blob | HTMLCanvasElement, onProgress?: (p: number, status: string) => void): Promise<OcrResult> {
  progressCb = onProgress ?? null;
  const w = await getWorker();
  const { data } = await w.recognize(img as Blob, {}, { text: true, blocks: true });
  progressCb = null;
  const words: OcrWord[] = [];
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
  const html = paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
  return { text: paras.join('\n\n'), html, confidence: data.confidence, words, w: iw, h: ih };
}

/** Light pre-processing for photos of paper: grayscale + contrast stretch, max 2400px. */
export async function prepareScan(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const id = ctx.getImageData(0, 0, c.width, c.height);
  const d = id.data;
  let lo = 255;
  let hi = 0;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    hist[l]++;
  }
  const n = d.length / 4;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc > n * 0.02) {
      lo = i;
      break;
    }
  }
  acc = 0;
  for (let i = 255; i >= 0; i--) {
    acc += hist[i];
    if (acc > n * 0.05) {
      hi = i;
      break;
    }
  }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = Math.max(0, Math.min(255, ((l - lo) / span) * 255));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(id, 0, 0);
  return new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
}
