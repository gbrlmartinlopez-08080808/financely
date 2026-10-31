import type { SyncConfig } from './core';

/** The sync server (set at build time). Without it, "Use Frogity on a computer" does not appear. */
const rtUrl = import.meta.env.VITE_SYNC_RT_URL as string | undefined;
const rtKey = import.meta.env.VITE_SYNC_RT_KEY as string | undefined;
export const SYNC: SyncConfig = {
  url: import.meta.env.VITE_SYNC_URL ?? '',
  key: import.meta.env.VITE_SYNC_KEY ?? 'phone',
  // live pings (Supabase Realtime) when configured; otherwise the phone looks for news every few seconds while open
  rt: rtUrl && rtKey ? { url: rtUrl, key: rtKey } : undefined,
};
/** Where the computer app lives (shown on the pairing screen). */
export const WEB_URL = import.meta.env.VITE_WEB_URL ?? 'frogity-web.vercel.app';
export const syncAvailable = () => !!SYNC.url;
