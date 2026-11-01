// Builds the "Interesting" daily feed: ONE small JSON file that every phone downloads, instead of every phone calling
// a dozen servers. That is what keeps Frogity free for any number of readers: the cost is the same for ten people and
// for ten million. A scheduled job (see .github/workflows/feed.yml) runs this a few times a day and publishes
// docs/feed/daily.json, which is served by GitHub Pages (a free CDN).
//
//   node scripts/build-feed.mjs [outfile]
//
// What goes in it (all free and public, with the source named on every item):
//   news    – the day's biggest stories, from public and independent broadcasters around the world. The same story in
//             several outlets is grouped, so a card says who reported it and links to each; stories reported by more
//             outlets, in more regions, rank first (that, not any one outlet's editors, decides what leads).
//   figure  – a person born on this day (Wikipedia's "on this day")
//   picture – Wikimedia's picture of the day · featured – Wikipedia's article of the day · history – this day in history
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const OUT = process.argv[2] || 'docs/feed/daily.json';
const UA = 'FrogityFeedBot/1.0';

const SOURCES = [
  { id: 'bbc', name: 'BBC News', region: 'UK', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { id: 'aje', name: 'Al Jazeera', region: 'Qatar', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { id: 'dw', name: 'DW', region: 'Germany', url: 'https://rss.dw.com/rdf/rss-en-all' },
  { id: 'npr', name: 'NPR', region: 'USA', url: 'https://feeds.npr.org/1001/rss.xml' },
  { id: 'gdn', name: 'The Guardian', region: 'UK', url: 'https://www.theguardian.com/world/rss' },
  { id: 'f24', name: 'France 24', region: 'France', url: 'https://www.france24.com/en/rss' },
  { id: 'abc', name: 'ABC News (Australia)', region: 'Australia', url: 'https://www.abc.net.au/news/feed/2942460/rss.xml' },
  { id: 'afn', name: 'Africanews', region: 'Africa', url: 'https://www.africanews.com/feed/rss' },
  { id: 'eun', name: 'Euronews', region: 'Europe', url: 'https://www.euronews.com/rss?format=mrss&level=theme&name=news' },
  { id: 'hin', name: 'The Hindu', region: 'India', url: 'https://www.thehindu.com/news/international/feeder/default.rss' },
  { id: 'sti', name: 'The Straits Times', region: 'Singapore', url: 'https://www.straitstimes.com/news/world/rss.xml' },
];

const get = async (url, tries = 3, accept = '*/*') => {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (e) {
      err = e;
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
  }
  throw err;
};

// ------------------------------------------------------------------ a tiny RSS / Atom reader (no dependencies)
const dec = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
const text = (s) =>
  dec(dec(s ?? ''))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};
const attr = (block, tagName, a, filter) => {
  for (const m of block.matchAll(new RegExp(`<${tagName}\\b([^>]*)/?>`, 'gi'))) {
    if (filter && !filter.test(m[1])) continue;
    const v = m[1].match(new RegExp(`\\b${a}="([^"]+)"`, 'i'));
    if (v) return dec(v[1]);
  }
  return '';
};
const widest = (block) => {
  let best = '';
  let w = 0;
  for (const m of block.matchAll(/<media:(?:content|thumbnail)\b([^>]*)\/?>/gi)) {
    const u = m[1].match(/\burl="([^"]+)"/i)?.[1];
    if (!u) continue;
    if (/medium="(?:video|audio)"|type="(?:video|audio)/i.test(m[1])) continue;
    const ww = Number(m[1].match(/\bwidth="(\d+)"/i)?.[1] ?? 0);
    if (!best || ww > w) {
      best = dec(u);
      w = ww;
    }
  }
  return best;
};
function parseFeed(xml) {
  const items = [];
  for (const m of xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const b = m[2];
    const title = text(tag(b, 'title'));
    const link = text(tag(b, 'link')) || attr(b, 'link', 'href', /rel="alternate"|^(?!.*rel=)/i);
    const desc = tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded') || tag(b, 'content');
    let image = widest(b) || attr(b, 'enclosure', 'url', /type="image|\.(jpe?g|png|webp)/i);
    if (!image) image = dec(desc).match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ?? '';
    const date = text(tag(b, 'pubDate') || tag(b, 'dc:date') || tag(b, 'published') || tag(b, 'updated'));
    const t = Date.parse(date);
    image = image.replace('/standard/240/', '/standard/800/').replace('/standard/144/', '/standard/800/'); // BBC sends thumbnails
    if (title && link) items.push({ title, link, summary: text(desc).slice(0, 400), image, time: Number.isFinite(t) ? t : 0 });
  }
  return items;
}

// ------------------------------------------------------------------ grouping the same story from different outlets
const STOP = new Set('the a an and or of to in on for with is are was were be been it this that as at by from into about after before over under says say said new will would could has have had not its their his her they them than more most amid out up off how why what who when where which you your our can may just also report reports reported live latest news update updates video watch'.split(' '));
const words = (t) => new Set((t.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/)).filter((w) => w.length > 2 && !STOP.has(w)));
const sim = (a, b) => {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.max(1, Math.min(a.size, b.size));
};

async function news() {
  const all = [];
  await Promise.all(
    SOURCES.map(async (s) => {
      try {
        const xml = await (await get(s.url, 3, 'application/rss+xml, application/xml, text/xml')).text();
        const items = parseFeed(xml).slice(0, 25);
        console.log(`  ${s.name}: ${items.length} items`);
        for (const it of items) all.push({ ...it, src: s });
      } catch (e) {
        console.warn(`  ${s.name}: skipped (${e.message})`);
      }
    }),
  );
  const now = Date.now();
  const fresh = all.filter((a) => !a.time || now - a.time < 36 * 3600e3);
  const clusters = [];
  for (const a of fresh) {
    a.w = words(a.title);
    const hit = clusters.find((c) => c.items.every((x) => x.src.id !== a.src.id) && c.items.some((x) => sim(x.w, a.w) >= 0.55 && Math.min(x.w.size, a.w.size) >= 3));
    if (hit) hit.items.push(a);
    else clusters.push({ items: [a] });
  }
  const scored = clusters.map((c) => {
    const regions = new Set(c.items.map((i) => i.src.region));
    const newest = Math.max(...c.items.map((i) => i.time || 0));
    const age = newest ? (now - newest) / 3600e3 : 12;
    // reported by many outlets, across regions, and recently
    return { c, score: c.items.length * 3 + regions.size * 2 - age / 6 + (c.items.some((i) => i.image) ? 0.5 : -2) };
  });
  scored.sort((x, y) => y.score - x.score);
  // never more than three leading stories from one outlet, and at most 14 cards: a short, finishable list
  const used = {};
  const out = [];
  for (const { c } of scored) {
    const lead = c.items.find((i) => i.image) ?? c.items[0];
    if (!lead.image) continue;
    if ((used[lead.src.id] ?? 0) >= 3 && c.items.length < 2) continue;
    used[lead.src.id] = (used[lead.src.id] ?? 0) + 1;
    out.push({
      id: createHash('sha1').update(lead.link).digest('hex').slice(0, 10),
      title: lead.title,
      summary: [...c.items].sort((a, b) => b.summary.length - a.summary.length)[0].summary,
      image: lead.image,
      imageFrom: lead.src.name,
      time: Math.max(...c.items.map((i) => i.time || 0)) || now,
      sources: c.items.map((i) => ({ name: i.src.name, region: i.src.region, title: i.title, url: i.link })),
    });
    if (out.length >= 14) break;
  }
  return out;
}

// ------------------------------------------------------------------ Wikipedia / Wikimedia: figure, picture, article of the day, this day in history
const slim = (p) =>
  p && {
    title: p.titles?.normalized ?? p.title,
    description: p.description ?? '',
    extract: (p.extract ?? '').slice(0, 700),
    image: p.thumbnail?.source?.replace(/\/\d+px-/, '/500px-') ?? p.originalimage?.source ?? '',
    url: p.content_urls?.desktop?.page ?? '',
  };

async function wikipedia(d) {
  const y = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const out = {};
  try {
    const f = await (await get(`https://en.wikipedia.org/api/rest_v1/feed/featured/${y}/${mm}/${dd}`, 4)).json();
    if (f.tfa) out.featured = slim(f.tfa);
    if (f.image)
      out.picture = {
        title: (f.image.title ?? '').replace(/^File:/, '').replace(/\.[a-z]+$/i, '').replace(/_/g, ' '),
        description: text(f.image.description?.text ?? ''),
        image: f.image.thumbnail?.source?.replace(/\/\d+px-/, '/960px-') ?? f.image.image?.source ?? '',
        credit: text(f.image.artist?.html ?? ''),
        url: f.image.file_page ?? '',
      };
    out.history = (f.onthisday ?? [])
      .filter((e) => e.text && e.year)
      .slice(0, 6)
      .map((e) => ({ year: e.year, text: e.text, image: e.pages?.[0]?.thumbnail?.source ?? '', url: e.pages?.[0]?.content_urls?.desktop?.page ?? '' }));
  } catch (e) {
    console.warn('  featured feed skipped:', e.message);
  }
  try {
    const b = await (await get(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/births/${mm}/${dd}`, 4)).json();
    const seed = Number(`${y}${mm}${dd}`);
    const pool = (b.births ?? [])
      .map((e) => ({ e, p: e.pages?.[0] }))
      .filter(({ p }) => p?.thumbnail && (p.extract?.length ?? 0) > 120 && p.type === 'standard' && !/disambig/i.test(p.description ?? ''))
      .filter(({ e }) => e.year > 0 && e.year < y - 25);
    // the best-known people first (by how many people read their article last month), then a different one each day
    const month = new Date(Date.UTC(y, d.getUTCMonth() - 1, 1));
    const ym = `${month.getUTCFullYear()}${String(month.getUTCMonth() + 1).padStart(2, '0')}01`;
    const views = async ({ p }) => {
      try {
        const t = encodeURIComponent((p.titles?.canonical ?? p.title).replace(/ /g, '_'));
        const j = await (await get(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${t}/monthly/${ym}/${ym}`, 2)).json();
        return j.items?.[0]?.views ?? 0;
      } catch {
        return 0;
      }
    };
    const cand = pool.slice(0, 60);
    const counts = [];
    for (let i = 0; i < cand.length; i += 10) counts.push(...(await Promise.all(cand.slice(i, i + 10).map(views))));
    const ranked = cand.map((c, i) => ({ ...c, v: counts[i] })).sort((a, b) => b.v - a.v || b.p.extract.length - a.p.extract.length);
    const top = ranked.slice(0, 5);
    const pick = top[seed % Math.max(1, top.length)];
    if (pick) out.figure = { year: pick.e.year, ...slim(pick.p) };
  } catch (e) {
    console.warn('  figure skipped:', e.message);
  }
  return out;
}

const today = new Date();
console.log('Building the daily feed for', today.toISOString().slice(0, 10));
const [stories, wiki] = await Promise.all([news(), wikipedia(today)]);
const feed = {
  v: 1,
  date: today.toISOString().slice(0, 10),
  generated: today.toISOString(),
  news: stories,
  ...wiki,
};
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(feed));
console.log(`Wrote ${OUT}: ${stories.length} stories${feed.figure ? ', a figure' : ''}${feed.picture ? ', a picture' : ''}${feed.featured ? ', an article' : ''}${feed.history ? `, ${feed.history.length} events` : ''}`);
if (stories.length < 5) {
  console.error('Too few stories — not publishing a thin feed.');
  process.exit(1);
}
