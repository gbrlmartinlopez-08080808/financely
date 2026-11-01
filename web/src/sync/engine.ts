// The computer's side of sync: pairing, pulling what changed, sending what changed here, and keeping a decrypted copy
// in the browser. Every write is sent at once; a "changed" ping from the phone pulls the news within a second.
import * as db from '../lib/db';
import { docById, getState, setState, toast, type LocalDoc } from '../lib/store';
import { kindOf, makeCover, mimeOf, pdfCover, titleOf } from '../lib/kinds';
import {
  call,
  downloadCover,
  downloadFile,
  fingerprint,
  relayFetch,
  listen,
  mergeMeta,
  newId,
  newPairKeys,
  publicB64,
  sealJson,
  SyncError,
  unsealJson,
  unwrapLibraryKey,
  uploadFile,
  type Creds,
  type RemoteItem,
  type SyncConfig,
  type SyncMeta,
} from './core';
import { SYNC } from './config';

const cfg: SyncConfig = SYNC;
let creds: Creds | null = null;
let key: CryptoKey | null = null;
let stopListen: (() => void) | null = null;

const markCached = (id: string) => setState((s) => (s.cached[id] ? {} : { cached: { ...s.cached, [id]: true } }));
/** Starts fetching a document in the background (when the pointer rests on it): clicking it then opens it at once. */
export function prefetch(id: string) {
  const d = docById(id);
  if (!d || getState().cached[id] || d.meta.doc.size > 12 * 1024 * 1024) return;
  void getFile(id).catch(() => {});
}
const busy = (d: number) => setState((s) => ({ sync: { ...s.sync, busy: Math.max(0, s.sync.busy + d) } }));
const sortDocs = (d: LocalDoc[]) => [...d].sort((a, b) => (b.meta.doc.openedAt || b.meta.doc.addedAt) - (a.meta.doc.openedAt || a.meta.doc.addedAt));
function putLocal(d: LocalDoc) {
  setState((s) => ({ docs: sortDocs([...s.docs.filter((x) => x.id !== d.id), d]) }));
  return db.put('docs', d.id, d);
}

// ---------------------------------------------------------------- start
export async function boot() {
  creds = (await db.get<Creds>('kv', 'creds')) ?? null;
  key = (await db.get<CryptoKey>('kv', 'key')) ?? null;
  const notice = (await db.get<string>('kv', 'notice')) ?? '';
  if (!creds || !key) return setState({ phase: 'unpaired', notice });
  const docs = await db.all<LocalDoc>('docs');
  const covers: Record<string, string> = {};
  for (const d of docs) {
    const c = await db.get<Blob>('covers', d.id);
    if (c) covers[d.id] = URL.createObjectURL(c);
  }
  const cached: Record<string, boolean> = {};
  for (const k of await db.keys('files')) cached[k] = true;
  setState({ phase: 'ready', docs: sortDocs(docs), covers, cached });
  start();
}

