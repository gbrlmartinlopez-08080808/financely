// Word lookup, all from free public sources:
//   definitions → dictionaryapi.dev (Wiktionary-derived), falling back to Wiktionary's own definition API
//   origin      → Wiktionary etymology (Greek/Latin roots pulled out as chips)
//   encyclopedia + picture → Wikipedia (+ Wikimedia images)
import * as db from './db';

const HDRS = { 'Api-User-Agent': 'Quire/1.1 (personal reading app)' };

export interface Definition {
  word: string;
  phonetic?: string;
  audio?: string;
  meanings: { pos: string; defs: { d: string; ex?: string }[]; synonyms: string[] }[];
  source: string;
}
export interface Origin {
  text: string[]; // paragraphs
  roots: { lang: string; form: string; gloss?: string }[];
}
export interface WikiCard {
  title: string;
  description?: string;
  extract: string;
  thumb?: string;
  url: string;
}

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = await db.get<{ v: T; at: number }>('kv', 'lk2:' + key).catch(() => undefined);
  if (hit && Date.now() - hit.at < 30 * 864e5) return hit.v;
  const v = await fn();
  if (v) db.put('kv', 'lk2:' + key, { v, at: Date.now() }).catch(() => {});
  return v;
}

export const normalizeWord = (w: string) =>
  w
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/[’']s$/i, '');

const stripTags = (h: string) => {
  const d = new DOMParser().parseFromString(h, 'text/html');
  d.querySelectorAll('sup, style, .mw-ref').forEach((n) => n.remove());
  return (d.body.textContent ?? '').replace(/\s+/g, ' ').trim();
};

/** "running" → running, run; "studies" → studies, study, studie … (tried in order) */
function variants(w: string): string[] {
  const lw = w.toLowerCase();
  const out = [lw];
  const add = (x: string) => x.length > 2 && !out.includes(x) && out.push(x);
  if (lw.endsWith('ies')) add(lw.slice(0, -3) + 'y');
  if (lw.endsWith('es')) add(lw.slice(0, -2));
  if (lw.endsWith('s')) add(lw.slice(0, -1));
  if (lw.endsWith('ed')) {
    add(lw.slice(0, -2));
    add(lw.slice(0, -1));
    if (/(.)\1ed$/.test(lw)) add(lw.slice(0, -3));
  }
  if (lw.endsWith('ing')) {
    add(lw.slice(0, -3));
    add(lw.slice(0, -3) + 'e');
    if (/(.)\1ing$/.test(lw)) add(lw.slice(0, -4));
  }
  if (lw.endsWith('ly')) add(lw.slice(0, -2));
  if (lw.endsWith('er')) add(lw.slice(0, -2));
  return out;
}

async function fromDictionaryApi(w: string): Promise<Definition | null> {
  const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`dictionary ${r.status}`);
  const data = (await r.json()) as {
    word: string;
    phonetic?: string;
    phonetics?: { text?: string; audio?: string }[];
    meanings: { partOfSpeech: string; definitions: { definition: string; example?: string }[]; synonyms?: string[] }[];
  }[];
  if (!Array.isArray(data) || !data.length) return null;
  const meanings: Definition['meanings'] = [];
  for (const e of data)
    for (const m of e.meanings) {
      const defs = m.definitions.slice(0, 4).map((d) => ({ d: d.definition, ex: d.example }));
      const ex = meanings.find((x) => x.pos === m.partOfSpeech);
      if (ex) ex.defs.push(...defs.slice(0, 2));
      else meanings.push({ pos: m.partOfSpeech, defs, synonyms: (m.synonyms ?? []).slice(0, 6) });
    }
  return {
    word: data[0].word,
    phonetic: data[0].phonetic ?? data[0].phonetics?.find((p) => p.text)?.text,
    audio: data.flatMap((d) => d.phonetics ?? []).find((p) => p.audio)?.audio || undefined,
    meanings,
    source: 'Wiktionary',
  };
}

