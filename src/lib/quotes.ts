// The quote card: a line from the user's own documents when we can find a good one, otherwise a classic.
import { dayKey } from './store';
import type { DocMeta } from './types';
import { isGuide, type Harvest } from './harvest';

export interface Quote {
  text: string;
  from: string;
  own: boolean;
}

// Short public-domain lines about reading and attention.
const CLASSICS: Quote[] = [
  { text: 'Read the best books first, or you may not have a chance to read them at all.', from: 'Henry David Thoreau', own: false },
  { text: 'It is not that we have a short time to live, but that we waste a lot of it.', from: 'Seneca', own: false },
  { text: 'A man is known by the books he reads.', from: 'Ralph Waldo Emerson', own: false },
  { text: 'The art of reading is in great part that of acquiring a better understanding of life.', from: 'Samuel Johnson', own: false },
  { text: 'Not what we have, but what we enjoy, constitutes our abundance.', from: 'Epicurus', own: false },
  { text: 'Wonder is the beginning of wisdom.', from: 'Socrates', own: false },
  { text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', from: 'Will Durant', own: false },
  { text: 'A little learning each day adds up to a great deal in a lifetime.', from: 'after Confucius', own: false },
];

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export function pickQuote(docs: DocMeta[], harvest: Record<string, Harvest>, salt = ''): Quote {
  const seed = hash(dayKey() + salt);
  const own = docs
    .filter((d) => !isGuide(d) && harvest[d.id]?.quotes.length)
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, 6);
  if (own.length) {
    const d = own[seed % own.length];
    const qs = harvest[d.id].quotes;
    return { text: qs[(seed >>> 3) % Math.min(qs.length, 5)], from: d.name, own: true };
  }
  return CLASSICS[seed % CLASSICS.length];
}

/** Static ASCII frame around a quote. Plain ASCII so it looks the same in any monospace font. */
export function quoteArt(q: Quote, width = 36): string {
  const words = `“${q.text}”`.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > width - 6) {
      lines.push(cur.trim());
      cur = w;
    } else cur += ' ' + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  const shown = lines.slice(0, 7);
  if (lines.length > 7) shown[6] = shown[6].replace(/\s*\S*$/, '') + '…”';
  const from = `— ${q.from.length > width - 8 ? q.from.slice(0, width - 9) + '…' : q.from}`;
  const inner = width - 4;
  const pad = (s: string, right = false) => (right ? ' '.repeat(Math.max(0, inner - s.length)) + s : s + ' '.repeat(Math.max(0, inner - s.length)));
  const top = ' .' + '-'.repeat(width - 2) + '.';
  const bot = " '" + '-'.repeat(width - 2) + "'";
  const blank = ' |' + ' '.repeat(width - 2) + '|';
  const row = (s: string, right = false) => ' | ' + pad(s, right) + ' |';
  const art = [
    '      ~  .  ~   .   ~',
    top,
    blank,
    ...shown.map((l) => row(l)),
    blank,
    row(from, true),
    blank,
    bot,
    '    \\_\\______________/_/',
    '      reading is quiet company',
  ];
  return art.join('\n');
}
