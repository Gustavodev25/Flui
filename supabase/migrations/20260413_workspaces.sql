-- Tabela para armazenar o nome customizado do workspace
CREATE TABLE IF NOT EXISTS public.workspaces (
  owner_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

-- Dono pode fazer tudo
CREATE POLICY "owner_all" ON public.workspaces
  FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- Membros do workspace podem ler
CREATE POLICY "member_read" ON public.workspaces
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_owner_id = workspaces.owner_id
        AND member_user_id = auth.uid()
    )
  );
