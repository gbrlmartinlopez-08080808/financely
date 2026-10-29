// Pulls short, readable material out of the user's own documents: motivating sentences and characteristic words.
// Everything is computed on-device and cached.
import * as db from './db';
import { loadContent } from './library';
import type { DocMeta } from './types';

/** The built-in welcome guide is the app's own manual, never a source of quotes or favourite words. */
export const isGuide = (d: DocMeta) => d.name === 'Welcome to Quire' || d.fileName === 'Welcome to Quire.md';

export interface Harvest {
  quotes: string[];
  words: string[];
}

const KEY = (id: string) => `hv2:${id}`;

const LEXICON = new Set(
  'learn learning begin begins start believe never always courage brave dream dreams hope effort practice patience wisdom truth life mind think curious curiosity imagine create build grow growth change future freedom difficult hard simple best good great time work read reading book books understand discover question answer love listen speak quiet slow patient journey page pages write words story stories light'.split(' '),
);
const BAD_START = /^(figure|fig\.|table|chapter|section|abstract|copyright|appendix|note|see|http|www|©|page|equation|theorem|lemma|proof|definition)/i;
const STOP_LONG = new Set(
  'sentence sentences paragraph paragraphs language information document documents question questions problem problems understand really thought thoughts people things everyone everybody gutenberg project license licence copyright trademark electronic foundation distributing distribution redistribution commons archive terms conditions agreement permission volunteers donations ebook ebooks contents illustration illustrations chapter chapters because through between another however without something different following important together anything according although including example usually general several whether certain nothing everything therefore thought whatever whenever against possible present required provide provides provided results result process system systems number numbers within around before during himself herself itself themselves yourself already perhaps remain often rather really almost actually exactly likely instead similar indeed enough toward towards second third fourth should would could might shall other others their there these those which where while whose about above after again being below between both could each every from have having here itself just more most much must only over same some such than that them then they this those through under until very were what when will with your'.split(' '),
);

async function plainText(doc: DocMeta): Promise<string> {
  if (doc.size > 40_000_000) return '';
  if (doc.kind === 'pdf') {
    const { getFile } = await import('./library');
    const f = await getFile(doc.id);
    if (!f) return '';
    const { openPdf } = await import('./formats/pdf');
    const pdf = await openPdf(await f.arrayBuffer());
    try {
      let out = '';
      const last = Math.min(pdf.numPages, 16);
      for (let i = 1; i <= last; i++) {
        const tc = await (await pdf.getPage(i)).getTextContent();
        out += tc.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : '')).join('') + '\n\n';
        if (out.length > 160_000) break;
      }
      return out;
    } finally {
      pdf.loadingTask.destroy();
    }
  }
  if (['markdown', 'text', 'html', 'rtf', 'odt', 'docx', 'epub', 'slides'].includes(doc.kind)) {
    const c = await loadContent(doc);
    if (c.type !== 'flow') return '';
    const body = new DOMParser().parseFromString(c.liquid.html, 'text/html').body;
    body.querySelectorAll('.katex, math, script, style, figure, table, pre, code').forEach((n) => n.remove());
    c.liquid.urls.forEach((u) => URL.revokeObjectURL(u));
    // one block per line, so a heading never fuses with the sentence after it
    const text = Array.from(body.querySelectorAll('p, li, blockquote, h1, h2, h3, h4'))
      .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n\n');
    return stripBoilerplate(text).slice(0, 200_000);
  }
  return '';
}

/** Project Gutenberg & friends wrap books in licence text; keep only the book. */
function stripBoilerplate(t: string): string {
  const start = t.search(/\*{3}\s*START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\*{3}/i);
  if (start >= 0) t = t.slice(start).replace(/^[^\n]*\n/, '');
  const end = t.search(/\*{3}\s*END OF (THE|THIS) PROJECT GUTENBERG/i);
  if (end > 0) t = t.slice(0, end);
  return t;
}

