// A local stand-in for the Supabase side (edge function + storage + realtime pings), for tests and offline work.
// Same actions and rules as supabase/functions/frogity-sync. Run: node supabase/mock/server.mjs [port]
import http from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

const PORT = Number(process.argv[2] || 8787);
const BASE = `http://127.0.0.1:${PORT}`;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const secret = () => randomBytes(32).toString('hex');
const libs = new Set();
const devices = new Map(); // id -> {id, library_id, kind, label, token_hash, created_at, last_seen}
const items = new Map(); // `${lib}|${id}` -> row
const pairings = new Map();
const files = new Map(); // path -> Buffer
const hits = new Map();
let rev = 0;
const topics = new Map(); // topic -> Set<ws>

class Http extends Error { constructor(s, m) { super(m); this.status = s; } }
const auth = (req) => {
  const [id, token] = String(req.headers['x-frogity'] || '').split('.');
  const d = devices.get(id);
  if (!d || d.token_hash !== sha(token || '')) throw new Http(401, 'not connected');
  d.last_seen = new Date().toISOString();
  return d;
};
const limit = (k, max) => { const key = k + Math.floor(Date.now() / 60000); const n = (hits.get(key) || 0) + 1; hits.set(key, n); if (n > max) throw new Http(429, 'too many tries, wait a minute'); };
const ping = (lib, r, by) => {
  const msg = JSON.stringify({ topic: `realtime:frogity-${lib}`, event: 'broadcast', payload: { type: 'broadcast', event: 'changed', payload: { rev: r, by } }, ref: null });
  for (const ws of topics.get(`realtime:frogity-${lib}`) || []) ws.send(msg);
};
const p = (lib, id, n) => `${lib}/${encodeURIComponent(id)}/${n}`;
const rmFolder = (prefix, keep) => { for (const k of [...files.keys()]) if (k.startsWith(prefix + '/') && !(keep && keep(k.slice(prefix.length + 1)))) files.delete(k); };
const now = () => new Date().toISOString();

