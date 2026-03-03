-- Migration 099: Hangout Subgroup Limits
-- Adds activity tracking, reduces default max_members, caps existing user-created groups

-- 1. Add last_activity_at column for 72h inactivity cleanup
ALTER TABLE hangout_groups ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Backfill existing groups
UPDATE hangout_groups SET last_activity_at = COALESCE(updated_at, created_at, NOW()) WHERE last_activity_at IS NULL;

-- 3. Change default max_members from 200 to 25 for new groups
ALTER TABLE hangout_groups ALTER COLUMN max_members SET DEFAULT 25;

-- 4. Cap existing user-created groups to 25 members max
UPDATE hangout_groups SET max_members = 25 WHERE is_main = false AND is_wall_of_fame = false AND max_members > 25;

-- 5. Partial index for efficient 72h cleanup query (only user-created groups)
CREATE INDEX IF NOT EXISTS idx_hangout_groups_last_activity
  ON hangout_groups (last_activity_at)
  WHERE is_main = false AND is_wall_of_fame = false;
