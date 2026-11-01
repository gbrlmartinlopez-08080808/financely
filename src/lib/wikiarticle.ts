// A Wikipedia article read inside the app: the whole text (not the three lines of a summary), with its links turned into
// links inside the app, so a reader can follow one idea into the next without ever being thrown out to a browser.
import * as db from './db';
import { sanitizeHtml } from './sanitize';

export interface WikiDoc {
  title: string;
  description: string;
  image?: string;
  iw?: number;
  ih?: number;
  html: string;
  /** "See also" and the like: where to go next */
  next: string[];
  words: number;
  url: string;
}

const STOP_AT = /^(references|notes|footnotes|external links|further reading|bibliography|sources|citations|works cited|see also)$/i;
const KILL = '.infobox, .navbox, .vertical-navbox, .sidebar, .hatnote, .ambox, .mbox-small, .metadata, .mw-editsection, .mw-empty-elt, .noprint, .reflist, .mw-references-wrap, .refbegin, style, script, link, sup.reference, .portal, .sistersitebox, .shortdescription, .thumbcaption .magnify, [role="note"], .navigation-not-searchable, table.sidebar, .mw-authority-control, .spoken-wikipedia, .side-box, .thumb-note';

const clean = (t: string) => t.replace(/_/g, ' ');
const rest = 'https://en.wikipedia.org/api/rest_v1';

async function getJson<T>(url: string): Promise<T> {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { 'Api-User-Agent': 'Frogity/5 (personal reading app)' } });
    if (r.status === 429 || r.status >= 500) {
      await new Promise((res) => setTimeout(res, 900 * (i + 1)));
      continue;
    }
    if (!r.ok) throw new Error(`Wikipedia answered ${r.status}`);
    return r.json() as Promise<T>;
  }
  throw new Error('Wikipedia is busy right now — try again in a moment.');
}

export async function wikiArticle(title: string): Promise<WikiDoc> {
  const t = clean(title);
  const key = 'wa:' + t.toLowerCase();
  const hit = await db.get<{ d: WikiDoc; at: number }>('kv', key).catch(() => undefined);
  if (hit && Date.now() - hit.at < 7 * 864e5) return hit.d;
  const enc = encodeURIComponent(t.replace(/ /g, '_'));
  const [sum, htmlRes] = await Promise.all([
    getJson<{ title: string; description?: string; thumbnail?: { source: string }; originalimage?: { source: string; width: number; height: number }; content_urls?: { desktop?: { page?: string } } }>(`${rest}/page/summary/${enc}`).catch(() => null),
    fetch(`${rest}/page/html/${enc}`, { headers: { 'Api-User-Agent': 'Frogity/5 (personal reading app)' } }),
  ]);
  if (!htmlRes.ok) throw new Error(htmlRes.status === 404 ? 'There is no article with that name.' : `Wikipedia answered ${htmlRes.status}`);
  const doc = new DOMParser().parseFromString(await htmlRes.text(), 'text/html');
  doc.querySelectorAll(KILL).forEach((n) => n.remove());
  const body = doc.body;
  // keep sections until the back matter; collect "See also"
  const next: string[] = [];
  const keep = document.createElement('div');
  let stop = false;
  for (const sec of Array.from(body.querySelectorAll(':scope > section'))) {
    const h = sec.querySelector(':scope > h2, :scope > h3');
    const name = (h?.textContent ?? '').trim();
    if (/^see also$/i.test(name)) {
      sec.querySelectorAll('li a[rel="mw:WikiLink"]').forEach((a) => {
        const w = clean(decodeURIComponent((a.getAttribute('href') ?? '').replace(/^\.\//, '').split('#')[0]));
        if (w && !/^(File|Category|Template|Help|Portal|Wikipedia|Special):/i.test(w) && next.length < 12) next.push(w);
      });
      continue;
    }
    if (STOP_AT.test(name)) {
      stop = true;
      continue;
    }
    if (stop && name) continue;
    keep.appendChild(sec.cloneNode(true));
  }
  if (!keep.childElementCount) keep.innerHTML = body.innerHTML;
  // links: other articles open in the app; anything else is plain text (the sources are named at the foot)
  keep.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href') ?? '';
    if (a.getAttribute('rel') === 'mw:WikiLink' || /^\.\/[^:#]+(#.*)?$/.test(href)) {
      const w = decodeURIComponent(href.replace(/^\.\//, '').split('#')[0]);
      if (/^(File|Category|Template|Help|Portal|Wikipedia|Special|Talk):/i.test(w) || !w) return a.replaceWith(...Array.from(a.childNodes));
      a.setAttribute('href', '#wiki:' + w);
    } else a.replaceWith(...Array.from(a.childNodes));
  });
  // pictures: https, a sensible number, with their captions
  keep.querySelectorAll('img').forEach((img, i) => {
    const src = img.getAttribute('src') ?? '';
    const w = Number(img.getAttribute('width') ?? 0);
    if (!src || w < 120 || i > 7 || /Symbol_|Icon|Commons-logo|Wiki_letter|Ambox|Question_book/i.test(src)) return (img.closest('figure') ?? img).remove();
    img.setAttribute('src', src.startsWith('//') ? 'https:' + src : src);
    img.removeAttribute('srcset');
    img.removeAttribute('width');
    img.removeAttribute('height');
  });
  keep.querySelectorAll('table').forEach((t) => ((t.textContent ?? '').length > 1500 ? t.remove() : t.classList.add('wk-table')));
  keep.querySelectorAll('section > h2, section > h3').forEach((h) => h.setAttribute('id', 'h-' + (h.textContent ?? '').trim().toLowerCase().replace(/\W+/g, '-')));
  const html = sanitizeHtml(keep);
  const words = (keep.textContent ?? '').trim().split(/\s+/).length;
  const d: WikiDoc = {
    title: sum?.title ?? t,
    description: sum?.description ?? '',
    image: sum?.originalimage ? sum.thumbnail?.source?.replace(/\/\d+px-/, '/500px-') : sum?.thumbnail?.source,
    iw: sum?.originalimage?.width,
    ih: sum?.originalimage?.height,
    html,
    next: [...new Set(next)],
    words,
    url: sum?.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${enc}`,
  };
  db.put('kv', key, { d, at: Date.now() }).catch(() => {});
  return d;
}
