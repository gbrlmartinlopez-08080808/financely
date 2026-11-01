// Frogity sync, the part both sides share (the computer app keeps an identical copy in web/src/sync/core.ts — change
// both together). Plain browser APIs only: fetch, WebCrypto, WebSocket.
//
// Everything that leaves a device is sealed with the library key (AES-256-GCM) first. The server routes ciphertext.
// A computer gets the library key during pairing, wrapped for its own key pair (ECDH P-256), never in the clear.

export interface SyncConfig {
  /** the Supabase project URL */
  url: string;
  /** its public (anon / publishable) key: lets requests reach the edge function, nothing more */
  key: string;
  /** where "something changed" pings come from (Supabase Realtime); without it, devices look for news every few seconds */
  rt?: { url: string; key: string };
}
export interface Creds {
  library: string;
  device: string;
  token: string;
}

// ---------------------------------------------------------------- shapes of what is synced
export interface SyncDoc {
  id: string;
  name: string;
  fileName: string;
  kind: string;
  mime: string;
  size: number;
  addedAt: number;
  openedAt: number;
  progress: number;
  readMs: number;
  pages?: number;
  author?: string;
  finished?: boolean;
  position?: { mode: string; value: number };
  url?: string;
}
export interface SyncHighlight {
  id: string;
  docId: string;
  text: string;
  prefix: string;
  note?: string;
  at: number;
  /** where it sits on a PDF page (set by the computer; the phone ignores it) */
  page?: number;
  rects?: number[][];
}
export interface SyncBookmark {
  id: string;
  docId: string;
  progress: number;
  label: string;
  at: number;
  page?: number;
  auto?: boolean;
}
export interface SyncMeta {
  v: 1;
  doc: SyncDoc;
  marks: { h: SyncHighlight[]; b: SyncBookmark[] };
  /** ids of marks deleted somewhere (so a merge does not bring them back) */
  gone: string[];
  /** when the document's own fields last changed (ms) */
  t: number;
  /** a plain-text copy of what the phone read in a scan (for search on the computer) */
  text?: string;
}
export interface RemoteItem {
  id: string;
  rev: number;
  deleted: boolean;
  meta: string;
  file_ver: string | null;
  file_parts: number;
  file_size: number;
  /** false: the file is not kept on the server (it is big) — it is fetched from the phone when needed */
  file_stored?: boolean;
  cover_ver: string | null;
  updated_at: string;
  updated_by: string | null;
}

/** Two copies of one document's record become one: newest fields win, marks are joined, deletions stick. */
export function mergeMeta(a: SyncMeta | undefined, b: SyncMeta): SyncMeta {
  if (!a) return b;
  const gone = [...new Set([...a.gone, ...b.gone])].slice(-2000);
  const dead = new Set(gone);
  const join = <T extends { id: string; at: number }>(x: T[], y: T[]) => {
    const m = new Map<string, T>();
    for (const it of [...x, ...y]) {
      const have = m.get(it.id);
      if (!have || it.at >= have.at) m.set(it.id, it);
    }
    return [...m.values()].filter((it) => !dead.has(it.id));
  };
  const newer = b.t >= a.t ? b : a;
  const older = newer === a ? b : a;
  return {
    v: 1,
    doc: { ...older.doc, ...newer.doc, readMs: Math.max(a.doc.readMs ?? 0, b.doc.readMs ?? 0) },
    marks: { h: join(a.marks.h, b.marks.h), b: join(a.marks.b, b.marks.b) },
    gone,
    t: Math.max(a.t, b.t),
    text: b.text ?? a.text,
  };
}

// ---------------------------------------------------------------- bytes and text
const enc = new TextEncoder();
const dec = new TextDecoder();
export function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));
export const newId = () => [...rand(9)].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 14);

// ---------------------------------------------------------------- the library key
export const newLibraryKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']) as Promise<CryptoKey>;
export const exportKey = async (k: CryptoKey) => new Uint8Array(await crypto.subtle.exportKey('raw', k));
export const importLibraryKey = (raw: Uint8Array, extractable = false) => crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', extractable, ['encrypt', 'decrypt']);

