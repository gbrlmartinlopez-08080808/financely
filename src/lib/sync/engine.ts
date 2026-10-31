// The phone's side of "Use Frogity on a computer". Off until the first computer is connected. Then: every document
// (file, cover, details, highlights, bookmarks) is sealed with the library key and sent; whatever the computer
// changes comes back within a second (a ping on a private channel) and is put in place here.
//
// Nothing here changes how the rest of the app works: it watches the library and writes through the same store.
import * as db from '../db';
import { getState, patchDoc, removeDoc, saveDoc, subscribe } from '../store';
import { COVER_V, generatedCover, getFile } from '../library';
import type { Bookmark, DocKind, DocMeta, Highlight } from '../types';
import {
  call,
  downloadCover,
  downloadFile,
  exportKey,
  fingerprint,
  importLibraryKey,
  listen,
  mergeMeta,
  newLibraryKey,
  sealJson,
  SyncError,
  unsealJson,
  uploadFile,
  wrapLibraryKey,
  type Creds,
  type RemoteItem,
  type SyncMeta,
} from './core';
import { SYNC, syncAvailable } from './config';

interface Mirror {
  /** hash of what was last sent or received for this document */
  h: string;
  fileVer: string | null;
  coverVer: string | null;
  /** size + modified time of the file that was sent (a change means a new version to send) */
  sig: string;
  /** marks ids last seen (to notice deletions) */
  marks: string[];
}

let creds: Creds | null = null;
let key: CryptoKey | null = null;
let stop: (() => void) | null = null;
let mirror: Record<string, Mirror> = {};
const subs = new Set<() => void>();
export interface SyncStatus {
  on: boolean;
  live: boolean;
  /** documents still to send (first upload, new versions) */
  queue: number;
  sending?: string;
  error: string;
  last: number;
}
let status: SyncStatus = { on: false, live: false, queue: 0, error: '', last: 0 };
const setStatus = (p: Partial<SyncStatus>) => {
  status = { ...status, ...p };
  subs.forEach((f) => f());
};
export const syncStatus = () => status;
export const onSyncStatus = (f: () => void) => (subs.add(f), () => void subs.delete(f));

// ---------------------------------------------------------------- start
export async function startSync() {
  if (!syncAvailable()) return;
  creds = (await db.get<Creds>('kv', 'sync:creds')) ?? null;
  const raw = await db.get<Uint8Array>('kv', 'sync:key');
  if (!creds || !raw) return;
  // only turned on once a computer has been connected
  if (!(await db.get<boolean>('kv', 'sync:on'))) return;
  key = await importLibraryKey(raw, true);
  mirror = (await db.get<Record<string, Mirror>>('kv', 'sync:mirror')) ?? {};
  setStatus({ on: true });
  run();
}

function run() {
  if (!creds) return;
  stop?.();
  let t = 0;
  const offListen = listen(SYNC, creds.library, () => {
    clearTimeout(t);
    t = window.setTimeout(() => void pull(), 250);
  }, (live) => setStatus({ live }));
  // changes in the library (rename, progress, a new book…): sent a moment later
  let pt = 0;
  const offStore = subscribe(() => {
    clearTimeout(pt);
    pt = window.setTimeout(() => void push(), 1500);
  });
  // highlights and bookmarks are written straight to the database: a quiet look every half minute, and on leaving
  const iv = window.setInterval(() => void push(), 30_000);
  const vis = () => (document.hidden ? void push() : void pull().then(push));
  document.addEventListener('visibilitychange', vis);
  stop = () => {
    offListen();
    offStore();
    clearInterval(iv);
    document.removeEventListener('visibilitychange', vis);
  };
  void pull().then(push);
}

const failed = async (e: unknown) => {
  if (e instanceof SyncError && e.status === 401) {
    // the library was removed (from another device, or by the server): back to off, nothing on the phone is lost
    await turnOff(false);
    return;
  }
  setStatus({ error: e instanceof SyncError && e.status === 0 ? 'offline' : String((e as Error).message ?? e) });
};

