// Word lookup, all from free public sources:
//   definitions → dictionaryapi.dev (Wiktionary-derived), falling back to Wiktionary's own definition API
//   origin      → Wiktionary etymology (Greek/Latin roots pulled out as chips)
//   encyclopedia + picture → Wikipedia (+ Wikimedia images)
import * as db from './db';
import { wikiHtmlToRich } from './mathtext';

const HDRS = { 'Api-User-Agent': 'Frogity/1.1 (personal reading app)' };

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
export interface WikiImage {
  src: string; // ~640px thumbnail
  full?: string; // original file
  title: string;
  w: number;
  h: number;
  credit?: string;
  lead?: boolean; // the article's own lead picture
}
export interface WikiCard {
  title: string;
  description?: string;
  extract: string; // plain text
  html: string; // sanitised summary with typeset maths
  thumb?: string;
  images: WikiImage[];
  url: string;
}

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = await db.get<{ v: T; at: number }>('kv', 'lk3:' + key).catch(() => undefined);
  if (hit && Date.now() - hit.at < 30 * 864e5) return hit.v;
  const v = await fn();
  if (v) db.put('kv', 'lk3:' + key, { v, at: Date.now() }).catch(() => {});
  return v;
}

const LIG: Record<string, string> = { '\ufb00': 'ff', '\ufb01': 'fi', '\ufb02': 'fl', '\ufb03': 'ffi', '\ufb04': 'ffl' };
/** The word as a dictionary spells it: no soft hyphens, ligature glyphs, curly quotes or the punctuation next to it. */
export const normalizeWord = (w: string) =>
  w
    .normalize('NFC')
    .replace(/[\ufb00-\ufb04]/g, (c) => LIG[c] ?? c)
    .replace(/\u00ad/g, '')
    .replace(/[’‘`´]/g, "'")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/'s$/i, '');

const stripTags = (h: string) => {
  const d = new DOMParser().parseFromString(h, 'text/html');
  d.querySelectorAll('sup, style, .mw-ref').forEach((n) => n.remove());
  return (d.body.textContent ?? '').replace(/\s+/g, ' ').trim();
};

/** "running" → running, run; "studies" → studies, study, studie … (tried in order) */
function variants(w: string, lang = 'en'): string[] {
  const lw = w.toLowerCase();
  const out = [lw];
  const add = (x: string) => x.length > 2 && !out.includes(x) && out.push(x);
  if (lang !== 'en') {
    // other languages: plurals, feminine forms, common verb endings, and the word without its accents' variants
    if (lw.endsWith('s')) add(lw.slice(0, -1));
    if (lw.endsWith('es')) add(lw.slice(0, -2));
    if (lw.endsWith('x')) add(lw.slice(0, -1));
    if (lw.endsWith('a') || lw.endsWith('as')) add(lw.replace(/as?$/, 'o'));
    if (lw.endsWith('e') && lang === 'fr') add(lw.slice(0, -1));
    if (/(ando|iendo|ado|ido)$/.test(lw)) add(lw.replace(/(ando|ado)$/, 'ar').replace(/(iendo|ido)$/, 'er'));
    if (/(ent|ons|ez)$/.test(lw) && lang === 'fr') add(lw.replace(/(ent|ons|ez)$/, 'er'));
    if (/(en|te|st|t)$/.test(lw) && lang === 'de') add(lw.replace(/(en|te|st|t)$/, 'en'));
    if (/(er|e)$/.test(lw) && lang === 'de') add(lw.replace(/e$/, ''));
    if (lw.includes('-')) lw.split('-').forEach(add);
    return out;
  }
  if (lw.includes('-')) lw.split('-').forEach(add);
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

const DICT_LANGS = new Set(['en', 'es', 'fr', 'de', 'it', 'ru', 'tr', 'ko', 'ja', 'hi', 'ar']);
async function fromDictionaryApi(w: string, lang = 'en'): Promise<Definition | null> {
  if (!DICT_LANGS.has(lang)) return null;
  const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/${lang}/${encodeURIComponent(w)}`);
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

async function fromWiktionary(w: string, lang = 'en'): Promise<Definition | null> {
  const r = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(w)}`, { headers: HDRS });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`wiktionary ${r.status}`);
  const j = (await r.json()) as Record<string, { partOfSpeech: string; definitions: { definition: string; examples?: string[] }[] }[]>;
  // the book's own language first; otherwise English, otherwise whatever language the word belongs to
  const en = j[lang] ?? j.en ?? Object.values(j)[0];
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

export async function define(word: string, lang = 'en'): Promise<Definition | null> {
  return cached(`def:${lang}:` + word.toLowerCase(), async () => {
    let failure: unknown = null;
    for (const v of variants(word, lang)) {
      for (const src of [(x: string) => fromDictionaryApi(x, lang), (x: string) => fromWiktionary(x, lang)]) {
        try {
          const d = await src(v);
          if (d) return d;
        } catch (e) {
          failure = e;
        }
      }
    }
    // a word the book borrowed from English (or the reverse): the other dictionary may know it
    if (lang !== 'en') {
      const d = await fromWiktionary(word.toLowerCase(), 'en').catch(() => null);
      if (d) return d;
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
    exlimit: 'max',
    ...params,
  });
  const r = await fetch(`https://en.wikipedia.org/w/api.php?${qs}`, { headers: HDRS });
  if (!r.ok) throw new Error(`wikipedia ${r.status}`);
  const j = (await r.json()) as { query?: { pages?: Record<string, WikiPage> } };
  const pages = Object.values(j.query?.pages ?? {}).filter((p) => !p.missing && p.extract);
  pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages[0] ?? null;
}