function start() {
  if (!creds) return;
  stopListen?.();
  let t = 0;
  stopListen = listen(cfg, creds.library, () => {
    clearTimeout(t);
    t = window.setTimeout(() => void pull(), 250);
  }, (live) => setState((s) => ({ sync: { ...s.sync, live } })));
  void pull().then(pushDirty);
  if (!cfg.rt) void watch();
}
/** Without live pings: one request waits at the server until something changes (news within about a second). */
let watching = false;
async function watch() {
  if (watching) return;
  watching = true;
  try {
    while (creds && getState().phase === 'ready') {
      if (document.hidden) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      try {
        const since = (await db.get<number>('kv', 'rev')) ?? 0;
        const r = await call<{ changed: boolean }>(cfg, creds, 'wait', { since });
        if (r.changed) await pull();
      } catch (e) {
        if (e instanceof SyncError && e.status === 401) return void failed(e);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  } finally {
    watching = false;
  }
}
// news from the phone: every few seconds while this tab is in front (without live pings), and every half minute
// as a safety net (missed pings, a laptop waking up)
let lastPull = 0;
setInterval(() => {
  const s = getState();
  if (s.phase !== 'ready') return;
  const gap = 30_000;
  if (Date.now() - lastPull >= gap) {
    lastPull = Date.now();
    void pull();
  }
}, 1000);
window.addEventListener('focus', () => getState().phase === 'ready' && void pull());
window.addEventListener('online', () => getState().phase === 'ready' && void pull().then(pushDirty));

/** This computer's access was taken away (or it disconnected itself): its copy goes. */
async function lost(why: string) {
  stopListen?.();
  creds = key = null;
  await db.wipe();
  await db.put('kv', 'notice', why);
  Object.values(getState().covers).forEach((u) => URL.revokeObjectURL(u));
  setState({ phase: 'unpaired', docs: [], covers: {}, cached: {}, notice: why });
}
const failed = async (e: unknown) => {
  if (e instanceof SyncError && e.status === 401) return lost('This computer was disconnected from your phone. Connect it again with a new code.');
  setState((s) => ({ sync: { ...s.sync, error: e instanceof SyncError && e.status === 0 ? 'offline' : String((e as Error).message ?? e) } }));
};

// ---------------------------------------------------------------- pairing
export type PairStage = { stage: 'joining' } | { stage: 'waiting'; emoji: string } | { stage: 'done' } | { stage: 'error'; message: string };
function deviceLabel() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : /CrOS/.test(ua) ? 'Chromebook' : 'computer';
  return `${browser} on ${os}`;
}
export async function pair(code: string, onStage: (s: PairStage) => void) {
  try {
    onStage({ stage: 'joining' });
    const keys = await newPairKeys();
    const pub = await publicB64(keys.publicKey);
    const j = await call<{ pairing: string; secret: string }>(cfg, null, 'pair_join', { code, pub, label: deviceLabel() });
    onStage({ stage: 'waiting', emoji: await fingerprint(pub) });
    const until = Date.now() + 3.5 * 60_000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 500));
      const w = await call<{ status: string; library?: string; device?: string; token?: string; wrapped?: string; pub?: string }>(cfg, null, 'pair_wait', { pairing: j.pairing, secret: j.secret });
      if (w.status === 'expired') throw new Error('The code ran out of time. Make a new one on your phone.');
      if (w.status !== 'done') continue;
      key = await unwrapLibraryKey(keys.privateKey, w.pub!, w.wrapped!);
      creds = { library: w.library!, device: w.device!, token: w.token! };
      await db.put('kv', 'creds', creds);
      await db.put('kv', 'key', key); // a key that can't be read out again, only used
      await db.del('kv', 'notice');
      await db.put('kv', 'rev', 0);
      setState({ phase: 'ready', docs: [], covers: {}, cached: {}, notice: '' });
      onStage({ stage: 'done' });
      start();
      return;
    }
    throw new Error('Your phone did not answer. Keep the code screen open on the phone and try again.');
  } catch (e) {
    onStage({ stage: 'error', message: e instanceof SyncError && e.status === 0 ? 'No connection. Check the internet and try again.' : (e as Error).message });
  }
}
export async function disconnect() {
  if (creds) await call(cfg, creds, 'revoke', { device: creds.device }).catch(() => {});
  await lost('');
}
export const devices = () => call<{ devices: { id: string; kind: string; label: string; created_at: string; last_seen: string }[]; me: string }>(cfg, creds, 'devices');

// ---------------------------------------------------------------- pulling
let pulling: Promise<void> | null = null;
let again = false;
export function pull(): Promise<void> {
  if (pulling) {
    again = true;
    return pulling;
  }
  pulling = (async () => {
    busy(1);
    try {
      do {
        again = false;
        for (;;) {
          if (!creds || !key) return;
          const since = (await db.get<number>('kv', 'rev')) ?? 0;
          const r = await call<{ items: RemoteItem[]; more: boolean; me: string; head?: number }>(cfg, creds, 'changes', { since });
          for (const it of r.items) await apply(it);
          const top = Math.max(since, r.head ?? 0, r.items.length ? r.items[r.items.length - 1].rev : 0);
          if (top !== since) await db.put('kv', 'rev', top);
          if (!r.more) break;
        }
      } while (again);
      setState((s) => ({ sync: { ...s.sync, error: '', last: Date.now() } }));
    } catch (e) {
      await failed(e);
    } finally {
      busy(-1);
      pulling = null;
    }
  })();
  return pulling;
}

async function apply(it: RemoteItem) {
  const have = docById(it.id);
  if (it.deleted) {
    if (have) await dropLocal(it.id);
    return;
  }
  let remote: SyncMeta;
  try {
    remote = await unsealJson<SyncMeta>(key!, it.meta);
  } catch {
    return; // sealed with another key: not ours to read
  }
  const meta = mergeMeta(have?.meta, remote);
  const changedHere = !!have?.dirty && JSON.stringify(meta) !== JSON.stringify(remote);
  const d: LocalDoc = {
    id: it.id,
    meta,
    rev: it.rev,
    fileVer: have?.fileDirty ? have.fileVer : it.file_ver,
    fileParts: have?.fileDirty ? have.fileParts : it.file_parts,
    fileStored: have?.fileDirty ? have.fileStored : it.file_stored !== false,
    coverVer: it.cover_ver,
    dirty: changedHere,
    fileDirty: have?.fileDirty,
  };
  await putLocal(d);
  if (it.cover_ver && it.cover_ver !== have?.coverVer) void fetchCover(d);
  if (have && it.file_ver !== have.fileVer && !have.fileDirty) window.dispatchEvent(new CustomEvent('frogity:file', { detail: { id: it.id } }));
  if (changedHere) schedulePush(it.id);
}
async function fetchCover(d: LocalDoc) {
  try {
    const b = await downloadCover(cfg, creds!, key!, { id: d.id, cover_ver: d.coverVer });
    await db.put('covers', d.id, b);
    setState((s) => {
      if (s.covers[d.id]) URL.revokeObjectURL(s.covers[d.id]);
      return { covers: { ...s.covers, [d.id]: URL.createObjectURL(b) } };
    });
  } catch {
    /* the cover can wait */
  }
}
async function dropLocal(id: string) {
  await db.del('docs', id);
  await db.del('files', id);
  await db.del('covers', id);
  await db.del('text', id);
  setState((s) => {
    if (s.covers[id]) URL.revokeObjectURL(s.covers[id]);
    const covers = { ...s.covers };
    delete covers[id];
    const cached = { ...s.cached };
    delete cached[id];
    return { docs: s.docs.filter((d) => d.id !== id), covers, cached };
  });
  window.dispatchEvent(new CustomEvent('frogity:gone', { detail: { id } }));
}

