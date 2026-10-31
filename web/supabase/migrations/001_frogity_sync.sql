-- Frogity phone ↔ computer sync. Everything is end-to-end encrypted on the devices: these tables only hold
-- ciphertext and routing data. No client reads them directly (RLS on, no policies): all access goes through the
-- edge function `frogity-sync`, which checks the device token.
create sequence if not exists public.frogity_rev_seq;

create table if not exists public.frogity_libraries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists public.frogity_devices (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.frogity_libraries(id) on delete cascade,
  token_hash text not null,
  kind text not null check (kind in ('phone','web')),
  label text not null default '',
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index if not exists frogity_devices_library on public.frogity_devices(library_id);

create table if not exists public.frogity_items (
  library_id uuid not null references public.frogity_libraries(id) on delete cascade,
  id text not null,
  rev bigint not null default nextval('public.frogity_rev_seq'),
  deleted boolean not null default false,
  meta text not null default '',          -- encrypted JSON (base64)
  file_ver text,                           -- version of the encrypted file parts
  file_parts int not null default 0,
  file_size bigint not null default 0,
  cover_ver text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (library_id, id)
);
create index if not exists frogity_items_rev on public.frogity_items(library_id, rev);

create table if not exists public.frogity_pairings (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.frogity_libraries(id) on delete cascade,
  code text not null,
  status text not null default 'open' check (status in ('open','joined','done','expired')),
  web_pub text,
  web_label text,
  web_secret_hash text,
  phone_pub text,
  wrapped text,
  web_device_id uuid,
  web_token text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists frogity_pairings_code on public.frogity_pairings(code, status);

-- rate limiting for code guesses (per address, per minute)
create table if not exists public.frogity_hits (
  key text not null,
  minute timestamptz not null,
  n int not null default 0,
  primary key (key, minute)
);

alter table public.frogity_libraries enable row level security;
alter table public.frogity_devices enable row level security;
alter table public.frogity_items enable row level security;
alter table public.frogity_pairings enable row level security;
alter table public.frogity_hits enable row level security;

-- private bucket for the encrypted files (parts of at most 20 MB)
insert into storage.buckets (id, name, public, file_size_limit)
values ('frogity-sync', 'frogity-sync', false, 26214400)
on conflict (id) do nothing;

-- one atomic rate-limit step: returns the count for this key in the current minute
create or replace function public.frogity_hit(k text) returns int
language sql security definer set search_path = public as $$
  insert into public.frogity_hits(key, minute, n) values (k, date_trunc('minute', now()), 1)
  on conflict (key, minute) do update set n = public.frogity_hits.n + 1
  returning n;
$$;
revoke all on function public.frogity_hit(text) from public, anon, authenticated;

-- a fresh revision number for an item on every write
create or replace function public.frogity_bump() returns trigger language plpgsql set search_path = public as $$
begin
  new.rev := nextval('public.frogity_rev_seq');
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists frogity_items_bump on public.frogity_items;
create trigger frogity_items_bump before update on public.frogity_items for each row execute function public.frogity_bump();
