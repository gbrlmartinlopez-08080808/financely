// What is open on screen: the tabs across the top, which one is shown, and a second document beside it.
import { useSyncExternalStore } from 'react';

export type View = 'library' | 'marks' | string; // a document id
interface Ui {
  tabs: string[];
  active: View;
  split: string | null;
  palette: boolean;
  dialog: null | 'devices' | 'keys';
  /** where to open a document (a page to jump to) */
  jump: Record<string, number | undefined>;
}
let ui: Ui = { tabs: [], active: 'library', split: null, palette: false, dialog: null, jump: {} };
try {
  const saved = JSON.parse(localStorage.getItem('frogity-tabs') ?? 'null');
  if (saved) ui = { ...ui, tabs: saved.tabs ?? [], active: saved.active ?? 'library' };
} catch {
  /* fresh */
}
const subs = new Set<() => void>();
export function setUi(p: Partial<Ui> | ((u: Ui) => Partial<Ui>)) {
  ui = { ...ui, ...(typeof p === 'function' ? p(ui) : p) };
  try {
    localStorage.setItem('frogity-tabs', JSON.stringify({ tabs: ui.tabs, active: ui.active }));
  } catch {
    /* private window */
  }
  subs.forEach((f) => f());
}
export const getUi = () => ui;
export const useUi = <T,>(sel: (u: Ui) => T) =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => sel(ui),
  );

/** Opens a document in a tab (or shows its tab), optionally at a page. */
export function openDoc(id: string, page?: number) {
  setUi((u) => ({ tabs: u.tabs.includes(id) ? u.tabs : [...u.tabs, id], active: id, jump: { ...u.jump, [id]: page } }));
}
export function closeTab(id: string) {
  setUi((u) => {
    const i = u.tabs.indexOf(id);
    const tabs = u.tabs.filter((t) => t !== id);
    const active = u.active === id ? (tabs[Math.min(i, tabs.length - 1)] ?? 'library') : u.active;
    return { tabs, active, split: u.split === id ? null : u.split };
  });
}
export function forgetTabs(ids: string[]) {
  setUi((u) => ({ tabs: u.tabs.filter((t) => !ids.includes(t)), active: ids.includes(u.active) ? 'library' : u.active, split: u.split && ids.includes(u.split) ? null : u.split }));
}
