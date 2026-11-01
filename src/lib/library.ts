import * as db from './db';
import { detectKind, titleFromFile } from './formats/detect';
import { drawPixel, KIND_PIXEL } from './pixels';
import { saveDoc, getState } from './store';
import type { DocKind, DocMeta, LiquidDoc } from './types';

export type Content =
  | { type: 'pdf'; blob: Blob }
  | { type: 'flow'; liquid: LiquidDoc }
  | { type: 'sheet'; sheets: { name: string; rows: string[][] }[] }
  | { type: 'image'; url: string; blob: Blob }
  | { type: 'media'; url: string; kind: 'audio' | 'video' }
  | { type: 'code'; text: string; ext: string }
  | { type: 'binary'; size: number; hex: string };

// ------------------------------------------------------------------ covers

const COVER_W = 360;
const COVER_H = 520;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const PALETTES = [
  { bg: '#f4f3ef', ink: '#141414', sub: '#8b8a86' },
  { bg: '#151515', ink: '#f1f0ec', sub: '#7d7c78' },
  { bg: '#dcd9d2', ink: '#151515', sub: '#6f6d68' },
  { bg: '#e9e4d8', ink: '#2b2a26', sub: '#8d877a' },
  { bg: '#cfd4cf', ink: '#1c1f1c', sub: '#6b726b' },
  { bg: '#d6d9df', ink: '#191b20', sub: '#6c707a' },
];

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
    if (lines.length >= maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…';
  return lines;
}

/** A typographic cover for files that do not carry one. */
export async function generatedCover(title: string, kind: DocKind, author?: string): Promise<Blob> {
  await document.fonts.ready;
  const c = document.createElement('canvas');
  c.width = COVER_W;
  c.height = COVER_H;
  const ctx = c.getContext('2d')!;
  const h = hash(title);
  const pal = PALETTES[h % PALETTES.length];
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, COVER_W, COVER_H);
  // dotted grid
  ctx.fillStyle = pal.sub;
  ctx.globalAlpha = 0.28;
  for (let y = 24; y < COVER_H; y += 16) for (let x = 24; x < COVER_W; x += 16) ctx.fillRect(x, y, 1.5, 1.5);
  ctx.globalAlpha = 1;
  // big pixel glyph
  ctx.fillStyle = pal.ink;
  drawPixel(ctx, KIND_PIXEL[kind] ?? 'block', 30, 34, 44);
  // label
  ctx.font = '500 13px "JetBrains Mono", monospace';
  ctx.fillStyle = pal.sub;
  ctx.textBaseline = 'top';
  ctx.fillText(`.${kind}`, COVER_W - 30 - ctx.measureText(`.${kind}`).width, 40);
  // title near the top so it peeks out of the acrylic pocket
  ctx.fillStyle = pal.ink;
  ctx.font = '700 34px "JetBrains Mono", monospace';
  const lines = wrap(ctx, title.toLowerCase(), COVER_W - 60, 4);
  let y = 104;
  for (const l of lines) {
    ctx.fillText(l, 30, y);
    y += 40;
  }
  ctx.font = '400 13px "JetBrains Mono", monospace';
  ctx.fillStyle = pal.sub;
  ctx.fillText(author ? author.slice(0, 34) : '— frogity', 30, COVER_H - 46);
  return new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
}

async function imageCover(blob: Blob): Promise<Blob | undefined> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return await new Promise((r) => c.toBlob((b) => r(b ?? undefined), 'image/jpeg', 0.85));
  } catch {
    return undefined;
  }
}

/** Biggest picture inside an Office file (DOCX → word/media, PPTX → ppt/media). */
async function officeCover(buf: ArrayBuffer, folder: string): Promise<Blob | undefined> {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buf);
    const files = Object.values(zip.files).filter((f) => f.name.startsWith(folder) && /\.(png|jpe?g|webp|gif)$/i.test(f.name) && !f.dir);
    let best: { f: (typeof files)[number]; size: number } | null = null;
    for (const f of files) {
      const size = (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
      if (!best || size > best.size) best = { f, size };
    }
    if (!best || best.size < 25_000) return undefined;
    const blob = await best.f.async('blob');
    return imageCover(new Blob([blob], { type: /png$/i.test(best.f.name) ? 'image/png' : 'image/jpeg' }));
  } catch {
    return undefined;
  }
}

export async function refreshCover(doc: DocMeta): Promise<boolean> {
  const f = await getFile(doc.id);
  if (!f) return false;
  const buf = await f.arrayBuffer();
  let cover: Blob | undefined;
  if (doc.kind === 'pdf') cover = (await (await import('./formats/pdf')).pdfCover(buf)).cover ?? undefined;
  else if (doc.kind === 'docx') cover = await officeCover(buf, 'word/media/');
  else if (doc.kind === 'slides') cover = await officeCover(buf, 'ppt/media/');
  if (!cover) cover = await generatedCover(doc.name, doc.kind, doc.author);
  const coverId = `${doc.id}:cover-${Date.now()}`;
  await db.put('blobs', coverId, cover);
  if (doc.coverId) await db.del('blobs', doc.coverId);
  const { patchDoc } = await import('./store');
  await patchDoc(doc.id, { coverId, coverV: COVER_V });
  return true;
}

