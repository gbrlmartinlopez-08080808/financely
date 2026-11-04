// World info: the curated list (scripts/world-curated.json, written by hand: summits, sport, festivals, rich pages) plus every
// election that Wikidata knows about in the next two years (national and regional, every country), so no vote is missing and the
// list grows by itself. Written to docs/feed/world.json by the same workflow as the daily feed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const curated = JSON.parse(readFileSync('scripts/world-curated.json', 'utf8'));
const UA = 'FrogityFeedBuilder/1.0 (open-source reader app; https://github.com/gbrlmartinlopez-08080808/financely)';
const day = 864e5;
const from = new Date(Date.now() - 60 * day).toISOString().slice(0, 10);
const to = new Date(Date.now() + 26 * 30 * day).toISOString().slice(0, 10);

const QUERY = `SELECT ?e ?eLabel ?d ?iso ?cLabel WHERE {
  ?e wdt:P31/wdt:P279* wd:Q40231; wdt:P585 ?d.
  FILTER(?d >= "${from}T00:00:00Z"^^xsd:dateTime && ?d < "${to}T00:00:00Z"^^xsd:dateTime)
  OPTIONAL { ?e wdt:P17 ?c. ?c wdt:P297 ?iso. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 3000`;

async function sparql() {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`https://query.wikidata.org/sparql?query=${encodeURIComponent(QUERY)}`, { headers: { Accept: 'application/sparql-results+json', 'User-Agent': UA }, signal: AbortSignal.timeout(90000) }).catch(() => null);
    if (r?.ok) return (await r.json()).results.bindings;
    console.warn(`  wikidata: ${r?.status ?? 'no answer'}, retrying`);
    await new Promise((ok) => setTimeout(ok, 15000 * (i + 1)));
  }
  throw new Error('Wikidata did not answer');
}

const NATIONAL = /(general|presidential|parliamentary|legislative|federal|national|senate|congress|referendum|assembly|riksdag|bundestag|chamber|deputies|lower house|upper house|cortes|storting|folketing)/i;
const LOCAL = /(state|regional|provincial|local|municipal|county|city|mayoral|gubernatorial|council|communal|community|district|cantonal|departmental)/i;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const words = (t) => new Set(t.toLowerCase().replace(/\b(next|election|elections|the|of|in)\b|\d+/g, ' ').split(/[^a-zà-ÿ]+/).filter((w) => w.length > 2));
const overlap = (a, b) => {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.max(1, Math.min(a.size, b.size));
};

const rows = await sparql();
// one record per election; an election with two dates close together (two rounds) becomes a range
const byLabel = new Map();
for (const r of rows) {
  const label = r.eLabel?.value ?? '';
  const iso = r.iso?.value?.toLowerCase();
  if (!iso || /^Q\d+$/.test(label)) continue; // no country, or no English name
  const d = r.d.value.slice(0, 10);
  const k = `${iso}|${label}`;
  const x = byLabel.get(k);
  if (!x) byLabel.set(k, { label, iso, country: r.cLabel?.value ?? '', a: d, b: d });
  else {
    if (d < x.a) x.a = d;
    if (d > x.b) x.b = d;
  }
}
// the small ones (a seat, a ward, an office with no party contest) and the United States (it has its own hub) stay out
const SMALL = /by-election|\bin [A-ZÀ-Þ]|council election|city council|local elections|municipal|mayoral|school|public service commission|attorney general|secretary of state|treasurer|auditor|comptroller|superintendent|lieutenant|district|county|\bward\b|commissioner|sheriff|judicial|supreme court|board of|constituency|community|parish|village|town /i;
const have = curated.events.filter((e) => e.k === 'election');
const auto = [];
for (const x of byLabel.values()) {
  if (x.iso === 'us' || SMALL.test(x.label)) continue;
  const title = x.label.replace(/^next\s+/i, '');
  if (!/election|referendum|vote|poll/i.test(title)) continue;
  const w = words(title);
  const two = x.b !== x.a && new Date(x.b) - new Date(x.a) <= 60 * day;
  if (have.some((e) => (e.cc ?? []).includes(x.iso) && Math.abs(new Date(e.a) - new Date(x.a)) < 7 * day && /general|parliament|chamber|senate|presidential|federal/i.test(`${e.t} ${title}`))) continue;
  const match = have.find((e) => (e.cc ?? []).includes(x.iso) && Math.abs(new Date(e.a) - new Date(x.a)) < 200 * day && overlap(words(e.t), w) >= 0.5);
  if (match) {
    // the hand-written entry keeps its pictures and parties, but the date is the one on record
    if (!/-01-01$/.test(x.a)) {
      match.a = x.a;
      if (two) match.b = x.b;
      else delete match.b;
      delete match.when;
    }
    continue;
  }
  const yearOnly = /-01-01$/.test(x.a);
  const level = LOCAL.test(title) && !/presidential|general|parliamentary|federal/.test(title) ? 'regional' : NATIONAL.test(title) ? 'national' : 'regional';
  auto.push({
    k: 'election',
    t: title.replace(/^(\d{4})\s+/, ''),
    w: x.country,
    a: x.a,
    ...(two ? { b: x.b } : {}),
    ...(yearOnly ? { when: x.a.slice(0, 4) } : {}),
    cc: [x.iso],
    icon: { cc: x.iso },
    level,
    wiki: title,
    auto: true,
  });
}
// the same election often has two dates on record: one per item is enough
const seen = new Set();
const events = [...curated.events, ...auto.sort((a, b) => a.a.localeCompare(b.a))].filter((e) => {
  const k = `${e.cc?.[0] ?? ''}|${(e.wiki ?? e.t).toLowerCase()}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
mkdirSync('docs/feed', { recursive: true });
writeFileSync('docs/feed/world.json', JSON.stringify({ v: 4, built: new Date().toISOString(), note: 'Curated by Frogity; elections from Wikidata, refreshed through the day. Dates can move: check the organisers for the latest.', events }, null, 1));
console.log(`world: ${curated.events.length} curated + ${auto.length} elections = ${events.length}`);
