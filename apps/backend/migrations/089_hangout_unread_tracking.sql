-- 089: Add last_read_at to hangout_group_members for unread message tracking
ALTER TABLE hangout_group_members
  ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ DEFAULT NULL;
