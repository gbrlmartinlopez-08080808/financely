import { useSyncExternalStore } from 'react';
import * as db from './db';
import { DEFAULT_SETTINGS, type DocMeta, type Settings } from './types';
import { migrateFontId } from './fonts';

interface State {
  ready: boolean;
  docs: DocMeta[];
  settings: Settings;
  days: Record<string, number>; // yyyy-mm-dd -> ms read
  hours: Record<string, number[]>; // yyyy-mm-dd -> ms read in each hour of that day
  freeze: FreezeState;
}

/** One free "freeze day" per week keeps a streak alive over a missed day; more can be earned. */
export interface FreezeState {
  used: string[]; // days a freeze was spent on (they bridge the streak without adding to it)
  paid?: string[]; // the subset of `used` that was paid for from the bonus
  bonus: number; // extra freezes earned (e.g. for sending feedback)
}

let state: State = { ready: false, docs: [], settings: DEFAULT_SETTINGS, days: {}, hours: {}, freeze: { used: [], bonus: 0 } };
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sel(state),
  );
}

export const getState = () => state;

export async function init() {
  const [docs, settings, dayEntries, hours, freeze] = await Promise.all([
    db.all<DocMeta>('docs'),
    db.get<Settings>('kv', 'settings'),
    db.entries<number>('days'),
    db.get<Record<string, number[]>>('kv', 'hours'),
    db.get<FreezeState>('kv', 'freeze'),
  ]);
  const merged: Settings = { ...DEFAULT_SETTINGS, ...settings };
  merged.font = migrateFontId(merged.font);
  merged.fontFaves = (merged.fontFaves ?? DEFAULT_SETTINGS.fontFaves).map(migrateFontId);
  if (!settings || (settings.v ?? 1) < 2) {
    // v2 scaled the interface down ~9%, so nudge saved reading sizes up to look the same as before
    merged.fontSize = Math.round((settings?.fontSize ?? 19) * 1.08);
    merged.v = 2;
    db.put('kv', 'settings', merged);
  }
  set({
    ready: true,
    docs: sortDocs(docs),
    settings: merged,
    days: Object.fromEntries(dayEntries),
    hours: hours ?? {},
    freeze: { used: freeze?.used ?? [], paid: freeze?.paid ?? [], bonus: freeze?.bonus ?? 0 },
  });
  applyFreeze();
}

const sortDocs = (d: DocMeta[]) => [...d].sort((a, b) => b.openedAt - a.openedAt);

export async function saveDoc(doc: DocMeta) {
  const isNew = !state.docs.some((d) => d.id === doc.id);
  await db.put('docs', doc.id, doc);
  const others = state.docs.filter((d) => d.id !== doc.id);
  set({ docs: sortDocs([...others, doc]) });
  // a new PDF is looked at straight away: if it is a scan, its text is read in the background
  if (isNew && doc.kind === 'pdf') import('./scan').then((m) => m.queueScan(doc));
}

export async function patchDoc(id: string, patch: Partial<DocMeta>, resort = false) {
  const cur = state.docs.find((d) => d.id === id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  await db.put('docs', id, next);
  const docs = state.docs.map((d) => (d.id === id ? next : d));
  set({ docs: resort ? sortDocs(docs) : docs });
}

export async function removeDoc(id: string) {
  const cur = state.docs.find((d) => d.id === id);
  await db.del('docs', id);
  await db.del('files', id);
  if (cur?.coverId) await db.del('blobs', cur.coverId);
  for (const p of cur?.scanPages ?? []) await db.del('blobs', p);
  await db.delPrefix('cache', id + ':');
  await db.delPrefix('marks', id + ':');
  set({ docs: state.docs.filter((d) => d.id !== id) });
}

let saveT = 0;
/** Applies instantly; the disk write is debounced so dragging a slider doesn't hammer IndexedDB. */
export function updateSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch };
  set({ settings });
  clearTimeout(saveT);
  saveT = window.setTimeout(() => db.put('kv', 'settings', state.settings), 400);
}

// ---------- reading time / streaks ----------

export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

