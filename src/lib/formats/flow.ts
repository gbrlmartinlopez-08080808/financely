// Loaders for every format that becomes reflowable HTML ("flow").
import JSZip from 'jszip';
import { marked, type TokenizerAndRendererExtension } from 'marked';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { escapeHtml, sanitizeHtml } from '../sanitize';
import type { LiquidDoc, TocEntry } from '../types';

const decoder = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  // honour BOMs, default to utf-8 and fall back to windows-1252 if utf-8 is invalid
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
};
export const decodeText = decoder;

/** Give headings ids and build a table of contents. */
export function finalize(html: string, urls: string[] = [], extraToc?: TocEntry[]): LiquidDoc {
  const div = document.createElement('div');
  div.innerHTML = html;
  const toc: TocEntry[] = [];
  let n = 0;
  div.querySelectorAll('h1,h2,h3').forEach((h) => {
    const text = (h.textContent ?? '').trim();
    if (!text) return;
    if (!h.id) h.id = `h-${n++}`;
    toc.push({ title: text.slice(0, 120), anchor: h.id, level: Number(h.tagName[1]) });
  });
  return { html: div.innerHTML, toc: extraToc?.length ? extraToc : toc, urls };
}

// ------------------------------------------------------------------ plain text

export function textToLiquid(buf: ArrayBuffer): LiquidDoc {
  const text = decoder(buf).replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n\s*\n+/);
  // Hard-wrapped text (e.g. Project Gutenberg): most lines end mid-sentence at ~60-80 chars.
  const lines = text.split('\n').filter((l) => l.trim());
  const wrapped = lines.length > 20 && lines.filter((l) => l.length > 50 && l.length < 85).length / lines.length > 0.5;
  let html = '';
  for (const b of blocks) {
    const t = b.trim();
    if (!t) continue;
    const isHeading = t.length < 70 && !t.includes('\n') && (/^(chapter|book|part|section|act|scene)\b/i.test(t) || (t === t.toUpperCase() && /[A-Z]{3}/.test(t)));
    if (isHeading) html += `<h2>${escapeHtml(t)}</h2>`;
    else if (/^[-*_=]{3,}$/.test(t)) html += '<hr/>';
    else {
      const body = wrapped ? escapeHtml(t.replace(/\s*\n\s*/g, ' ')) : escapeHtml(t).replace(/\n/g, '<br/>');
      html += `<p>${body}</p>`;
    }
  }
  return finalize(html || '<p class="muted">This file is empty.</p>');
}

// ------------------------------------------------------------------ markdown (+ KaTeX)

const mathBlock: TokenizerAndRendererExtension = {
  name: 'mathBlock',
  level: 'block',
  start: (src: string) => src.match(/\$\$/)?.index,
  tokenizer(src: string) {
    const m = /^\$\$([\s\S]+?)\$\$/.exec(src);
    if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() };
    return undefined;
  },
  renderer: (t) => `<p data-math-block="${encodeURIComponent((t as unknown as { text: string }).text)}"></p>`,
};
const mathInline: TokenizerAndRendererExtension = {
  name: 'mathInline',
  level: 'inline',
  start: (src: string) => src.match(/\$/)?.index,
  tokenizer(src: string) {
    const m = /^\$(?!\s)((?:\\\$|[^$\n])+?)(?<!\s)\$(?!\d)/.exec(src);
    if (m) return { type: 'mathInline', raw: m[0], text: m[1] };
    const p = /^\\\((.+?)\\\)/.exec(src);
    if (p) return { type: 'mathInline', raw: p[0], text: p[1] };
    return undefined;
  },
  renderer: (t) => `<span data-math-inline="${encodeURIComponent((t as unknown as { text: string }).text)}"></span>`,
};
marked.use({ extensions: [mathBlock, mathInline], gfm: true });

