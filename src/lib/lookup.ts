// Word lookup: dictionary definition, etymology (with Greek/Latin roots) and a Wikipedia card.
import * as db from './db';

const HDRS = { 'Api-User-Agent': 'Quire/1.0 (personal reading app)' };

export interface Definition {
  word: string;
  phonetic?: string;
  audio?: string;
  meanings: { pos: string; defs: { d: string; ex?: string }[]; synonyms: string[] }[];
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
  const hit = await db.get<{ v: T; at: number }>('kv', 'lk:' + key).catch(() => undefined);
  if (hit && Date.now() - hit.at < 30 * 864e5) return hit.v;
  const v = await fn();
  if (v) db.put('kv', 'lk:' + key, { v, at: Date.now() }).catch(() => {});
  return v;
}

export const normalizeWord = (w: string) =>
  w
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/[’']s$/i, '');

export async function define(word: string): Promise<Definition | null> {
  return cached('def:' + word.toLowerCase(), async () => {
    const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`dictionary ${r.status}`);
    const data = (await r.json()) as {
      word: string;
      phonetic?: string;
      phonetics?: { text?: string; audio?: string }[];
      meanings: { partOfSpeech: string; definitions: { definition: string; example?: string }[]; synonyms?: string[] }[];
    }[];
    if (!Array.isArray(data) || !data.length) return null;
    const first = data[0];
    const meanings: Definition['meanings'] = [];
    for (const e of data)
      for (const m of e.meanings) {
        const ex = meanings.find((x) => x.pos === m.partOfSpeech);
        const defs = m.definitions.slice(0, 4).map((d) => ({ d: d.definition, ex: d.example }));
        if (ex) ex.defs.push(...defs.slice(0, 2));
        else meanings.push({ pos: m.partOfSpeech, defs, synonyms: (m.synonyms ?? []).slice(0, 6) });
      }
    return {
      word: first.word,
      phonetic: first.phonetic ?? first.phonetics?.find((p) => p.text)?.text,
      audio: data.flatMap((d) => d.phonetics ?? []).find((p) => p.audio)?.audio || undefined,
      meanings,
    };
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
    const html = (await tryWord(word)) ?? (await tryWord(word.toLowerCase()));
    if (!html) return null;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Parsoid: <section><h2 id="English">… <section><h3 id="Etymology">…<p>
    const english = doc.querySelector('h2#English')?.closest('section') ?? doc.body;
    const heads = Array.from(english.querySelectorAll('h3, h4')).filter((h) => /^Etymology/i.test(h.textContent ?? ''));
    const text: string[] = [];
    for (const h of heads.slice(0, 2)) {
      const sec = h.closest('section');
      const ps = sec ? Array.from(sec.children).filter((c) => c.tagName === 'P') : [];
      // Non-Parsoid fallback: walk siblings until next heading
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

export async function wiki(term: string): Promise<WikiCard | null> {
  return cached('wiki:' + term.toLowerCase(), async () => {
    const get = async (t: string) => {
      const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, '_'))}?redirect=true`, { headers: HDRS });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`wikipedia ${r.status}`);
      const j = await r.json();
      if (j.type === 'disambiguation' && !j.extract) return null;
      return {
        title: j.title,
        description: j.description,
        extract: j.extract,
        thumb: j.thumbnail?.source,
        url: j.content_urls?.mobile?.page ?? j.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(t)}`,
      } as WikiCard;
    };
    let card = await get(term);
    if (!card) {
      const s = await fetch(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(term)}&limit=1&namespace=0&format=json&origin=*`, { headers: HDRS });
      if (s.ok) {
        const j = await s.json();
        const t = j?.[1]?.[0];
        if (t) card = await get(t);
      }
    }
    return card;
  });
}
