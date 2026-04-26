-- Tabela de changelogs públicos
CREATE TABLE IF NOT EXISTS changelogs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL,
  type text NOT NULL DEFAULT 'feature' CHECK (type IN ('feature', 'fix', 'improvement', 'breaking')),
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE changelogs ENABLE ROW LEVEL SECURITY;

-- Qualquer um pode ler changelogs publicados
CREATE POLICY "Anyone can read changelogs"
  ON changelogs FOR SELECT
  USING (true);

-- Apenas admins podem inserir/atualizar/deletar (via service_role no backend)
CREATE INDEX IF NOT EXISTS changelogs_published_at_idx ON changelogs (published_at DESC);
