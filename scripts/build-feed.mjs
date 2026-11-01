// Builds the "Interesting" daily feed: ONE small JSON file that every phone downloads, instead of every phone calling
// a dozen servers. That is what keeps Frogity free for any number of readers: the cost is the same for ten people and
// for ten million. A scheduled job (see .github/workflows/feed.yml) runs this a few times a day and publishes
// docs/feed/daily.json, which is served by GitHub Pages (a free CDN).
//
//   node scripts/build-feed.mjs [outfile]
//
// What goes in it (all free and public, with the source named on every item):
//   news    – the day's stories on many topics (not only the heavy ones), from public and independent broadcasters around the world. The same story in
//             several outlets is grouped, so a card says who reported it and links to each; stories reported by more
//             outlets, in more regions, rank first (that, not any one outlet's editors, decides what leads).
//   figure  – a person born on this day (Wikipedia's "on this day")
//   picture – Wikimedia's picture of the day · featured – Wikipedia's article of the day · history – this day in history
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const OUT = process.argv[2] || 'docs/feed/daily.json';
const UA = 'FrogityFeedBot/1.0';

const get = async (url, tries = 3, accept = '*/*') => {
  if (/wikipedia\.org\/w\/api/.test(url)) tries = Math.max(tries, 5);
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (e) {
      err = e;
      await new Promise((res) => setTimeout(res, (/429/.test(e.message) ? 5000 : 1500) * (i + 1)));
    }
  }
  throw err;
};

