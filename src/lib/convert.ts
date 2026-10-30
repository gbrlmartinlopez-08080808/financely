// Conversions between formats. Everything runs on-device.
import type { jsPDF as JsPDF } from 'jspdf';

export type Target = 'pdf' | 'txt' | 'md' | 'html' | 'png' | 'csv' | 'jpg';

// ------------------------------------------------------------------ helpers

async function fontB64(path: string) {
  const buf = await (await fetch(new URL(path, document.baseURI).href)).arrayBuffer();
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

let fontsP: Promise<Record<string, string>> | null = null;
const loadFonts = () =>
  (fontsP ??= (async () => ({
    r: await fontB64('./fonts/NotoSerif-Regular.ttf'),
    b: await fontB64('./fonts/NotoSerif-Bold.ttf'),
    i: await fontB64('./fonts/NotoSerif-Italic.ttf'),
    m: await fontB64('./fonts/NotoSansMono-Regular.ttf'),
  }))());

async function newPdf(): Promise<JsPDF> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const f = await loadFonts();
  doc.addFileToVFS('NS-R.ttf', f.r);
  doc.addFont('NS-R.ttf', 'NotoSerif', 'normal');
  doc.addFileToVFS('NS-B.ttf', f.b);
  doc.addFont('NS-B.ttf', 'NotoSerif', 'bold');
  doc.addFileToVFS('NS-I.ttf', f.i);
  doc.addFont('NS-I.ttf', 'NotoSerif', 'italic');
  doc.addFileToVFS('NM-R.ttf', f.m);
  doc.addFont('NM-R.ttf', 'NotoMono', 'normal');
  doc.setFont('NotoSerif', 'normal');
  return doc;
}

async function urlToImage(url: string): Promise<{ data: Uint8Array; w: number; h: number; fmt: 'PNG' | 'JPEG' } | null> {
  try {
    const blob = await (await fetch(url)).blob();
    const bmp = await createImageBitmap(blob);
    const w = bmp.width;
    const h = bmp.height;
    // re-encode to PNG/JPEG which jsPDF understands
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    const isPng = blob.type === 'image/png';
    const out = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), isPng ? 'image/png' : 'image/jpeg', 0.9));
    return { data: new Uint8Array(await out.arrayBuffer()), w, h, fmt: isPng ? 'PNG' : 'JPEG' };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ rich text → PDF

type Run =
  | { k: 'text'; text: string; style: 'normal' | 'bold' | 'italic'; mono?: boolean; script?: 'sup' | 'sub' }
  | { k: 'img'; url: string; emW: number; emH: number; emDrop: number };

function collectRuns(el: Node, style: 'normal' | 'bold' | 'italic' = 'normal', mono = false, script?: 'sup' | 'sub', out: Run[] = []): Run[] {
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n.textContent ?? '';
      if (t) out.push({ k: 'text', text: t, style, mono, script });
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const e = n as HTMLElement;
    const tag = e.tagName.toLowerCase();
    if (e.classList.contains('im')) {
      const st = e.style;
      const url = /url\(([^)]+)\)/.exec(st.getPropertyValue('--m'))?.[1];
      if (url) out.push({ k: 'img', url, emW: parseFloat(st.width), emH: parseFloat(st.height), emDrop: -parseFloat(st.verticalAlign) || 0 });
      return;
    }
    if (e.classList.contains('katex-mathml') || tag === 'math') {
      return;
    }
    if (e.classList.contains('katex')) {
      const tex = e.querySelector('annotation')?.textContent;
      if (tex) out.push({ k: 'text', text: tex, style: 'italic', mono, script });
      return;
    }
    if (tag === 'br') {
      out.push({ k: 'text', text: '\n', style, mono, script });
      return;
    }
    const s = tag === 'b' || tag === 'strong' ? 'bold' : tag === 'i' || tag === 'em' ? 'italic' : style;
    collectRuns(e, s, mono || tag === 'code', tag === 'sup' ? 'sup' : tag === 'sub' ? 'sub' : script, out);
  });
  return out;
}

