// Short, human messages for the streak bubble. They react to today's minutes, the week, the streak,
// the time of day, and (sometimes) to the user's own name, authors and words.
import { COUNT_MS, dayKey } from './store';
import type { DocMeta } from './types';
import { isGuide, type Harvest } from './harvest';

export interface CheerCtx {
  name: string;
  todayMs: number;
  goalMs: number;
  days: Record<string, number>;
  streak: number;
  docs: DocMeta[];
  harvest: Record<string, Harvest>;
  now?: Date;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const rng = (seed: string) => {
  let a = hash(seed) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const displayName = (name: string) => {
  const n = name.trim();
  if (!n || n.toLowerCase() === 'reader') return '';
  return n.charAt(0).toUpperCase() + n.slice(1);
};

export function cheer(ctx: CheerCtx): { main: string; fun?: string } {
  const now = ctx.now ?? new Date();
  const m = Math.floor(ctx.todayMs / 60000);
  const goalM = Math.max(1, Math.round(ctx.goalMs / 60000));
  const left = Math.max(0, goalM - m);
  const rand = rng(`${dayKey(now)}|${Math.floor(m / 3)}|${ctx.streak}`);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const hour = now.getHours();

  // the last 7 days
  const week: { k: string; ms: number; dow: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    week.push({ k: dayKey(d), ms: ctx.days[dayKey(d)] ?? 0, dow: d.getDay() });
  }
  const weekMin = Math.round(week.reduce((a, d) => a + d.ms, 0) / 60000);
  const daysRead = week.filter((d) => d.ms >= COUNT_MS).length;
  const yesterday = week[1].ms;
  const best = [...week.slice(1)].sort((a, b) => b.ms - a.ms)[0];

  // ---- practical line
  const weighted: [string, number][] = [];
  const add = (s: string, w: number) => weighted.push([s, w]);
  if (m === 0) {
    if (ctx.streak > 0) add(`Read for a minute and your ${ctx.streak}-day streak lives on.`, 4);
    else add('A page a day. Start with one minute.', 4);
    if (hour >= 20) add('A few pages before sleep?', 2);
    if (hour < 10) add('Morning pages — the quiet hours are the best ones.', 2);
    if (daysRead >= 2) add(`${daysRead} of the last 7 days so far. Make it ${Math.min(7, daysRead + 1)}.`, 2);
  } else if (m < goalM) {
    if (left <= 5) add(`${plural(left, 'minute')} from today’s goal.`, 5);
    if (m >= 45 && m < 60) add(`${plural(60 - m, 'minute')} away from an hour. Hours add up.`, 5);
    if (m >= 10) add(`${plural(m, 'minute')} today. Ready for the next stretch?`, 4);
    add(`${m} min in, ${left} to go.`, 3);
    if (yesterday > 0 && ctx.todayMs > yesterday) add('Already more than yesterday.', 3);
    if (weekMin >= 30) add(`${weekMin} minutes this week and counting.`, 2);
  } else {
    add(`Goal reached — ${plural(m, 'minute')} today.`, 4);
    add(`${plural(m, 'minute')}. Anything more is a bonus.`, 3);
    if (m >= 60) add(`${(m / 60).toFixed(1)} hours today. That’s a real session.`, 5);
    if (yesterday > 0 && ctx.todayMs > yesterday) add('A bigger day than yesterday.', 2);
  }
  if (best && best.ms >= 10 * 60000 && ctx.todayMs < best.ms) add(`${WEEKDAYS[best.dow]} was your best day this week.`, 1.5);
  if (daysRead >= 4) add(`${daysRead} reading days in the last 7.`, 2);
  if ([3, 7, 14, 21, 30, 50, 100, 200, 365].includes(ctx.streak)) add(`${ctx.streak}-day streak. Quietly impressive.`, 6);

  const total = weighted.reduce((a, [, w]) => a + w, 0);
  let r = rand() * total;
  let main = weighted[0][0];
  for (const [s, w] of weighted) {
    if ((r -= w) <= 0) {
      main = s;
      break;
    }
  }
  const nm = displayName(ctx.name);
  if (nm && rand() < 0.24) main = `${nm}, ${main.charAt(0).toLowerCase()}${main.slice(1)}`;

  // ---- sometimes a playful line drawn from the user's own library
  let fun: string | undefined;
  const reached = m >= goalM;
  if (rand() < (reached ? 1 : 0.38)) {
    const authors = [...new Set(ctx.docs.map((d) => d.author).filter((a): a is string => !!a && a.length > 3 && a.length < 38 && !/[0-9@]|\.(com|org|net)|arxiv|unknown|admin|user/i.test(a)))];
    const words = ctx.docs.filter((d) => !isGuide(d)).flatMap((d) => (ctx.harvest[d.id]?.words ?? []).slice(0, 6));
    const unread = ctx.docs.filter((d) => !d.finished && d.progress > 0.02).sort((a, b) => b.openedAt - a.openedAt)[0];
    const dusty = ctx.docs.find((d) => Date.now() - d.openedAt > 3 * 864e5 && d.progress > 0.02 && !d.finished);
    const pool: string[] = [];
    if (authors.length) {
      const a = pick(authors).replace(/\s*,.*$/, '');
      pool.push(`${a} would be proud of you.`, `${a} is glad someone is still reading.`);
    }
    if (words.length) {
      const w = pick(words);
      if (hour >= 19 || hour < 5) pool.push(`Nothing like a big bag of “${w}” before sleep.`);
      else pool.push(`Today’s word: “${w}”.`, `A little “${w}” goes a long way.`);
    }
    if (dusty) pool.push(`“${dusty.name.length > 36 ? dusty.name.slice(0, 36) + '…' : dusty.name}” misses you.`);
    if (unread && unread.progress > 0.05) pool.push(`${Math.round(unread.progress * 100)}% through “${unread.name.length > 30 ? unread.name.slice(0, 30) + '…' : unread.name}”.`);
    if (ctx.docs.length >= 5) pool.push(`${ctx.docs.length} documents on the shelf. No pressure.`);
    if (pool.length) fun = pick(pool);
  }
  return { main, fun };
}