const NOT_PICTURES = /(logo|icon|flag_of|commons-|wiki(?:media|data|pedia|source|quote|books|versity|news|voyage|species)|question_book|ambox|edit-|increase2|decrease2|steady2|crystal_clear|folder|nuvola|padlock|symbol|portal|stub|disambig|oojs|redirect|information_icon|lock-|searchtool|merge-|split-|text_document|gnome|p_vip|star_|speaker_icon|loudspeaker|audio|button|arrow|blank|pending|wikt|ooui|vote|check_mark|cross_|red_pencil|cscr|translation|semi-protection|cartoon|clipart|clip_art|emoji|emoticon|smiley|sticker|meme|comic|anime|manga|doodle|chibi|mascot|avatar|screenshot|poster|template|pictogram|ikon|badge|seal_of|coat_of_arms|signature|autograph|diagram_|chart|graph|banner|header|wordmark|stamp|sprite|animation|animated|gif)/i;

const plain = (h?: string) => (h ? h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : '');

interface RawInfo {
  title: string;
  imageinfo?: {
    thumburl?: string;
    thumbwidth?: number;
    thumbheight?: number;
    url?: string;
    width?: number;
    height?: number;
    mime?: string;
    extmetadata?: Record<string, { value?: string }>;
  }[];
}

/** Words of the subject that a picture's file name must mention to count as "about" it. */
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'file', 'image', 'photo', 'jpg', 'jpeg', 'png']);
const subjectTokens = (...names: string[]) =>
  new Set(names.flatMap((n) => n.toLowerCase().split(/[^\p{L}]+/u)).filter((t) => t.length >= 4 && !STOPWORDS.has(t)));

function toImages(pages: Record<string, RawInfo> | undefined, first?: string, tokens?: Set<string>, cap = 6): WikiImage[] {
  const out: WikiImage[] = [];
  for (const p of Object.values(pages ?? {})) {
    const ii = p.imageinfo?.[0];
    // real photographs and paintings only: no vector art, no animations
    if (!ii?.thumburl || !/^image\/(jpeg|png|webp|tiff)/.test(ii.mime ?? '')) continue;
    if (NOT_PICTURES.test(p.title)) continue;
    const w = ii.width ?? ii.thumbwidth ?? 0;
    const h = ii.height ?? ii.thumbheight ?? 0;
    if (Math.max(w, h) < 480 || Math.min(w, h) < 260) continue; // icons, slivers, thumbnails
    const ratio = w / Math.max(1, h);
    if (ratio < 0.5 || ratio > 2.4) continue;
    const rawName = p.title.replace(/^File:/, '').replace(/ /g, '_');
    let decodedFirst = first ?? '';
    try {
      decodedFirst = decodeURIComponent(decodedFirst);
    } catch {
      /* keep as is */
    }
    const isLead = !!first && decodedFirst.includes(rawName);
    const name = p.title.replace(/^File:/, '').replace(/[_\-.]+/g, ' ').toLowerCase();
    // tightly related: the picture's own name has to mention the subject (the lead picture always does)
    if (!isLead && tokens && ![...tokens].some((t) => name.includes(t))) continue;
    const meta = ii.extmetadata ?? {};
    const artist = plain(meta.Artist?.value).slice(0, 60);
    const lic = plain(meta.LicenseShortName?.value);
    out.push({
      lead: isLead,
      src: ii.thumburl,
      full: ii.url,
      title: p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '').replace(/_/g, ' '),
      w: ii.thumbwidth ?? w,
      h: ii.thumbheight ?? h,
      credit: [artist, lic].filter(Boolean).join(' · ') || undefined,
    });
  }
  // lead picture first, then the biggest remaining
  out.sort((a, b) => (a.lead ? -1 : b.lead ? 1 : b.w * b.h - a.w * a.h));
  const seen = new Set<string>();
  return out.filter((i) => (seen.has(i.src) ? false : (seen.add(i.src), true))).slice(0, cap);
}