async function fromWiktionary(w: string): Promise<Definition | null> {
  const r = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(w)}`, { headers: HDRS });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`wiktionary ${r.status}`);
  const j = (await r.json()) as { en?: { partOfSpeech: string; definitions: { definition: string; examples?: string[] }[] }[] };
  const en = j.en;
  if (!en?.length) return null;
  const meanings = en
    .map((e) => ({
      pos: e.partOfSpeech.toLowerCase(),
      defs: e.definitions
        .map((d) => ({ d: stripTags(d.definition), ex: d.examples?.[0] ? stripTags(d.examples[0]) : undefined }))
        .filter((d) => d.d.length > 2)
        .slice(0, 4),
      synonyms: [],
    }))
    .filter((m) => m.defs.length);
  return meanings.length ? { word: w, meanings, source: 'Wiktionary' } : null;
}

export async function define(word: string): Promise<Definition | null> {
  return cached('def:' + word.toLowerCase(), async () => {
    let failure: unknown = null;
    for (const v of variants(word)) {
      for (const src of [fromDictionaryApi, fromWiktionary]) {
        try {
          const d = await src(v);
          if (d) return d;
        } catch (e) {
          failure = e;
        }
      }
    }
    if (failure) throw failure;
    return null;
  });
}

const ROOT_LANGS = 'Ancient Greek|Koine Greek|Byzantine Greek|Greek|New Latin|Late Latin|Medieval Latin|Latin|Old French|Middle French|French|Old English|Middle English|Proto-Indo-European|Proto-Germanic|Old Norse|Arabic|Sanskrit|Italian|Spanish|German|Dutch|Hebrew|Persian';

export async function origin(word: string): Promise<Origin | null> {
  return cached('ety:' + word.toLowerCase(), async () => {
    const tryWord = async (w: string) => {
      const r = await fetch(`https://en.wiktionary.org/api/rest_v1/page/html/${encodeURIComponent(w)}`, { headers: HDRS });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`wiktionary ${r.status}`);
      return r.text();
    };
    let html: string | null = null;
    for (const v of variants(word)) {
      html = (await tryWord(v).catch(() => null)) ?? null;
      if (html && /Etymology/i.test(html)) break;
      html = null;
    }
    if (!html) return null;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const english = doc.querySelector('h2#English')?.closest('section') ?? doc.body;
    const heads = Array.from(english.querySelectorAll('h3, h4')).filter((h) => /^Etymology/i.test(h.textContent ?? ''));
    const text: string[] = [];
    for (const h of heads.slice(0, 2)) {
      const sec = h.closest('section');
      const ps = sec ? Array.from(sec.children).filter((c) => c.tagName === 'P') : [];
      if (!ps.length) {
        for (let n = h.nextElementSibling; n && !/^H[1-4]$/.test(n.tagName); n = n.nextElementSibling) if (n.tagName === 'P') ps.push(n);
      }
      for (const p of ps) {
        const t = (p.textContent ?? '').replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
        if (t) text.push(t);
      }
    }
    if (!text.length) return null;
    const roots: Origin['roots'] = [];
    const re = new RegExp(`(${ROOT_LANGS})\\s+([^\\s,;(]+(?:\\s[^\\s,;(]+)?)\\s*(?:\\(([^)]{1,80})\\))?`, 'g');
    const joined = text.join(' ');
    let m;
    while ((m = re.exec(joined)) && roots.length < 6) {
      const form = m[2].replace(/[.,;:]+$/, '');
      if (/^(word|term|from|and|the|via|ultimately|equivalent)$/i.test(form)) continue;
      if (!roots.some((r) => r.form === form)) roots.push({ lang: m[1], form, gloss: m[3]?.replace(/[“”"]/g, '') });
    }
    return { text: text.slice(0, 4), roots };
  });
}

interface WikiPage {
  title: string;
  extract?: string;
  description?: string;
  fullurl?: string;
  canonicalurl?: string;
  thumbnail?: { source: string };
  index?: number;
  missing?: boolean;
}

async function queryWiki(params: Record<string, string>): Promise<WikiPage | null> {
  const qs = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    redirects: '1',
    prop: 'pageimages|extracts|info|description',
    inprop: 'url',
    piprop: 'thumbnail',
    pithumbsize: '760',
    exintro: '1',
    explaintext: '1',
    exsentences: '6',
    ...params,
  });
  const r = await fetch(`https://en.wikipedia.org/w/api.php?${qs}`, { headers: HDRS });
  if (!r.ok) throw new Error(`wikipedia ${r.status}`);
  const j = (await r.json()) as { query?: { pages?: Record<string, WikiPage> } };
  const pages = Object.values(j.query?.pages ?? {}).filter((p) => !p.missing && p.extract);
  pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages[0] ?? null;
}

/** Wikipedia article (with picture) for a word or phrase; exact title first, then best search hit. */
export async function wiki(term: string, exactOnly = false): Promise<WikiCard | null> {
  return cached(`wiki:${exactOnly ? 'x:' : ''}${term.toLowerCase()}`, async () => {
    const cap = term.charAt(0).toUpperCase() + term.slice(1);
    let page = await queryWiki({ titles: term }).catch(() => null);
    if (!page && cap !== term) page = await queryWiki({ titles: cap });
    if (page && /may refer to|disambiguation/i.test(page.extract ?? '') && !exactOnly) {
      page = (await queryWiki({ generator: 'search', gsrsearch: term, gsrlimit: '2', gsrnamespace: '0' }).catch(() => null)) ?? page;
    }
    if (!page && !exactOnly) page = await queryWiki({ generator: 'search', gsrsearch: term, gsrlimit: '1', gsrnamespace: '0' });
    if (!page) return null;
    return {
      title: page.title,
      description: page.description,
      extract: (page.extract ?? '').trim(),
      thumb: page.thumbnail?.source,
      url: page.canonicalurl ?? page.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
    };
  });
}

/** Is this Wikipedia page really about this word (so its picture belongs on the Define tab)? */
export function sameSubject(word: string, card: WikiCard | null): boolean {
  if (!card) return false;
  const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const a = norm(word);
  const b = norm(card.title);
  return variants(a).some((v) => v === b || v + 's' === b) || b === a;
}
