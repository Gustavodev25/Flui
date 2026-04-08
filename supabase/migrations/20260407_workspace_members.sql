CREATE TABLE IF NOT EXISTS workspace_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_email TEXT NOT NULL,
  member_name TEXT,
  member_avatar TEXT,
  role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_owner_id, member_user_id)
);

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_can_read_members"
  ON workspace_members FOR SELECT
  USING (auth.uid() = workspace_owner_id OR auth.uid() = member_user_id);

CREATE POLICY "owner_can_insert_members"
  ON workspace_members FOR INSERT
  WITH CHECK (auth.uid() = workspace_owner_id);

CREATE POLICY "owner_can_delete_members"
  ON workspace_members FOR DELETE
  USING (auth.uid() = workspace_owner_id);
