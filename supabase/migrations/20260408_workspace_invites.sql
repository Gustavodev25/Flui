CREATE TABLE IF NOT EXISTS workspace_invites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token UUID DEFAULT gen_random_uuid() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_owner_id, email)
);

ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_can_read_invites"
  ON workspace_invites FOR SELECT
  USING (auth.uid() = workspace_owner_id);

CREATE POLICY "owner_can_insert_invites"
  ON workspace_invites FOR INSERT
  WITH CHECK (auth.uid() = workspace_owner_id);

CREATE POLICY "owner_can_delete_invites"
  ON workspace_invites FOR DELETE
  USING (auth.uid() = workspace_owner_id);
