// What a file is, and a cover for it (the same kinds the phone knows).
export type Kind = 'fr' | 'pdf' | 'epub' | 'docx' | 'markdown' | 'html' | 'text' | 'code' | 'sheet' | 'slides' | 'odt' | 'rtf' | 'image' | 'audio' | 'video' | 'scan' | 'unknown';

const BY_EXT: Record<string, Kind> = {
  fr: 'fr', pdf: 'pdf', epub: 'epub', docx: 'docx', doc: 'docx', md: 'markdown', markdown: 'markdown', txt: 'text', text: 'text',
  html: 'html', htm: 'html', csv: 'sheet', tsv: 'sheet', xlsx: 'sheet', xls: 'sheet', ods: 'sheet', pptx: 'slides', odt: 'odt', rtf: 'rtf',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', svg: 'image', bmp: 'image', avif: 'image',
  mp3: 'audio', m4a: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio', aac: 'audio', mp4: 'video', webm: 'video', mov: 'video', mkv: 'video',
  js: 'code', ts: 'code', tsx: 'code', jsx: 'code', py: 'code', java: 'code', c: 'code', cpp: 'code', h: 'code', cs: 'code', go: 'code', rs: 'code',
  rb: 'code', php: 'code', swift: 'code', kt: 'code', json: 'code', xml: 'code', yml: 'code', yaml: 'code', sh: 'code', css: 'code', sql: 'code', tex: 'code',
};
const MIME: Record<string, string> = {
  fr: 'application/x-frogity',
  pdf: 'application/pdf', epub: 'application/epub+zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown', txt: 'text/plain', html: 'text/html', htm: 'text/html', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm',
};
export const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');
export const kindOf = (name: string, type = ''): Kind => BY_EXT[extOf(name)] ?? (type.startsWith('image/') ? 'image' : type.startsWith('audio/') ? 'audio' : type.startsWith('video/') ? 'video' : type.startsWith('text/') ? 'text' : 'unknown');
export const mimeOf = (name: string, type = '') => type || MIME[extOf(name)] || 'application/octet-stream';
export const titleOf = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || name;

export const KIND_LABEL: Record<string, string> = {
  fr: 'Frogity', pdf: 'PDF', epub: 'EPUB', docx: 'Word', markdown: 'Markdown', html: 'Web page', text: 'Text', code: 'Code', sheet: 'Sheet', slides: 'Slides',
  odt: 'ODT', rtf: 'RTF', image: 'Image', audio: 'Audio', video: 'Video', scan: 'Scan', unknown: 'File',
};
/** kinds the computer can edit as text */
export const EDITABLE = new Set(['fr', 'markdown', 'text', 'html', 'docx', 'code']);

const PALETTE = [
  ['#1f3d2b', '#c8f169'],
  ['#2a2240', '#f5b8ff'],
  ['#3b2312', '#ffcf7a'],
  ['#102a3a', '#7ad7ff'],
  ['#3a1020', '#ff9aa8'],
  ['#202020', '#e8e3d5'],
];
/** A typographic cover, like the phone draws for books without one. */
export async function makeCover(title: string, kind: string, author?: string): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = 300;
  c.height = 420;
  const x = c.getContext('2d')!;
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = PALETTE[h % PALETTE.length];
  x.fillStyle = bg;
  x.fillRect(0, 0, 300, 420);
  x.fillStyle = fg;
  x.font = '600 13px ui-monospace, monospace';
  x.fillText((KIND_LABEL[kind] ?? 'File').toUpperCase(), 24, 40);
  x.font = '600 30px Georgia, serif';
  const words = title.split(/\s+/);
  let line = '';
  let y = 120;
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (x.measureText(t).width > 252 && line) {
      x.fillText(line, 24, y);
      y += 38;
      line = w;
      if (y > 330) break;
    } else line = t;
  }
  if (y <= 330) x.fillText(line, 24, y);
  if (author) {
    x.font = '15px ui-monospace, monospace';
    x.fillText(author.slice(0, 30), 24, 390);
  }
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.86));
}

/** The first page of a PDF as its cover. */
export async function pdfCover(bytes: Uint8Array): Promise<{ cover: Blob; pages: number; title?: string; author?: string } | null> {
  try {
    const { openPdf, renderPage } = await import('./pdf');
    const doc = await openPdf(bytes);
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const canvas = await renderPage(page, 300 / vp.width);
    const cover = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.82));
    const info = (await doc.getMetadata().catch(() => null))?.info as { Title?: string; Author?: string } | undefined;
    const out = { cover, pages: doc.numPages, title: info?.Title?.trim() || undefined, author: info?.Author?.trim() || undefined };
    void doc.loadingTask.destroy();
    return out;
  } catch {
    return null;
  }
}