// ---------------------------------------------------------------- the file itself
const loading = new Map<string, { ver: string | null; p: Promise<Blob> }>();
/**
 * The document's file: from this computer's copy, or fetched (and decrypted) once. Asking again while it is on its way
 * (a second click, a hover, a new version number) joins the same transfer — the phone is only ever asked once.
 */
export function getFile(id: string): Promise<Blob> {
  const d = docById(id);
  if (!d) return Promise.reject(new Error('not found'));
  const mine = loading.get(id);
  if (mine) return mine.p;
  const p = (async () => {
    const cached = await db.get<{ ver: string | null; blob: Blob }>('files', id);
    if (cached && (cached.ver === d.fileVer || cached.ver === 'local')) return cached.blob;
    busy(1);
    const progress = (done: number, total: number) => setState((s) => ({ sync: { ...s.sync, asking: undefined, transfer: { name: d.meta.doc.name, done, total } } }));
    const ask = () => relayFetch(cfg, creds!, key!, id, d.meta.doc.mime, (secs) => setState((s) => ({ sync: { ...s.sync, asking: { name: d.meta.doc.name, secs } } })), progress);
    try {
      // small files are kept (sealed) on the server; anything else — big files, files the phone has not sent yet, or one
      // that did not come — is asked of the phone, which answers at once and puts this document first
      let blob: Blob;
      if (d.fileStored !== false && d.fileVer && d.fileParts > 0) {
        try {
          blob = await downloadFile(cfg, creds!, key!, { id, file_ver: d.fileVer, file_parts: d.fileParts }, d.meta.doc.mime, progress);
        } catch {
          blob = await ask();
        }
      } else blob = await ask();
      await db.put('files', id, { ver: d.fileVer, blob });
      markCached(id);
      return blob;
    } finally {
      busy(-1);
      setState((s) => ({ sync: { ...s.sync, transfer: undefined, asking: undefined } }));
    }
  })();
  loading.set(id, { ver: d.fileVer, p });
  const done = () => loading.get(id)?.p === p && loading.delete(id);
  p.then(done, done);
  return p;
}

// ---------------------------------------------------------------- sending
const timers = new Map<string, number>();
function schedulePush(id: string, ms = 600) {
  clearTimeout(timers.get(id));
  timers.set(id, window.setTimeout(() => void push(id), ms));
}
const pushing = new Map<string, Promise<void>>();
async function push(id: string) {
  const prev = pushing.get(id);
  if (prev) await prev;
  const run = (async () => {
    const d = docById(id);
    if (!d || !creds || !key) return;
    busy(1);
    try {
      let file: { ver: string; parts: number; size: number; stored?: boolean } | undefined;
      let cover: string | undefined;
      if (d.fileDirty) {
        const local = await db.get<{ ver: string | null; blob: Blob }>('files', id);
        const coverBlob = (await db.get<{ pending?: boolean; blob: Blob }>('kv', `cover:${id}`))?.blob ?? null;
        const up = await uploadFile(cfg, creds, key, id, local?.blob ?? null, coverBlob, (done, total) =>
          setState((s) => ({ sync: { ...s.sync, transfer: total > 1 ? { name: d.meta.doc.name, done, total } : undefined } })),
        );
        file = up.file;
        cover = up.cover;
        if (local && file) await db.put('files', id, { ver: file.ver, blob: local.blob });
        await db.del('kv', `cover:${id}`);
      }
      const meta = await sealJson(key, d.meta);
      const r = await call<{ rev: number }>(cfg, creds, 'put', { id, meta, file, cover });
      const now = docById(id);
      if (now) await putLocal({ ...now, rev: r.rev, dirty: now.meta !== d.meta ? now.dirty : false, fileDirty: false, fileVer: file?.ver ?? now.fileVer, fileParts: file?.parts ?? now.fileParts, fileStored: file ? file.stored !== false : now.fileStored, coverVer: cover ?? now.coverVer });
      setState((s) => ({ sync: { ...s.sync, error: '', last: Date.now(), transfer: undefined } }));
    } catch (e) {
      await failed(e);
      if (!(e instanceof SyncError && e.status === 401)) schedulePush(id, 8000); // try again a little later
    } finally {
      busy(-1);
    }
  })();
  pushing.set(id, run);
  await run;
  pushing.delete(id);
}
function pushDirty() {
  for (const d of getState().docs) if (d.dirty || d.fileDirty) schedulePush(d.id, 50);
}

