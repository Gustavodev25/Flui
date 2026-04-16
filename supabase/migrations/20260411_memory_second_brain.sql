-- ═══ Long-Term Memory & Second Brain ═══
-- Persistent knowledge base that allows the AI to remember everything about the user

-- ── Memórias de longo prazo ──────────────────────────────────────────────────
create table if not exists public.user_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  memory_type text not null,
  -- Tipos:
  -- 'episodic'  — eventos/conversas importantes ("você disse que ia focar em X")
  -- 'semantic'  — fatos sobre o usuário (preferências, contexto de vida)
  -- 'entity'    — pessoas, projetos, lugares mencionados pelo usuário

  content text not null,
  -- O conteúdo da memória em texto livre

  summary text,
  -- Resumo curto para matching rápido (gerado pela IA)

  entities jsonb not null default '[]'::jsonb,
  -- Entidades relacionadas: [{"name": "João", "type": "person"}, {"name": "Projeto X", "type": "project"}]

  tags jsonb not null default '[]'::jsonb,
  -- Tags para filtragem rápida: ["trabalho", "saúde", "pessoal"]

  importance float not null default 0.5,
  -- 0.0 a 1.0: quão importante é essa memória (decai com o tempo se não acessada)

  access_count integer not null default 0,
  -- Quantas vezes foi recuperada/usada

  last_accessed_at timestamptz,
  -- Última vez que foi incluída no contexto

  source_message text,
  -- Mensagem original que gerou essa memória

  expires_at timestamptz,
  -- Se definido, memória expira (para informações temporárias)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_memories_user_type_idx
  on public.user_memories (user_id, memory_type, importance desc);

create index if not exists user_memories_user_search_idx
  on public.user_memories (user_id, created_at desc);

-- ── Knowledge Base (Segundo Cérebro) ─────────────────────────────────────────
create table if not exists public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  category text not null,
  -- Categorias:
  -- 'note'       — anotação geral, ata de reunião, insight
  -- 'idea'       — ideias para o futuro
  -- 'reference'  — informação para consulta (senhas, dados, links)
  -- 'decision'   — decisões tomadas e contexto
  -- 'contact'    — info sobre pessoas (quem faz o quê)
  -- 'routine'    — rotinas, processos recorrentes

  title text not null,
  -- Título curto e descritivo

  content text not null,
  -- Conteúdo completo

  entities jsonb not null default '[]'::jsonb,
  -- Pessoas, projetos, lugares mencionados

  tags jsonb not null default '[]'::jsonb,
  -- Tags livres para organização

  related_task_ids jsonb not null default '[]'::jsonb,
  -- IDs de tarefas relacionadas (para cross-reference)

  metadata jsonb not null default '{}'::jsonb,
  -- Dados extras (data da reunião, local, etc.)

  pinned boolean not null default false,
  -- Se está fixado (sempre aparece no contexto)

  source text not null default 'whatsapp',
  -- Origem: 'whatsapp', 'web', 'auto'

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_entries_user_category_idx
  on public.knowledge_entries (user_id, category, created_at desc);

create index if not exists knowledge_entries_user_pinned_idx
  on public.knowledge_entries (user_id, pinned, created_at desc)
  where pinned = true;

-- ── Grafo de entidades (pessoas, projetos, contextos) ────────────────────────
create table if not exists public.entity_graph (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  entity_type text not null,
  -- 'person', 'project', 'place', 'company', 'topic'

  description text,
  -- Descrição curta ("colega de trabalho", "projeto da empresa")

  attributes jsonb not null default '{}'::jsonb,
  -- Atributos variáveis: {"role": "dev", "email": "x@y.com", "frequency": "daily"}

  related_entities jsonb not null default '[]'::jsonb,
  -- Relações: [{"entity_id": "uuid", "relation": "works_with"}, ...]

  mention_count integer not null default 1,
  -- Quantas vezes foi mencionado

  last_mentioned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists entity_graph_user_name_type_idx
  on public.entity_graph (user_id, lower(name), entity_type);

create index if not exists entity_graph_user_mentions_idx
  on public.entity_graph (user_id, mention_count desc);

-- ── RLS Policies ─────────────────────────────────────────────────────────────
alter table public.user_memories enable row level security;
alter table public.knowledge_entries enable row level security;
alter table public.entity_graph enable row level security;

create policy "service_role_all_user_memories"
  on public.user_memories for all
  using (true) with check (true);

create policy "service_role_all_knowledge_entries"
  on public.knowledge_entries for all
  using (true) with check (true);

create policy "service_role_all_entity_graph"
  on public.entity_graph for all
  using (true) with check (true);

-- Permite que o próprio usuário leia suas memórias via anon key (para UI)
create policy "user_read_own_memories"
  on public.user_memories for select
  using (auth.uid() = user_id);

create policy "user_read_own_knowledge"
  on public.knowledge_entries for select
  using (auth.uid() = user_id);

create policy "user_read_own_entities"
  on public.entity_graph for select
  using (auth.uid() = user_id);