/** Save pasted text as a note. */
export async function importText(text: string, title?: string): Promise<DocMeta> {
  const first = text.trim().split('\n').find((l) => l.trim()) ?? 'Note';
  const t = (title?.trim() || first.replace(/^#+\s*/, '').slice(0, 60)) || 'Note';
  const md = /^\s*#|\*\*|\$\$|^- /m.test(text);
  return importFile(new Blob([text], { type: md ? 'text/markdown' : 'text/plain' }), `${t.replace(/[\\/:*?"<>|]+/g, '')}.${md ? 'md' : 'txt'}`, { title: t });
}

// ------------------------------------------------------------------ import

export const COVER_V = 2;

export interface Extracted {
  title: string;
  author?: string;
  pages?: number;
  cover?: Blob;
}

/** Title, author, page count and a cover from the file itself (falls back gracefully per format). */
export async function extractMeta(file: Blob, name: string, kind: DocKind, titleHint?: string): Promise<Extracted> {
  const buf = await file.arrayBuffer();
  let title = titleHint ?? titleFromFile(name);
  let author: string | undefined;
  let pages: number | undefined;
  let cover: Blob | undefined;
  try {
    if (kind === 'pdf') {
      const { pdfCover } = await import('./formats/pdf');
      const r = await pdfCover(buf);
      cover = r.cover ?? undefined;
      pages = r.pages;
      if (r.title && !titleHint) title = r.title;
      author = r.author;
    } else if (kind === 'epub') {
      const { epubMeta } = await import('./formats/flow');
      const r = await epubMeta(buf);
      if (r.title && !titleHint) title = r.title;
      author = r.author;
      if (r.cover) cover = await imageCover(r.cover);
    } else if (kind === 'image' || kind === 'scan') {
      cover = await imageCover(file);
    } else if (kind === 'docx') cover = await officeCover(buf, 'word/media/');
    else if (kind === 'slides') cover = await officeCover(buf, 'ppt/media/');
  } catch (e) {
    console.warn('metadata failed', e);
  }
  return { title, author, pages, cover };
}

export async function importFile(file: Blob, name: string, opts: { kind?: DocKind; title?: string; author?: string; cover?: Blob; open?: boolean } = {}): Promise<DocMeta> {
  // no copies of the file in memory: the blob is stored as it is, and only its first bytes are looked at
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const kind = opts.kind ?? detectKind(name, file.type, head);
  const id = db.uid();
  const mime = file.type || mimeFor(kind, name);
  const blob = file.type === mime ? file : file.slice(0, file.size, mime);
  const saved = db.put('files', id, blob);
  // a cover that came with the book (a catalogue thumbnail) means the slow part, opening the file to draw one, can wait:
  // the real cover is drawn later in the background (see upgradeCovers)
  const quick = !!opts.cover && !!opts.title && ['pdf', 'epub'].includes(kind);
  const x = quick ? { title: opts.title!, author: opts.author, pages: undefined as number | undefined, cover: opts.cover } : await extractMeta(blob, name, kind, opts.title);
  const cover = x.cover ?? (await generatedCover(x.title, kind, x.author));
  const coverId = id + ':cover';
  await Promise.all([saved, db.put('blobs', coverId, cover)]);
  const now = Date.now();
  const meta: DocMeta = {
    id,
    name: x.title,
    fileName: name,
    kind,
    mime,
    size: file.size,
    addedAt: now,
    openedAt: now,
    progress: 0,
    pages: x.pages,
    author: x.author ?? opts.author,
    coverId,
    coverV: quick && kind === 'pdf' ? 1 : COVER_V,
    readMs: 0,
  };
  await saveDoc(meta);
  if (quick && kind === 'pdf') setTimeout(() => upgradeCovers(), 4000);
  return meta;
}

function mimeFor(kind: DocKind, name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    epub: 'application/epub+zip',
    md: 'text/markdown',
    txt: 'text/plain',
    html: 'text/html',
    csv: 'text/csv',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    mp4: 'video/mp4',
    webm: 'video/webm',
  };
  return (ext && map[ext]) || (kind === 'text' ? 'text/plain' : 'application/octet-stream');
}

export async function getFile(id: string): Promise<Blob | undefined> {
  const doc = getState().docs.find((d) => d.id === id);
  if (doc?.uri) {
    const { readLinked } = await import('./linked');
    return readLinked(doc);
  }
  return db.get<Blob>('files', id);
}

const blurCache = new Map<string, string>();
/** A tiny pre-blurred copy of the cover: gives the acrylic pocket its frosted look without a live blur filter. */
export async function blurredCoverUrl(meta: DocMeta): Promise<string | undefined> {
  if (!meta.coverId) return undefined;
  const hit = blurCache.get(meta.coverId);
  if (hit) return hit;
  const b = await db.get<Blob>('blobs', meta.coverId);
  if (!b) return undefined;
  try {
    const bmp = await createImageBitmap(b);
    const w = 48;
    const h = Math.max(8, Math.round((w * bmp.height) / bmp.width));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.filter = 'blur(1.5px)';
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.7));
    if (!blob) return undefined;
    const u = URL.createObjectURL(blob);
    blurCache.set(meta.coverId, u);
    return u;
  } catch {
    return undefined;
  }
}

