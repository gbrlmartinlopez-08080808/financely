// World info, by country: the countries, the home country, public holidays, and the numbers behind each economy.
import { useEffect, useState } from 'react';
import type { WorldEvent } from './world';
import { isOn, isOver } from './world';

export interface Country {
  cc: string;
  name: string;
  iso3: string;
  cur: string;
}
/** the countries every list starts from, after the home country */
export const TOP: Country[] = [
  { cc: 'us', name: 'United States', iso3: 'USA', cur: 'USD' },
  { cc: 'fr', name: 'France', iso3: 'FRA', cur: 'EUR' },
  { cc: 'es', name: 'Spain', iso3: 'ESP', cur: 'EUR' },
  { cc: 'it', name: 'Italy', iso3: 'ITA', cur: 'EUR' },
  { cc: 'cn', name: 'China', iso3: 'CHN', cur: 'CNY' },
  { cc: 'de', name: 'Germany', iso3: 'DEU', cur: 'EUR' },
  { cc: 'se', name: 'Sweden', iso3: 'SWE', cur: 'SEK' },
];
const MORE: Country[] = [
  ['gb', 'United Kingdom', 'GBR', 'GBP'], ['ie', 'Ireland', 'IRL', 'EUR'], ['pt', 'Portugal', 'PRT', 'EUR'], ['nl', 'Netherlands', 'NLD', 'EUR'], ['be', 'Belgium', 'BEL', 'EUR'],
  ['ch', 'Switzerland', 'CHE', 'CHF'], ['at', 'Austria', 'AUT', 'EUR'], ['pl', 'Poland', 'POL', 'PLN'], ['no', 'Norway', 'NOR', 'NOK'], ['dk', 'Denmark', 'DNK', 'DKK'],
  ['fi', 'Finland', 'FIN', 'EUR'], ['gr', 'Greece', 'GRC', 'EUR'], ['tr', 'Türkiye', 'TUR', 'TRY'], ['ua', 'Ukraine', 'UKR', 'UAH'], ['ru', 'Russia', 'RUS', 'RUB'],
  ['ca', 'Canada', 'CAN', 'CAD'], ['mx', 'Mexico', 'MEX', 'MXN'], ['br', 'Brazil', 'BRA', 'BRL'], ['ar', 'Argentina', 'ARG', 'ARS'], ['cl', 'Chile', 'CHL', 'CLP'],
  ['co', 'Colombia', 'COL', 'COP'], ['pe', 'Peru', 'PER', 'PEN'], ['in', 'India', 'IND', 'INR'], ['jp', 'Japan', 'JPN', 'JPY'], ['kr', 'South Korea', 'KOR', 'KRW'],
  ['au', 'Australia', 'AUS', 'AUD'], ['nz', 'New Zealand', 'NZL', 'NZD'], ['za', 'South Africa', 'ZAF', 'ZAR'], ['ng', 'Nigeria', 'NGA', 'NGN'], ['eg', 'Egypt', 'EGY', 'EGP'],
  ['ke', 'Kenya', 'KEN', 'KES'], ['sa', 'Saudi Arabia', 'SAU', 'SAR'], ['ae', 'United Arab Emirates', 'ARE', 'AED'], ['il', 'Israel', 'ISR', 'ILS'], ['id', 'Indonesia', 'IDN', 'IDR'],
].map(([cc, name, iso3, cur]) => ({ cc, name, iso3, cur }));
export const COUNTRIES: Country[] = [...TOP, ...MORE];
export const country = (cc: string) => COUNTRIES.find((c) => c.cc === cc.toLowerCase());

const KEY = 'world:home';
const bus = new EventTarget();
function guess(): string {
  const region = (navigator.language || 'en-US').split('-')[1]?.toLowerCase();
  return region && country(region) ? region : 'us';
}
export const getHome = () => {
  try {
    return localStorage.getItem(KEY) || guess();
  } catch {
    return guess();
  }
};
export function setHome(cc: string) {
  try {
    localStorage.setItem(KEY, cc);
  } catch {
    /* private mode */
  }
  bus.dispatchEvent(new Event('home'));
}
export function useHome(): [string, (cc: string) => void] {
  const [h, setH] = useState(getHome());
  useEffect(() => {
    const f = () => setH(getHome());
    bus.addEventListener('home', f);
    return () => bus.removeEventListener('home', f);
  }, []);
  return [h, setHome];
}
/** the countries to show, in order: home first, then the usual ones (anyone can be left out, e.g. China has no elections) */
export function countryOrder(home: string, skip: string[] = []): Country[] {
  const h = country(home) ?? TOP[0];
  return [h, ...TOP.filter((c) => c.cc !== h.cc)].filter((c) => !skip.includes(c.cc));
}

export type Section = 'general' | 'politics' | 'economy' | 'sports' | 'events' | 'holidays';
export const SECTIONS: { id: Section; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'politics', label: 'Politics' },
  { id: 'economy', label: 'Economy' },
  { id: 'sports', label: 'Sports' },
  { id: 'events', label: 'Events' },
  { id: 'holidays', label: 'Holidays' },
];
export function sectionOf(e: WorldEvent): Section {
  if (e.sec) return e.sec as Section;
  if (e.k === 'election') return 'politics';
  if (e.k === 'economy') return 'economy';
  if (e.k === 'sport') return 'sports';
  if (e.k === 'culture') return 'events';
  return 'events';
}
/** does an event concern a country? Events with no country belong to everybody. */
export const concerns = (e: WorldEvent, cc: string) => !e.cc?.length || e.cc.includes(cc);
const DAY = 864e5;
const at = (s: string) => new Date(`${s}T12:00:00`).getTime();
export const endedDaysAgo = (e: WorldEvent) => Math.round((Date.now() - at(e.b ?? e.a)) / DAY);
/** what is on or coming, plus what ended in the last two months (an election just held is still news) */
export const relevant = (e: WorldEvent) => !isOver(e) || endedDaysAgo(e) <= 60;
export const isRecent = (e: WorldEvent) => isOver(e) && !isOn(e);

