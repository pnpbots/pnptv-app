-- 092: Fix last_read_at default — should be NULL so COALESCE falls through to joined_at
-- Migration 089 used DEFAULT NOW() which set all existing rows to the migration timestamp,
-- masking real unread messages. Reset to NULL for proper fallback behavior.
ALTER TABLE hangout_group_members
  ALTER COLUMN last_read_at SET DEFAULT NULL;

-- Reset existing rows that were incorrectly set to the migration timestamp
-- Only reset rows where the user hasn't explicitly marked as read since
UPDATE hangout_group_members
SET last_read_at = NULL
WHERE last_read_at IS NOT NULL
  AND last_read_at = (SELECT last_read_at FROM hangout_group_members ORDER BY last_read_at ASC LIMIT 1);
