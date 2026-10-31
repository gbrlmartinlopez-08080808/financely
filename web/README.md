# Frogity for the computer

The desktop web app that shows (and edits) the documents of the Frogity phone app. See `PLAN.md` for the design.

- Live: https://frogity-web.vercel.app (Vercel project `frogity-web`, root directory `web/`)
- Dev: `npm install && npm run dev` (port 5180). Against the local test server: `node supabase/mock/server.mjs` and open
  `http://127.0.0.1:5180/?sync=http://127.0.0.1:8787` (the phone app built with
  `VITE_SYNC_URL=http://127.0.0.1:8787 VITE_SYNC_KEY=local`).

## The sync server (Supabase)

1. **Tables and bucket** — run `supabase/migrations/001_frogity_sync.sql` (SQL editor in the dashboard, or the CLI).
2. **Edge function** — deploy `supabase/functions/frogity-sync/index.ts` as `frogity-sync` with **JWT verification
   off** (it checks its own device tokens): `supabase functions deploy frogity-sync --no-verify-jwt`.
3. **Keys** — the project URL and its anon/publishable key go into:
   - Vercel (`frogity-web` → Environment Variables): `VITE_SYNC_URL`, `VITE_SYNC_KEY`, then redeploy;
   - the phone build (`.env.production` at the repo root): `VITE_SYNC_URL`, `VITE_SYNC_KEY`, `VITE_WEB_URL`.

The key is public by design: it only lets requests reach the edge function. Tables have row-level security on with no
policies, the bucket is private, and every document is encrypted on the device before it is sent.
