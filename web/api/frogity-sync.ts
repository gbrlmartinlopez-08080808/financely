// Frogity sync server, as a Vercel function (reached at /functions/v1/frogity-sync through vercel.json).
// The same actions and rules as supabase/functions/frogity-sync, but everything is kept in one private Supabase
// Storage bucket instead of tables, so it needs nothing set up beyond that bucket.
//
// It never sees a document: files, covers and notes arrive sealed by the devices. It checks device tokens, hands
// out short-lived storage links, and pairs a computer with a four-digit code.
//
// Environment (server side only): SUPABASE_URL, SUPABASE_SECRET_KEY.
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';

export const config = { maxDuration: 30 };

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const BUCKET = 'frogity-sync';
const store = () => sb.storage.from(BUCKET);
const CODE_MS = 3 * 60_000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-frogity, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
class Http extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const secret = () => randomBytes(32).toString('hex');
const now = () => new Date().toISOString();

// ---------------------------------------------------------------- tiny JSON store on top of storage
async function read<T>(path: string): Promise<T | null> {
  // straight from storage, never from a cache (a stale record would point at a file version that is gone)
  const r = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${path}?fresh=${Date.now()}${Math.random()}`, {
    headers: { apikey: process.env.SUPABASE_SECRET_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`, 'Cache-Control': 'no-cache' },
    cache: 'no-store',
  }).catch(() => null);
  if (!r || !r.ok) return null;
  try {
    return (await r.json()) as T;
  } catch {
    return null;
  }
}
async function write(path: string, v: unknown) {
  const { error } = await store().upload(path, JSON.stringify(v), { upsert: true, contentType: 'application/json', cacheControl: '0' });
  if (error) throw new Error(error.message);
}
const remove = (paths: string[]) => (paths.length ? store().remove(paths) : Promise.resolve());
async function list(prefix: string) {
  const out: { name: string; updated_at?: string }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data } = await store().list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
    out.push(...((data ?? []) as { name: string; updated_at?: string }[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const enc = (id: string) => encodeURIComponent(id).replace(/%/g, '_');

interface Device {
  id: string;
  library: string;
  kind: 'phone' | 'web';
  label: string;
  token_hash: string;
  created_at: string;
  last_seen: string;
}
interface Pairing {
  id: string;
  library: string;
  code: string;
  status: 'open' | 'joined' | 'done' | 'expired';
  expires: number;
  web_pub?: string;
  web_label?: string;
  web_secret_hash?: string;
  phone_pub?: string;
  wrapped?: string | null;
  web_device?: string;
  web_token?: string | null;
}
interface Item {
  id: string;
  rev: number;
  deleted: boolean;
  meta: string;
  file_ver: string | null;
  file_parts: number;
  file_size: number;
  /** false: the file itself is not kept here (it is big); a computer asks the phone for it when it needs it */
  file_stored?: boolean;
  cover_ver: string | null;
  updated_at: string;
  updated_by: string | null;
}
const P = {
  device: (id: string) => `meta/devices/${id}.json`,
  lib: (lib: string) => `meta/libs/${lib}`,
  head: (lib: string) => `meta/libs/${lib}/head.json`,
  item: (lib: string, id: string) => `meta/libs/${lib}/items/${enc(id)}.json`,
  pairing: (id: string) => `meta/pairings/${id}.json`,
  code: (code: string) => `meta/codes/${code}.json`,
  files: (lib: string, id: string) => `files/${lib}/${enc(id)}`,
  // documents asked for by a computer, waiting for the phone to hand them over (and the handing-over place)
  reqs: (lib: string) => `meta/libs/${lib}/requests`,
  reqHead: (lib: string) => `meta/libs/${lib}/reqhead.json`,
  relay: (lib: string, req: string) => `relay/${lib}/${req}`,
};

async function auth(req: Request): Promise<Device> {
  const [id, token] = (req.headers.get('x-frogity') ?? '').split('.');
  if (!id || !token || !/^[\w-]{10,60}$/.test(id)) throw new Http(401, 'not connected');
  const d = await read<Device>(P.device(id));
  if (!d || d.token_hash !== sha(token)) throw new Http(401, 'not connected');
  if (Date.now() - Date.parse(d.last_seen) > 5 * 60_000) await write(P.device(id), { ...d, last_seen: now() }).catch(() => {});
  return d;
}

/** a rough per-minute limit (good enough to make guessing codes pointless) */
const hits = new Map<string, number>();
function limit(key: string, max: number) {
  const k = `${key}:${Math.floor(Date.now() / 60_000)}`;
  const n = (hits.get(k) ?? 0) + 1;
  hits.set(k, n);
  if (hits.size > 5000) hits.clear();
  if (n > max) throw new Http(429, 'Too many tries — wait a minute.');
}
/** revisions: milliseconds, never twice the same in one instance */
let lastRev = 0;
const nextRev = () => (lastRev = Math.max(Date.now(), lastRev + 1));

const str = (b: Record<string, unknown>, k: string, max = 200_000) => {
  const v = b[k];
  if (typeof v !== 'string' || v.length > max) throw new Http(400, `bad ${k}`);
  return v;
};
async function devicesOf(lib: string) {
  const ids = (await read<string[]>(`${P.lib(lib)}/devices.json`)) ?? [];
  return (await Promise.all(ids.map((id) => read<Device>(P.device(id))))).filter((d): d is Device => !!d);
}
async function addDevice(d: Device) {
  await write(P.device(d.id), d);
  const ids = (await read<string[]>(`${P.lib(d.library)}/devices.json`)) ?? [];
  await write(`${P.lib(d.library)}/devices.json`, [...new Set([...ids, d.id])]);
}
async function dropDevice(lib: string, id: string) {
  await remove([P.device(id)]);
  const ids = (await read<string[]>(`${P.lib(lib)}/devices.json`)) ?? [];
  await write(`${P.lib(lib)}/devices.json`, ids.filter((x) => x !== id));
}
async function touchHead(lib: string, rev: number) {
  await write(P.head(lib), { rev });
}
async function removeFolder(prefix: string, keep?: (name: string) => boolean) {
  const all = await list(prefix);
  await remove(all.filter((f) => !keep?.(f.name)).map((f) => `${prefix}/${f.name}`));
}
async function mapLimit<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (i < xs.length) {
      const k = i++;
      out[k] = await f(xs[k]);
    }
  }));
  return out;
}

