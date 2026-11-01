// The full story, read inside the app: a news card is the short overview; this is what is behind it. The page is fetched,
// the article is lifted out of it (no menus, adverts or comment threads), and shown in plain, readable type.
// Nothing is saved unless the reader chooses to keep it.
import * as db from './db';
import { NOISE, fetchBlob, meta, pickMain } from './links';
import { sanitizeHtml } from './sanitize';

export interface Article {
  title: string;
  site: string;
  url: string;
  html: string;
  words: number;
}

export async function readArticle(url: string): Promise<Article> {
  const key = 'article:' + url;
  const hit = await db.get<{ a: Article; at: number }>('kv', key).catch(() => undefined);
  if (hit && Date.now() - hit.at < 2 * 864e5) return hit.a;
  const got = await fetchBlob(url, 6_000_000);
  if (got.type && !/html|xml/.test(got.type)) throw new Error('That link is not a web page.');
  const doc = new DOMParser().parseFromString(await got.blob.text(), 'text/html');
  const base = got.finalUrl;
  const abs = (u: string | null | undefined) => {
    try {
      return u ? new URL(u, base).href : '';
    } catch {
      return '';
    }
  };
  const title = (meta(doc, 'og:title', 'twitter:title') ?? doc.querySelector('h1')?.textContent ?? doc.title ?? '').replace(/\s+/g, ' ').trim();
  const site = meta(doc, 'og:site_name') ?? new URL(base).hostname.replace(/^www\./, '');
  const main = pickMain(doc).cloneNode(true) as Element;
  main.querySelectorAll('script, style, noscript, iframe, form, nav, aside, footer, button, svg, video, audio, dialog, h1, [aria-hidden="true"], [hidden]').forEach((n) => n.remove());
  main.querySelectorAll('*').forEach((n) => {
    if (n !== main && NOISE.test(`${n.id} ${typeof n.className === 'string' ? n.className : ''}`) && (n.textContent ?? '').length < 800) n.remove();
  });
  // only real pictures: lazy ones resolved, small ones (icons, trackers, avatars) dropped
  for (const img of Array.from(main.querySelectorAll('img'))) {
    const lazy = img.getAttribute('data-src') ?? img.getAttribute('data-original') ?? img.getAttribute('data-lazy-src');
    const best = img.getAttribute('srcset')?.split(',').map((x) => x.trim().split(/\s+/)).filter((x) => x[0]).sort((a, b) => parseInt(b[1] ?? '0') - parseInt(a[1] ?? '0'))[0]?.[0];
    img.setAttribute('src', abs(best ?? lazy ?? img.getAttribute('src')));
    img.removeAttribute('srcset');
    const w = Number(img.getAttribute('width') ?? 0);
    if (!img.getAttribute('src') || (w && w < 260) || /avatar|logo|icon|sprite|pixel|tracking|1x1/i.test(img.getAttribute('src') ?? '')) img.remove();
  }
  main.querySelectorAll('a[href]').forEach((a) => a.setAttribute('href', abs(a.getAttribute('href')) || '#'));
  const html = sanitizeHtml(main);
  const text = (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').trim();
  if (text.length < 300) throw new Error('This page has no article text Froggy can read here (it may need a subscription or sign-in).');
  const a: Article = { title, site, url: base, html, words: text.split(/\s+/).length };
  db.put('kv', key, { a, at: Date.now() }).catch(() => {});
  return a;
}