const coverCache = new Map<string, string>();
const arCache = new Map<string, number>();

/** Cover URL plus its true aspect ratio (width / height), so the book holder can fit any cover without cropping. */
export async function coverInfo(meta: DocMeta): Promise<{ url: string; ar: number } | undefined> {
  const url = await coverUrl(meta);
  if (!url || !meta.coverId) return undefined;
  let ar = arCache.get(meta.coverId);
  if (ar === undefined) {
    const b = await db.get<Blob>('blobs', meta.coverId);
    try {
      const bmp = await createImageBitmap(b!);
      ar = bmp.width / bmp.height;
      bmp.close();
    } catch {
      ar = 0.72;
    }
    arCache.set(meta.coverId, ar);
  }
  return { url, ar };
}

/** Rebuild covers made by older versions of the cover logic (one at a time, in the background). */
let upgrading = false;
export async function upgradeCovers() {
  if (upgrading) return;
  upgrading = true;
  try {
    const stale = () => getState().docs.find((d) => (d.coverV ?? 1) < COVER_V && ['pdf', 'docx', 'slides'].includes(d.kind) && d.size < 120_000_000);
    for (let d = stale(); d; d = stale()) {
      await refreshCover(d).catch(() => patchDocQuiet(d.id));
      await new Promise((r) => setTimeout(r, 400));
    }
    // other kinds never used the changed logic
    for (const d of getState().docs.filter((x) => (x.coverV ?? 1) < COVER_V)) await patchDocQuiet(d.id);
  } finally {
    upgrading = false;
  }
}
async function patchDocQuiet(id: string) {
  const { patchDoc } = await import('./store');
  await patchDoc(id, { coverV: COVER_V });
}
export async function coverUrl(meta: DocMeta): Promise<string | undefined> {
  if (!meta.coverId) return undefined;
  const hit = coverCache.get(meta.coverId);
  if (hit) return hit;
  const b = await db.get<Blob>('blobs', meta.coverId);
  if (!b) return undefined;
  const u = URL.createObjectURL(b);
  coverCache.set(meta.coverId, u);
  return u;
}

// ------------------------------------------------------------------ load

export async function loadContent(meta: DocMeta): Promise<Content> {
  const blob = await getFile(meta.id);
  if (!blob) throw new Error('The file for this document is missing.');
  // a PDF is not read here at all: pdf.js reads just the parts it needs, straight from the file
  if (meta.kind === 'pdf') return { type: 'pdf', blob };
  const buf = await blob.arrayBuffer();
  const f = await import('./formats/flow');
  switch (meta.kind) {
    case 'epub':
      return { type: 'flow', liquid: await f.epubToLiquid(buf) };
    case 'docx':
      return { type: 'flow', liquid: await f.docxToLiquid(buf) };
    case 'markdown':
      return { type: 'flow', liquid: f.markdownToLiquid(buf) };
    case 'html':
      return { type: 'flow', liquid: f.htmlToLiquid(buf) };
    case 'text':
      return { type: 'flow', liquid: f.textToLiquid(buf) };
    case 'rtf':
      return { type: 'flow', liquid: f.rtfToLiquid(buf) };
    case 'odt':
      return { type: 'flow', liquid: await f.odtToLiquid(buf) };
    case 'slides':
      return { type: 'flow', liquid: await f.slidesToLiquid(buf, meta.fileName) };
    case 'scan': {
      const cached = await db.get<string>('cache', meta.id + ':ocr');
      const imgs = await Promise.all((meta.scanPages ?? []).map((p) => db.get<Blob>('blobs', p)));
      const urls = imgs.filter(Boolean).map((b) => URL.createObjectURL(b!));
      let html = cached ?? '';
      html += urls.map((u, i) => `<figure class="scanpage"><img src="${u}" alt="Page ${i + 1}"/><figcaption>scan · page ${i + 1}</figcaption></figure>`).join('');
      return { type: 'flow', liquid: f.finalize(html, urls) };
    }
    case 'sheet':
      return { type: 'sheet', sheets: await f.readSheets(buf, meta.fileName) };
    case 'image': {
      const url = URL.createObjectURL(blob);
      return { type: 'image', url, blob };
    }
    case 'audio':
    case 'video':
      return { type: 'media', url: URL.createObjectURL(blob), kind: meta.kind };
    case 'code':
      return { type: 'code', text: f.decodeText(buf), ext: meta.fileName.split('.').pop() ?? '' };
    default: {
      const bytes = new Uint8Array(buf.slice(0, 512));
      const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ');
      return { type: 'binary', size: buf.byteLength, hex };
    }
  }
}

export function docById(id: string) {
  return getState().docs.find((d) => d.id === id);
}

export function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d < 7) return `${d}d ago`;
  if (d < 60) return `${Math.floor(d / 7)}w ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
