# Frogity for the computer

The desktop web app that shows (and edits) the documents of the Frogity phone app. See `PLAN.md` for the design.

- Live: https://frogity-web.vercel.app (Vercel project `frogity-web`, root directory `web/`)
- Dev: `npm install && npm run dev` (port 5180). Against the local test server: `node supabase/mock/server.mjs` and open
  `http://127.0.0.1:5180/?sync=http://127.0.0.1:8787` (the phone app built with
  `VITE_SYNC_URL=http://127.0.0.1:8787 VITE_SYNC_KEY=local`).

## The sync server

Live setup: the server is the Vercel function `api/frogity-sync.ts` (reached at `/functions/v1/frogity-sync` through
`vercel.json`). It keeps everything in one private Supabase Storage bucket, `frogity-sync`, so the Supabase project needs
no tables. Vercel environment (server side only): `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (marked sensitive).

- The phone app is built with `VITE_SYNC_URL=https://frogity-web.vercel.app` (`.env.production` at the repo root).
- Without a Realtime key, each device keeps one request waiting at the server (`wait`), which answers the moment
  something changes — news within about a second. With a publishable key, set `VITE_SYNC_RT_URL` (the Supabase URL)
  and `VITE_SYNC_RT_KEY` (`sb_publishable_…`) for both builds to use Realtime pings instead.
- Everything is encrypted on the devices before it is sent; the server and Supabase only ever see ciphertext.

### Alternative: Supabase only

`supabase/migrations/001_frogity_sync.sql` (tables) and `supabase/functions/frogity-sync` (edge function, deploy with
`--no-verify-jwt`) do the same with Postgres tables, if the project is ever set up that way.
