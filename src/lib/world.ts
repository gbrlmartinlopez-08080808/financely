// World info: a short list of what is happening in the world that people follow — elections, summits, big matches and
// tournaments, the sky, the year's festivals. It is a small file kept by hand next to the daily feed, so it can be updated
// without a new version of the app; a copy ships inside the app.
import * as db from './db';
import { FEED_URLS } from './config';

export type WorldKind = 'election' | 'summit' | 'sport' | 'economy' | 'sky' | 'culture';
export interface WorldEvent {
  k: WorldKind;
  t: string;
  w: string;
  /** first day (YYYY-MM-DD) */
  a: string;
  /** last day */
  b?: string;
  n?: string;
  wiki?: string;
  /** shown instead of the exact date when it is not fixed yet */
  when?: string;
  /** the picture that stands for it: a country flag (ISO code) or the logo from a Wikipedia article */
  icon?: { cc?: string; wiki?: string };
  /** who is taking part: parties, teams, countries */
  sides?: { n: string; wiki?: string; cc?: string }[];
  /** a sports competition whose standings and fixtures are fetched live */
  live?: { sport: 'football' | 'nba' | 'nfl' | 'f1'; league: number; season: 'split' | 'year'; h2h?: [string, string] };
  /** the stages, in order */
  phases?: { n: string; a: string; b: string; t?: string }[];
  /** an interactive diagram */
  chart?: SeatsChart | CurveChart;
  /** words that find the stories about it in today's news */
  keys?: string[];
}
export interface SeatsChart {
  type: 'seats';
  note?: string;
  chambers: { name: string; total: number; majority: number; parties: { n: string; c: string; s: number }[] }[];
}
export interface CurveChart {
  type: 'curve';
  peak: string;
  width: number;
  max: number;
  unit: string;
  note?: string;
}
export interface World {
  v: number;
  note: string;
  events: WorldEvent[];
}
const valid = (d: unknown): d is World => !!d && Array.isArray((d as World).events) && (d as World).events.length > 0;

export async function loadWorld(): Promise<World> {
  const saved = await db.get<{ at: number; data: World }>('kv', 'world').catch(() => undefined);
  if (saved && Date.now() - saved.at < 6 * 3600e3 && valid(saved.data)) return saved.data;
  const net = await Promise.any(
    FEED_URLS.map(async (u) => {
      const r = await fetch(u.replace('daily.json', 'world.json'), { signal: AbortSignal.timeout(7000) });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      if (!valid(d)) throw new Error('bad');
      return d;
    }),
  ).catch(() => null);
  if (net) {
    await db.put('kv', 'world', { at: Date.now(), data: net }).catch(() => {});
    return net;
  }
  if (saved && valid(saved.data)) return saved.data;
  const r = await fetch('./feed/world.json').catch(() => null);
  const d = r?.ok ? await r.json().catch(() => null) : null;
  if (valid(d)) return d;
  throw new Error('World info needs a connection the first time.');
}

const DAY = 864e5;
const at = (s: string) => new Date(`${s}T12:00:00`).getTime();
const today = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime();
};
/** days until it starts (negative when it has started) */
export const daysTo = (e: WorldEvent) => Math.round((at(e.a) - today()) / DAY);
export const isOn = (e: WorldEvent) => {
  const t = today();
  return at(e.a) <= t && t <= at(e.b ?? e.a);
};
export const isOver = (e: WorldEvent) => today() > at(e.b ?? e.a);

export function dateLabel(e: WorldEvent): string {
  if (e.when) return e.when;
  const f = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return e.b && e.b !== e.a ? `${f(e.a)} – ${f(e.b)}` : f(e.a);
}
export function countdown(e: WorldEvent): string {
  if (isOn(e)) {
    const left = Math.round((at(e.b ?? e.a) - today()) / DAY);
    return left <= 0 ? 'today' : `on now · ${left} day${left === 1 ? '' : 's'} left`;
  }
  const n = daysTo(e);
  if (n === 1) return 'tomorrow';
  if (n < 14) return `in ${n} days`;
  if (n < 60) return `in ${Math.round(n / 7)} weeks`;
  if (n < 700) return `in ${Math.round(n / 30)} months`;
  return `in ${(n / 365).toFixed(1)} years`;
}
