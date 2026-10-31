// Frogity sync: the one door to the sync tables. It never sees a document: every file, cover and note arrives
// already encrypted by the devices. It routes, checks device tokens, hands out short-lived storage links, pairs a
// computer with a four-digit code, and pings the other devices when something changed.
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sb = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const BUCKET = 'frogity-sync';
const CODE_MINUTES = 3;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-frogity, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
class Http extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const secret = () => hex(crypto.getRandomValues(new Uint8Array(32)).buffer);

interface Device {
  id: string;
  library_id: string;
  kind: 'phone' | 'web';
  label: string;
}

async function auth(req: Request): Promise<Device> {
  const h = req.headers.get('x-frogity') ?? '';
  const [id, token] = h.split('.');
  if (!id || !token) throw new Http(401, 'not connected');
  const { data } = await sb.from('frogity_devices').select('id, library_id, kind, label, token_hash').eq('id', id).maybeSingle();
  if (!data || data.token_hash !== (await sha(token))) throw new Http(401, 'not connected');
  // at most once a minute: when this device was last seen
  void sb.from('frogity_devices').update({ last_seen: new Date().toISOString() }).eq('id', id).lt('last_seen', new Date(Date.now() - 60_000).toISOString());
  return data as Device;
}

async function limit(key: string, max: number) {
  const { data } = await sb.rpc('frogity_hit', { k: key });
  if ((data as number) > max) throw new Http(429, 'too many tries, wait a minute');
}