export function markdownToLiquid(buf: ArrayBuffer): LiquidDoc {
  const src = decoder(buf).replace(/^---\n[\s\S]*?\n---\n/, ''); // drop front-matter
  const raw = marked.parse(src, { async: false }) as string;
  // Sanitise first (our placeholders survive because data-* is re-added below), then render math.
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  const holders: { el: Element; tex: string; display: boolean }[] = [];
  doc.querySelectorAll('[data-math-block],[data-math-inline]').forEach((el, i) => {
    const display = el.hasAttribute('data-math-block');
    const tex = decodeURIComponent(el.getAttribute(display ? 'data-math-block' : 'data-math-inline') ?? '');
    el.replaceWith(doc.createTextNode(`\u0002${i}\u0002`));
    holders.push({ el, tex, display });
  });
  let html = sanitizeHtml(doc);
  html = html.replace(/\u0002(\d+)\u0002/g, (_, i) => {
    const h = holders[Number(i)];
    if (!h) return '';
    try {
      const out = katex.renderToString(h.tex, { displayMode: h.display, throwOnError: false, output: 'htmlAndMathml' });
      return h.display ? `<div class="math-display">${out}</div>` : out;
    } catch {
      return escapeHtml(h.tex);
    }
  });
  return finalize(html);
}

// ------------------------------------------------------------------ html

export function htmlToLiquid(buf: ArrayBuffer): LiquidDoc {
  return finalize(sanitizeHtml(decoder(buf)));
}

// ------------------------------------------------------------------ docx

export async function docxToLiquid(buf: ArrayBuffer): Promise<LiquidDoc> {
  const mammoth = (await import('mammoth')).default ?? (await import('mammoth'));
  const res = await mammoth.convertToHtml({ arrayBuffer: buf });
  return finalize(sanitizeHtml(res.value));
}

// ------------------------------------------------------------------ epub