// ------------------------------------------------------------------ is this picture good enough to show?
/** width × height of a JPEG / PNG / WebP / GIF from its first bytes */
function dims(b) {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 10 && b.toString('ascii', 0, 3) === 'GIF') return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const k = b.toString('ascii', 12, 16);
    if (k === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (k === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (k === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}
async function probe(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Range: 'bytes=0-65535' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const chunks = [];
    let n = 0;
    const rd = r.body.getReader();
    while (n < 65536) {
      const { done, value } = await rd.read();
      if (done) break;
      chunks.push(value);
      n += value.length;
    }
    rd.cancel().catch(() => {});
    return dims(Buffer.concat(chunks));
  } catch {
    return null;
  }
}
const WIKI_STEPS = [320, 500, 960, 1280, 1920];
/** a Wikimedia thumbnail at the largest standard size the original can fill (never a stretched small one) */
const wikiThumb = (p, want = 960) => {
  const src = p?.thumbnail?.source;
  if (!src) return p?.originalimage?.source ?? '';
  const max = Math.min(want, p.originalimage?.width ?? 320);
  const w = [...WIKI_STEPS].reverse().find((x) => x <= max) ?? 320;
  return src.replace(/\/\d+px-/, `/${w}px-`);
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

// ------------------------------------------------------------------ who is who
// Every outlet, with a rough place on the political spectrum (−2 left … 0 centre … +2 right) taken from public media-bias
// ratings (such as AllSides and Ad Fontes). These are approximations, often disputed: the app shows them as a prompt to
// compare how different outlets cover a story, never as a verdict. `null` = not a news outlet with a political line.
const OUTLETS = [
  { id: 'bbc', name: 'BBC News', region: 'UK', domain: 'bbc.com', kind: 'public', lean: 0, about: 'Public broadcaster, funded by the UK licence fee, with a charter requiring impartiality.',
    feeds: [['https://feeds.bbci.co.uk/news/world/rss.xml', 'world'], ['https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', 'science'], ['https://feeds.bbci.co.uk/news/technology/rss.xml', 'tech'], ['https://feeds.bbci.co.uk/news/health/rss.xml', 'health'], ['https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', 'culture'], ['https://feeds.bbci.co.uk/news/business/rss.xml', 'business'], ['https://feeds.bbci.co.uk/sport/rss.xml', 'sport']] },
  { id: 'aje', name: 'Al Jazeera', region: 'Qatar', domain: 'aljazeera.com', kind: 'state-funded', lean: -1, about: 'International broadcaster funded by the state of Qatar; strong coverage of the Middle East and the Global South.', feeds: [['https://www.aljazeera.com/xml/rss/all.xml', 'world']] },
  { id: 'dw', name: 'DW', region: 'Germany', domain: 'dw.com', kind: 'public', lean: 0, about: 'Germany’s international public broadcaster, funded by the federal budget, editorially independent.', feeds: [['https://rss.dw.com/rdf/rss-en-all', 'world']] },
  { id: 'npr', name: 'NPR', region: 'USA', domain: 'npr.org', kind: 'public', lean: -1, about: 'US non-profit public radio, funded by member stations, donors and sponsors.',
    feeds: [['https://feeds.npr.org/1001/rss.xml', 'world'], ['https://feeds.npr.org/1007/rss.xml', 'science'], ['https://feeds.npr.org/1128/rss.xml', 'health'], ['https://feeds.npr.org/1008/rss.xml', 'culture'], ['https://feeds.npr.org/1019/rss.xml', 'tech']] },
  { id: 'gdn', name: 'The Guardian', region: 'UK', domain: 'theguardian.com', kind: 'independent', lean: -1.5, about: 'UK newspaper owned by a trust whose purpose is to keep it independent; editorially liberal.',
    feeds: [['https://www.theguardian.com/world/rss', 'world'], ['https://www.theguardian.com/science/rss', 'science'], ['https://www.theguardian.com/technology/rss', 'tech'], ['https://www.theguardian.com/culture/rss', 'culture'], ['https://www.theguardian.com/environment/rss', 'environment'], ['https://www.theguardian.com/sport/rss', 'sport'], ['https://www.theguardian.com/business/rss', 'business']] },
  { id: 'f24', name: 'France 24', region: 'France', domain: 'france24.com', kind: 'state-funded', lean: 0, about: 'French international news channel, funded by the French state.', feeds: [['https://www.france24.com/en/rss', 'world']] },
  { id: 'abc', name: 'ABC Australia', region: 'Australia', domain: 'abc.net.au', kind: 'public', lean: 0, about: 'Australia’s public broadcaster, funded by the government at arm’s length.', feeds: [['https://www.abc.net.au/news/feed/2942460/rss.xml', 'world']] },
  { id: 'afn', name: 'Africanews', region: 'Africa', domain: 'africanews.com', kind: 'independent', lean: 0, about: 'Pan-African news channel, part of the Euronews group.', feeds: [['https://www.africanews.com/feed/rss', 'world']] },
  { id: 'eun', name: 'Euronews', region: 'Europe', domain: 'euronews.com', kind: 'independent', lean: 0, about: 'Pan-European news channel based in Lyon.', feeds: [['https://www.euronews.com/rss?format=mrss&level=theme&name=news', 'world']] },
  { id: 'hin', name: 'The Hindu', region: 'India', domain: 'thehindu.com', kind: 'independent', lean: -0.5, about: 'Indian national daily with a centre-left tradition.', feeds: [['https://www.thehindu.com/news/international/feeder/default.rss', 'world']] },
  { id: 'sti', name: 'The Straits Times', region: 'Singapore', domain: 'straitstimes.com', kind: 'commercial', lean: 0.5, about: 'Singapore’s main English daily; generally seen as close to the government’s line.', feeds: [['https://www.straitstimes.com/news/world/rss.xml', 'world']] },
  { id: 'fox', name: 'Fox News', region: 'USA', domain: 'foxnews.com', kind: 'commercial', lean: 2, about: 'US cable news channel; right-leaning commentary, news desk rated more centrist.', feeds: [['https://moxie.foxnews.com/google-publisher/world.xml', 'world']] },
  { id: 'tel', name: 'The Telegraph', region: 'UK', domain: 'telegraph.co.uk', kind: 'commercial', lean: 1.5, about: 'UK newspaper with a conservative editorial line.', feeds: [['https://www.telegraph.co.uk/rss.xml', 'world']] },
  { id: 'wsj', name: 'Wall Street Journal', region: 'USA', domain: 'wsj.com', kind: 'commercial', lean: 0.5, about: 'US business daily; news reporting rated centrist, editorial page conservative.', feeds: [['https://feeds.a.dj.com/rss/RSSWorldNews.xml', 'world']] },
  { id: 'nyp', name: 'New York Post', region: 'USA', domain: 'nypost.com', kind: 'commercial', lean: 1.5, about: 'US tabloid with a conservative editorial line.', feeds: [['https://nypost.com/feed/', 'world']] },
  { id: 'ind', name: 'The Independent', region: 'UK', domain: 'independent.co.uk', kind: 'commercial', lean: -0.5, about: 'UK online-only newspaper, centre-left.', feeds: [['https://www.independent.co.uk/news/world/rss', 'world']] },
  { id: 'sky', name: 'Sky News', region: 'UK', domain: 'news.sky.com', kind: 'commercial', lean: 0, about: 'UK broadcaster bound by impartiality rules.', feeds: [['https://feeds.skynews.com/feeds/rss/world.xml', 'world']] },
  { id: 'cnn', name: 'CNN', region: 'USA', domain: 'cnn.com', kind: 'commercial', lean: -1, about: 'US cable news channel; leans left in commentary.', feeds: [['http://rss.cnn.com/rss/edition_world.rss', 'world']] },
  { id: 'cbs', name: 'CBS News', region: 'USA', domain: 'cbsnews.com', kind: 'commercial', lean: -0.5, about: 'US broadcast network news.', feeds: [['https://www.cbsnews.com/latest/rss/world', 'world']] },
  { id: 'hpo', name: 'HuffPost', region: 'USA', domain: 'huffpost.com', kind: 'commercial', lean: -2, about: 'US news site with a progressive editorial line.', feeds: [['https://www.huffpost.com/section/world-news/feed', 'world']] },
  // not political: science, technology, good news
  { id: 'nasa', name: 'NASA', region: 'USA', domain: 'nasa.gov', kind: 'agency', lean: null, about: 'The US space agency’s own news.', feeds: [['https://www.nasa.gov/feed/', 'science']] },
  { id: 'sdy', name: 'ScienceDaily', region: 'USA', domain: 'sciencedaily.com', kind: 'independent', lean: null, about: 'Science news compiled from universities and research institutions.', feeds: [['https://www.sciencedaily.com/rss/top.xml', 'science']] },
  { id: 'nat', name: 'Nature', region: 'UK', domain: 'nature.com', kind: 'journal', lean: null, about: 'Leading science journal; news and research highlights.', feeds: [['https://www.nature.com/nature.rss', 'science']] },
  { id: 'nwa', name: 'New Atlas', region: 'Global', domain: 'newatlas.com', kind: 'independent', lean: null, about: 'Technology and science news.', feeds: [['https://newatlas.com/index.rss', 'tech']] },
  { id: 'gnn', name: 'Good News Network', region: 'USA', domain: 'goodnewsnetwork.org', kind: 'independent', lean: null, about: 'Reports only positive stories.', feeds: [['https://www.goodnewsnetwork.org/feed/', 'good']] },
  { id: 'pos', name: 'Positive News', region: 'UK', domain: 'positive.news', kind: 'cooperative', lean: null, about: 'Journalism about progress, owned by its readers.', feeds: [['https://www.positive.news/feed/', 'good']] },
];
const READ_SOURCES = [
  { id: 'atl', name: 'Atlas Obscura', domain: 'atlasobscura.com', kind: 'curious', url: 'https://www.atlasobscura.com/feeds/latest' },
  { id: 'smi', name: 'Smithsonian', domain: 'smithsonianmag.com', kind: 'curious', url: 'https://www.smithsonianmag.com/rss/latest_articles/' },
  { id: 'aeo', name: 'Aeon', domain: 'aeon.co', kind: 'long', url: 'https://aeon.co/feed.rss' },
  { id: 'lgr', name: 'Longreads', domain: 'longreads.com', kind: 'long', url: 'https://longreads.com/feed/' },
  { id: 'nau', name: 'Nautilus', domain: 'nautil.us', kind: 'long', url: 'https://nautil.us/feed/' },
  { id: 'qua', name: 'Quanta Magazine', domain: 'quantamagazine.org', kind: 'article', url: 'https://api.quantamagazine.org/feed/' },
  { id: 'con', name: 'The Conversation', domain: 'theconversation.com', kind: 'article', url: 'https://theconversation.com/global/articles.atom' },
  { id: 'big', name: 'Big Think', domain: 'bigthink.com', kind: 'article', url: 'https://bigthink.com/feed/' },
];

// ------------------------------------------------------------------ logos (embedded, so the app never asks a third party for them)
async function logo(domain) {
  const tryFetch = async (url, minBytes = 500) => {
    try {
      const r = await get(url, 2);
      const b = Buffer.from(await r.arrayBuffer());
      const type = (r.headers.get('content-type') || '').split(';')[0] || 'image/png';
      if (b.length < minBytes || b.length > 60000 || !/^image\//.test(type)) return '';
      return `data:${type};base64,${b.toString('base64')}`;
    } catch {
      return '';
    }
  };
  try {
    const html = await (await get(`https://${domain}/`, 2)).text();
    const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).filter((t) => /rel=["'][^"']*(apple-touch-icon|icon)[^"']*["']/i.test(t) && !/mask-icon/i.test(t));
    links.sort((a, b) => Number(/apple-touch/i.test(b)) - Number(/apple-touch/i.test(a)));
    for (const t of links.slice(0, 3)) {
      const h = t.match(/href=["']([^"']+)["']/i)?.[1];
      if (!h) continue;
      const got = await tryFetch(new URL(h, `https://${domain}/`).href, 600);
      if (got) return got;
    }
  } catch {
    /* the fallback below */
  }
  return (await tryFetch(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`, 700)) || (await tryFetch(`https://icons.duckduckgo.com/ip3/${domain}.ico`, 700));
}

// ------------------------------------------------------------------ the tone of a story, so the day is not only bad news
const HEAVY = /\b(kill(?:s|ed|ing)?|dead|death|dies|died|murder|attack(?:s|ed)?|bomb(?:s|ed|ing)?|strike(?:s)?|war|riot(?:s)?|crash|hostage|shooting|shot|terror|massacre|collapse|crisis|victims?|wounded|injur(?:ed|ies)|threat(?:s|ens)?|sanctions?|invasion|casualt(?:y|ies)|abuse|fraud|hack(?:ed)?|scandal|arrest(?:ed|s)?|trial|jail(?:ed)?|prison|famine|flood(?:s|ing)?|earthquake|wildfire|explosion|blast|conflict|ceasefire|protest(?:s|ers)?)\b/i;
const LIGHT = /\b(discover(?:s|ed|y)?|breakthrough|wins?|won|record|saved?|rescued?|celebrat\w+|joy|first[- ]ever|launch(?:es|ed)?|cure[sd]?|restor(?:e|ed|ation)|hope|helps?|new species|inspir\w+|revive[sd]?|grow(?:s|th)|beautiful|festival|champion|triumph|donat\w+|innovation|solar|clean energy|recovery|returns?)\b/i;
const toneOf = (t) => (HEAVY.test(t) ? 'heavy' : LIGHT.test(t) ? 'light' : 'neutral');

// ------------------------------------------------------------------ grouping the same story from different outlets
const STOP = new Set('the a an and or of to in on for with is are was were be been it this that as at by from into about after before over under says say said new will would could has have had not its their his her they them than more most amid out up off how why what who when where which you your our can may just also report reports reported live latest news update updates video watch'.split(' '));
const words = (t) => new Set((t.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/)).filter((w) => w.length > 2 && !STOP.has(w)));
const sim = (a, b) => {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.max(1, Math.min(a.size, b.size));
};

async function ogImage(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Range: 'bytes=0-80000' }, signal: AbortSignal.timeout(12000) });
    const t = (await r.text()).slice(0, 80000);
    return t.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? t.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1] ?? '';
  } catch {
    return '';
  }
}
/** the best photograph among candidates: wide enough to fill a phone sharply, and a sensible shape */
async function bestPhoto(cands) {
  let best = null;
  for (const c of cands) {
    if (!c.image) continue;
    const d = await probe(c.image);
    if (!d || d.w < 640 || d.h < 360) continue;
    const ar = d.w / d.h;
    if (ar < 0.6 || ar > 2.4) continue;
    if (!best || d.w * d.h > best.w * best.h) best = { ...c, w: d.w, h: d.h };
  }
  return best;
}