interface Layout {
  doc: JsPDF;
  y: number;
  margin: number;
  width: number;
  pageH: number;
  imgCache: Map<string, Awaited<ReturnType<typeof urlToImage>>>;
}

function ensure(L: Layout, h: number) {
  if (L.y + h > L.pageH - L.margin) {
    L.doc.addPage();
    L.y = L.margin;
  }
}

async function drawRich(L: Layout, runs: Run[], size: number, opts: { indent?: number; lh?: number; color?: number } = {}) {
  const { doc } = L;
  const lh = size * (opts.lh ?? 1.45);
  const x0 = L.margin + (opts.indent ?? 0);
  const maxW = L.width - (opts.indent ?? 0);
  // tokenise into words keeping their style
  type Tok = { w: number; draw: (x: number, base: number) => void; space: boolean; nl?: boolean };
  const toks: Tok[] = [];
  for (const r of runs) {
    if (r.k === 'img') {
      const img = L.imgCache.get(r.url) ?? (await urlToImage(r.url));
      L.imgCache.set(r.url, img);
      const w = r.emW * size;
      const h = r.emH * size;
      toks.push({
        w,
        space: false,
        draw: (x, base) => {
          if (img) doc.addImage(img.data, img.fmt, x, base - h + r.emDrop * size, w, h, undefined, 'FAST');
        },
      });
      continue;
    }
    const fs = r.script ? size * 0.68 : size;
    const parts = r.text.replace(/\s+/g, (m) => (m.includes('\n') && r.text.trim() === '' ? '\n' : ' ')).split(/( |\n)/);
    for (const p of parts) {
      if (p === '\n') {
        toks.push({ w: 0, space: false, nl: true, draw: () => {} });
        continue;
      }
      if (p === ' ') {
        if (toks.length) toks[toks.length - 1].space = true;
        continue;
      }
      if (!p) continue;
      doc.setFont(r.mono ? 'NotoMono' : 'NotoSerif', r.mono ? 'normal' : r.style);
      doc.setFontSize(fs);
      const w = doc.getTextWidth(p);
      const font = r.mono ? 'NotoMono' : 'NotoSerif';
      const st = r.mono ? 'normal' : r.style;
      const shift = r.script === 'sup' ? -size * 0.33 : r.script === 'sub' ? size * 0.18 : 0;
      toks.push({
        w,
        space: false,
        draw: (x, base) => {
          doc.setFont(font, st);
          doc.setFontSize(fs);
          doc.text(p, x, base + shift);
        },
      });
    }
  }
  doc.setFontSize(size);
  doc.setFont('NotoSerif', 'normal');
  const spaceW = doc.getTextWidth(' ');
  let line: Tok[] = [];
  let lw = 0;
  const flush = () => {
    ensure(L, lh);
    let x = x0;
    const base = L.y + size;
    for (const t of line) {
      t.draw(x, base);
      x += t.w + (t.space ? spaceW : 0);
    }
    L.y += lh;
    line = [];
    lw = 0;
  };
  for (const t of toks) {
    if (t.nl) {
      flush();
      continue;
    }
    const add = t.w + (line.length && line[line.length - 1].space ? spaceW : 0);
    if (lw + add > maxW && line.length) flush();
    line.push(t);
    lw += t.w + (t.space ? spaceW : 0);
  }
  if (line.length) flush();
}

