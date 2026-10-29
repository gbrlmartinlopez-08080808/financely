import type { DocKind } from '../types';

const EXT: Record<string, DocKind> = {
  pdf: 'pdf',
  epub: 'epub',
  docx: 'docx',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  txt: 'text',
  text: 'text',
  log: 'text',
  nfo: 'text',
  csv: 'sheet',
  tsv: 'sheet',
  xlsx: 'sheet',
  xls: 'sheet',
  ods: 'sheet',
  numbers: 'sheet',
  pptx: 'slides',
  odp: 'slides',
  odt: 'odt',
  rtf: 'rtf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  avif: 'image',
  svg: 'image',
  heic: 'image',
  mp3: 'audio',
  m4a: 'audio',
  wav: 'audio',
  ogg: 'audio',
  oga: 'audio',
  flac: 'audio',
  aac: 'audio',
  opus: 'audio',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  mkv: 'video',
  m4v: 'video',
};

const CODE = new Set(
  'js mjs cjs ts tsx jsx json jsonc py rb go rs java kt kts c h cpp hpp cc cs swift php sh bash zsh fish ps1 sql yaml yml toml ini cfg conf xml css scss less lua r m pl dart scala hs ex exs clj vue svelte tex bib gradle properties env dockerfile makefile'.split(
    ' ',
  ),
);

export function extOf(name: string) {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export function detectKind(name: string, mime: string, head?: Uint8Array): DocKind {
  const ext = extOf(name);
  if (EXT[ext]) return EXT[ext];
  if (CODE.has(ext) || /^(dockerfile|makefile)$/i.test(name)) return 'code';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/epub+zip') return 'epub';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.includes('wordprocessingml')) return 'docx';
  if (mime.includes('spreadsheet') || mime === 'text/csv') return 'sheet';
  if (mime.includes('presentation')) return 'slides';
  if (mime === 'text/markdown') return 'markdown';
  if (mime === 'text/html') return 'html';
  if (head) {
    const sig = String.fromCharCode(...head.slice(0, 5));
    if (sig === '%PDF-') return 'pdf';
    if (head[0] === 0x89 && head[1] === 0x50) return 'image';
    if (head[0] === 0xff && head[1] === 0xd8) return 'image';
    if (sig.startsWith('{\\rtf')) return 'rtf';
    if (looksLikeText(head)) return 'text';
  }
  if (mime.startsWith('text/')) return 'text';
  return 'unknown';
}

export function looksLikeText(bytes: Uint8Array) {
  const n = Math.min(bytes.length, 4096);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) bad++;
  }
  return bad / Math.max(1, n) < 0.02;
}

export const KIND_LABEL: Record<DocKind, string> = {
  pdf: 'pdf',
  epub: 'epub',
  docx: 'word',
  markdown: 'markdown',
  html: 'web page',
  text: 'text',
  code: 'code',
  sheet: 'sheet',
  slides: 'slides',
  odt: 'odt',
  rtf: 'rtf',
  image: 'image',
  audio: 'audio',
  video: 'video',
  scan: 'scan',
  unknown: 'file',
};

export const titleFromFile = (name: string) =>
  name
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || name;
