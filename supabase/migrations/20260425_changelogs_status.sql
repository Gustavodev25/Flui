-- Adiciona status (draft / published) na tabela changelogs
ALTER TABLE changelogs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published'
  CHECK (status IN ('draft', 'published'));

-- Usuários autenticados podem ver rascunhos (para preview de admin)
CREATE POLICY "Authenticated users can read all changelogs"
  ON changelogs FOR SELECT
  TO authenticated
  USING (true);