/** Render liquid/flow HTML (already in the DOM) to a clean PDF. */
export async function flowToPdf(root: HTMLElement, title: string, onProgress?: (p: number) => void): Promise<Blob> {
  const doc = await newPdf();
  doc.setProperties({ title, creator: 'Frogity' });
  const margin = 56;
  const L: Layout = { doc, y: margin, margin, width: doc.internal.pageSize.getWidth() - margin * 2, pageH: doc.internal.pageSize.getHeight(), imgCache: new Map() };
  const body = 11;
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,figure,table,hr,.math-display'));
  // keep only outermost blocks
  const top = blocks.filter((b) => !blocks.some((o) => o !== b && o.contains(b)));
  for (let i = 0; i < top.length; i++) {
    const b = top[i];
    const tag = b.tagName.toLowerCase();
    if (i % 25 === 0) {
      onProgress?.(i / top.length);
      await new Promise((r) => setTimeout(r));
    }
    if (/^h[1-6]$/.test(tag)) {
      const size = tag === 'h1' ? 18 : tag === 'h2' ? 15 : 12.5;
      L.y += size * 0.8;
      ensure(L, size * 3);
      await drawRich(L, collectRuns(b, 'bold'), size, { lh: 1.3 });
      L.y += size * 0.3;
    } else if (tag === 'p' || tag === 'li' || tag === 'blockquote' || b.classList.contains('math-display')) {
      if (b.classList.contains('math-display')) {
        const tex = b.querySelector('annotation')?.textContent ?? b.textContent ?? '';
        await drawRich(L, [{ k: 'text', text: tex, style: 'italic' }], body, { indent: 24 });
      } else {
        const indent = tag === 'li' || b.classList.contains('li') ? 14 : tag === 'blockquote' ? 20 : 0;
        const runs = collectRuns(b);
        if (tag === 'li') runs.unshift({ k: 'text', text: '• ', style: 'normal' });
        const small = b.querySelector('small.fn');
        await drawRich(L, runs, small ? body * 0.8 : body, { indent });
      }
      L.y += body * 0.55;
    } else if (tag === 'pre') {
      const text = b.textContent ?? '';
      doc.setFont('NotoMono', 'normal');
      doc.setFontSize(8.5);
      const lines = doc.splitTextToSize(text, L.width) as string[];
      for (const ln of lines) {
        ensure(L, 12);
        doc.text(ln, margin, L.y + 9);
        L.y += 12;
      }
      L.y += 8;
    } else if (tag === 'figure') {
      const mask = b.querySelector<HTMLElement>('.mask');
      const img = b.querySelector('img');
      const url = mask ? /url\(([^)]+)\)/.exec(mask.style.getPropertyValue('--m'))?.[1] : img?.src;
      if (url) {
        const im = L.imgCache.get(url) ?? (await urlToImage(url));
        if (im) {
          let w = mask ? parseFloat(mask.style.width) * body : im.w * 0.5;
          if (!w || !isFinite(w)) w = L.width;
          w = Math.min(w, L.width);
          const h = (im.h / im.w) * w;
          const maxH = L.pageH - margin * 2;
          const fw = h > maxH ? (w * maxH) / h : w;
          const fh = Math.min(h, maxH);
          ensure(L, fh + 8);
          doc.addImage(im.data, im.fmt, margin + (L.width - fw) / 2, L.y + 4, fw, fh, undefined, 'FAST');
          L.y += fh + 12;
        }
      }
      const eqno = b.querySelector('.eqno')?.textContent;
      if (eqno) {
        doc.setFont('NotoSerif', 'normal');
        doc.setFontSize(9);
        doc.text(eqno, margin + L.width, L.y - 20, { align: 'right' });
      }
      const cap = b.querySelector('figcaption')?.textContent;
      if (cap) await drawRich(L, [{ k: 'text', text: cap, style: 'italic' }], 9);
    } else if (tag === 'table') {
      const rows = Array.from(b.querySelectorAll('tr')).map((r) => Array.from(r.children).map((c) => (c.textContent ?? '').trim()));
      const cols = Math.max(1, ...rows.map((r) => r.length));
      const cw = L.width / cols;
      doc.setFontSize(8);
      for (const [ri, r] of rows.entries()) {
        doc.setFont('NotoSerif', ri === 0 ? 'bold' : 'normal');
        const cells = r.map((c) => doc.splitTextToSize(c, cw - 6) as string[]);
        const h = Math.max(1, ...cells.map((c) => c.length)) * 10 + 4;
        ensure(L, h);
        cells.forEach((c, ci) => c.forEach((ln, li) => doc.text(ln, margin + ci * cw, L.y + 9 + li * 10)));
        L.y += h;
        doc.setDrawColor(220);
        doc.line(margin, L.y - 2, margin + L.width, L.y - 2);
      }
      L.y += 10;
    } else if (tag === 'hr') {
      L.y += 10;
      ensure(L, 10);
      doc.setFontSize(10);
      doc.text('· · ·', margin + L.width / 2, L.y, { align: 'center' });
      L.y += 14;
    }
  }
  // page numbers
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    doc.setFont('NotoMono', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(String(p), doc.internal.pageSize.getWidth() / 2, L.pageH - 28, { align: 'center' });
  }
  onProgress?.(1);
  return doc.output('blob');
}