const join = (base: string, rel: string) => {
  if (/^[a-z]+:/i.test(rel) || rel.startsWith('/')) return rel.replace(/^\//, '');
  const parts = base.split('/').slice(0, -1);
  for (const seg of decodeURIComponent(rel).split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
};

const parseXml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');

export async function epubMeta(buf: ArrayBuffer): Promise<{ title?: string; author?: string; cover?: Blob }> {
  const zip = await JSZip.loadAsync(buf);
  const { opf, opfPath } = await readOpf(zip);
  const title = opf.querySelector('metadata > title, metadata title')?.textContent?.trim();
  const author = opf.querySelector('metadata > creator, metadata creator')?.textContent?.trim();
  let coverHref: string | undefined;
  const items = Array.from(opf.querySelectorAll('manifest > item'));
  const byProp = items.find((i) => (i.getAttribute('properties') ?? '').includes('cover-image'));
  if (byProp) coverHref = byProp.getAttribute('href') ?? undefined;
  if (!coverHref) {
    const id = opf.querySelector('meta[name="cover"]')?.getAttribute('content');
    const it = items.find((i) => i.getAttribute('id') === id);
    coverHref = it?.getAttribute('href') ?? undefined;
  }
  if (!coverHref) {
    const it = items.find((i) => /cover/i.test(i.getAttribute('id') ?? '') && (i.getAttribute('media-type') ?? '').startsWith('image/'));
    coverHref = it?.getAttribute('href') ?? undefined;
  }
  let cover: Blob | undefined;
  if (coverHref) {
    const f = zip.file(join(opfPath, coverHref));
    if (f) cover = await f.async('blob');
  }
  return { title, author, cover };
}

async function readOpf(zip: JSZip) {
  const container = await zip.file('META-INF/container.xml')?.async('string');
  const opfPath = container ? parseXml(container).querySelector('rootfile')?.getAttribute('full-path') ?? '' : '';
  const path = opfPath || Object.keys(zip.files).find((f) => f.endsWith('.opf')) || '';
  const opfText = await zip.file(path)?.async('string');
  if (!opfText) throw new Error('This EPUB has no package file.');
  return { opf: parseXml(opfText), opfPath: path };
}

export async function epubToLiquid(buf: ArrayBuffer): Promise<LiquidDoc> {
  const zip = await JSZip.loadAsync(buf);
  const { opf, opfPath } = await readOpf(zip);
  const manifest = new Map<string, { href: string; type: string; props: string }>();
  opf.querySelectorAll('manifest > item').forEach((i) =>
    manifest.set(i.getAttribute('id') ?? '', {
      href: join(opfPath, i.getAttribute('href') ?? ''),
      type: i.getAttribute('media-type') ?? '',
      props: i.getAttribute('properties') ?? '',
    }),
  );
  const spine = Array.from(opf.querySelectorAll('spine > itemref'))
    .map((r) => manifest.get(r.getAttribute('idref') ?? ''))
    .filter((x): x is { href: string; type: string; props: string } => !!x && /html|xml/.test(x.type));
  const chapterIndex = new Map(spine.map((s, i) => [s.href, i]));
  const urls: string[] = [];
  const blobUrl = new Map<string, string>();
  const imgs = new Map<string, JSZip.JSZipObject>();
  for (const [, m] of manifest) if (m.type.startsWith('image/')) {
    const f = zip.file(m.href);
    if (f) imgs.set(m.href, f);
  }
  // Pre-create blob URLs for images so sanitize can resolve synchronously.
  for (const [href, f] of imgs) {
    const blob = await f.async('blob');
    const type = manifest.get([...manifest.keys()].find((k) => manifest.get(k)!.href === href)!)?.type ?? 'image/*';
    const u = URL.createObjectURL(new Blob([blob], { type }));
    urls.push(u);
    blobUrl.set(href, u);
  }
  let html = '';
  for (let i = 0; i < spine.length; i++) {
    const ch = spine[i];
    const text = await zip.file(ch.href)?.async('string');
    if (!text) continue;
    let doc = new DOMParser().parseFromString(text, 'application/xhtml+xml');
    if (doc.querySelector('parsererror')) doc = new DOMParser().parseFromString(text, 'text/html');
    // svg-wrapped covers → plain img
    doc.querySelectorAll('svg').forEach((svg) => {
      const im = svg.querySelector('image');
      const href = im?.getAttribute('xlink:href') ?? im?.getAttribute('href') ?? im?.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (href) {
        const img = doc.createElementNS('http://www.w3.org/1999/xhtml', 'img');
        img.setAttribute('src', href);
        svg.replaceWith(img);
      }
    });
    const body = doc.querySelector('body') ?? doc.documentElement;
    const inner = sanitizeHtml(body, {
      idPrefix: `c${i}-`,
      resolveSrc: (src) => blobUrl.get(join(ch.href, src)),
      resolveHref: (href) => {
        const [path, frag] = href.split('#');
        const target = path ? chapterIndex.get(join(ch.href, path)) : i;
        if (target === undefined) return undefined;
        return frag ? `#c${target}-${frag}` : `#ch-${target}`;
      },
    });
    html += `<section class="ch" id="ch-${i}">${inner}</section>`;
  }
  // TOC from nav document or NCX
  const toc: TocEntry[] = [];
  const navItem = [...manifest.values()].find((m) => m.props.includes('nav'));
  const anchorFor = (base: string, href: string) => {
    const [path, frag] = href.split('#');
    const idx = chapterIndex.get(join(base, path));
    if (idx === undefined) return undefined;
    return frag ? `c${idx}-${frag}` : `ch-${idx}`;
  };
  if (navItem) {
    const nav = await zip.file(navItem.href)?.async('string');
    if (nav) {
      const d = new DOMParser().parseFromString(nav, 'application/xhtml+xml');
      const tocNav = Array.from(d.querySelectorAll('nav')).find((n) => (n.getAttribute('epub:type') ?? n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? '').includes('toc')) ?? d.querySelector('nav');
      tocNav?.querySelectorAll('a').forEach((a) => {
        const anchor = anchorFor(navItem.href, a.getAttribute('href') ?? '');
        let level = 0;
        for (let p: Element | null = a; p && p !== tocNav; p = p.parentElement) if (p.tagName.toLowerCase() === 'ol') level++;
        if (anchor) toc.push({ title: (a.textContent ?? '').trim(), anchor, level: Math.max(1, level) });
      });
    }
  }
  if (!toc.length) {
    const ncxItem = [...manifest.values()].find((m) => m.type.includes('dtbncx'));
    const ncx = ncxItem ? await zip.file(ncxItem.href)?.async('string') : undefined;
    if (ncx && ncxItem) {
      parseXml(ncx)
        .querySelectorAll('navPoint')
        .forEach((np) => {
          const label = np.querySelector('navLabel text')?.textContent?.trim() ?? '';
          const src = np.querySelector('content')?.getAttribute('src') ?? '';
          let level = 0;
          for (let p: Element | null = np; p; p = p.parentElement) if (p.localName === 'navPoint') level++;
          const anchor = anchorFor(ncxItem.href, src);
          if (anchor && label) toc.push({ title: label, anchor, level });
        });
    }
  }
  return finalize(html, urls, toc);
}

// ------------------------------------------------------------------ odt

export async function odtToLiquid(buf: ArrayBuffer): Promise<LiquidDoc> {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('content.xml')?.async('string');
  if (!xml) throw new Error('Not a valid OpenDocument file.');
  const doc = parseXml(xml);
  const urls: string[] = [];
  const out: string[] = [];
  const inline = (el: Element): string => {
    let s = '';
    el.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) s += escapeHtml(n.textContent ?? '');
      else if (n.nodeType === Node.ELEMENT_NODE) {
        const e = n as Element;
        if (e.localName === 's') s += ' '.repeat(Number(e.getAttribute('text:c') ?? 1));
        else if (e.localName === 'tab') s += ' ';
        else if (e.localName === 'line-break') s += '<br/>';
        else if (e.localName === 'note') s += '';
        else s += inline(e);
      }
    });
    return s;
  };
  const walk = async (el: Element) => {
    for (const c of Array.from(el.children)) {
      const ln = c.localName;
      if (ln === 'h') {
        const lvl = Math.min(3, Number(c.getAttribute('text:outline-level') ?? 1));
        out.push(`<h${lvl}>${inline(c)}</h${lvl}>`);
      } else if (ln === 'p') {
        const frame = c.querySelector('image');
        if (frame) {
          const href = frame.getAttribute('xlink:href');
          const f = href ? zip.file(href) : null;
          if (f) {
            const u = URL.createObjectURL(await f.async('blob'));
            urls.push(u);
            out.push(`<figure><img src="${u}"/></figure>`);
          }
        }
        const t = inline(c);
        if (t.trim()) out.push(`<p>${t}</p>`);
      } else if (ln === 'list') {
        out.push('<ul>');
        for (const li of Array.from(c.children)) out.push(`<li>${Array.from(li.children).map(inline).join(' ')}</li>`);
        out.push('</ul>');
      } else if (ln === 'table') {
        out.push('<table>');
        c.querySelectorAll('table-row').forEach((r) => {
          out.push('<tr>' + Array.from(r.children).map((cell) => `<td>${inline(cell)}</td>`).join('') + '</tr>');
        });
        out.push('</table>');
      } else if (ln === 'section' || ln === 'text' || ln === 'body') await walk(c);
    }
  };
  const text = doc.getElementsByTagNameNS('*', 'text')[0];
  if (text) await walk(text);
  return finalize(out.join(''), urls);
}

