// Documents that stay where they are on the phone. Quire remembers the Android document URI and reads the
// file only when you open it, so linking a thousand PDFs costs almost no space.
import * as db from './db';
import { detectKind, titleFromFile } from './formats/detect';
import { generatedCover, extractMeta } from './library';
import { getState, patchDoc, saveDoc, removeDoc } from './store';
import { listFolderNative, pickFilesNative, pickFolderNative, readUriBlob, type LinkedFile } from './native';
import type { DocMeta } from './types';

export interface LinkedFolder {
  uri: string;
  name: string;
  added: number;
}

export const getFolders = async () => (await db.get<LinkedFolder[]>('kv', 'folders')) ?? [];
const setFolders = (f: LinkedFolder[]) => db.put('kv', 'folders', f);
const getIgnored = async () => new Set((await db.get<string[]>('kv', 'ignored')) ?? []);

export async function ignoreUri(uri: string) {
  const s = await getIgnored();
  s.add(uri);
  await db.put('kv', 'ignored', [...s]);
}

export async function readLinked(doc: DocMeta): Promise<Blob> {
  return readUriBlob(doc.uri!, doc.fileName, doc.mime);
}

async function addLinked(f: LinkedFile, folder?: string): Promise<DocMeta | null> {
  const docs = getState().docs;
  if (docs.some((d) => d.uri === f.uri)) return null;
  const kind = detectKind(f.name, f.mime);
  const title = titleFromFile(f.name);
  const id = db.uid();
  const coverId = `${id}:cover`;
  await db.put('blobs', coverId, await generatedCover(title, kind));
  const now = Date.now();
  const meta: DocMeta = {
    id,
    name: title,
    fileName: f.name,
    kind,
    mime: f.mime,
    size: f.size,
    addedAt: now,
    openedAt: f.modified && f.modified < now ? f.modified : now - 1,
    progress: 0,
    coverId,
    readMs: 0,
    uri: f.uri,
    folder,
    modified: f.modified,
  };
  await saveDoc(meta);
  return meta;
}

/** Pick files with Android's document picker; they are linked, not copied. */
export async function linkPickedFiles(): Promise<DocMeta[]> {
  const files = await pickFilesNative();
  const out: DocMeta[] = [];
  for (const f of files) {
    const m = await addLinked(f);
    if (m) out.push(m);
  }
  queueEnrich(out);
  return out;
}

export async function linkFolder(): Promise<{ folder?: LinkedFolder; added: number }> {
  const r = await pickFolderNative();
  if (!r.uri) return { added: 0 };
  const folders = await getFolders();
  let folder = folders.find((f) => f.uri === r.uri);
  if (!folder) {
    folder = { uri: r.uri, name: r.name ?? 'Folder', added: Date.now() };
    await setFolders([...folders, folder]);
  }
  const added = await scanFolder(folder);
  return { folder, added };
}

export async function unlinkFolder(uri: string) {
  await setFolders((await getFolders()).filter((f) => f.uri !== uri));
  for (const d of getState().docs.filter((d) => d.folder === uri)) await removeDoc(d.id);
}

async function scanFolder(folder: LinkedFolder): Promise<number> {
  const [files, ignored] = await Promise.all([listFolderNative(folder.uri), getIgnored()]);
  const known = new Set(getState().docs.map((d) => d.uri));
  const fresh: DocMeta[] = [];
  for (const f of files) {
    if (known.has(f.uri) || ignored.has(f.uri)) continue;
    const m = await addLinked(f, folder.uri);
    if (m) fresh.push(m);
  }
  // files that vanished from the folder
  const present = new Set(files.map((f) => f.uri));
  for (const d of getState().docs.filter((d) => d.folder === folder.uri && d.uri && !present.has(d.uri))) await removeDoc(d.id);
  queueEnrich(fresh);
  return fresh.length;
}

export async function rescanAll(): Promise<number> {
  let n = 0;
  for (const f of await getFolders()) {
    try {
      n += await scanFolder(f);
    } catch (e) {
      console.warn('folder scan failed', f.name, e);
    }
  }
  // anything linked earlier that never got its real cover
  queueEnrich(getState().docs.filter((d) => d.uri && !d.enriched).slice(0, 60));
  return n;
}

// ---- covers & titles for linked files, read lazily in the background (one at a time, never blocking the UI)
let queue: DocMeta[] = [];
let running = false;
export function queueEnrich(docs: DocMeta[]) {
  for (const d of docs) if (!queue.some((q) => q.id === d.id)) queue.push(d);
  if (!running) void run();
}
async function run() {
  running = true;
  while (queue.length) {
    const d = queue.shift()!;
    const cur = getState().docs.find((x) => x.id === d.id);
    if (!cur || cur.enriched || !cur.uri) continue;
    try {
      if (cur.size > 80_000_000 || !['pdf', 'epub', 'docx', 'slides', 'image'].includes(cur.kind)) {
        await patchDoc(cur.id, { enriched: true });
        continue;
      }
      const blob = await readLinked(cur);
      const x = await extractMeta(blob, cur.fileName, cur.kind);
      const patch: Partial<DocMeta> = { enriched: true, pages: x.pages ?? cur.pages, author: x.author ?? cur.author };
      if (x.title && x.title !== cur.name && cur.name === titleFromFile(cur.fileName)) patch.name = x.title;
      if (x.cover) {
        const coverId = `${cur.id}:cover-${Date.now()}`;
        await db.put('blobs', coverId, x.cover);
        if (cur.coverId) await db.del('blobs', cur.coverId);
        patch.coverId = coverId;
      }
      await patchDoc(cur.id, patch);
    } catch (e) {
      console.warn('enrich failed', cur.fileName, e);
      await patchDoc(cur.id, { enriched: true });
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  running = false;
}
