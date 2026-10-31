// Tiny promise wrapper around IndexedDB. Everything lives on-device.

const DB_NAME = 'quire';
const VERSION = 1;
const STORES = ['docs', 'files', 'blobs', 'kv', 'marks', 'days', 'cache'] as const;
export type StoreName = (typeof STORES)[number];

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: StoreName, mode: IDBTransactionMode) {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export async function get<T>(name: StoreName, key: string): Promise<T | undefined> {
  return wrap((await store(name, 'readonly')).get(key)) as Promise<T | undefined>;
}

export async function put<T>(name: StoreName, key: string, value: T): Promise<void> {
  await wrap((await store(name, 'readwrite')).put(value, key));
}

export async function del(name: StoreName, key: string): Promise<void> {
  await wrap((await store(name, 'readwrite')).delete(key));
}

export async function all<T>(name: StoreName): Promise<T[]> {
  return wrap((await store(name, 'readonly')).getAll()) as Promise<T[]>;
}

export async function entries<T>(name: StoreName): Promise<[string, T][]> {
  const s = await store(name, 'readonly');
  const [keys, values] = await Promise.all([wrap(s.getAllKeys()), wrap(s.getAll())]);
  return keys.map((k, i) => [String(k), values[i] as T]);
}

/** The keys that start with `prefix` (keys only: nothing big is read). */
export async function keys(name: StoreName, prefix: string): Promise<string[]> {
  const s = await store(name, 'readonly');
  return ((await wrap(s.getAllKeys(IDBKeyRange.bound(prefix, prefix + '\uffff')))) as IDBValidKey[]).map(String);
}

export async function delPrefix(name: StoreName, prefix: string): Promise<void> {
  const s = await store(name, 'readwrite');
  const range = IDBKeyRange.bound(prefix, prefix + '￿');
  await wrap(s.delete(range));
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