async function news() {
  const all = [];
  let ok = 0;
  await Promise.all(
    OUTLETS.flatMap((o) =>
      o.feeds.map(async ([url, topic]) => {
        try {
          const xml = await (await get(url, 3, 'application/rss+xml, application/xml, text/xml')).text();
          const items = parseFeed(xml).slice(0, topic === 'world' ? 20 : 12);
          ok++;
          for (const it of items) all.push({ ...it, src: o, topic });
        } catch (e) {
          console.warn(`  ${o.name} (${topic}): skipped (${e.message})`);
        }
      }),
    ),
  );
  console.log(`  ${ok} feeds read, ${all.length} items`);
  const now = Date.now();
  const fresh = all.filter((a) => (!a.time || now - a.time < 48 * 3600e3) && !/\b(bulletin|podcast|newsletter|quiz|crossword|horoscope|live blog|watch live|in pictures|live:|as it happened)\b/i.test(a.title));
  const clusters = [];
  for (const a of fresh) {
    a.w = words(a.title);
    const hit = clusters.find((c) => c.items.every((x) => x.src.id !== a.src.id) && c.items.some((x) => sim(x.w, a.w) >= 0.55 && Math.min(x.w.size, a.w.size) >= 3));
    if (hit) hit.items.push(a);
    else clusters.push({ items: [a] });
  }
  // a story told twice by the same outlet in different feeds is one
  for (const c of clusters) {
    const seen = new Set();
    c.items = c.items.filter((i) => (seen.has(i.link) ? false : seen.add(i.link)));
  }
  const scored = clusters.map((c) => {
    const leans = c.items.map((i) => i.src.lean).filter((l) => l !== null && l !== undefined);
    const spread = leans.length ? Math.max(...leans) - Math.min(...leans) : 0;
    const topic = Object.entries(c.items.reduce((m, i) => ((m[i.topic] = (m[i.topic] || 0) + (i.topic === 'world' ? 0.6 : 1)), m), {})).sort((a, b) => b[1] - a[1])[0][0];
    const newest = Math.max(...c.items.map((i) => i.time || 0));
    const age = newest ? (now - newest) / 3600e3 : 12;
    const lead = c.items.find((i) => i.image) ?? c.items[0];
    const tone = toneOf(`${lead.title} ${lead.summary}`);
    // reported by many outlets, across the spectrum and the world, and recently
    const score = c.items.length * 3 + new Set(c.items.map((i) => i.src.region)).size * 1.5 + spread * 1.2 - age / 6 + (topic === 'world' ? 0 : 2.5);
    return { c, score, topic, tone };
  });
  scored.sort((x, y) => y.score - x.score);

  // pictures are checked for the stories in the running, best first, until each topic has what it needs
  const QUOTA = { world: 6, science: 3, tech: 2, health: 2, culture: 2, environment: 2, sport: 1, business: 1, good: 3 };
  const take = {};
  const heavyMax = 7;
  let heavy = 0;
  const out = [];
  const used = {};
  for (const { c, topic, tone } of scored) {
    if ((take[topic] ?? 0) >= (QUOTA[topic] ?? 1)) continue;
    if (tone === 'heavy' && heavy >= heavyMax) continue;
    const cands = c.items.filter((i) => i.image).sort((a, b) => (b.image.length > 0) - (a.image.length > 0));
    let photo = await bestPhoto(cands.map((i) => ({ image: i.image, from: i.src.name })));
    if (!photo) {
      const og = await ogImage((c.items.find((i) => !i.image) ?? c.items[0]).link);
      if (og) photo = await bestPhoto([{ image: og, from: c.items[0].src.name }]);
    }
    if (!photo) continue;
    const lead = c.items.find((i) => i.src.name === photo.from) ?? c.items[0];
    if ((used[lead.src.id] ?? 0) >= 4 && c.items.length < 2) continue;
    used[lead.src.id] = (used[lead.src.id] ?? 0) + 1;
    take[topic] = (take[topic] ?? 0) + 1;
    if (tone === 'heavy') heavy++;
    out.push({
      id: createHash('sha1').update(lead.link).digest('hex').slice(0, 10),
      title: lead.title,
      summary: [...c.items].sort((a, b) => b.summary.length - a.summary.length)[0].summary,
      image: photo.image,
      imageFrom: photo.from,
      iw: photo.w,
      ih: photo.h,
      time: Math.max(...c.items.map((i) => i.time || 0)) || now,
      topic,
      tone,
      sources: c.items.map((i) => ({ id: i.src.id, title: i.title, url: i.link })),
    });
    if (out.length >= 24) break;
  }
  // a good mix, not a block of one kind: topics take turns
  const byTopic = {};
  for (const s of out) (byTopic[s.topic] ??= []).push(s);
  const order = ['world', 'science', 'good', 'tech', 'culture', 'health', 'environment', 'world', 'sport', 'business'];
  const mixed = [];
  while (mixed.length < out.length) {
    let moved = false;
    for (const t of order) {
      const s = byTopic[t]?.shift();
      if (s) (mixed.push(s), (moved = true));
    }
    if (!moved) break;
  }
  return mixed;
}

