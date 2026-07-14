-- Add parent_group_id (self-referential FK) and position to hangout_groups
ALTER TABLE hangout_groups
  ADD COLUMN IF NOT EXISTS parent_group_id INTEGER REFERENCES hangout_groups(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

-- Fix the column default (existing rows already updated individually)
ALTER TABLE hangout_groups ALTER COLUMN max_members SET DEFAULT 200000;

-- Index for fast child-group lookup
CREATE INDEX IF NOT EXISTS idx_hangout_groups_parent_id
  ON hangout_groups(parent_group_id)
  WHERE parent_group_id IS NOT NULL;
