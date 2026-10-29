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
}

let state: State = { ready: false, docs: [], settings: DEFAULT_SETTINGS, days: {}, hours: {} };
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
  const [docs, settings, dayEntries, hours] = await Promise.all([
    db.all<DocMeta>('docs'),
    db.get<Settings>('kv', 'settings'),
    db.entries<number>('days'),
    db.get<Record<string, number[]>>('kv', 'hours'),
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
  });
}

const sortDocs = (d: DocMeta[]) => [...d].sort((a, b) => b.openedAt - a.openedAt);

export async function saveDoc(doc: DocMeta) {
  await db.put('docs', doc.id, doc);
  const others = state.docs.filter((d) => d.id !== doc.id);
  set({ docs: sortDocs([...others, doc]) });
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

export function streakInfo(days: Record<string, number>) {
  const counts = (k: string) => (days[k] ?? 0) >= COUNT_MS;
  const d = new Date();
  let current = 0;
  // Today not yet counted shouldn't break the streak.
  if (!counts(dayKey(d))) d.setDate(d.getDate() - 1);
  while (counts(dayKey(d))) {
    current++;
    d.setDate(d.getDate() - 1);
  }
  let longest = 0;
  let run = 0;
  const keys = Object.keys(days).filter(counts).sort();
  let prev: Date | null = null;
  for (const k of keys) {
    const [y, m, dd] = k.split('-').map(Number);
    const date = new Date(y, m - 1, dd);
    run = prev && Math.round((date.getTime() - prev.getTime()) / 864e5) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = date;
  }
  const total = Object.values(days).reduce((a, b) => a + b, 0);
  return { current, longest, total, today: days[dayKey()] ?? 0, activeDays: keys.length };
}
