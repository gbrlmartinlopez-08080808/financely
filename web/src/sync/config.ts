import type { SyncConfig } from './core';

/**
 * Where the sync server is. Normally this same site (the server is a function next to the app; see api/), with live
 * pings from Supabase Realtime when a publishable key is configured. For the local test server, open the app once
 * with `?sync=http://127.0.0.1:8787` (remembered in this browser).
 */
const q = new URLSearchParams(location.search);
const fromUrl = q.get('sync');
if (fromUrl) {
  localStorage.setItem('frogity-sync', fromUrl);
  localStorage.setItem('frogity-sync-rt', q.get('rt') === '0' ? '0' : '1');
}
const local = localStorage.getItem('frogity-sync');
const localRt = localStorage.getItem('frogity-sync-rt') !== '0';
const rtUrl = import.meta.env.VITE_SYNC_RT_URL as string | undefined;
const rtKey = import.meta.env.VITE_SYNC_RT_KEY as string | undefined;

export const SYNC: SyncConfig = local
  ? { url: local, key: 'local', rt: localRt ? { url: local, key: 'local' } : undefined }
  : { url: (import.meta.env.VITE_SYNC_URL as string | undefined) || location.origin, key: 'web', rt: rtUrl && rtKey ? { url: rtUrl, key: rtKey } : undefined };
