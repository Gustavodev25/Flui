create table if not exists public.whatsapp_sessions (
  phone text primary key,
  session jsonb not null,
  expires_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_sessions_expires_at_idx
  on public.whatsapp_sessions (expires_at)
  where expires_at is not null;

alter table public.whatsapp_sessions enable row level security;

create table if not exists public.whatsapp_processed_messages (
  message_id text primary key,
  channel text not null default 'whatsapp',
  received_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 day')
);

create index if not exists whatsapp_processed_messages_expires_at_idx
  on public.whatsapp_processed_messages (expires_at);

create index if not exists whatsapp_processed_messages_received_at_idx
  on public.whatsapp_processed_messages (received_at desc);

alter table public.whatsapp_processed_messages enable row level security;