// ------------------------------------------------------------------ public holidays (Nager.Date)
export interface Holiday {
  date: string;
  name: string;
  local: string;
  global: boolean;
  types: string[];
}
const mem = new Map<string, unknown>();
async function json<T>(url: string, ttl = 6 * 3600e3): Promise<T> {
  const hit = mem.get(url) as { at: number; v: T } | undefined;
  if (hit && Date.now() - hit.at < ttl) return hit.v;
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const v = (await r.json()) as T;
  mem.set(url, { at: Date.now(), v });
  return v;
}
export async function holidays(cc: string): Promise<Holiday[]> {
  const y = new Date().getFullYear();
  const rows = await Promise.all([y, y + 1].map((yy) => json<{ date: string; name: string; localName: string; global: boolean; types: string[] }[]>(`https://date.nager.at/api/v3/PublicHolidays/${yy}/${cc.toUpperCase()}`).catch(() => [])));
  const today = new Date().toISOString().slice(0, 10);
  return rows
    .flat()
    .filter((h) => h.date >= today)
    .map((h) => ({ date: h.date, name: h.name, local: h.localName, global: h.global, types: h.types }))
    .slice(0, 14);
}

// ------------------------------------------------------------------ the numbers behind an economy (World Bank) and exchange rates
export const INDICATORS = [
  { id: 'NY.GDP.MKTP.CD', label: 'Economy size', unit: 'US$', fmt: (v: number) => `$${(v / 1e12).toFixed(v > 1e12 ? 1 : 2)} trillion`, short: (v: number) => `${(v / 1e12).toFixed(1)}T` },
  { id: 'NY.GDP.MKTP.KD.ZG', label: 'Growth', unit: '%', fmt: (v: number) => `${v.toFixed(1)}%`, short: (v: number) => `${v.toFixed(1)}%` },
  { id: 'FP.CPI.TOTL.ZG', label: 'Inflation', unit: '%', fmt: (v: number) => `${v.toFixed(1)}%`, short: (v: number) => `${v.toFixed(1)}%` },
  { id: 'SL.UEM.TOTL.ZS', label: 'Unemployment', unit: '%', fmt: (v: number) => `${v.toFixed(1)}%`, short: (v: number) => `${v.toFixed(1)}%` },
  { id: 'SP.POP.TOTL', label: 'Population', unit: '', fmt: (v: number) => `${(v / 1e6).toFixed(v > 1e8 ? 0 : 1)} million`, short: (v: number) => `${(v / 1e6).toFixed(0)}M` },
] as const;
export interface Series {
  year: number;
  v: number;
}
/** every indicator for the given countries, years oldest first: the file saved beside the daily feed, then the World Bank itself */
export async function economy(iso3: string[]): Promise<Record<string, Record<string, Series[]>>> {
  const fromFile = async () => {
    for (const u of ['./feed/economy.json']) {
      const r = await fetch(u).catch(() => null);
      const j = r?.ok ? await r.json().catch(() => null) : null;
      if (j?.data) {
        const out: Record<string, Record<string, Series[]>> = {};
        for (const [c, inds] of Object.entries(j.data as Record<string, Record<string, [number, number][]>>)) for (const [id, ser] of Object.entries(inds)) (out[c] ??= {})[id] = ser.map(([year, v]) => ({ year, v }));
        return out;
      }
    }
    return null;
  };
  const live = async () => {
    const out: Record<string, Record<string, Series[]>> = {};
    const y = new Date().getFullYear();
    await Promise.all(
      INDICATORS.map(async (ind) => {
        const rows = await json<[unknown, { countryiso3code: string; date: string; value: number | null }[]] | null>(`https://api.worldbank.org/v2/country/${iso3.join(';')}/indicator/${ind.id}?format=json&per_page=1000&date=${y - 12}:${y}`, 24 * 3600e3);
        for (const r of rows?.[1] ?? []) {
          if (r.value === null) continue;
          ((out[r.countryiso3code] ??= {})[ind.id] ??= []).push({ year: Number(r.date), v: r.value });
        }
      }),
    );
    for (const c of Object.values(out)) for (const k of Object.keys(c)) c[k].sort((a, b) => a.year - b.year);
    return out;
  };
  // the saved file (refreshed a few times a day) answers at once; the World Bank is asked only if it is missing
  const saved = await fromFile();
  if (saved) return saved;
  return live();
}
export interface Fx {
  base: string;
  quote: string;
  now: number;
  series: { date: string; v: number }[];
}
export async function fx(base: string, quote: string, days = 90): Promise<Fx> {
  const end = new Date();
  const start = new Date(end.getTime() - days * DAY);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const j = await json<{ rates: Record<string, Record<string, number>> }>(`https://api.frankfurter.dev/v1/${d(start)}..${d(end)}?base=${base}&symbols=${quote}`, 3 * 3600e3);
  const series = Object.entries(j.rates).map(([date, r]) => ({ date, v: r[quote] })).sort((a, b) => a.date.localeCompare(b.date));
  return { base, quote, now: series[series.length - 1]?.v ?? 0, series };
}
