// "Interesting": today's things worth knowing, all free and shared by everyone, so it stays free however many people use it.
//   • one static file, rebuilt a few times a day for every reader (news from public broadcasters worldwide, a figure,
//     a picture, an article, this day in history) — see scripts/build-feed.mjs
//   • a fact of the day, kept in the app
//   • one article a week that has to do with the book you are reading, from Wikipedia (two small requests, then remembered)
// Whatever is fetched is remembered on the phone, so opening the tab again costs nothing, and without a connection the
// last copy (or the one inside the app) is shown.
import * as db from './db';
import { FEED_URLS } from './config';
import { FACTS, type Fact } from '../data/facts';
import type { DocMeta } from './types';

export interface NewsSource {
  name: string;
  region: string;
  title: string;
  url: string;
}
export interface Story {
  id: string;
  title: string;
  summary: string;
  image: string;
  imageFrom: string;
  iw?: number;
  ih?: number;
  time: number;
  sources: NewsSource[];
}
export interface Card {
  title: string;
  description?: string;
  extract?: string;
  image?: string;
  iw?: number;
  ih?: number;
  url?: string;
  year?: number;
  credit?: string;
}
export interface Daily {
  v: number;
  date: string;
  generated: string;
  news: Story[];
  figure?: Card & { year: number };
  picture?: Card;
  featured?: Card;
  history?: { year: number; text: string; image?: string; url?: string }[];
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const timed = async (url: string, ms = 9000) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { signal: c.signal, cache: 'no-cache' });
  } finally {
    clearTimeout(t);
  }
};
const valid = (d: unknown): d is Daily => !!d && typeof d === 'object' && Array.isArray((d as Daily).news) && (d as Daily).v === 1;

export type Loaded = { data: Daily; fresh: boolean; offline: boolean };

/** The first of the shared addresses to answer (all asked at once), saved on the phone. */
async function fetchDaily(): Promise<Daily> {
  const data = await Promise.any(
    FEED_URLS.map(async (url) => {
      const r = await timed(url, 7000);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (!valid(d) || d.news.length < 3) throw new Error('not a feed');
      return d;
    }),
  );
  await db.put('kv', 'daily', { at: Date.now(), data }).catch(() => {});
  return data;
}

/**
 * The day's feed, without ever making the reader wait: what is saved (or the copy inside the app) is returned at once, and
 * when a newer one arrives from the network `onNewer` is called. A saved copy under three hours old needs no request at all.
 */
export async function loadDaily(onNewer: (d: Loaded) => void, force = false): Promise<Loaded> {
  const saved = await db.get<{ at: number; data: Daily }>('kv', 'daily').catch(() => undefined);
  const age = saved ? Date.now() - saved.at : Infinity;
  if (saved && !force && age < 3 * 3600e3) return { data: saved.data, fresh: true, offline: false };
  const net = fetchDaily().then(
    (data) => ({ data, fresh: true, offline: false }) as Loaded,
    () => null,
  );
  let first: Loaded | null = saved ? { data: saved.data, fresh: false, offline: true } : null;
  if (!first) {
    const r = await fetch('./feed/daily.json').catch(() => null);
    const data = r?.ok ? await r.json().catch(() => null) : null;
    if (valid(data)) first = { data, fresh: false, offline: true };
  }
  if (!first) {
    const n = await net; // nothing at all on the phone: wait for the network
    if (n) return n;
    throw new Error('Nothing to show yet — connect once and Froggy will fetch today.');
  }
  net.then((n) => {
    if (n) onNewer(n);
    else onNewer({ ...first!, offline: true });
  });
  return first;
}

