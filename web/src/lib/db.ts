// The computer's own copy, in the browser (IndexedDB). Opened documents and covers are kept here decrypted, so the
// library opens instantly and works offline; "Disconnect" wipes all of it.
const NAME = 'frogity-web';
const STORES = ['docs', 'files', 'covers', 'kv', 'text'] as const;
export type Store = (typeof STORES)[number];

let dbp: Promise<IDBDatabase> | null = null;
function open() {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => STORES.forEach((s) => r.result.objectStoreNames.contains(s) || r.result.createObjectStore(s));
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const wrap = <T,>(q: IDBRequest<T>) => new Promise<T>((res, rej) => ((q.onsuccess = () => res(q.result)), (q.onerror = () => rej(q.error))));
const st = async (s: Store, mode: IDBTransactionMode = 'readonly') => (await open()).transaction(s, mode).objectStore(s);

export const get = async <T,>(s: Store, k: string) => wrap((await st(s)).get(k)) as Promise<T | undefined>;
export const put = async (s: Store, k: string, v: unknown) => void (await wrap((await st(s, 'readwrite')).put(v, k)));
export const del = async (s: Store, k: string) => void (await wrap((await st(s, 'readwrite')).delete(k)));
export const keys = async (s: Store) => ((await wrap((await st(s)).getAllKeys())) as IDBValidKey[]).map(String);
export const all = async <T,>(s: Store) => wrap((await st(s)).getAll()) as Promise<T[]>;
export async function wipe() {
  for (const s of STORES) await wrap((await st(s, 'readwrite')).clear());
}