/** iv (12 bytes) + ciphertext */
export async function seal(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const iv = rand(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, data as BufferSource));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}
export async function unseal(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12) as BufferSource }, key, data.subarray(12) as BufferSource));
}
export const sealJson = async (key: CryptoKey, v: unknown) => b64(await seal(key, enc.encode(JSON.stringify(v))));
export const unsealJson = async <T>(key: CryptoKey, s: string): Promise<T> => JSON.parse(dec.decode(await unseal(key, unb64(s)))) as T;

// ---------------------------------------------------------------- pairing keys
export const newPairKeys = () => crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']) as Promise<CryptoKeyPair>;
export const publicB64 = async (k: CryptoKey) => b64(new Uint8Array(await crypto.subtle.exportKey('raw', k)));
const importPub = (s: string) => crypto.subtle.importKey('raw', unb64(s) as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
const shared = async (priv: CryptoKey, pub: string) => crypto.subtle.deriveKey({ name: 'ECDH', public: await importPub(pub) }, priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

/** Phone side: the library key, wrapped so only the computer with `webPub` can open it. */
export async function wrapLibraryKey(libraryKey: CryptoKey, webPub: string): Promise<{ pub: string; wrapped: string }> {
  const eph = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey'])) as CryptoKeyPair;
  const k = await shared(eph.privateKey, webPub);
  return { pub: await publicB64(eph.publicKey), wrapped: b64(await seal(k, await exportKey(libraryKey))) };
}
/** Computer side: opens it with its own private key. The result can't be exported again. */
export async function unwrapLibraryKey(priv: CryptoKey, phonePub: string, wrapped: string): Promise<CryptoKey> {
  const k = await shared(priv, phonePub);
  return importLibraryKey(await unseal(k, unb64(wrapped)), false);
}

const EMOJI = '🐸🌙⭐🍀🌊🔥🍋🍉🌵🌻🍄🐢🦉🐝🦋🐙🦊🐼🐧🐳🌈⚡🎈🎲🎧📚🔑🧭⛵🚲🪁🧩'.match(/\p{Extended_Pictographic}/gu)!;
/** Two pictures both screens show during pairing (made from the computer's key): a quick "it is really me". */
export async function fingerprint(pub: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', unb64(pub) as BufferSource));
  return EMOJI[h[0] % EMOJI.length] + EMOJI[h[1] % EMOJI.length];
}

// ---------------------------------------------------------------- talking to the server
export class SyncError extends Error {
  constructor(
    public status: number,
    msg: string,
  ) {
    super(msg);
  }
}
export async function call<T = Record<string, unknown>>(cfg: SyncConfig, creds: Creds | null, a: string, body: Record<string, unknown> = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: cfg.key, Authorization: `Bearer ${cfg.key}` };
  if (creds) headers['x-frogity'] = `${creds.device}.${creds.token}`;
  let res: Response;
  try {
    res = await fetch(`${cfg.url}/functions/v1/frogity-sync`, { method: 'POST', headers, body: JSON.stringify({ a, ...body }) });
  } catch {
    throw new SyncError(0, 'offline');
  }
  const out = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new SyncError(res.status, out.error ?? `failed (${res.status})`);
  return out;
}

// ---------------------------------------------------------------- files, in sealed parts
const PART = 16 * 1024 * 1024;

/** Files up to this size are kept on the server (encrypted), so they open even when the phone is off. */
export const STORE_MAX = 4 * 1024 * 1024;

/**
 * Seals a file (and a cover) and uploads it in parts. Returns what the item row needs. With `store` false only the
 * cover goes up: the file stays on the phone and is handed over when a computer asks for it.
 */
export async function uploadFile(cfg: SyncConfig, creds: Creds, key: CryptoKey, id: string, file: Blob | null, cover?: Blob | null, onPart?: (done: number, total: number) => void, store = true, fixedVer?: string) {
  const ver = file ? (fixedVer ?? newId()) : undefined;
  const allParts = file ? Math.max(1, Math.ceil(file.size / PART)) : 0;
  const parts = store ? allParts : 0;
  const coverVer = cover ? newId() : undefined;
  if (!parts && !coverVer) return { file: file ? { ver: ver!, parts: allParts, size: file.size, stored: false } : undefined, cover: undefined };
  const { urls } = await call<{ urls: Record<string, string> }>(cfg, creds, 'upload_urls', { id, ver, parts, cover: coverVer });
  const put = async (url: string, data: Uint8Array) => {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' }, body: data as BodyInit }).catch(() => null);
      if (r?.ok) return;
      if (attempt >= 3) throw new SyncError(r?.status ?? 0, 'upload failed');
      await new Promise((res) => setTimeout(res, 800 * 2 ** attempt));
    }
  };
  for (let i = 0; i < parts; i++) {
    const chunk = new Uint8Array(await file!.slice(i * PART, (i + 1) * PART).arrayBuffer());
    await put(urls[`${ver}.${i}`], await seal(key, chunk));
    onPart?.(i + 1, parts);
  }
  if (cover && coverVer) await put(urls[`cover.${coverVer}`], await seal(key, new Uint8Array(await cover.arrayBuffer())));
  return { file: file ? { ver: ver!, parts: allParts, size: file.size, stored: store } : undefined, cover: coverVer };
}