const dayNumber = (d = new Date()) => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1970, 0, 1)) / 864e5);
/** The fact for today: a different one each day, the same one for everybody. */
export const factOfDay = (d = new Date()): Fact => FACTS[dayNumber(d) % FACTS.length];
export const wikiUrl = (title: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

export const isoWeek = (d = new Date()) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${Math.ceil(((t.getTime() - y0.getTime()) / 864e5 + 1) / 7)}`;
};
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

// ---------------------------------------------------------------------------------------------- the article of the week
export interface WeekPick {
  because: string; // the book it has to do with
  article: Card;
  more: Card[];
}
const REST = 'https://en.wikipedia.org/api/rest_v1';
const wikiJson = async <T>(url: string): Promise<T> => {
  for (let i = 0; i < 3; i++) {
    const r = await timed(url, 10000);
    if (r.status === 429 || r.status >= 500) {
      await wait(900 * (i + 1) + Math.random() * 400);
      continue;
    }
    if (!r.ok) throw new Error(`Wikipedia ${r.status}`);
    return r.json() as Promise<T>;
  }
  throw new Error('Wikipedia is busy');
};
interface Summary {
  title: string;
  description?: string;
  extract?: string;
  type?: string;
  thumbnail?: { source: string };
  originalimage?: { source: string; width?: number; height?: number };
  content_urls?: { desktop?: { page?: string } };
}
/** the largest standard Wikimedia size the original can fill sharply (never a small picture stretched) */
const bestThumb = (p: Summary) => {
  const src = p.thumbnail?.source;
  if (!src) return p.originalimage?.source;
  const max = Math.min(960, p.originalimage?.width ?? 320);
  const w = [1280, 960, 500, 320].find((x) => x <= max) ?? 320;
  return src.replace(/\/\d+px-/, `/${w}px-`);
};
const asCard = (p: Summary): Card => ({
  title: p.title,
  description: p.description,
  extract: p.extract,
  image: bestThumb(p),
  iw: p.originalimage?.width,
  ih: p.originalimage?.height,
  url: p.content_urls?.desktop?.page ?? wikiUrl(p.title),
});

/** Words that say what a book is about: its title without volume numbers and subtitles, and its author. */
const subjects = (d: DocMeta): string[] => {
  const t = d.name
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/[_\-–—]+/g, ' ')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(pdf|epub|vol(?:ume)?\.?\s*\d+|edition|ed\.|draft|final|copy|scan(?:ned)?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const main = t.split(/[:.|]/)[0].trim();
  return [...new Set([main, d.author?.trim() ?? '', t].filter((x) => x.length > 2))];
};

/**
 * One article a week that relates to what the reader has been reading: the book's title and author are searched on
 * Wikipedia, and a different good result is chosen each week (so the week has a theme: the author, the place, the idea).
 * Two small requests, then it is remembered for the week.
 */
export async function articleOfWeek(doc: DocMeta | undefined): Promise<WeekPick | null> {
  const week = isoWeek();
  const key = `week:${week}:${doc?.id ?? 'none'}`;
  const hit = await db.get<WeekPick | null>('kv', key).catch(() => undefined);
  if (hit) return hit;
  let pick: WeekPick | null = null;
  const seed = hash(week + (doc?.id ?? ''));
  if (doc) {
    const seen = new Set<string>();
    const pool: Summary[] = [];
    for (const q of subjects(doc).slice(0, 2)) {
      try {
        const j = await wikiJson<{ pages?: { key: string; title: string; description?: string; thumbnail?: { url: string } | null }[] }>(`https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(q)}&limit=10`);
        for (const p of j.pages ?? []) {
          if (seen.has(p.key) || /disambiguation|list of/i.test(`${p.title} ${p.description ?? ''}`)) continue;
          seen.add(p.key);
          pool.push({ title: p.title, description: p.description, thumbnail: p.thumbnail ? { source: p.thumbnail.url.startsWith('//') ? `https:${p.thumbnail.url}` : p.thumbnail.url } : undefined });
        }
      } catch {
        /* the next query */
      }
    }
    // a different one each week; pictures first, so the card is never bare
    const ranked = [...pool.filter((p) => p.thumbnail), ...pool.filter((p) => !p.thumbnail)].slice(0, 8);
    const order = ranked.map((_, i) => ranked[(i + seed) % Math.max(1, ranked.length)]);
    for (const c of order) {
      try {
        const s = await wikiJson<Summary>(`${REST}/page/summary/${encodeURIComponent(c.title.replace(/ /g, '_'))}`);
        if (s.type === 'disambiguation' || (s.extract?.length ?? 0) < 120) continue;
        const more = order
          .filter((o) => o.title !== c.title)
          .slice(0, 4)
          .map((o) => ({ title: o.title, description: o.description, image: o.thumbnail?.source, url: wikiUrl(o.title) }) as Card);
        pick = { because: doc.name, article: asCard(s), more };
        break;
      } catch {
        /* the next candidate */
      }
    }
  }
  if (pick) await db.put('kv', key, pick).catch(() => {});
  return pick;
}

/** "3 h ago", "yesterday" */
export function agoShort(t: number) {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 2) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}