// ---------------------------------------------------------------- what a document looks like when synced
const DOC_FIELDS = ['id', 'name', 'fileName', 'kind', 'mime', 'size', 'addedAt', 'openedAt', 'progress', 'readMs', 'pages', 'author', 'finished', 'position', 'url'] as const;
const docPart = (d: DocMeta) => Object.fromEntries(DOC_FIELDS.filter((k) => d[k] !== undefined).map((k) => [k, d[k]])) as unknown as SyncMeta['doc'];
async function marksOf(id: string) {
  const all = await db.entries<Highlight | Bookmark>('marks');
  const h: Highlight[] = [];
  const b: Bookmark[] = [];
  for (const [k, v] of all) {
    if (!k.startsWith(id + ':')) continue;
    if (k.startsWith(id + ':h:')) h.push(v as Highlight);
    else if (k.startsWith(id + ':b:')) b.push(v as Bookmark);
  }
  return { h, b };
}
/** The words the phone read in a scanned PDF or photo (so the computer can search them). */
async function scanText(d: DocMeta): Promise<string | undefined> {
  if (!['pdf', 'scan', 'image'].includes(d.kind)) return undefined;
  if ((await db.get<string>('kv', `scan:${d.id}`)) !== 'done2' && d.kind === 'pdf') return undefined;
  const lq = await db.get<{ blocks: { t: string; html?: string }[] }>('cache', `${d.id}:${(await import('../scan')).LQ_VERSION}`);
  const ocr = await db.get<{ text?: string }>('cache', `${d.id}:ocr`);
  const text = lq ? lq.blocks.map((b) => (b.t === 'p' || b.t === 'h' || b.t === 'li' ? (b.html ?? '').replace(/<[^>]+>/g, '') : '')).filter(Boolean).join('\n\n') : (ocr?.text ?? '');
  return text ? text.slice(0, 300_000) : undefined;
}
const hash = (v: unknown) => {
  const s = JSON.stringify(v);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36) + s.length.toString(36);
};
const saveMirror = () => db.put('kv', 'sync:mirror', mirror);

// ---------------------------------------------------------------- sending
let pushing: Promise<void> | null = null;
let pushAgain = false;
export function push(): Promise<void> {
  if (!creds || !key) return Promise.resolve();
  if (pushing) {
    pushAgain = true;
    return pushing;
  }
  pushing = (async () => {
    try {
      do {
        pushAgain = false;
        await pushOnce();
      } while (pushAgain);
      setStatus({ error: '', last: Date.now(), sending: undefined });
    } catch (e) {
      await failed(e);
    } finally {
      pushing = null;
      setStatus({ sending: undefined });
    }
  })();
  return pushing;
}
async function pushOnce() {
  if (!creds || !key) return;
  const docs = getState().docs;
  const here = new Set(docs.map((d) => d.id));
  // documents deleted on the phone go everywhere
  for (const id of Object.keys(mirror)) {
    if (here.has(id)) continue;
    await call(SYNC, creds, 'put', { id, meta: await sealJson(key, { v: 1, doc: { id }, marks: { h: [], b: [] }, gone: [], t: Date.now() }), deleted: true });
    delete mirror[id];
    await saveMirror();
  }
  // small changes first (they are quick), new files after
  const pending = docs.map((d) => ({ d, m: mirror[d.id] })).sort((a, b) => Number(!a.m) - Number(!b.m) || a.d.size - b.d.size);
  setStatus({ queue: pending.filter((p) => !p.m?.fileVer).length });
  for (const { d } of pending) {
    if (!creds || !key) return;
    const m = mirror[d.id];
    const marks = await marksOf(d.id);
    const ids = [...marks.h, ...marks.b].map((x) => x.id);
    const gone = (m?.marks ?? []).filter((x) => !ids.includes(x));
    const text = m ? undefined : await scanText(d);
    const meta: SyncMeta = { v: 1, doc: docPart(d), marks, gone, t: Date.now(), ...(text ? { text } : {}) };
    const h = hash({ doc: meta.doc, marks, gone });
    const sig = `${d.size}:${d.modified ?? 0}`;
    const needFile = !m?.fileVer || m.sig !== sig;
    if (m && m.h === h && !needFile) continue;
    let file: { ver: string; parts: number; size: number } | undefined;
    let cover: string | undefined;
    if (needFile) {
      const blob = await getFile(d.id).catch(() => undefined);
      if (!blob) continue; // a linked file that can't be read right now: next time
      setStatus({ sending: d.name });
      const coverBlob = d.coverId ? ((await db.get<Blob>('blobs', d.coverId)) ?? null) : null;
      const up = await uploadFile(SYNC, creds, key, d.id, blob, coverBlob);
      file = up.file;
      cover = up.cover;
    }
    if (!meta.text && !m) delete meta.text;
    await call(SYNC, creds, 'put', { id: d.id, meta: await sealJson(key, meta), file, cover });
    mirror[d.id] = { h, fileVer: file?.ver ?? m?.fileVer ?? null, coverVer: cover ?? m?.coverVer ?? null, sig, marks: ids };
    await saveMirror();
    if (needFile) setStatus({ queue: Math.max(0, status.queue - 1) });
  }
}