/** Each image becomes a page; optional OCR text is embedded invisibly so the PDF is searchable. */
export async function imagesToPdf(images: Blob[], texts?: string[]): Promise<Blob> {
  const doc = await newPdf();
  for (let i = 0; i < images.length; i++) {
    const url = URL.createObjectURL(images[i]);
    const im = await urlToImage(url);
    URL.revokeObjectURL(url);
    if (!im) continue;
    const pw = 595;
    const ph = (im.h / im.w) * pw;
    if (i === 0) {
      doc.deletePage(1);
    }
    doc.addPage([pw, ph], ph > pw ? 'portrait' : 'landscape');
    doc.addImage(im.data, im.fmt, 0, 0, pw, ph, undefined, 'FAST');
    const t = texts?.[i];
    if (t) {
      doc.setFontSize(10);
      const lines = doc.splitTextToSize(t, pw - 40) as string[];
      doc.text(lines, 20, 30, { renderingMode: 'invisible' });
    }
  }
  return doc.output('blob');
}

export async function pdfToPngZip(data: ArrayBuffer, name: string, onProgress?: (p: number) => void): Promise<Blob> {
  const { openPdf, renderPage } = await import('./formats/pdf');
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const pdf = await openPdf(data);
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const { canvas } = await renderPage(page, 1600 / vp.width);
      const b = await new Promise<Blob>((r) => canvas.toBlob((x) => r(x!), 'image/png'));
      zip.file(`${name}-${String(i).padStart(3, '0')}.png`, b);
      onProgress?.(i / pdf.numPages);
    }
  } finally {
    pdf.loadingTask.destroy();
  }
  return zip.generateAsync({ type: 'blob' });
}

// ------------------------------------------------------------------ text formats