function scoreSentence(s: string): number {
  const words = s.split(/\s+/);
  if (words.length < 8 || words.length > 28) return -1;
  if (s.length < 44 || s.length > 168) return -1;
  if (!/^[A-Z“"‘']/.test(s) || !/[.!?”"]$/.test(s)) return -1;
  if (/gutenberg|licen[cs]e|copyright|trademark|ebook|royalt|donat/i.test(s) || BAD_START.test(s) || /https?:|www\.|@|\[|\]|=|\+|©|\{|\}|\\|_/.test(s)) return -1;
  if ((s.match(/\d/g)?.length ?? 0) > 2) return -1;
  if ((s.match(/[A-Z]{4,}/g)?.length ?? 0) > 0) return -1;
  const letters = (s.match(/\p{L}/gu)?.length ?? 0) / s.length;
  if (letters < 0.8) return -1;
  let score = 0;
  for (const w of words) if (LEXICON.has(w.toLowerCase().replace(/[^a-z]/g, ''))) score += 2;
  if (/\b(you|we|us|your|our)\b/i.test(s)) score += 1;
  if (/[;,—–:]/.test(s)) score += 0.5;
  if (words.length <= 18) score += 1;
  if (/\b(et al|ibid|cf\.|e\.g\.|i\.e\.|fig)\b/i.test(s)) score -= 4;
  return score;
}

export function harvestText(text: string): Harvest {
  const flat = text.replace(/\s+/g, ' ');
  // sentences never cross a paragraph break (so a heading can't fuse with the line after it)
  const sentences = text
    .split(/\n{2,}/)
    .flatMap((para) => para.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z“"‘'])/));
  const scored = sentences
    .map((s) => ({ s: s.trim(), v: scoreSentence(s.trim()) }))
    .filter((x) => x.v >= 2)
    .sort((a, b) => b.v - a.v);
  const quotes: string[] = [];
  for (const q of scored) {
    if (quotes.length >= 8) break;
    if (!quotes.some((x) => x.slice(0, 24) === q.s.slice(0, 24))) quotes.push(q.s);
  }
  const freq = new Map<string, number>();
  for (const m of flat.toLowerCase().matchAll(/\b[a-z]{7,14}\b/g)) {
    const w = m[0];
    if (STOP_LONG.has(w) || w.endsWith('ly') || w.endsWith('ness') || w.endsWith('ment') || w.endsWith('ed')) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const words = [...freq.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] * (1 + b[0].length / 20) - a[1] * (1 + a[0].length / 20))
    .slice(0, 10)
    .map(([w]) => w);
  return { quotes, words };
}

export async function harvestDoc(doc: DocMeta): Promise<Harvest | null> {
  const hit = await db.get<Harvest>('kv', KEY(doc.id));
  if (hit) return hit;
  try {
    const text = await plainText(doc);
    if (text.length < 300) {
      const empty = { quotes: [], words: [] };
      await db.put('kv', KEY(doc.id), empty);
      return empty;
    }
    const h = harvestText(text);
    await db.put('kv', KEY(doc.id), h);
    return h;
  } catch (e) {
    console.warn('harvest failed', doc.name, e);
    return null;
  }
}

/** Harvest a few recent documents (one at a time so the UI never stalls). */
export async function harvestRecent(docs: DocMeta[], limit = 4): Promise<Record<string, Harvest>> {
  const out: Record<string, Harvest> = {};
  const candidates = docs.filter((d) => !isGuide(d) && !['image', 'audio', 'video', 'sheet', 'code', 'unknown'].includes(d.kind)).slice(0, 12);
  let computed = 0;
  for (const d of candidates) {
    const cached = await db.get<Harvest>('kv', KEY(d.id));
    if (cached) {
      out[d.id] = cached;
      continue;
    }
    if (computed >= limit) continue;
    computed++;
    const h = await harvestDoc(d);
    if (h) out[d.id] = h;
    await new Promise((r) => setTimeout(r, 30));
  }
  return out;
}