// ---------------------------------------------------------------- receiving
let pulling: Promise<void> | null = null;
export function pull(): Promise<void> {
  if (!creds || !key) return Promise.resolve();
  if (pulling) return pulling;
  pulling = (async () => {
    try {
      for (;;) {
        const since = (await db.get<number>('kv', 'sync:rev')) ?? 0;
        const r = await call<{ items: RemoteItem[]; more: boolean; me: string }>(SYNC, creds!, 'changes', { since });
        for (const it of r.items) if (it.updated_by !== r.me) await apply(it);
        if (r.items.length) await db.put('kv', 'sync:rev', r.items[r.items.length - 1].rev);
        if (!r.more) break;
      }
      setStatus({ error: '', last: Date.now() });
    } catch (e) {
      await failed(e);
    } finally {
      pulling = null;
    }
  })();
  return pulling;
}

async function apply(it: RemoteItem) {
  const local = getState().docs.find((d) => d.id === it.id);
  if (it.deleted) {
    if (local) await removeDoc(it.id);
    delete mirror[it.id];
    await saveMirror();
    return;
  }
  let remote: SyncMeta;
  try {
    remote = await unsealJson<SyncMeta>(key!, it.meta);
  } catch {
    return;
  }
  const m = mirror[it.id];
  if (!local) {
    // a document added on the computer
    const blob = await downloadFile(SYNC, creds!, key!, it, remote.doc.mime);
    await db.put('files', it.id, blob);
    const coverId = `${it.id}:cover:${it.cover_ver ?? 'g'}`;
    const cover = it.cover_ver ? await downloadCover(SYNC, creds!, key!, it).catch(() => null) : null;
    await db.put('blobs', coverId, cover ?? (await generatedCover(remote.doc.name, remote.doc.kind as DocKind, remote.doc.author)));
    await writeMarks(it.id, remote.marks, remote.gone);
    const meta = { ...(remote.doc as unknown as DocMeta), coverId, coverV: COVER_V, enriched: true, readMs: remote.doc.readMs ?? 0, modified: Date.now() };
    mirror[it.id] = { h: '', fileVer: it.file_ver, coverVer: it.cover_ver, sig: `${meta.size}:${meta.modified}`, marks: [...remote.marks.h, ...remote.marks.b].map((x) => x.id) };
    await saveDoc(meta);
    mirror[it.id].h = hash({ doc: docPart(meta), marks: remote.marks, gone: [] });
    await saveMirror();
    return;
  }
  // details and marks: joined with what the phone has
  const mineMarks = await marksOf(it.id);
  // changed here since the last exchange (and not sent yet): the phone's own details win
  const dirty = !!m && m.h !== hash({ doc: docPart(local), marks: mineMarks, gone: [] });
  const mine: SyncMeta = { v: 1, doc: docPart(local), marks: mineMarks, gone: [], t: dirty ? Date.now() : 0 };
  const merged = mergeMeta(mine, remote);
  const patch: Partial<DocMeta> = {};
  for (const k of DOC_FIELDS) {
    if (k === 'id' || k === 'size') continue;
    const v = (merged.doc as unknown as Record<string, unknown>)[k];
    if (v !== undefined && JSON.stringify(v) !== JSON.stringify((local as unknown as Record<string, unknown>)[k])) (patch as Record<string, unknown>)[k] = v;
  }
  await writeMarks(it.id, merged.marks, merged.gone);
  // a new version of the file (edited on the computer)
  let sig = m?.sig ?? `${local.size}:${local.modified ?? 0}`;
  if (it.file_ver && it.file_ver !== m?.fileVer) {
    const blob = await downloadFile(SYNC, creds!, key!, it, local.mime || remote.doc.mime);
    await db.put('files', it.id, blob);
    // what was made from the old version (Liquid view, reading of scans, form check) is made again
    await db.delPrefix('cache', it.id + ':');
    for (const k of ['liquid', 'scan', 'plan', 'lqmeta', 'lqv', 'figs', 'formoffer', 'scanfail']) await db.del('kv', `${k}:${it.id}`);
    Object.assign(patch, { size: blob.size, modified: Date.now(), uri: undefined, folder: undefined });
    sig = `${blob.size}:${patch.modified}`;
  }
  if (it.cover_ver && it.cover_ver !== m?.coverVer) {
    const cover = await downloadCover(SYNC, creds!, key!, it).catch(() => null);
    if (cover) {
      const coverId = `${it.id}:cover:${it.cover_ver}`;
      await db.put('blobs', coverId, cover);
      if (local.coverId && local.coverId !== coverId) await db.del('blobs', local.coverId);
      Object.assign(patch, { coverId, coverV: COVER_V });
    }
  }
  if (Object.keys(patch).length) await patchDoc(it.id, patch, 'openedAt' in patch);
  const now = getState().docs.find((d) => d.id === it.id)!;
  if (patch.modified) import('../scan').then((s) => s.queueScan(now));
  mirror[it.id] = { h: hash({ doc: docPart(now), marks: merged.marks, gone: merged.gone }), fileVer: it.file_ver, coverVer: it.cover_ver, sig, marks: [...merged.marks.h, ...merged.marks.b].map((x) => x.id) };
  await saveMirror();
}