// ------------------------------------------------------------------ links to Wikipedia: names in a story that have an article
const NAME = /\b(?:[A-Z][\p{L}'’.-]+)(?:\s+(?:of|the|de|del|von|van|bin|al|and|&)?\s*[A-Z][\p{L}'’.-]+){0,3}\b/gu;
const NOT_NAMES = new Set('The A An In On At For To By With From After Before As And But Or If When While This That These Those It He She They We You His Her Their Its Our Your Why How What Who Where Which Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December New Live Watch Video Latest Breaking Photos Opinion Analysis Explained'.split(' '));
async function linkTerms(stories) {
  const cand = new Map(); // text → Set(story index)
  stories.forEach((s, i) => {
    const t = `${s.title}. ${s.summary}`;
    for (const m of t.matchAll(NAME)) {
      let x = m[0].replace(/['’]s$/, '').trim();
      const first = x.split(/\s+/)[0];
      if (NOT_NAMES.has(first)) x = x.split(/\s+/).slice(1).join(' ');
      if (x.length < 4 || NOT_NAMES.has(x) || /^[A-Z]+$/.test(x) && x.length < 3) continue;
      (cand.get(x) ?? cand.set(x, new Set()).get(x)).add(i);
    }
  });
  const names = [...cand.keys()].slice(0, 400);
  const found = new Map(); // text → wikipedia title
  for (let i = 0; i < names.length; i += 40) {
    const chunk = names.slice(i, i + 40);
    try {
      const qs = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', redirects: '1', prop: 'pageprops', ppprop: 'disambiguation', titles: chunk.join('|') });
      const j = await (await get(`https://en.wikipedia.org/w/api.php?${qs}`, 3)).json();
      const norm = new Map((j.query?.normalized ?? []).map((n) => [n.from, n.to]));
      const redir = new Map((j.query?.redirects ?? []).map((n) => [n.from, n.to]));
      const pages = new Map((j.query?.pages ?? []).map((p) => [p.title, p]));
      for (const name of chunk) {
        let t = norm.get(name) ?? name;
        t = redir.get(t) ?? t;
        const p = pages.get(t);
        if (p && !p.missing && !p.invalid && !p.pageprops?.disambiguation) found.set(name, t);
      }
    } catch (e) {
      console.warn('  link check skipped:', e.message);
      break;
    }
  }
  stories.forEach((s, i) => {
    s.terms = [...found].filter(([n]) => cand.get(n)?.has(i)).sort((a, b) => b[0].length - a[0].length).slice(0, 8).map(([t, w]) => ({ t, w }));
  });
}

// ------------------------------------------------------------------ reading: articles, curious things, long reads
async function reads() {
  const out = [];
  await Promise.all(
    READ_SOURCES.map(async (s) => {
      try {
        const xml = await (await get(s.url, 3)).text();
        const items = parseFeed(xml).slice(0, 8);
        const got = [];
        for (const it of items) {
          const cands = [it.image && { image: it.image, from: s.name }, ...(it.image ? [] : [{ image: await ogImage(it.link), from: s.name }])].filter((c) => c && c.image);
          const photo = await bestPhoto(cands);
          if (!photo || it.summary.length < 60) continue;
          got.push({ id: createHash('sha1').update(it.link).digest('hex').slice(0, 10), kind: s.kind, source: s.id, title: it.title, summary: it.summary, image: photo.image, iw: photo.w, ih: photo.h, time: it.time, url: it.link });
          if (got.length >= 3) break;
        }
        out.push(...got);
        console.log(`  ${s.name}: ${got.length} reads`);
      } catch (e) {
        console.warn(`  ${s.name}: skipped (${e.message})`);
      }
    }),
  );
  // interleave sources, newest first inside each kind
  out.sort((a, b) => (b.time || 0) - (a.time || 0));
  return out;
}

// ------------------------------------------------------------------ Wikipedia / Wikimedia
const slim = (p) =>
  p && {
    title: p.titles?.normalized ?? p.title,
    description: p.description ?? '',
    extract: (p.extract ?? '').slice(0, 900),
    image: wikiThumb(p, 960),
    iw: p.originalimage?.width ?? 0,
    ih: p.originalimage?.height ?? 0,
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
    // what the world is reading today on Wikipedia (people and events excluded: the curious, the odd, the well-made)
    out.mostread = (f.mostread?.articles ?? [])
      .filter((a) => a.type === 'standard' && a.thumbnail && (a.extract?.length ?? 0) > 160 && !/^(Main Page|Special:|Wikipedia:|Portal:|List of|Deaths in|\d{4})/.test(a.title))
      .slice(0, 6)
      .map((a) => ({ ...slim(a), views: a.views }));
  } catch (e) {
    console.warn('  featured feed skipped:', e.message);
  }
  // this day in history: events from every age, each with the articles it touches
  try {
    const ev = await (await get(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`, 4)).json();
    const good = (ev.events ?? []).filter((e) => e.text && e.year && (e.pages ?? []).some((p) => p.thumbnail && (p.extract?.length ?? 0) > 100));
    const eras = [(e) => e.year < 1000, (e) => e.year >= 1000 && e.year < 1800, (e) => e.year >= 1800 && e.year < 1950, (e) => e.year >= 1950];
    const seed = Number(`${y}${mm}${dd}`);
    const pick = [];
    for (let r = 0; r < 3; r++)
      for (const era of eras) {
        const pool = good.filter(era).filter((e) => !pick.includes(e));
        const e = pool[(seed + r * 7) % Math.max(1, pool.length)];
        if (e) pick.push(e);
      }
    out.history = pick
      .sort((a, b) => a.year - b.year)
      .slice(0, 10)
      .map((e) => ({
        year: e.year,
        text: e.text,
        pages: e.pages.filter((p) => p.type === 'standard').slice(0, 3).map(slim),
      }));
  } catch (e) {
    console.warn('  history skipped:', e.message);
  }
  try {
    const b = await (await get(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/births/${mm}/${dd}`, 4)).json();
    const seed = Number(`${y}${mm}${dd}`);
    const pool = (b.births ?? [])
      .map((e) => ({ e, p: e.pages?.[0] }))
      .filter(({ p }) => p?.thumbnail && (p.originalimage?.width ?? 0) >= 600 && (p.extract?.length ?? 0) > 120 && p.type === 'standard' && !/disambig/i.test(p.description ?? ''))
      .filter(({ e }) => e.year > 0 && e.year < y - 25);
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
const [stories, wiki, readsList] = await Promise.all([news(), wikipedia(today), reads()]);
await linkTerms(stories);
// the outlets that appear, with their logos
const usedIds = new Set([...stories.flatMap((s) => s.sources.map((x) => x.id)), ...readsList.map((r) => r.source)]);
const sources = {};
for (const o of OUTLETS) if (usedIds.has(o.id)) sources[o.id] = { name: o.name, region: o.region, domain: o.domain, kind: o.kind, lean: o.lean, about: o.about };
for (const r of READ_SOURCES) if (usedIds.has(r.id)) sources[r.id] = { name: r.name, region: '', domain: r.domain, kind: r.kind, lean: null, about: '' };
await Promise.all(Object.values(sources).map(async (s) => (s.logo = await logo(s.domain))));
const feed = { v: 2, date: today.toISOString().slice(0, 10), generated: today.toISOString(), sources, news: stories, reads: readsList, ...wiki };
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(feed));
const tones = stories.reduce((m, s) => ((m[s.tone] = (m[s.tone] || 0) + 1), m), {});
const tops = stories.reduce((m, s) => ((m[s.topic] = (m[s.topic] || 0) + 1), m), {});
console.log(`Wrote ${OUT} (${Math.round(JSON.stringify(feed).length / 1024)} KB): ${stories.length} stories`, tops, tones, `${readsList.length} reads, ${feed.history?.length ?? 0} events, ${Object.values(sources).filter((s) => s.logo).length}/${Object.keys(sources).length} logos`);
if (stories.length < 8) {
  console.error('Too few stories — not publishing a thin feed.');
  process.exit(1);
}