async function putBytes(url: string, data: Uint8Array) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' }, body: data as BodyInit }).catch(() => null);
    if (r?.ok) return;
    if (attempt >= 3) throw new SyncError(r?.status ?? 0, 'upload failed');
    await new Promise((res) => setTimeout(res, 800 * 2 ** attempt));
  }
}

/** The phone: hands one file over for a computer that asked for it (sealed, through a place that is cleared after). */
const RELAY_PART = 4 * 1024 * 1024; // small pieces: the computer fetches each one while the phone sends the next

export async function relaySend(cfg: SyncConfig, creds: Creds, key: CryptoKey, req: string, file: Blob, ver: string | null, onPart?: (done: number, total: number) => void) {
  const T = Date.now();
  const parts = Math.max(1, Math.ceil(file.size / RELAY_PART));
  const { urls } = await call<{ urls: string[] }>(cfg, creds, 'relay_upload_urls', { req, parts });
  console.debug(`[sync] upload places after ${Date.now() - T} ms`);
  // a few pieces at a time; the computer starts on the first ones while the rest are still going up
  const done: boolean[] = new Array(parts).fill(false);
  let next = 0;
  let announced = 0;
  const worker = async () => {
    while (next < parts) {
      const i = next++;
      await putBytes(urls[i], await seal(key, new Uint8Array(await file.slice(i * RELAY_PART, (i + 1) * RELAY_PART).arrayBuffer())));
      done[i] = true;
      onPart?.(done.filter(Boolean).length, parts);
      let c = 0;
      while (c < parts && done[c]) c++;
      if (c > announced && c < parts) {
        announced = c;
        void call(cfg, creds, 'relay_part', { req, parts, got: c }).catch(() => {});
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, parts) }, worker));
  await call(cfg, creds, 'relay_ready', { req, parts, size: file.size, ver });
  console.debug(`[sync] handed over in ${Date.now() - T} ms`);
}

/**
 * The computer: asks the phone for a document's file and waits for it (the phone must be online with Frogity).
 * `onWait` is told how long it has been waiting, so the screen can say what is going on.
 */
export async function relayFetch(cfg: SyncConfig, creds: Creds, key: CryptoKey, id: string, mime: string, onWait?: (secs: number) => void, onPart?: (done: number, total: number) => void, signal?: { stop: boolean }): Promise<Blob> {
  const T = Date.now();
  const { req } = await call<{ req: string }>(cfg, creds, 'fetch_request', { id });
  const t0 = Date.now();
  console.debug(`[sync] asked the phone (${t0 - T} ms)`);
  const out: Uint8Array[] = [];
  let started = false;
  for (;;) {
    if (signal?.stop) throw new SyncError(0, 'stopped');
    // pieces are fetched as soon as the phone has sent them
    const r = await call<{ status: string; parts?: number; got?: number; urls?: string[] }>(cfg, creds, 'relay_status', { req, from: out.length });
    if (r.status === 'gone') throw new SyncError(404, 'The request ran out — try again.');
    if (r.urls?.length) {
      if (!started) console.debug(`[sync] first piece ready after ${Date.now() - t0} ms`);
      started = true;
      // the pieces that are there come down together
      const got = await Promise.all(
        r.urls.map(async (u) => {
          const res = await fetch(u);
          if (!res.ok) throw new SyncError(res.status, 'download failed');
          return unseal(key, new Uint8Array(await res.arrayBuffer()));
        }),
      );
      for (const g of got) out.push(g);
      onPart?.(out.length, r.parts ?? out.length);
    }
    if (r.status === 'ready' && out.length >= (r.parts ?? 1)) {
      console.debug(`[sync] whole file after ${Date.now() - t0} ms`);
      void call(cfg, creds, 'relay_done', { req }).catch(() => {});
      return new Blob(out as BlobPart[], { type: mime });
    }
    if (Date.now() - t0 > 10 * 60_000) throw new SyncError(408, 'Your phone did not answer.');
    if (!started) onWait?.(Math.round((Date.now() - t0) / 1000));
    if (!r.urls?.length) await new Promise((res) => setTimeout(res, started ? 250 : 600));
  }
}

