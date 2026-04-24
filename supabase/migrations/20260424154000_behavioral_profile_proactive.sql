create extension if not exists pgcrypto;

create table if not exists public.behavioral_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  peak_hours jsonb not null default '[]'::jsonb,
  energy_patterns jsonb not null default '{}'::jsonb,
  communication_style text not null default 'balanced',
  tone_profile jsonb not null default '{}'::jsonb,
  ideal_cadence_minutes integer not null default 180,
  avg_daily_completions double precision not null default 0,
  productive_days jsonb not null default '[]'::jsonb,
  action_triggers jsonb not null default '[]'::jsonb,
  procrastination_patterns jsonb not null default '{}'::jsonb,
  avg_response_time_minutes double precision,
  preferred_reminder_hours jsonb not null default '[]'::jsonb,
  max_streak integer not null default 0,
  last_analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.behavioral_profiles
  add column if not exists peak_hours jsonb not null default '[]'::jsonb,
  add column if not exists energy_patterns jsonb not null default '{}'::jsonb,
  add column if not exists communication_style text not null default 'balanced',
  add column if not exists tone_profile jsonb not null default '{}'::jsonb,
  add column if not exists ideal_cadence_minutes integer not null default 180,
  add column if not exists avg_daily_completions double precision not null default 0,
  add column if not exists productive_days jsonb not null default '[]'::jsonb,
  add column if not exists action_triggers jsonb not null default '[]'::jsonb,
  add column if not exists procrastination_patterns jsonb not null default '{}'::jsonb,
  add column if not exists avg_response_time_minutes double precision,
  add column if not exists preferred_reminder_hours jsonb not null default '[]'::jsonb,
  add column if not exists max_streak integer not null default 0,
  add column if not exists last_analyzed_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists behavioral_profiles_user_id_unique_idx
  on public.behavioral_profiles (user_id);

create table if not exists public.behavioral_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.behavioral_events
  add column if not exists event_data jsonb not null default '{}'::jsonb,
  add column if not exists occurred_at timestamptz not null default now(),
  add column if not exists created_at timestamptz not null default now();

create index if not exists behavioral_events_user_type_idx
  on public.behavioral_events (user_id, event_type, occurred_at desc);

create index if not exists behavioral_events_occurred_at_idx
  on public.behavioral_events (occurred_at);

create table if not exists public.proactive_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  insight_type text not null,
  content text not null,
  priority text not null default 'medium',
  context jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  delivered_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.proactive_insights
  add column if not exists priority text not null default 'medium',
  add column if not exists context jsonb not null default '{}'::jsonb,
  add column if not exists status text not null default 'pending',
  add column if not exists delivered_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists created_at timestamptz not null default now();

create index if not exists proactive_insights_user_status_idx
  on public.proactive_insights (user_id, status, created_at desc);

create index if not exists proactive_insights_expires_idx
  on public.proactive_insights (expires_at)
  where status = 'pending';

alter table public.behavioral_profiles enable row level security;
alter table public.behavioral_events enable row level security;
alter table public.proactive_insights enable row level security;

drop policy if exists "service_role_all_behavioral_profiles" on public.behavioral_profiles;
create policy "service_role_all_behavioral_profiles"
  on public.behavioral_profiles for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "user_read_own_behavioral_profiles" on public.behavioral_profiles;
create policy "user_read_own_behavioral_profiles"
  on public.behavioral_profiles for select
  using (auth.uid() = user_id);

drop policy if exists "service_role_all_behavioral_events" on public.behavioral_events;
create policy "service_role_all_behavioral_events"
  on public.behavioral_events for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "service_role_all_proactive_insights" on public.proactive_insights;
create policy "service_role_all_proactive_insights"
  on public.proactive_insights for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "user_read_own_proactive_insights" on public.proactive_insights;
create policy "user_read_own_proactive_insights"
  on public.proactive_insights for select
  using (auth.uid() = user_id);