async function writeMarks(id: string, marks: SyncMeta['marks'], gone: string[]) {
  for (const h of marks.h) await db.put('marks', `${id}:h:${h.id}`, { id: h.id, docId: id, text: h.text, prefix: h.prefix ?? '', note: h.note, at: h.at });
  for (const b of marks.b) await db.put('marks', `${id}:b:${b.id}`, b);
  for (const g of gone) {
    await db.del('marks', `${id}:h:${g}`);
    await db.del('marks', `${id}:b:${g}`);
  }
}

// ---------------------------------------------------------------- connecting a computer
export type PairState =
  | { stage: 'starting' }
  | { stage: 'code'; code: string; expires: number }
  | { stage: 'joining'; label: string; emoji: string }
  | { stage: 'done'; label: string }
  | { stage: 'error'; message: string };

/** Shows a code, waits for a computer to type it, and hands that computer the library key (wrapped for it). */
export async function connectComputer(onState: (s: PairState) => void, cancelled: () => boolean) {
  try {
    onState({ stage: 'starting' });
    creds = (await db.get<Creds>('kv', 'sync:creds')) ?? null;
    let raw = await db.get<Uint8Array>('kv', 'sync:key');
    if (!creds || !raw) {
      const r = await call<Creds>(SYNC, null, 'register', { label: phoneLabel() });
      creds = { library: r.library, device: r.device, token: r.token };
      key = await newLibraryKey();
      raw = await exportKey(key);
      await db.put('kv', 'sync:creds', creds);
      await db.put('kv', 'sync:key', raw);
    }
    key = await importLibraryKey(raw, true);
    for (;;) {
      const p = await call<{ pairing: string; code: string; expires: string }>(SYNC, creds, 'pair_start', {});
      const expires = Date.parse(p.expires);
      onState({ stage: 'code', code: p.code, expires });
      while (Date.now() < expires) {
        if (cancelled()) return;
        await new Promise((r) => setTimeout(r, 900));
        const s = await call<{ status: string; pub?: string; label?: string }>(SYNC, creds, 'pair_status', { pairing: p.pairing });
        if (s.status === 'joined' && s.pub) {
          onState({ stage: 'joining', label: s.label ?? 'Computer', emoji: await fingerprint(s.pub) });
          const w = await wrapLibraryKey(key, s.pub);
          await call(SYNC, creds, 'pair_finish', { pairing: p.pairing, pub: w.pub, wrapped: w.wrapped });
          await db.put('kv', 'sync:on', true);
          setStatus({ on: true });
          if (!stop) {
            mirror = (await db.get<Record<string, Mirror>>('kv', 'sync:mirror')) ?? {};
            run();
          }
          onState({ stage: 'done', label: s.label ?? 'Computer' });
          return;
        }
        if (s.status === 'expired') break;
      }
      // the code ran out unused: a fresh one, as long as the screen is open
    }
  } catch (e) {
    onState({ stage: 'error', message: e instanceof SyncError && e.status === 0 ? 'No internet connection.' : (e as Error).message });
  }
}
function phoneLabel() {
  const m = navigator.userAgent.match(/Android [\d.]+; ([^;)]+)/);
  return (m?.[1] ?? 'Phone').replace(/Build.*$/, '').trim().slice(0, 40) || 'Phone';
}

export const listDevices = () => call<{ devices: { id: string; kind: string; label: string; created_at: string; last_seen: string }[]; me: string }>(SYNC, creds, 'devices');
export const disconnectDevice = (id: string) => call(SYNC, creds, 'revoke', { device: id });

/** Stops syncing. With `wipe`, everything kept on the server for this library is deleted too. */
export async function turnOff(wipe: boolean) {
  if (wipe && creds) await call(SYNC, creds, 'forget', {}).catch(() => {});
  stop?.();
  stop = null;
  creds = null;
  key = null;
  mirror = {};
  for (const k of ['sync:creds', 'sync:key', 'sync:on', 'sync:mirror', 'sync:rev']) await db.del('kv', k);
  setStatus({ on: false, live: false, queue: 0, error: '', last: 0 });
}