let hoursT = 0;
export async function addReading(ms: number, docId?: string) {
  if (ms <= 0) return;
  const k = dayKey();
  const before = state.days[k] ?? 0;
  const days = { ...state.days, [k]: before + ms };
  const goalMs = state.settings.dailyGoal * 60_000;
  if (before < goalMs && days[k] >= goalMs) window.dispatchEvent(new CustomEvent('quire:goal'));
  const h = new Date().getHours();
  const row = [...(state.hours[k] ?? new Array(24).fill(0))];
  row[h] += ms;
  set({ days, hours: { ...state.hours, [k]: row } });
  clearTimeout(hoursT);
  hoursT = window.setTimeout(() => db.put('kv', 'hours', state.hours), 1500);
  await db.put('days', k, days[k]);
  if (docId) {
    const d = state.docs.find((x) => x.id === docId);
    if (d) await patchDoc(docId, { readMs: (d.readMs ?? 0) + ms });
  }
}

/** A day "counts" once you have read for at least a minute. */
export const COUNT_MS = 60_000;

export function streakInfo(days: Record<string, number>, frozen: string[] = state.freeze.used) {
  const fz = new Set(frozen);
  const counts = (k: string) => (days[k] ?? 0) >= COUNT_MS;
  const d = new Date();
  let current = 0;
  // Today not yet counted shouldn't break the streak.
  if (!counts(dayKey(d))) d.setDate(d.getDate() - 1);
  // A frozen day keeps the chain going without adding to it.
  while (counts(dayKey(d)) || fz.has(dayKey(d))) {
    if (counts(dayKey(d))) current++;
    d.setDate(d.getDate() - 1);
  }
  let longest = 0;
  let run = 0;
  const keys = Object.keys(days).filter(counts).sort();
  let prev: Date | null = null;
  for (const k of keys) {
    const [y, m, dd] = k.split('-').map(Number);
    const date = new Date(y, m - 1, dd);
    const gap = prev ? Math.round((date.getTime() - prev.getTime()) / 864e5) : 0;
    const bridged = prev && gap === 2 && fz.has(dayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1)));
    run = prev && (gap === 1 || bridged) ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = date;
  }
  const total = Object.values(days).reduce((a, b) => a + b, 0);
  return { current, longest, total, today: days[dayKey()] ?? 0, activeDays: keys.length };
}

// ---------- freeze days ----------

const parseDay = (k: string) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Monday of the week a day falls in (weeks run Monday to Sunday). */
const weekOf = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return dayKey(x);
};

/** Is this week's own freeze still unspent? Freezes paid for from the earned bonus don't count against it. */
export function freezeStatus(f: FreezeState = state.freeze) {
  const thisWeek = weekOf(new Date());
  const weekly = !f.used.some((k) => !(f.paid ?? []).includes(k) && weekOf(parseDay(k)) === thisWeek);
  return { weekly, bonus: f.bonus, available: (weekly ? 1 : 0) + f.bonus };
}

/** If yesterday was missed but the streak was alive before it, spend a freeze on it (once, automatically). */
export function applyFreeze() {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yk = dayKey(y);
  const before = new Date(y);
  before.setDate(before.getDate() - 1);
  const bk = dayKey(before);
  const { days, freeze } = state;
  const counts = (k: string) => (days[k] ?? 0) >= COUNT_MS;
  if (counts(yk) || freeze.used.includes(yk)) return;
  if (!counts(bk) && !freeze.used.includes(bk)) return; // there was no streak to save
  const st = freezeStatus(freeze);
  if (!st.available) return;
  const next: FreezeState = st.weekly
    ? { ...freeze, used: [...freeze.used, yk] }
    : { used: [...freeze.used, yk], paid: [...(freeze.paid ?? []), yk], bonus: freeze.bonus - 1 };
  saveFreeze(next);
  // let the screen settle first, so the toast isn't missed
  setTimeout(() => window.dispatchEvent(new CustomEvent('quire:freeze', { detail: { day: yk } })), 1800);
}

/** Gives the reader an extra freeze day (e.g. a thank-you for feedback). */
export function grantFreeze(n = 1) {
  saveFreeze({ ...state.freeze, bonus: state.freeze.bonus + n });
}

function saveFreeze(freeze: FreezeState) {
  db.put('kv', 'freeze', freeze);
  // a fresh `days` object makes everything that shows the streak redraw
  set({ freeze, days: { ...state.days } });
}