// ------------------------------------------------------------------ slides (pptx / odp)

export async function slidesToLiquid(buf: ArrayBuffer, name: string): Promise<LiquidDoc> {
  const zip = await JSZip.loadAsync(buf);
  const urls: string[] = [];
  let html = '';
  if (/\.odp$/i.test(name)) {
    const xml = await zip.file('content.xml')?.async('string');
    const pages = xml ? parseXml(xml).getElementsByTagNameNS('*', 'page') : [];
    Array.from(pages).forEach((p, i) => {
      html += `<h2>Slide ${i + 1}</h2>`;
      p.getElementsByTagNameNS('*', 'p').length;
      Array.from(p.getElementsByTagNameNS('*', 'p')).forEach((t) => {
        const s = (t.textContent ?? '').trim();
        if (s) html += `<p>${escapeHtml(s)}</p>`;
      });
    });
    return finalize(html, urls);
  }
  const slides = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/(\d+)\.xml/)![1]) - Number(b.match(/(\d+)\.xml/)![1]));
  for (let i = 0; i < slides.length; i++) {
    const xml = await zip.file(slides[i])!.async('string');
    const doc = parseXml(xml);
    const relsPath = slides[i].replace('slides/', 'slides/_rels/') + '.rels';
    const rels = await zip.file(relsPath)?.async('string');
    const relMap = new Map<string, string>();
    if (rels) parseXml(rels).querySelectorAll('Relationship').forEach((r) => relMap.set(r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? ''));
    let section = '';
    let title = '';
    for (const sp of Array.from(doc.getElementsByTagNameNS('*', 'sp'))) {
      const isTitle = !!Array.from(sp.getElementsByTagNameNS('*', 'ph')).find((ph) => /title/i.test(ph.getAttribute('type') ?? ''));
      const paras = Array.from(sp.getElementsByTagNameNS('*', 'p'))
        .map((p) => Array.from(p.getElementsByTagNameNS('*', 't')).map((t) => t.textContent ?? '').join(''))
        .filter((t) => t.trim());
      if (!paras.length) continue;
      if (isTitle && !title) title = paras.join(' ');
      else {
        const bullets = paras.length > 1;
        section += bullets ? `<ul>${paras.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` : `<p>${escapeHtml(paras[0])}</p>`;
      }
    }
    for (const blip of Array.from(doc.getElementsByTagNameNS('*', 'blip'))) {
      const rid = blip.getAttribute('r:embed') ?? blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed');
      const target = rid ? relMap.get(rid) : undefined;
      if (!target) continue;
      const f = zip.file(join(slides[i], target));
      if (!f) continue;
      const u = URL.createObjectURL(await f.async('blob'));
      urls.push(u);
      section += `<figure><img src="${u}"/></figure>`;
    }
    html += `<h2>${escapeHtml(title || `Slide ${i + 1}`)}</h2>${section}<hr/>`;
  }
  return finalize(html, urls);
}

