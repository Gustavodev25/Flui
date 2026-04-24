create extension if not exists pgcrypto;

create table if not exists public.channel_bindings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  channel text not null,
  external_user_id text not null,
  display_name text,
  authenticated boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  last_inbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.channel_bindings
  add column if not exists display_name text,
  add column if not exists authenticated boolean not null default true,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists last_seen_at timestamptz,
  add column if not exists last_inbound_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists channel_bindings_channel_external_user_id_idx
  on public.channel_bindings (channel, external_user_id);

create index if not exists channel_bindings_user_channel_idx
  on public.channel_bindings (user_id, channel);

create index if not exists channel_bindings_whatsapp_last_inbound_idx
  on public.channel_bindings (last_inbound_at desc)
  where channel = 'whatsapp' and authenticated = true;

create table if not exists public.conversation_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  channel text not null,
  channel_binding_id uuid references public.channel_bindings(id) on delete set null,
  title text,
  unread_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  last_message_at timestamptz not null default now(),
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.conversation_threads
  add column if not exists channel_binding_id uuid,
  add column if not exists title text,
  add column if not exists unread_count integer not null default 0,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists last_message_at timestamptz not null default now(),
  add column if not exists last_read_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists conversation_threads_user_id_idx
  on public.conversation_threads (user_id, last_message_at desc);

create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.conversation_threads(id) on delete cascade,
  user_id uuid not null,
  channel text not null,
  direction text not null,
  role text not null,
  message_type text not null,
  content text not null,
  status text not null default 'sent',
  external_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  provider text,
  model text,
  latency_ms integer,
  fallback_used boolean not null default false,
  tool_count integer not null default 0,
  error_class text,
  artifact_recovery boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.conversation_messages
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists provider text,
  add column if not exists model text,
  add column if not exists latency_ms integer,
  add column if not exists fallback_used boolean not null default false,
  add column if not exists tool_count integer not null default 0,
  add column if not exists error_class text,
  add column if not exists artifact_recovery boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists conversation_messages_channel_external_message_id_idx
  on public.conversation_messages (channel, external_message_id)
  where external_message_id is not null;

create index if not exists conversation_messages_thread_created_at_idx
  on public.conversation_messages (thread_id, created_at asc);

create index if not exists conversation_messages_user_channel_created_idx
  on public.conversation_messages (user_id, channel, created_at desc);

create table if not exists public.outbound_message_jobs (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.conversation_threads(id) on delete cascade,
  message_id uuid not null references public.conversation_messages(id) on delete cascade,
  user_id uuid not null,
  channel text not null,
  target text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  attempts integer not null default 0,
  lease_owner text,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  external_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.outbound_message_jobs
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists status text not null default 'queued',
  add column if not exists attempts integer not null default 0,
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists last_error text,
  add column if not exists external_message_id text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists outbound_message_jobs_ready_idx
  on public.outbound_message_jobs (status, next_attempt_at, lease_expires_at);

create index if not exists outbound_message_jobs_user_created_idx
  on public.outbound_message_jobs (user_id, created_at desc);

create table if not exists public.pending_followups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  task_id uuid,
  task_title text not null,
  reminder_type text not null,
  missed_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.pending_followups
  add column if not exists task_id uuid,
  add column if not exists task_title text,
  add column if not exists reminder_type text,
  add column if not exists missed_at timestamptz not null default now(),
  add column if not exists resolved_at timestamptz,
  add column if not exists created_at timestamptz not null default now();

create index if not exists pending_followups_unresolved_user_idx
  on public.pending_followups (user_id, missed_at asc)
  where resolved_at is null;

create table if not exists public.daily_commitments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  date date not null,
  committed_tasks text[] not null default '{}',
  morning_sent_at timestamptz,
  afternoon_sent_at timestamptz,
  evening_sent_at timestamptz,
  weekly_sent_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.daily_commitments
  add column if not exists committed_tasks text[] not null default '{}',
  add column if not exists morning_sent_at timestamptz,
  add column if not exists afternoon_sent_at timestamptz,
  add column if not exists evening_sent_at timestamptz,
  add column if not exists weekly_sent_at timestamptz,
  add column if not exists responded_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists daily_commitments_user_date_idx
  on public.daily_commitments (user_id, date);

alter table public.channel_bindings enable row level security;
alter table public.conversation_threads enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.outbound_message_jobs enable row level security;
alter table public.pending_followups enable row level security;
alter table public.daily_commitments enable row level security;

drop policy if exists "service_role_all_channel_bindings" on public.channel_bindings;
create policy "service_role_all_channel_bindings"
  on public.channel_bindings for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "user_read_own_channel_bindings" on public.channel_bindings;
create policy "user_read_own_channel_bindings"
  on public.channel_bindings for select
  using (auth.uid() = user_id);

drop policy if exists "service_role_all_conversation_threads" on public.conversation_threads;
create policy "service_role_all_conversation_threads"
  on public.conversation_threads for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "user_read_own_conversation_threads" on public.conversation_threads;
create policy "user_read_own_conversation_threads"
  on public.conversation_threads for select
  using (auth.uid() = user_id);

drop policy if exists "service_role_all_conversation_messages" on public.conversation_messages;
create policy "service_role_all_conversation_messages"
  on public.conversation_messages for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "user_read_own_conversation_messages" on public.conversation_messages;
create policy "user_read_own_conversation_messages"
  on public.conversation_messages for select
  using (auth.uid() = user_id);

drop policy if exists "service_role_all_outbound_message_jobs" on public.outbound_message_jobs;
create policy "service_role_all_outbound_message_jobs"
  on public.outbound_message_jobs for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "service_role_all_pending_followups" on public.pending_followups;
create policy "service_role_all_pending_followups"
  on public.pending_followups for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "user_read_own_pending_followups" on public.pending_followups;
create policy "user_read_own_pending_followups"
  on public.pending_followups for select
  using (auth.uid() = user_id);

drop policy if exists "service_role_all_daily_commitments" on public.daily_commitments;
create policy "service_role_all_daily_commitments"
  on public.daily_commitments for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "user_read_own_daily_commitments" on public.daily_commitments;
create policy "user_read_own_daily_commitments"
  on public.daily_commitments for select
  using (auth.uid() = user_id);
