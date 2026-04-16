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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists channel_bindings_channel_external_user_id_idx
  on public.channel_bindings (channel, external_user_id);

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

create unique index if not exists conversation_messages_channel_external_message_id_idx
  on public.conversation_messages (channel, external_message_id)
  where external_message_id is not null;

create index if not exists conversation_messages_thread_created_at_idx
  on public.conversation_messages (thread_id, created_at asc);

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

create index if not exists outbound_message_jobs_ready_idx
  on public.outbound_message_jobs (status, next_attempt_at, lease_expires_at);
