-- ═══ Behavioral Profile & Proactive Intelligence ═══
-- Tracks user behavior patterns and enables smart proactive interventions

-- ── Perfil comportamental do usuário ─────────────────────────────────────────
create table if not exists public.behavioral_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,

  -- Horários produtivos (média de hora do dia em que completa tarefas)
  peak_hours jsonb not null default '[]'::jsonb,
  -- Ex: [{"hour": 9, "completions": 15}, {"hour": 14, "completions": 12}]

  -- Padrões de energia por período
  energy_patterns jsonb not null default '{}'::jsonb,
  -- Ex: {"morning": 0.8, "afternoon": 0.6, "evening": 0.3}
  -- 0-1 score baseado em taxa de conclusão por período

  -- Estilo de comunicação detectado
  communication_style text not null default 'balanced',
  -- 'concise' | 'detailed' | 'balanced'

  -- Cadência ideal de mensagens (minutos entre interações)
  ideal_cadence_minutes integer not null default 180,

  -- Taxa média de conclusão diária
  avg_daily_completions float not null default 0,

  -- Dias mais produtivos da semana (0=dom, 6=sab)
  productive_days jsonb not null default '[]'::jsonb,
  -- Ex: [{"day": 1, "rate": 0.9}, {"day": 2, "rate": 0.85}]

  -- Gatilhos de ação que funcionam com esse usuário
  action_triggers jsonb not null default '[]'::jsonb,
  -- Ex: ["urgency", "progress", "streak"]

  -- Padrões de procrastinação
  procrastination_patterns jsonb not null default '{}'::jsonb,
  -- Ex: {"avg_reschedules": 2.1, "common_postpone_days": 3, "categories": ["estudo"]}

  -- Tempo médio de resposta (minutos)
  avg_response_time_minutes float,

  -- Preferência de horário de lembretes (aprendido)
  preferred_reminder_hours jsonb not null default '[]'::jsonb,
  -- Ex: [8, 13, 19]

  -- Streak máximo histórico
  max_streak integer not null default 0,

  -- Última atualização do perfil
  last_analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists behavioral_profiles_user_id_idx
  on public.behavioral_profiles (user_id);

-- ── Eventos comportamentais (dados brutos para análise) ──────────────────────
create table if not exists public.behavioral_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  event_type text not null,
  -- Tipos: 'task_completed', 'task_created', 'task_rescheduled', 'task_overdue',
  --        'message_sent', 'message_response', 'session_start', 'session_end',
  --        'reminder_engaged', 'reminder_ignored'
  event_data jsonb not null default '{}'::jsonb,
  -- Dados específicos do evento (hora, task_id, contexto)
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists behavioral_events_user_type_idx
  on public.behavioral_events (user_id, event_type, occurred_at desc);

-- Limpa eventos antigos (mais de 90 dias) para não acumular infinitamente
create index if not exists behavioral_events_occurred_at_idx
  on public.behavioral_events (occurred_at);

-- ── Insights proativos gerados ───────────────────────────────────────────────
create table if not exists public.proactive_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  insight_type text not null,
  -- Tipos: 'procrastination_alert', 'overload_warning', 'momentum_praise',
  --        'reorganization_suggestion', 'pattern_observation', 'streak_celebration'
  content text not null,
  -- Mensagem gerada para o usuário
  priority text not null default 'medium',
  -- 'low', 'medium', 'high', 'critical'
  context jsonb not null default '{}'::jsonb,
  -- Dados de contexto (tasks envolvidas, padrões detectados)
  status text not null default 'pending',
  -- 'pending', 'delivered', 'engaged', 'dismissed', 'expired'
  delivered_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists proactive_insights_user_status_idx
  on public.proactive_insights (user_id, status, created_at desc);

create index if not exists proactive_insights_expires_idx
  on public.proactive_insights (expires_at)
  where status = 'pending';

-- ── RLS Policies ─────────────────────────────────────────────────────────────
alter table public.behavioral_profiles enable row level security;
alter table public.behavioral_events enable row level security;
alter table public.proactive_insights enable row level security;

-- Service role tem acesso total (usado pelo servidor)
create policy "service_role_all_behavioral_profiles"
  on public.behavioral_profiles for all
  using (true) with check (true);

create policy "service_role_all_behavioral_events"
  on public.behavioral_events for all
  using (true) with check (true);

create policy "service_role_all_proactive_insights"
  on public.proactive_insights for all
  using (true) with check (true);