const A = {
  register(req, b) { const lib = randomUUID(); libs.add(lib); const token = secret(); const id = randomUUID(); devices.set(id, { id, library_id: lib, kind: 'phone', label: String(b.label || 'Phone').slice(0, 60), token_hash: sha(token), created_at: now(), last_seen: now() }); return { library: lib, device: id, token }; },
  pair_start(req) {
    const d = auth(req); if (d.kind !== 'phone') throw new Http(403, 'only the phone makes codes');
    for (const x of pairings.values()) if (x.library_id === d.library_id && ['open', 'joined'].includes(x.status)) x.status = 'expired';
    for (let i = 0; i < 20; i++) {
      const code = String(randomBytes(4).readUInt32BE() % 10000).padStart(4, '0');
      if ([...pairings.values()].some((x) => x.code === code && ['open', 'joined'].includes(x.status) && x.expires_at > now())) continue;
      const id = randomUUID(); const expires = new Date(Date.now() + 180000).toISOString();
      pairings.set(id, { id, library_id: d.library_id, code, status: 'open', expires_at: expires }); return { pairing: id, code, expires };
    }
    throw new Http(503, 'no free code');
  },
  pair_join(req, b) {
    limit('join:' + req.socket.remoteAddress, 10);
    if (!/^\d{4}$/.test(String(b.code))) throw new Http(400, 'four digits');
    const x = [...pairings.values()].find((x) => x.code === b.code && x.status === 'open' && x.expires_at > now());
    if (!x) throw new Http(404, 'That code is not valid — check the phone, or make a new one');
    const s = secret(); Object.assign(x, { status: 'joined', web_pub: b.pub, web_label: String(b.label || 'Computer').slice(0, 60), web_secret_hash: sha(s) });
    return { pairing: x.id, secret: s };
  },
  pair_status(req, b) { const d = auth(req); const x = pairings.get(b.pairing); if (!x || x.library_id !== d.library_id) throw new Http(404, 'gone'); return { status: x.status === 'open' && x.expires_at < now() ? 'expired' : x.status, pub: x.web_pub, label: x.web_label }; },
  pair_finish(req, b) {
    const d = auth(req); if (d.kind !== 'phone') throw new Http(403, 'phone only');
    const x = pairings.get(b.pairing); if (!x || x.library_id !== d.library_id || x.status !== 'joined') throw new Http(409, 'nothing to finish');
    const token = secret(); const id = randomUUID();
    devices.set(id, { id, library_id: d.library_id, kind: 'web', label: x.web_label, token_hash: sha(token), created_at: now(), last_seen: now() });
    Object.assign(x, { status: 'done', phone_pub: b.pub, wrapped: b.wrapped, web_device_id: id, web_token: token }); return { device: id };
  },
  pair_wait(req, b) {
    const x = pairings.get(b.pairing); if (!x || x.web_secret_hash !== sha(String(b.secret))) throw new Http(404, 'gone');
    if (x.status !== 'done' || !x.web_token) return { status: x.status === 'joined' && x.expires_at < now() ? 'expired' : x.status };
    const out = { status: 'done', library: x.library_id, device: x.web_device_id, token: x.web_token, wrapped: x.wrapped, pub: x.phone_pub };
    x.web_token = null; x.wrapped = null; return out;
  },
  changes(req, b) {
    const d = auth(req); const since = Number(b.since) || 0;
    const rows = [...items.values()].filter((r) => r.library_id === d.library_id && r.rev > since).sort((a, c) => a.rev - c.rev).slice(0, 300);
    return { items: rows.map(({ library_id, ...r }) => r), more: rows.length === 300, me: d.id };
  },
  put(req, b) {
    const d = auth(req); const k = `${d.library_id}|${b.id}`; const cur = items.get(k) || { file_ver: null, file_parts: 0, file_size: 0, cover_ver: null };
    const row = { ...cur, library_id: d.library_id, id: b.id, meta: b.meta, deleted: !!b.deleted, updated_by: d.id, rev: ++rev, updated_at: now() };
    if (b.file) Object.assign(row, { file_ver: b.file.ver, file_parts: b.file.parts, file_size: b.file.size });
    if (typeof b.cover === 'string') row.cover_ver = b.cover;
    if (b.deleted) Object.assign(row, { file_ver: null, file_parts: 0, file_size: 0, cover_ver: null });
    items.set(k, row);
    const folder = `${d.library_id}/${encodeURIComponent(b.id)}`;
    if (b.deleted) rmFolder(folder); else if (b.file || b.cover) rmFolder(folder, (n) => (row.file_ver && n.startsWith(row.file_ver + '.')) || (row.cover_ver && n === 'cover.' + row.cover_ver));
    ping(d.library_id, row.rev, d.id); return { rev: row.rev };
  },
  upload_urls(req, b) {
    const d = auth(req); const out = {};
    for (let i = 0; i < (Number(b.parts) || 0); i++) out[`${b.ver}.${i}`] = `${BASE}/storage/${p(d.library_id, b.id, `${b.ver}.${i}`)}`;
    if (typeof b.cover === 'string') out[`cover.${b.cover}`] = `${BASE}/storage/${p(d.library_id, b.id, `cover.${b.cover}`)}`;
    return { urls: out };
  },
  download_urls(req, b) { const d = auth(req); return { urls: Object.fromEntries((b.names || []).map((n) => [n, `${BASE}/storage/${p(d.library_id, b.id, n)}`])) }; },
  devices(req) { const d = auth(req); return { devices: [...devices.values()].filter((x) => x.library_id === d.library_id).map(({ token_hash, library_id, ...x }) => x), me: d.id }; },
  revoke(req, b) { const d = auth(req); if (d.kind !== 'phone' && b.device !== d.id) throw new Http(403, 'phone only'); const t = devices.get(b.device); if (t && t.library_id === d.library_id && t.kind !== 'phone') devices.delete(b.device); ping(d.library_id, 0, d.id); return { ok: true }; },
  forget(req) { const d = auth(req); if (d.kind !== 'phone') throw new Http(403, 'phone only'); for (const [k, r] of items) if (r.library_id === d.library_id) items.delete(k); rmFolder(d.library_id); for (const [k, x] of devices) if (x.library_id === d.library_id) devices.delete(k); ping(d.library_id, 0, d.id); return { ok: true }; },
};

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS' };
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks);
  const url = new URL(req.url, BASE);
  try {
    if (url.pathname === '/functions/v1/frogity-sync' && req.method === 'POST') {
      const b = JSON.parse(body.toString() || '{}'); const fn = A[b.a]; if (!fn) throw new Http(400, 'unknown action');
      const out = await fn(req, b); res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end(JSON.stringify(out));
    }
    if (url.pathname.startsWith('/storage/')) {
      const key = decodeURIComponent(url.pathname.slice(9)).replace(/^([^/]+)\/([^/]+)\//, (m, a, b) => `${a}/${encodeURIComponent(decodeURIComponent(b))}/`);
      const k2 = url.pathname.slice(9);
      if (req.method === 'PUT') { files.set(k2, body); res.writeHead(200, cors); return res.end('{}'); }
      const f = files.get(k2) || files.get(key); if (!f) throw new Http(404, 'no file');
      res.writeHead(200, { ...cors, 'Content-Type': 'application/octet-stream' }); return res.end(f);
    }
    throw new Http(404, 'not found');
  } catch (e) {
    const s = e.status || 500; if (s === 500) console.error(e);
    res.writeHead(s, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message }));
  }
});
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, sock, head) => {
  if (!req.url.startsWith('/realtime/v1/websocket')) return sock.destroy();
  wss.handleUpgrade(req, sock, head, (ws) => {
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.event === 'phx_join') { if (!topics.has(m.topic)) topics.set(m.topic, new Set()); topics.get(m.topic).add(ws); ws.send(JSON.stringify({ topic: m.topic, event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: m.ref })); }
      else if (m.event === 'heartbeat') ws.send(JSON.stringify({ topic: 'phoenix', event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: m.ref }));
    });
    ws.on('close', () => { for (const s of topics.values()) s.delete(ws); });
  });
});
server.listen(PORT, '127.0.0.1', () => console.log('frogity mock sync on', BASE));