// ------------------------------------------------------------------ rtf

export function rtfToLiquid(buf: ArrayBuffer): LiquidDoc {
  const src = new TextDecoder('latin1').decode(buf);
  let out = '';
  let depth = 0;
  const skipDepth: number[] = [];
  let i = 0;
  let uc = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '{') {
      depth++;
      // destinations to ignore
      const ahead = src.slice(i + 1, i + 14);
      if (/^\\\*|^\\(fonttbl|colortbl|stylesheet|info|pict|header|footer|xmlnstbl|listtable|listoverridetable|rsidtbl|generator|themedata|datastore|latentstyles)/.test(ahead)) skipDepth.push(depth);
      i++;
    } else if (c === '}') {
      if (skipDepth[skipDepth.length - 1] === depth) skipDepth.pop();
      depth--;
      i++;
    } else if (c === '\\') {
      const m = /^\\([a-z]+)(-?\d+)? ?|^\\'([0-9a-f]{2})|^\\(.)/i.exec(src.slice(i, i + 40));
      if (!m) {
        i++;
        continue;
      }
      i += m[0].length;
      if (skipDepth.length) continue;
      if (m[3]) out += String.fromCharCode(parseInt(m[3], 16));
      else if (m[4]) out += m[4] === '~' ? ' ' : /[\\{}]/.test(m[4]) ? m[4] : '';
      else {
        const w = m[1];
        if (w === 'par' || w === 'line') out += '\n';
        else if (w === 'tab') out += '\t';
        else if (w === 'uc') uc = Number(m[2] ?? 1);
        else if (w === 'u') {
          let code = Number(m[2]);
          if (code < 0) code += 65536;
          out += String.fromCharCode(code);
          i += uc; // skip fallback chars
        }
      }
    } else {
      if (!skipDepth.length && c !== '\r' && c !== '\n') out += c;
      i++;
    }
  }
  const html = out
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('');
  return finalize(html);
}

// ------------------------------------------------------------------ sheets

export interface SheetData {
  name: string;
  rows: string[][];
}

export async function readSheets(buf: ArrayBuffer, name: string): Promise<SheetData[]> {
  const XLSX = await import('xlsx');
  let wb;
  if (/\.(csv|tsv)$/i.test(name)) {
    const text = decoder(buf);
    wb = XLSX.read(text, { type: 'string', FS: /\.tsv$/i.test(name) ? '\t' : undefined, raw: false });
  } else wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
  return wb.SheetNames.map((n) => ({
    name: n,
    rows: (XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '', blankrows: false }) as unknown[][]).map((r) => r.map((v) => String(v ?? ''))),
  }));
}

export function sheetsToHtml(sheets: SheetData[]): string {
  return sheets
    .map(
      (s) =>
        `<h2>${escapeHtml(s.name)}</h2><table>${s.rows
          .slice(0, 2000)
          .map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${escapeHtml(c)}</th>` : `<td>${escapeHtml(c)}</td>`)).join('')}</tr>`)
          .join('')}</table>`,
    )
    .join('');
}
