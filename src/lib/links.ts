// Save a web link as a document: article text + images, readable offline.
import { escapeHtml, sanitizeHtml } from './sanitize';
import { generatedCover, importFile } from './library';
import { detectKind } from './formats/detect';
import * as db from './db';
import { saveDoc } from './store';
import type { DocMeta } from './types';

export const looksLikeUrl = (s: string) => /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(s.trim()) && !/\s/.test(s.trim());
export const normalizeUrl = (s: string) => {
  const t = s.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
};

const NOISE = /(comment|sidebar|share|social|promo|newsletter|cookie|consent|advert|\bads?\b|related|recommend|footer|menu|navbar|breadcrumb|subscribe|popup|modal|toolbar|paywall|signup|login)/i;

async function fetchBlob(url: string, max = 25_000_000): Promise<{ blob: Blob; type: string; finalUrl: string }> {
  const r = await fetch(url, { redirect: 'follow', headers: { Accept: 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.8' } });
  if (!r.ok) throw new Error(`The site answered ${r.status}.`);
  const blob = await r.blob();
  if (blob.size > max) throw new Error('That page is too large to save.');
  return { blob, type: (r.headers.get('content-type') ?? blob.type ?? '').split(';')[0].trim().toLowerCase(), finalUrl: r.url || url };
}

const toDataUri = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const f = new FileReader();
    f.onload = () => res(String(f.result));
    f.onerror = () => rej(f.error);
    f.readAsDataURL(b);
  });

function pickMain(doc: Document): Element {
  const sem = doc.querySelector('article') ?? doc.querySelector('[role="main"], main');
  const textLen = (e: Element) => (e.textContent ?? '').trim().length;
  if (sem && textLen(sem) > 600) return sem;
  // fall back to the block holding the most paragraph text
  let best: Element = doc.body;
  let bestScore = 0;
  doc.querySelectorAll('div, section, td').forEach((el) => {
    let score = 0;
    for (const c of Array.from(el.children)) if (c.tagName === 'P') score += Math.min(400, (c.textContent ?? '').trim().length);
    const links = Array.from(el.querySelectorAll('a')).reduce((a, x) => a + (x.textContent ?? '').length, 0);
    score -= links * 0.5;
    if (NOISE.test(`${el.id} ${el.className}`)) score *= 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  });
  return bestScore > 200 ? best : (sem ?? doc.body);
}

function meta(doc: Document, ...names: string[]) {
  for (const n of names) {
    const v = doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`)?.getAttribute('content');
    if (v?.trim()) return v.trim();
  }
  return undefined;
}

export interface LinkProgress {
  (label: string): void;
}

export async function importUrl(input: string, progress?: LinkProgress): Promise<DocMeta> {
  const url = normalizeUrl(input);
  progress?.('fetching page');
  const got = await fetchBlob(url);
  const last = decodeURIComponent(new URL(got.finalUrl).pathname.split('/').filter(Boolean).pop() ?? '');
  // direct file links: PDFs, books, images…
  if (got.type && !/html|xml/.test(got.type)) {
    const name = last && /\.[a-z0-9]{2,5}$/i.test(last) ? last : `${last || new URL(got.finalUrl).hostname}.${got.type.split('/')[1]?.split('+')[0] || 'bin'}`;
    const kind = detectKind(name, got.type);
    const m = await importFile(got.blob, name, { kind });
    return m;
  }

  const html = await got.blob.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = got.finalUrl;
  const abs = (u: string | null | undefined) => {
    if (!u) return '';
    try {
      return new URL(u, base).href;
    } catch {
      return '';
    }
  };
  const title = (meta(doc, 'og:title', 'twitter:title') ?? doc.querySelector('h1')?.textContent ?? doc.title ?? new URL(base).hostname).replace(/\s+/g, ' ').trim().slice(0, 160);
  const site = meta(doc, 'og:site_name') ?? new URL(base).hostname.replace(/^www\./, '');
  const author = meta(doc, 'author', 'article:author', 'og:site_name');
  const ogImage = abs(meta(doc, 'og:image', 'twitter:image'));

  progress?.('finding the article');
  const main = pickMain(doc).cloneNode(true) as Element;
  main.querySelectorAll('script, style, noscript, iframe, form, nav, aside, footer, button, svg, video, audio, dialog, [aria-hidden="true"], [hidden]').forEach((n) => n.remove());
  main.querySelectorAll('*').forEach((n) => {
    if (n !== main && NOISE.test(`${n.id} ${typeof n.className === 'string' ? n.className : ''}`) && (n.textContent ?? '').length < 800) n.remove();
  });
  // lazy images → real src, everything absolute
  const imgs = Array.from(main.querySelectorAll('img'));
  for (const img of imgs) {
    const lazy = img.getAttribute('data-src') ?? img.getAttribute('data-original') ?? img.getAttribute('data-lazy-src');
    const srcset = img.getAttribute('srcset')?.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop();
    img.setAttribute('src', abs(lazy ?? srcset ?? img.getAttribute('src')));
    img.removeAttribute('srcset');
  }
  main.querySelectorAll('a[href]').forEach((a) => a.setAttribute('href', abs(a.getAttribute('href')) || '#'));

  // inline up to a handful of images so the page works offline
  progress?.('saving images');
  const inline = new Map<string, string>();
  let budget = 8_000_000;
  const wanted = imgs.map((i) => i.getAttribute('src') ?? '').filter((s) => /^https?:/i.test(s));
  for (const src of [...new Set(wanted)].slice(0, 14)) {
    try {
      const r = await fetch(src);
      if (!r.ok) continue;
      const b = await r.blob();
      if (!b.type.startsWith('image/') || b.size > 3_000_000 || b.size < 1_500 || b.size > budget) continue;
      budget -= b.size;
      inline.set(src, await toDataUri(b));
    } catch {
      /* skip images that fail */
    }
  }

  const clean = sanitizeHtml(main, { resolveSrc: (s) => inline.get(s) });
  const text = (new DOMParser().parseFromString(clean, 'text/html').body.textContent ?? '').trim();
  if (text.length < 200) throw new Error('This page has no readable article text (it may need you to be signed in).');
  const head = `<h1>${escapeHtml(title)}</h1><p class="byline"><small>${escapeHtml(site)} · <a href="${escapeHtml(base)}">${escapeHtml(new URL(base).hostname)}</a></small></p>`;
  const body = /<h1[\s>]/i.test(clean.slice(0, 600)) ? `${clean}` : head + clean;
  const file = new Blob([`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body}</body></html>`], { type: 'text/html' });

  // cover: lead image if there is one, otherwise a typographic cover
  let cover: Blob | undefined;
  const leadSrc = ogImage || wanted[0];
  if (leadSrc) {
    try {
      const r = await fetch(leadSrc);
      const b = await r.blob();
      if (r.ok && b.type.startsWith('image/') && b.size > 3000) cover = b;
    } catch {
      /* no cover image */
    }
  }
  const m = await importFile(file, `${title.slice(0, 80).replace(/[\\/:*?"<>|]+/g, '') || 'page'}.html`, { kind: 'html', title });
  const coverId = `${m.id}:cover-${Date.now()}`; // new key, so cached covers refresh
  const patch: DocMeta = { ...m, coverId, url: base, author: author && author !== site ? author : site };
  if (cover) {
    const bmp = await createImageBitmap(cover).catch(() => null);
    if (bmp) {
      const s = Math.min(1, 520 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * s);
      c.height = Math.round(bmp.height * s);
      c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      const jpg = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85));
      if (jpg) await db.put('blobs', coverId, jpg);
    }
  } else await db.put('blobs', coverId, await generatedCover(title, 'html', site));
  await saveDoc(patch);
  progress?.('done');
  return patch;
}
