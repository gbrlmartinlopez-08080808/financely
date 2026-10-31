import type { SyncConfig } from './core';

/** The sync server (set at build time). Without it, "Use Frogity on a computer" does not appear. */
export const SYNC: SyncConfig = { url: import.meta.env.VITE_SYNC_URL ?? '', key: import.meta.env.VITE_SYNC_KEY ?? '' };
/** Where the computer app lives (shown on the pairing screen). */
export const WEB_URL = import.meta.env.VITE_WEB_URL ?? 'frogity-web.vercel.app';
export const syncAvailable = () => !!SYNC.url && !!SYNC.key;
