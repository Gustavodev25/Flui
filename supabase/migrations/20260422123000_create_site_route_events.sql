create table if not exists public.site_route_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  path text not null,
  label text null,
  referrer text null,
  title text null,
  user_agent text null,
  country text null,
  state text null,
  city text null,
  locale text null,
  timezone text null,
  viewport jsonb null,
  ip_hash text null,
  created_at timestamptz not null default now()
);

create index if not exists site_route_events_created_at_idx
  on public.site_route_events (created_at desc);

create index if not exists site_route_events_path_created_at_idx
  on public.site_route_events (path, created_at desc);

create index if not exists site_route_events_user_id_idx
  on public.site_route_events (user_id);

create index if not exists site_route_events_geo_idx
  on public.site_route_events (country, state);

alter table public.site_route_events enable row level security;
