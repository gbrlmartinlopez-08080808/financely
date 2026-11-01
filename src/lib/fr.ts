// The Frogity document (.fr): a note you can edit anywhere — on the phone, on the computer, or both. It is a small
// JSON file holding a title and clean HTML, so nothing is lost when it is converted from (or to) other formats.
import { sanitizeHtml } from './sanitize';

/** HTML with scripts and event handlers taken out. */
const cleanHtml = (h: string) => sanitizeHtml(h);

export const FR_MIME = 'application/x-frogity';
export interface FrDoc {
  frogity: 1;
  title: string;
  html: string;
  updated: number;
}
export const makeFr = (title: string, html: string): Blob => new Blob([JSON.stringify({ frogity: 1, title, html: cleanHtml(html), updated: Date.now() } satisfies FrDoc)], { type: FR_MIME });
export function parseFr(text: string): FrDoc {
  try {
    const j = JSON.parse(text) as Partial<FrDoc>;
    if (j && typeof j.html === 'string') return { frogity: 1, title: j.title ?? '', html: cleanHtml(j.html), updated: j.updated ?? Date.now() };
  } catch {
    /* not JSON: plain text or HTML saved by hand */
  }
  return { frogity: 1, title: '', html: cleanHtml(/<\w+[^>]*>/.test(text) ? text : `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>`), updated: Date.now() };
}

/** HTML pasted from Google Docs, Word, a web page: its structure kept, its mess (inline styles, ids, wrappers) dropped. */
export function cleanPaste(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, meta, link, title, head, iframe, object, embed, form, input, button, svg, o\\:p').forEach((n) => n.remove());
  const keep = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'A', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'DEL', 'SUB', 'SUP', 'BR', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'IMG']);
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      walk(child);
      const st = (child.getAttribute('style') ?? '').toLowerCase();
      // a styled span (Google Docs writes bold and italic that way) becomes real bold / italic
      if (child.tagName === 'SPAN' || !keep.has(child.tagName)) {
        const bold = /font-weight:\s*(bold|[6-9]00)/.test(st);
        const ital = /font-style:\s*italic/.test(st);
        const und = /text-decoration[^;]*underline/.test(st) && !child.closest('a');
        let inner: Node[] = Array.from(child.childNodes);
        const wrap = (tag: string) => {
          const w = doc.createElement(tag);
          inner.forEach((n) => w.appendChild(n));
          inner = [w];
        };
        if (bold) wrap('strong');
        if (ital) wrap('em');
        if (und) wrap('u');
        child.replaceWith(...inner);
        continue;
      }
      if (child.tagName === 'B' && /^docs-internal-guid/.test(child.id)) {
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      // a heading-looking paragraph keeps its look: big, bold paragraphs become headings
      for (const a of Array.from(child.attributes)) if (!(child.tagName === 'A' && a.name === 'href') && !(child.tagName === 'IMG' && (a.name === 'src' || a.name === 'alt')) && !(/^(TD|TH)$/.test(child.tagName) && /^(colspan|rowspan)$/.test(a.name))) child.removeAttribute(a.name);
    }
  };
  walk(doc.body);
  // Word's empty paragraphs and non-breaking blanks
  doc.body.querySelectorAll('p').forEach((p) => {
    if (!p.textContent?.replace(/[\s ]/g, '') && !p.querySelector('img, br')) p.remove();
  });
  doc.body.querySelectorAll('img').forEach((i) => {
    const src = i.getAttribute('src') ?? '';
    if (!/^data:image\//.test(src) && !/^https?:/.test(src)) i.remove();
  });
  return cleanHtml(doc.body.innerHTML);
}

/** A rough guess of the language of a text (for choosing a reading voice). */
export function guessLang(text: string): string {
  const w = text.toLowerCase().match(/[a-zà-ÿ]+/g)?.slice(0, 400) ?? [];
  const sets: Record<string, string[]> = {
    en: ['the', 'and', 'of', 'to', 'is', 'in', 'that', 'it', 'for', 'with', 'was', 'as', 'this'],
    es: ['el', 'la', 'de', 'que', 'y', 'en', 'los', 'se', 'del', 'las', 'por', 'un', 'con', 'una', 'es'],
    fr: ['le', 'la', 'les', 'de', 'des', 'et', 'est', 'un', 'une', 'du', 'que', 'pour', 'dans', 'qui', 'pas'],
    de: ['der', 'die', 'und', 'das', 'ist', 'nicht', 'ein', 'eine', 'zu', 'mit', 'den', 'von', 'sich', 'auf'],
    it: ['il', 'di', 'che', 'la', 'e', 'un', 'per', 'in', 'non', 'una', 'sono', 'con', 'del', 'le'],
    pt: ['o', 'de', 'que', 'e', 'do', 'da', 'em', 'um', 'para', 'com', 'não', 'uma', 'os', 'no', 'se'],
  };
  let best = 'en';
  let bs = 0;
  for (const [l, ws] of Object.entries(sets)) {
    const set = new Set(ws);
    const score = w.filter((x) => set.has(x)).length;
    if (score > bs) (bs = score), (best = l);
  }
  return best;
}