export function flowToText(root: HTMLElement): string {
  const parts: string[] = [];
  root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,td,figcaption').forEach((el) => {
    if (el.closest('li') && el.tagName !== 'LI') return;
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.katex-mathml').forEach((m) => m.remove());
    clone.querySelectorAll('.katex').forEach((k) => (k.textContent = k.querySelector('annotation')?.textContent ?? k.textContent));
    clone.querySelectorAll('.im').forEach((m) => (m.textContent = '[math]'));
    const t = (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!t) return;
    parts.push(/^H\d$/.test(el.tagName) ? `\n${t.toUpperCase()}\n` : el.tagName === 'LI' ? `• ${t}` : t);
  });
  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function flowToMarkdown(root: HTMLElement): string {
  const inline = (el: Node): string => {
    let s = '';
    el.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) s += (n.textContent ?? '').replace(/\s+/g, ' ');
      else if (n.nodeType === Node.ELEMENT_NODE) {
        const e = n as HTMLElement;
        const t = e.tagName.toLowerCase();
        if (e.classList.contains('katex')) s += `$${e.querySelector('annotation')?.textContent ?? ''}$`;
        else if (e.classList.contains('katex-mathml')) s += '';
        else if (e.classList.contains('im')) s += '`[math]`';
        else if (t === 'b' || t === 'strong') s += `**${inline(e).trim()}**`;
        else if (t === 'i' || t === 'em') s += `*${inline(e).trim()}*`;
        else if (t === 'code') s += '`' + (e.textContent ?? '') + '`';
        else if (t === 'sup') s += `^${inline(e)}^`;
        else if (t === 'sub') s += `~${inline(e)}~`;
        else if (t === 'a') s += `[${inline(e)}](${e.getAttribute('href') ?? ''})`;
        else if (t === 'br') s += '  \n';
        else s += inline(e);
      }
    });
    return s;
  };
  const out: string[] = [];
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,figure,table,hr,.math-display'));
  const top = blocks.filter((b) => !blocks.some((o) => o !== b && o.contains(b) && o.tagName !== 'FIGURE'));
  for (const b of top) {
    const tag = b.tagName.toLowerCase();
    if (/^h\d$/.test(tag)) out.push(`${'#'.repeat(Number(tag[1]))} ${inline(b).trim()}`);
    else if (tag === 'li') out.push(`- ${inline(b).trim()}`);
    else if (tag === 'pre') out.push('```\n' + (b.textContent ?? '') + '\n```');
    else if (tag === 'blockquote') out.push('> ' + inline(b).trim());
    else if (tag === 'hr') out.push('---');
    else if (b.classList.contains('math-display')) out.push(`$$\n${b.querySelector('annotation')?.textContent ?? ''}\n$$`);
    else if (tag === 'figure') out.push(b.classList.contains('lq-math') ? '*[equation]*' : '*[figure]*');
    else if (tag === 'table') {
      const rows = Array.from(b.querySelectorAll('tr')).map((r) => Array.from(r.children).map((c) => (c.textContent ?? '').trim().replace(/\|/g, '\\|')));
      if (rows.length) {
        out.push(`| ${rows[0].join(' | ')} |\n| ${rows[0].map(() => '---').join(' | ')} |\n` + rows.slice(1).map((r) => `| ${r.join(' | ')} |`).join('\n'));
      }
    } else {
      const t = inline(b).trim();
      if (t) out.push(t);
    }
  }
  return out.join('\n\n') + '\n';
}

export async function flowToHtml(root: HTMLElement, title: string): Promise<string> {
  const clone = root.cloneNode(true) as HTMLElement;
  // inline blob images as data URIs
  const toData = async (url: string) => {
    const b = await (await fetch(url)).blob();
    return new Promise<string>((r) => {
      const fr = new FileReader();
      fr.onload = () => r(String(fr.result));
      fr.readAsDataURL(b);
    });
  };
  for (const img of Array.from(clone.querySelectorAll('img'))) if (img.src.startsWith('blob:')) img.src = await toData(img.src);
  for (const m of Array.from(clone.querySelectorAll<HTMLElement>('.mask,.im'))) {
    const url = /url\(([^)]+)\)/.exec(m.style.getPropertyValue('--m'))?.[1];
    if (url) m.style.setProperty('--m', `url(${await toData(url)})`);
  }
  clone.querySelectorAll('.s').forEach((s) => s.replaceWith(...Array.from(s.childNodes)));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title.replace(/</g, '&lt;')}</title>
<style>body{max-width:680px;margin:40px auto;padding:0 20px;font:18px/1.6 Georgia,serif;color:#141414;background:#f6f5f2}h1,h2,h3{font-family:ui-monospace,Menlo,monospace;line-height:1.25}img{max-width:100%}figure{margin:1em 0;text-align:center;position:relative}.mask,.im{display:inline-block;background:currentColor;-webkit-mask:var(--m) center/100% 100% no-repeat;mask:var(--m) center/100% 100% no-repeat;max-width:100%}.mask{display:block;margin:auto}.eqno{position:absolute;right:0;top:50%;font:12px monospace;color:#888}.pg{display:none}small.fn{display:block;font-size:.75em;color:#666}@media(prefers-color-scheme:dark){body{background:#111;color:#ddd}}</style></head><body>${clone.innerHTML}</body></html>`;
}

export function rowsToCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
}

export async function imageConvert(blob: Blob, to: 'png' | 'jpg'): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d')!;
  if (to === 'jpg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return new Promise((r) => c.toBlob((b) => r(b!), to === 'png' ? 'image/png' : 'image/jpeg', 0.92));
}