// ---------------------------------------------------------------- changing things here
/** Changes a document's details (name, progress, …); reaches the phone within a second. */
export async function updateDoc(id: string, patch: Partial<SyncMeta['doc']>) {
  const d = docById(id);
  if (!d) return;
  await putLocal({ ...d, meta: { ...d.meta, doc: { ...d.meta.doc, ...patch }, t: Date.now() }, dirty: true });
  schedulePush(id);
}
/** Replaces the marks lists (highlights, bookmarks) of a document. */
export async function updateMarks(id: string, f: (m: SyncMeta['marks'], gone: string[]) => void) {
  const d = docById(id);
  if (!d) return;
  const marks = { h: [...d.meta.marks.h], b: [...d.meta.marks.b] };
  const gone = [...d.meta.gone];
  f(marks, gone);
  await putLocal({ ...d, meta: { ...d.meta, marks, gone }, dirty: true });
  schedulePush(id);
}
/** A new version of the file (an edited PDF, a saved text): kept here at once, uploaded right after. */
export async function saveFile(id: string, blob: Blob, patch: Partial<SyncMeta['doc']> = {}, cover?: Blob) {
  const d = docById(id);
  if (!d) return;
  await db.put('files', id, { ver: 'local', blob });
  markCached(id);
  if (cover) {
    await db.put('kv', `cover:${id}`, { blob: cover });
    await db.put('covers', id, cover);
    setState((s) => ({ covers: { ...s.covers, [id]: URL.createObjectURL(cover) } }));
  }
  loading.delete(id);
  await db.del('text', id);
  await putLocal({ ...d, fileVer: 'local', meta: { ...d.meta, doc: { ...d.meta.doc, size: blob.size, ...patch }, t: Date.now() }, dirty: true, fileDirty: true });
  schedulePush(id, 50);
}
/** Files from the computer join the library (and appear on the phone). */
export async function importFiles(files: File[] | { name: string; blob: Blob }[]): Promise<string[]> {
  const ids: string[] = [];
  for (const f of files) {
    const name = 'blob' in f ? f.name : f.name;
    const blob = 'blob' in f ? f.blob : f;
    const kind = kindOf(name, blob.type);
    const mime = mimeOf(name, blob.type);
    let title = titleOf(name);
    let author: string | undefined;
    let pages: number | undefined;
    let cover: Blob | undefined;
    if (kind === 'pdf') {
      const x = await pdfCover(new Uint8Array(await blob.arrayBuffer()));
      if (x) ({ cover, pages } = x), (author = x.author), (title = x.title && x.title.length > 3 && !/untitled|microsoft word/i.test(x.title) ? x.title : title);
    } else if (kind === 'image') cover = blob;
    cover ??= await makeCover(title, kind, author);
    const id = newId();
    const now = Date.now();
    const meta: SyncMeta = {
      v: 1,
      doc: { id, name: title, fileName: name, kind, mime, size: blob.size, addedAt: now, openedAt: now, progress: 0, readMs: 0, pages, author },
      marks: { h: [], b: [] },
      gone: [],
      t: now,
    };
    await db.put('files', id, { ver: 'local', blob });
    markCached(id);
    await db.put('kv', `cover:${id}`, { blob: cover });
    await db.put('covers', id, cover);
    setState((s) => ({ covers: { ...s.covers, [id]: URL.createObjectURL(cover!) } }));
    await putLocal({ id, meta, rev: 0, fileVer: 'local', fileParts: 0, coverVer: null, dirty: true, fileDirty: true });
    schedulePush(id, 50);
    ids.push(id);
  }
  if (ids.length) toast(ids.length === 1 ? 'Added — on its way to your phone' : `${ids.length} files added — on their way to your phone`);
  return ids;
}
/** Deletes a document everywhere (phone included). */
export async function deleteDoc(id: string) {
  const d = docById(id);
  if (!d || !creds || !key) return;
  const meta = await sealJson(key, { ...d.meta, t: Date.now() });
  await dropLocal(id);
  await call(cfg, creds, 'put', { id, meta, deleted: true }).catch(failed);
}
