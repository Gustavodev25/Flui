-- Long-term memory schema plus semantic search support.
-- Requires pgvector, available in Supabase projects.

create extension if not exists vector with schema public;

create table if not exists public.user_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  memory_type text not null,
  content text not null,
  summary text,
  entities jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  importance double precision not null default 0.5,
  access_count integer not null default 0,
  last_accessed_at timestamptz,
  source_message text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  category text not null,
  title text not null,
  content text not null,
  entities jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  related_task_ids jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  pinned boolean not null default false,
  source text not null default 'whatsapp',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.entity_graph (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  entity_type text not null,
  description text,
  attributes jsonb not null default '{}'::jsonb,
  related_entities jsonb not null default '[]'::jsonb,
  mention_count integer not null default 1,
  last_mentioned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_memories
  add column if not exists embedding vector(1536),
  add column if not exists embedding_model text,
  add column if not exists embedding_updated_at timestamptz;

create index if not exists user_memories_user_type_idx
  on public.user_memories (user_id, memory_type, importance desc);

create index if not exists user_memories_user_search_idx
  on public.user_memories (user_id, created_at desc);

create index if not exists user_memories_embedding_hnsw_idx
  on public.user_memories
  using hnsw (embedding vector_cosine_ops)
  where embedding is not null;

create index if not exists knowledge_entries_user_category_idx
  on public.knowledge_entries (user_id, category, created_at desc);

create index if not exists knowledge_entries_user_pinned_idx
  on public.knowledge_entries (user_id, pinned, created_at desc)
  where pinned = true;

create unique index if not exists entity_graph_user_name_type_idx
  on public.entity_graph (user_id, lower(name), entity_type);

create index if not exists entity_graph_user_mentions_idx
  on public.entity_graph (user_id, mention_count desc);

alter table public.user_memories enable row level security;
alter table public.knowledge_entries enable row level security;
alter table public.entity_graph enable row level security;

drop policy if exists "service_role_all_user_memories" on public.user_memories;
create policy "service_role_all_user_memories"
  on public.user_memories for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "service_role_all_knowledge_entries" on public.knowledge_entries;
create policy "service_role_all_knowledge_entries"
  on public.knowledge_entries for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "service_role_all_entity_graph" on public.entity_graph;
create policy "service_role_all_entity_graph"
  on public.entity_graph for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "user_read_own_memories" on public.user_memories;
create policy "user_read_own_memories"
  on public.user_memories for select
  using (auth.uid() = user_id);

drop policy if exists "user_read_own_knowledge" on public.knowledge_entries;
create policy "user_read_own_knowledge"
  on public.knowledge_entries for select
  using (auth.uid() = user_id);

drop policy if exists "user_read_own_entities" on public.entity_graph;
create policy "user_read_own_entities"
  on public.entity_graph for select
  using (auth.uid() = user_id);

create or replace function public.match_user_memories(
  query_user_id uuid,
  query_embedding vector(1536),
  match_count integer default 5,
  min_importance double precision default 0.3,
  filter_memory_type text default null,
  min_similarity double precision default 0.72
)
returns table (
  id uuid,
  user_id uuid,
  memory_type text,
  content text,
  summary text,
  entities jsonb,
  tags jsonb,
  importance double precision,
  access_count integer,
  last_accessed_at timestamptz,
  source_message text,
  expires_at timestamptz,
  embedding_model text,
  embedding_updated_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  similarity double precision
)
language sql
stable
as $$
  select
    um.id,
    um.user_id,
    um.memory_type,
    um.content,
    um.summary,
    um.entities,
    um.tags,
    um.importance,
    um.access_count,
    um.last_accessed_at,
    um.source_message,
    um.expires_at,
    um.embedding_model,
    um.embedding_updated_at,
    um.created_at,
    um.updated_at,
    1 - (um.embedding <=> query_embedding) as similarity
  from public.user_memories um
  where um.user_id = query_user_id
    and um.embedding is not null
    and um.importance >= min_importance
    and (filter_memory_type is null or um.memory_type = filter_memory_type)
    and (um.expires_at is null or um.expires_at > now())
    and 1 - (um.embedding <=> query_embedding) >= min_similarity
  order by um.embedding <=> query_embedding, um.importance desc, um.created_at desc
  limit least(greatest(match_count, 1), 50);
$$;