/** a "something changed" ping to the library's other devices (no content, just the new revision) */
async function ping(library: string, rev: number, by: string) {
  await fetch(`${URL_}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ topic: `frogity-${library}`, event: 'changed', payload: { rev, by } }] }),
  }).catch(() => {});
}

const path = (lib: string, id: string, name: string) => `${lib}/${encodeURIComponent(id)}/${name}`;

async function removeFolder(prefix: string, keep?: (name: string) => boolean) {
  const { data } = await sb.storage.from(BUCKET).list(prefix, { limit: 1000 });
  const gone = (data ?? []).filter((f) => !keep?.(f.name)).map((f) => `${prefix}/${f.name}`);
  if (gone.length) await sb.storage.from(BUCKET).remove(gone);
}

type Body = Record<string, unknown>;
const str = (b: Body, k: string, max = 200_000) => {
  const v = b[k];
  if (typeof v !== 'string' || v.length > max) throw new Http(400, `bad ${k}`);
  return v;
};

const actions: Record<string, (req: Request, b: Body) => Promise<unknown>> = {
  // ---------------------------------------------------------------- a phone starts a library
  async register(req, b) {
    await limit(`reg:${req.headers.get('x-forwarded-for') ?? '?'}`, 20);
    const { data: lib, error } = await sb.from('frogity_libraries').insert({}).select('id').single();
    if (error) throw error;
    const token = secret();
    const { data: dev, error: e2 } = await sb.from('frogity_devices').insert({ library_id: lib.id, kind: 'phone', label: String(b.label ?? 'Phone').slice(0, 60), token_hash: await sha(token) }).select('id').single();
    if (e2) throw e2;
    return { library: lib.id, device: dev.id, token };
  },

  // ---------------------------------------------------------------- pairing a computer
  async pair_start(req) {
    const d = await auth(req);
    if (d.kind !== 'phone') throw new Http(403, 'only the phone makes codes');
    await sb.from('frogity_pairings').update({ status: 'expired' }).eq('library_id', d.library_id).in('status', ['open', 'joined']);
    // a code nobody else is using right now
    for (let i = 0; i < 20; i++) {
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0');
      const { data: busy } = await sb.from('frogity_pairings').select('id').eq('code', code).in('status', ['open', 'joined']).gt('expires_at', new Date().toISOString()).limit(1);
      if (busy?.length) continue;
      const expires = new Date(Date.now() + CODE_MINUTES * 60_000).toISOString();
      const { data, error } = await sb.from('frogity_pairings').insert({ library_id: d.library_id, code, expires_at: expires }).select('id').single();
      if (error) throw error;
      return { pairing: data.id, code, expires };
    }
    throw new Http(503, 'no free code, try again');
  },
  async pair_join(req, b) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '?';
    await limit(`join:${ip}`, 10);
    await limit('join:all', 600);
    const code = str(b, 'code', 4);
    if (!/^\d{4}$/.test(code)) throw new Http(400, 'four digits');
    const { data: p } = await sb.from('frogity_pairings').select('id').eq('code', code).eq('status', 'open').gt('expires_at', new Date().toISOString()).maybeSingle();
    if (!p) throw new Http(404, 'That code is not valid — check the phone, or make a new one');
    const s = secret();
    const { data: upd } = await sb
      .from('frogity_pairings')
      .update({ status: 'joined', web_pub: str(b, 'pub', 400), web_label: String(b.label ?? 'Computer').slice(0, 60), web_secret_hash: await sha(s) })
      .eq('id', p.id)
      .eq('status', 'open')
      .select('id');
    if (!upd?.length) throw new Http(409, 'That code was just used');
    return { pairing: p.id, secret: s };
  },
  async pair_status(req, b) {
    const d = await auth(req);
    const { data: p } = await sb.from('frogity_pairings').select('status, web_pub, web_label, expires_at').eq('id', str(b, 'pairing', 64)).eq('library_id', d.library_id).maybeSingle();
    if (!p) throw new Http(404, 'gone');
    return { status: p.status === 'open' && p.expires_at < new Date().toISOString() ? 'expired' : p.status, pub: p.web_pub, label: p.web_label };
  },
  async pair_finish(req, b) {
    const d = await auth(req);
    if (d.kind !== 'phone') throw new Http(403, 'only the phone finishes a pairing');
    const id = str(b, 'pairing', 64);
    const { data: p } = await sb.from('frogity_pairings').select('status, web_label').eq('id', id).eq('library_id', d.library_id).maybeSingle();
    if (!p || p.status !== 'joined') throw new Http(409, 'nothing to finish');
    const token = secret();
    const { data: dev, error } = await sb.from('frogity_devices').insert({ library_id: d.library_id, kind: 'web', label: p.web_label ?? 'Computer', token_hash: await sha(token) }).select('id').single();
    if (error) throw error;
    await sb.from('frogity_pairings').update({ status: 'done', phone_pub: str(b, 'pub', 400), wrapped: str(b, 'wrapped', 400), web_device_id: dev.id, web_token: token }).eq('id', id);
    return { device: dev.id };
  },
  async pair_wait(req, b) {
    const id = str(b, 'pairing', 64);
    const { data: p } = await sb.from('frogity_pairings').select('*').eq('id', id).maybeSingle();
    if (!p || p.web_secret_hash !== (await sha(str(b, 'secret', 100)))) throw new Http(404, 'gone');
    if (p.status !== 'done' || !p.web_token) return { status: p.status === 'joined' && p.expires_at < new Date().toISOString() ? 'expired' : p.status };
    // handed over once, then forgotten here
    await sb.from('frogity_pairings').update({ web_token: null, wrapped: null }).eq('id', id);
    return { status: 'done', library: p.library_id, device: p.web_device_id, token: p.web_token, wrapped: p.wrapped, pub: p.phone_pub };
  },

  // ---------------------------------------------------------------- the library itself
  async changes(req, b) {
    const d = await auth(req);
    const since = Number(b.since ?? 0) || 0;
    const { data, error } = await sb
      .from('frogity_items')
      .select('id, rev, deleted, meta, file_ver, file_parts, file_size, cover_ver, updated_at, updated_by')
      .eq('library_id', d.library_id)
      .gt('rev', since)
      .order('rev', { ascending: true })
      .limit(300);
    if (error) throw error;
    return { items: data, more: (data?.length ?? 0) === 300, me: d.id };
  },
  async put(req, b) {
    const d = await auth(req);
    const id = str(b, 'id', 120);
    const row: Record<string, unknown> = { library_id: d.library_id, id, meta: str(b, 'meta', 4_000_000), deleted: !!b.deleted, updated_by: d.id };
    if (b.file && typeof b.file === 'object') {
      const f = b.file as { ver: string; parts: number; size: number };
      row.file_ver = String(f.ver).slice(0, 40);
      row.file_parts = Math.max(0, Math.min(5000, Number(f.parts) || 0));
      row.file_size = Number(f.size) || 0;
    }
    if (typeof b.cover === 'string') row.cover_ver = b.cover.slice(0, 40);
    if (b.deleted) Object.assign(row, { file_ver: null, file_parts: 0, file_size: 0, cover_ver: null, meta: str(b, 'meta', 4_000_000) });
    const { data, error } = await sb.from('frogity_items').upsert(row, { onConflict: 'library_id,id' }).select('rev').single();
    if (error) throw error;
    // old file versions and covers go (or everything, for a deleted document)
    const folder = `${d.library_id}/${encodeURIComponent(id)}`;
    if (b.deleted) await removeFolder(folder);
    else if (row.file_ver || row.cover_ver) {
      const { data: cur } = await sb.from('frogity_items').select('file_ver, cover_ver').eq('library_id', d.library_id).eq('id', id).single();
      await removeFolder(folder, (n) => (!!cur?.file_ver && n.startsWith(`${cur.file_ver}.`)) || (!!cur?.cover_ver && n === `cover.${cur.cover_ver}`));
    }
    await ping(d.library_id, data.rev, d.id);
    return { rev: data.rev };
  },
  async upload_urls(req, b) {
    const d = await auth(req);
    const id = str(b, 'id', 120);
    const names: string[] = [];
    const ver = typeof b.ver === 'string' ? b.ver.slice(0, 40) : '';
    const parts = Math.max(0, Math.min(5000, Number(b.parts) || 0));
    for (let i = 0; i < parts; i++) names.push(`${ver}.${i}`);
    if (typeof b.cover === 'string') names.push(`cover.${b.cover.slice(0, 40)}`);
    const out: Record<string, string> = {};
    for (const n of names) {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path(d.library_id, id, n), { upsert: true });
      if (error) throw error;
      out[n] = data.signedUrl;
    }
    return { urls: out };
  },
  async download_urls(req, b) {
    const d = await auth(req);
    const id = str(b, 'id', 120);
    const names = (Array.isArray(b.names) ? b.names : []).slice(0, 5000).map((n) => String(n).slice(0, 60));
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(names.map((n) => path(d.library_id, id, n)), 3600);
    if (error) throw error;
    return { urls: Object.fromEntries(names.map((n, i) => [n, data?.[i]?.signedUrl ?? ''])) };
  },

  // ---------------------------------------------------------------- devices
  async devices(req) {
    const d = await auth(req);
    const { data } = await sb.from('frogity_devices').select('id, kind, label, created_at, last_seen').eq('library_id', d.library_id).order('created_at');
    return { devices: data, me: d.id };
  },
  async revoke(req, b) {
    const d = await auth(req);
    const target = str(b, 'device', 64);
    if (d.kind !== 'phone' && target !== d.id) throw new Http(403, 'only the phone disconnects other devices');
    await sb.from('frogity_devices').delete().eq('id', target).eq('library_id', d.library_id).neq('kind', 'phone');
    await ping(d.library_id, 0, d.id);
    return { ok: true };
  },
  /** the phone stops syncing for good: everything stored here for this library is deleted */
  async forget(req) {
    const d = await auth(req);
    if (d.kind !== 'phone') throw new Http(403, 'only the phone can do this');
    const { data: items } = await sb.from('frogity_items').select('id').eq('library_id', d.library_id);
    for (const it of items ?? []) await removeFolder(`${d.library_id}/${encodeURIComponent(it.id)}`);
    await sb.from('frogity_libraries').delete().eq('id', d.library_id);
    await ping(d.library_id, 0, d.id);
    return { ok: true };
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
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
});