async function fetchParts(cfg: SyncConfig, creds: Creds, key: CryptoKey, id: string, names: string[], onPart?: (done: number, total: number) => void): Promise<Uint8Array[]> {
  const { urls } = await call<{ urls: Record<string, string> }>(cfg, creds, 'download_urls', { id, names });
  const out: Uint8Array[] = [];
  for (let i = 0; i < names.length; i++) {
    if (!urls[names[i]]) throw new SyncError(404, 'the file is not on the server');
    const r = await fetch(urls[names[i]]);
    if (!r.ok) throw new SyncError(r.status, 'download failed');
    out.push(await unseal(key, new Uint8Array(await r.arrayBuffer())));
    onPart?.(i + 1, names.length);
  }
  return out;
}
export async function downloadFile(cfg: SyncConfig, creds: Creds, key: CryptoKey, item: Pick<RemoteItem, 'id' | 'file_ver' | 'file_parts'>, mime: string, onPart?: (done: number, total: number) => void): Promise<Blob> {
  const names = Array.from({ length: item.file_parts }, (_, i) => `${item.file_ver}.${i}`);
  return new Blob((await fetchParts(cfg, creds, key, item.id, names, onPart)) as BlobPart[], { type: mime });
}
export async function downloadCover(cfg: SyncConfig, creds: Creds, key: CryptoKey, item: Pick<RemoteItem, 'id' | 'cover_ver'>): Promise<Blob> {
  const [b] = await fetchParts(cfg, creds, key, item.id, [`cover.${item.cover_ver}`]);
  return new Blob([b as BlobPart], { type: 'image/jpeg' });
}

// ---------------------------------------------------------------- "something changed" pings
/**
 * Listens on the library's private channel; calls `onPing` when another device wrote something. Reconnects by
 * itself. Returns a function that stops it.
 */
export function listen(cfg: SyncConfig, library: string, onPing: (p: { rev: number; by: string }) => void, onState?: (live: boolean) => void): () => void {
  const rt = cfg.rt;
  if (!rt) {
    onState?.(false);
    return () => {};
  }
  let ws: WebSocket | null = null;
  let stopped = false;
  let beat = 0;
  let retry = 0;
  let ref = 0;
  const open = () => {
    if (stopped) return;
    const u = rt.url.replace(/^http/, 'ws') + `/realtime/v1/websocket?apikey=${encodeURIComponent(rt.key)}&vsn=1.0.0`;
    ws = new WebSocket(u);
    const send = (topic: string, event: string, payload: unknown) => ws?.readyState === 1 && ws.send(JSON.stringify({ topic, event, payload, ref: String(++ref) }));
    ws.onopen = () => {
      retry = 0;
      send(`realtime:frogity-${library}`, 'phx_join', { config: { broadcast: { self: false }, presence: { key: '' }, private: false } });
      beat = setInterval(() => send('phoenix', 'heartbeat', {}), 25_000) as unknown as number;
      onState?.(true);
    };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(String(e.data));
        if (m.event === 'broadcast' && m.payload?.event === 'changed') onPing(m.payload.payload ?? {});
      } catch {
        /* not for us */
      }
    };
    ws.onclose = () => {
      clearInterval(beat);
      onState?.(false);
      if (!stopped) setTimeout(open, Math.min(30_000, 1000 * 2 ** retry++));
    };
    ws.onerror = () => ws?.close();
  };
  open();
  return () => {
    stopped = true;
    clearInterval(beat);
    ws?.close();
  };
}
