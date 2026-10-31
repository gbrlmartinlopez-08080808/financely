import type { SyncConfig } from './core';

/**
 * Where the sync server is. Set at build time (VITE_SYNC_URL, VITE_SYNC_KEY), or for a local test server with
 * `?sync=http://127.0.0.1:8787` once (remembered in this browser).
 */
const fromUrl = new URLSearchParams(location.search).get('sync');
if (fromUrl) localStorage.setItem('frogity-sync', fromUrl);
const local = localStorage.getItem('frogity-sync');

export const SYNC: SyncConfig = local
  ? { url: local, key: 'local' }
  : { url: import.meta.env.VITE_SYNC_URL ?? '', key: import.meta.env.VITE_SYNC_KEY ?? '' };