type Body = Record<string, unknown>;
const ip = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '?';

const actions: Record<string, (req: Request, b: Body) => Promise<unknown>> = {
  async register(req, b) {
    limit(`reg:${ip(req)}`, 20);
    const library = randomUUID();
    const token = secret();
    const d: Device = { id: randomUUID(), library, kind: 'phone', label: String(b.label ?? 'Phone').slice(0, 60), token_hash: sha(token), created_at: now(), last_seen: now() };
    await addDevice(d);
    await touchHead(library, nextRev());
    return { library, device: d.id, token };
  },

  // ---------------------------------------------------------------- pairing a computer
  async pair_start(req) {
    const d = await auth(req);
    if (d.kind !== 'phone') throw new Http(403, 'only the phone makes codes');
    for (let i = 0; i < 25; i++) {
      const code = String(randomInt(0, 10000)).padStart(4, '0');
      const taken = await read<{ pairing: string; expires: number }>(P.code(code));
      if (taken && taken.expires > Date.now()) continue;
      const p: Pairing = { id: randomUUID(), library: d.library, code, status: 'open', expires: Date.now() + CODE_MS };
      await write(P.pairing(p.id), p);
      await write(P.code(code), { pairing: p.id, expires: p.expires });
      return { pairing: p.id, code, expires: new Date(p.expires).toISOString() };
    }
    throw new Http(503, 'No free code right now — try again.');
  },
  async pair_join(req, b) {
    limit(`join:${ip(req)}`, 10);
    limit('join:all', 600);
    const code = str(b, 'code', 4);
    if (!/^\d{4}$/.test(code)) throw new Http(400, 'four digits');
    const c = await read<{ pairing: string; expires: number }>(P.code(code));
    const p = c && c.expires > Date.now() ? await read<Pairing>(P.pairing(c.pairing)) : null;
    if (!p || p.status !== 'open' || p.expires < Date.now()) throw new Http(404, 'That code is not valid — check the phone, or make a new one');
    const s = secret();
    await write(P.pairing(p.id), { ...p, status: 'joined', web_pub: str(b, 'pub', 400), web_label: String(b.label ?? 'Computer').slice(0, 60), web_secret_hash: sha(s) });
    await remove([P.code(code)]); // used once
    return { pairing: p.id, secret: s };
  },
  async pair_status(req, b) {
    const d = await auth(req);
    const p = await read<Pairing>(P.pairing(str(b, 'pairing', 64)));
    if (!p || p.library !== d.library) throw new Http(404, 'gone');
    return { status: (p.status === 'open' || p.status === 'joined') && p.expires + 60_000 < Date.now() ? 'expired' : p.status, pub: p.web_pub, label: p.web_label };
  },
  async pair_finish(req, b) {
    const d = await auth(req);
    if (d.kind !== 'phone') throw new Http(403, 'only the phone finishes a pairing');
    const id = str(b, 'pairing', 64);
    const p = await read<Pairing>(P.pairing(id));
    if (!p || p.library !== d.library || p.status !== 'joined') throw new Http(409, 'nothing to finish');
    const token = secret();
    const web: Device = { id: randomUUID(), library: d.library, kind: 'web', label: p.web_label ?? 'Computer', token_hash: sha(token), created_at: now(), last_seen: now() };
    await addDevice(web);
    await write(P.pairing(id), { ...p, status: 'done', phone_pub: str(b, 'pub', 400), wrapped: str(b, 'wrapped', 400), web_device: web.id, web_token: token });
    return { device: web.id };
  },
  async pair_wait(req, b) {
    const id = str(b, 'pairing', 64);
    const p = await read<Pairing>(P.pairing(id));
    if (!p || p.web_secret_hash !== sha(str(b, 'secret', 100))) throw new Http(404, 'gone');
    if (p.status !== 'done' || !p.web_token) return { status: p.status === 'joined' && p.expires + 60_000 < Date.now() ? 'expired' : p.status };
    // handed over once, then forgotten
    await remove([P.pairing(id)]);
    return { status: 'done', library: p.library, device: p.web_device, token: p.web_token, wrapped: p.wrapped, pub: p.phone_pub };
  },

  // ---------------------------------------------------------------- the library
  async changes(req, b) {
    const d = await auth(req);
    const since = Number(b.since ?? 0) || 0;
    const head = await read<{ rev: number }>(P.head(d.library));
    if (since && head && head.rev <= since) return { items: [], more: false, me: d.id, head: head.rev };
    // what changed since then (a few seconds of overlap: two writes at the same moment are never missed; applying
    // the same change twice does nothing)
    const files = await list(`${P.lib(d.library)}/items`);
    const fresh = files.filter((f) => !since || !f.updated_at || Date.parse(f.updated_at) > since - 8000);
    const items = (await mapLimit(fresh, 16, (f) => read<Item>(`${P.lib(d.library)}/items/${f.name}`))).filter((x): x is Item => !!x && x.rev > since - 8000);
    items.sort((a, c) => a.rev - c.rev);
    return { items, more: false, me: d.id, head: head?.rev ?? 0 };
  },
  /** waits (up to ~20 s) until something in the library changes after `since`: news within about a second */
  async wait(req, b) {
    const d = await auth(req);
    const since = Number(b.since ?? 0) || 0;
    // the phone also waits for computers asking for a document
    const reqSince = d.kind === 'phone' ? Number(b.reqSince ?? 0) || 0 : -1;
    const until = Date.now() + 20_000;
    while (Date.now() < until) {
      const [head, rh] = await Promise.all([read<{ rev: number }>(P.head(d.library)), reqSince >= 0 ? read<{ rev: number }>(P.reqHead(d.library)) : null]);
      if (rh && rh.rev > reqSince) return { changed: !!head && head.rev > since, rev: head?.rev, requests: true, reqRev: rh.rev };
      if (head && head.rev > since) return { changed: true, rev: head.rev };
      await new Promise((r) => setTimeout(r, 600));
    }
    return { changed: false };
  },

  // ---------------------------------------------------------------- big files: straight from the phone, on demand
  /** A computer wants a document whose file is not kept here: the phone is asked to hand it over. */
  async fetch_request(req, b) {
    const d = await auth(req);
    const id = str(b, 'id', 120);
    const item = await read<Item>(P.item(d.library, id));
    if (!item || item.deleted) throw new Http(404, 'This document is gone.');
    // old requests nobody finished go (after half an hour)
    for (const f of await list(P.reqs(d.library))) {
      const r = await read<{ at: number; id: string }>(`${P.reqs(d.library)}/${f.name}`);
      if (!r || Date.now() - r.at > 30 * 60_000) {
        await remove([`${P.reqs(d.library)}/${f.name}`]);
        await removeFolder(P.relay(d.library, f.name.replace(/\.json$/, '')));
      }
    }
    const rid = randomUUID();
    await write(`${P.reqs(d.library)}/${rid}.json`, { id, ver: item.file_ver, at: Date.now(), by: d.id, status: 'waiting' });
    await write(P.reqHead(d.library), { rev: nextRev() });
    return { req: rid };
  },
  /** The phone: what computers are waiting for. */
  async requests(req) {
    const d = await auth(req);
    const out: { req: string; id: string; ver: string | null }[] = [];
    for (const f of await list(P.reqs(d.library))) {
      const r = await read<{ id: string; ver: string | null; at: number; status: string }>(`${P.reqs(d.library)}/${f.name}`);
      if (r && r.status === 'waiting' && Date.now() - r.at < 30 * 60_000) out.push({ req: f.name.replace(/\.json$/, ''), id: r.id, ver: r.ver });
    }
    return { requests: out };
  },
  /** The phone: where to put the (sealed) parts of the file for one request. */
  async relay_upload_urls(req, b) {
    const d = await auth(req);
    const rid = str(b, 'req', 64);
    const parts = Math.max(1, Math.min(5000, Number(b.parts) || 1));
    const urls: string[] = new Array(parts);
    await mapLimit(Array.from({ length: parts }, (_, i) => i), 8, async (i) => {
      const { data, error } = await store().createSignedUploadUrl(`${P.relay(d.library, rid)}/${i}`, { upsert: true });
      if (error) throw new Error(error.message);
      urls[i] = data.signedUrl;
    });
    return { urls };
  },
  /** The phone: one more piece is there (so the computer can start fetching before the whole file is sent). */
  async relay_part(req, b) {
    const d = await auth(req);
    const rid = str(b, 'req', 64);
    const path = `${P.reqs(d.library)}/${rid}.json`;
    const r = await read<Record<string, unknown>>(path);
    if (!r) throw new Http(404, 'gone');
    if (r.status === 'ready') return { ok: true };
    await write(path, { ...r, status: 'sending', parts: Math.max(1, Number(b.parts) || 1), got: Math.max(Number(r.got) || 0, Number(b.got) || 0) });
    return { ok: true };
  },
  async relay_ready(req, b) {
    const d = await auth(req);
    const rid = str(b, 'req', 64);
    const path = `${P.reqs(d.library)}/${rid}.json`;
    const r = await read<Record<string, unknown>>(path);
    if (!r) throw new Http(404, 'gone');
    await write(path, { ...r, status: 'ready', parts: Math.max(1, Number(b.parts) || 1), size: Number(b.size) || 0, ver: typeof b.ver === 'string' ? b.ver : r.ver });
    return { ok: true };
  },
  /** The computer: is it there yet? When it is, links to fetch it. */
  async relay_status(req, b) {
    const d = await auth(req);
    const rid = str(b, 'req', 64);
    const r = await read<{ status: string; parts?: number; got?: number; size?: number; ver?: string }>(`${P.reqs(d.library)}/${rid}.json`);
    if (!r) return { status: 'gone' };
    const from = Math.max(0, Number(b.from) || 0);
    const got = r.status === 'ready' ? (r.parts ?? 1) : r.status === 'sending' ? (r.got ?? 0) : 0;
    if (got <= from) return { status: r.status, parts: r.parts, got };
    // links for the pieces that are there and not fetched yet
    const names = Array.from({ length: got - from }, (_, k) => `${P.relay(d.library, rid)}/${from + k}`);
    const { data, error } = await store().createSignedUrls(names, 900);
    if (error) throw new Error(error.message);
    return { status: r.status, parts: r.parts, got, from, urls: (data ?? []).map((x) => x.signedUrl), size: r.size, ver: r.ver };
  },
  /** The computer has it: the handing-over place is cleared at once. */
  async relay_done(req, b) {
    const d = await auth(req);
    const rid = str(b, 'req', 64);
    await removeFolder(P.relay(d.library, rid));
    await remove([`${P.reqs(d.library)}/${rid}.json`]);
    return { ok: true };
  },
  /** The phone has a big new version (made on a computer): the copy kept here goes; computers ask the phone from now on. */
  async release_file(req, b) {
    const d = await auth(req);
    const id = str(b, 'id', 120);
    const path = P.item(d.library, id);
    const item = await read<Item>(path);
    if (!item || item.file_ver !== b.ver) return { ok: false };
    await write(path, { ...item, file_stored: false });
    await removeFolder(P.files(d.library, id), (n) => n.startsWith('cover.'));
    return { ok: true };
  },
  async put(req, b) {
    const d = await auth(req);
    const id = str(b, 'id', 120);
    const path = P.item(d.library, id);
    const cur = await read<Item>(path);
    const row: Item = {
      id,
      rev: nextRev(),
      deleted: !!b.deleted,
      meta: str(b, 'meta', 4_000_000),
      file_ver: cur?.file_ver ?? null,
      file_parts: cur?.file_parts ?? 0,
      file_size: cur?.file_size ?? 0,
      file_stored: cur?.file_stored,
      cover_ver: cur?.cover_ver ?? null,
      updated_at: now(),
      updated_by: d.id,
    };
    if (b.file && typeof b.file === 'object') {
      const f = b.file as { ver: string; parts: number; size: number; stored?: boolean };
      row.file_ver = String(f.ver).slice(0, 40);
      row.file_parts = Math.max(0, Math.min(5000, Number(f.parts) || 0));
      row.file_size = Number(f.size) || 0;
      row.file_stored = f.stored !== false;
    }
    if (typeof b.cover === 'string') row.cover_ver = b.cover.slice(0, 40);
    if (row.deleted) Object.assign(row, { file_ver: null, file_parts: 0, file_size: 0, file_stored: false, cover_ver: null });
    await write(path, row);
    await touchHead(d.library, row.rev);
    // old versions of the file and cover go (all of them for a deleted document)
    const folder = P.files(d.library, id);
    if (row.deleted) await removeFolder(folder);
    else if (b.file || b.cover) await removeFolder(folder, (n) => (!!row.file_ver && n.startsWith(`${row.file_ver}.`)) || (!!row.cover_ver && n === `cover.${row.cover_ver}`));
    return { rev: row.rev };
  },
  async upload_urls(req, b) {
    const d = await auth(req);
    const id = str(b, 'id', 120);
    const ver = typeof b.ver === 'string' ? b.ver.slice(0, 40) : '';
    const parts = Math.max(0, Math.min(5000, Number(b.parts) || 0));
    const names = Array.from({ length: parts }, (_, i) => `${ver}.${i}`);
    if (typeof b.cover === 'string') names.push(`cover.${b.cover.slice(0, 40)}`);
    const urls: Record<string, string> = {};
    await mapLimit(names, 8, async (n) => {
      const { data, error } = await store().createSignedUploadUrl(`${P.files(d.library, id)}/${n}`, { upsert: true });
      if (error) throw new Error(error.message);
      urls[n] = data.signedUrl;
    });
    return { urls };
  },
  async download_urls(req, b) {
    const d = await auth(req);
    const id = str(b, 'id', 120);
    const names = (Array.isArray(b.names) ? b.names : []).slice(0, 5000).map((n) => String(n).slice(0, 60));
    if (!names.length) return { urls: {} };
    const { data, error } = await store().createSignedUrls(names.map((n) => `${P.files(d.library, id)}/${n}`), 3600);
    if (error) throw new Error(error.message);
    return { urls: Object.fromEntries(names.map((n, i) => [n, data?.[i]?.signedUrl ?? ''])) };
  },

  // ---------------------------------------------------------------- devices
  async devices(req) {
    const d = await auth(req);
    const all = await devicesOf(d.library);
    return { devices: all.map(({ id, kind, label, created_at, last_seen }) => ({ id, kind, label, created_at, last_seen })), me: d.id };
  },
  async revoke(req, b) {
    const d = await auth(req);
    const target = str(b, 'device', 64);
    if (d.kind !== 'phone' && target !== d.id) throw new Http(403, 'only the phone disconnects other devices');
    const t = await read<Device>(P.device(target));
    if (t && t.library === d.library && t.kind !== 'phone') await dropDevice(d.library, target);
    await touchHead(d.library, nextRev());
    return { ok: true };
  },
  async forget(req) {
    const d = await auth(req);
    if (d.kind !== 'phone') throw new Http(403, 'only the phone can do this');
    const items = await list(`${P.lib(d.library)}/items`);
    for (const it of items) {
      const row = await read<Item>(`${P.lib(d.library)}/items/${it.name}`);
      if (row) await removeFolder(P.files(d.library, row.id));
    }
    for (const dev of await devicesOf(d.library)) await remove([P.device(dev.id)]);
    await removeFolder(`${P.lib(d.library)}/items`);
    await remove([P.head(d.library), `${P.lib(d.library)}/devices.json`]);
    return { ok: true };
  },
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: cors });
}

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as Body;
    const fn = actions[String(b.a)];
    if (!fn) throw new Http(400, 'unknown action');
    return json(await fn(req, b));
  } catch (e) {
    const status = e instanceof Http ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ error: e instanceof Error ? e.message : 'failed' }, status);
  }
}
