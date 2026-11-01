import { useSyncExternalStore } from 'react';
import type { SyncMeta } from '../sync/core';

/** One document as the computer holds it. */
export interface LocalDoc {
  id: string;
  meta: SyncMeta;
  rev: number;
  fileVer: string | null;
  fileParts: number;
  /** false: a big file that is not kept on the server — it is fetched from the phone when it is opened */
  fileStored?: boolean;
  coverVer: string | null;
  /** changed here and not yet sent */
  dirty?: boolean;
  /** the file changed here and is not uploaded yet (kept in the files store) */
  fileDirty?: boolean;
}

export interface SyncState {
  live: boolean;
  busy: number;
  error: string;
  last: number;
  /** a transfer in progress, for the status line */
  transfer?: { name: string; done: number; total: number };
  /** waiting for the phone to hand a document over (seconds so far) */
  asking?: { name: string; secs: number };
}

export interface State {
  phase: 'loading' | 'unpaired' | 'ready';
  docs: LocalDoc[];
  covers: Record<string, string>;
  sync: SyncState;
  /** why this computer was disconnected, if it was */
  notice: string;
}

let state: State = { phase: 'loading', docs: [], covers: {}, sync: { live: false, busy: 0, error: '', last: 0 }, notice: '' };
const subs = new Set<() => void>();
export const getState = () => state;
export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  subs.forEach((f) => f());
}
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => sel(state),
  );
}
export const docById = (id: string) => state.docs.find((d) => d.id === id);

// ---------------------------------------------------------------- toasts
export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}
let toasts: Toast[] = [];
const tsubs = new Set<() => void>();
let tid = 0;
export function toast(text: string, action?: Toast['action']) {
  const t = { id: ++tid, text, action };
  toasts = [...toasts, t].slice(-4);
  tsubs.forEach((f) => f());
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    tsubs.forEach((f) => f());
  }, action ? 7000 : 3600);
}
export const useToasts = () =>
  useSyncExternalStore(
    (f) => (tsubs.add(f), () => tsubs.delete(f)),
    () => toasts,
  );
