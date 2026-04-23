ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS due_time TEXT DEFAULT NULL;

CREATE TABLE IF NOT EXISTS public.google_integrations (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'google_calendar',
  email TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_type TEXT,
  scope TEXT,
  expires_at TIMESTAMPTZ,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  time_zone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  auto_sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_error TEXT,
  last_synced_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.google_calendar_task_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  google_event_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  event_html_link TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (user_id, task_id)
);

ALTER TABLE public.google_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_calendar_task_links ENABLE ROW LEVEL SECURITY;
