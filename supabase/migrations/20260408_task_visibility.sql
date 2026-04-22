-- Add visibility and workspace_owner_id columns to tasks table
-- visibility: 'personal' (default) = only visible to creator
--             'workspace' = visible to all workspace members
-- workspace_owner_id: ID of the workspace owner (set for workspace tasks)

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'personal'
    CHECK (visibility IN ('personal', 'workspace')),
  ADD COLUMN IF NOT EXISTS workspace_owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Index for fast lookup of workspace tasks by owner
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_owner
  ON public.tasks (workspace_owner_id)
  WHERE visibility = 'workspace';