const IMG_PROPS = { prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '640', origin: '*', format: 'json', action: 'query' };

async function articleImages(title: string, lead?: string, term?: string): Promise<WikiImage[]> {
  const qs = new URLSearchParams({ ...IMG_PROPS, generator: 'images', titles: title, gimlimit: '50' });
  const r = await fetch(`https://en.wikipedia.org/w/api.php?${qs}`, { headers: HDRS });
  if (!r.ok) return [];
  const j = (await r.json()) as { query?: { pages?: Record<string, RawInfo> } };
  return toImages(j.query?.pages, lead, subjectTokens(title, term ?? ''), 6);
}

/** Wikimedia Commons search: pictures for topics whose article has few or none. */
async function commonsImages(term: string): Promise<WikiImage[]> {
  const qs = new URLSearchParams({ ...IMG_PROPS, generator: 'search', gsrsearch: `${term} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '14' });
  const r = await fetch(`https://commons.wikimedia.org/w/api.php?${qs}`, { headers: HDRS });
  if (!r.ok) return [];
  const j = (await r.json()) as { query?: { pages?: Record<string, RawInfo> } };
  return toImages(j.query?.pages, undefined, subjectTokens(term), 4);
}

/** Wikipedia article (with a gallery of pictures); exact title first, then best search hit. */
export async function wiki(term: string, exactOnly = false): Promise<WikiCard | null> {
  return cached(`wiki:${exactOnly ? 'x:' : ''}${term.toLowerCase()}`, async () => {
    const cap = term.charAt(0).toUpperCase() + term.slice(1);
    let page = await queryWiki({ titles: term }).catch(() => null);
    if (!page && cap !== term) page = await queryWiki({ titles: cap });
    if (page && /may refer to|disambiguation/i.test(page.extract ?? '') && !exactOnly) {
      page = (await queryWiki({ generator: 'search', gsrsearch: term, gsrlimit: '2', gsrnamespace: '0' }).catch(() => null)) ?? page;
    }
    if (!page && !exactOnly) page = await queryWiki({ generator: 'search', gsrsearch: term, gsrlimit: '1', gsrnamespace: '0' });

    let images: WikiImage[] = [];
    if (page) {
      images = await articleImages(page.title, page.thumbnail?.source, term).catch(() => []);
      // the lead picture is always allowed, even if the filters above would have dropped it
      if (page.thumbnail?.source && !images.some((i) => i.src === page!.thumbnail!.source)) {
        images.unshift({ src: page.thumbnail.source, title: page.title, w: 640, h: 480 });
        images = images.slice(0, 6);
      }
    }
    // only when the article has no usable picture of its own: a few Commons photographs that name the subject
    if (images.length < 2 && !exactOnly) {
      const more = await commonsImages(page?.title ?? term).catch(() => []);
      const have = new Set(images.map((i) => i.title));
      images = [...images, ...more.filter((m) => !have.has(m.title))].slice(0, 5);
    }
    if (!page && !images.length) return null;
    if (!page) {
      return { title: cap, extract: '', html: '', images, url: `https://commons.wikimedia.org/w/index.php?search=${encodeURIComponent(term)}&ns6=1` };
    }
    const rich = wikiHtmlToRich(page.extract ?? '');
    return {
      title: page.title,
      description: page.description,
      extract: rich.text,
      html: rich.html,
      thumb: images[0]?.src ?? page.thumbnail?.source,
      images,
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
