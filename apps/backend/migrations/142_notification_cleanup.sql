-- Migration 142: Per-user notification cleanup
-- Keeps only the newest 1000 notifications per user,
-- and only deletes entries that are also older than 90 days.
-- This means a user with < 1000 notifications is never touched,
-- and even the overflow rows are kept if they are recent.

CREATE OR REPLACE FUNCTION cleanup_old_notifications() RETURNS void AS $$
BEGIN
  DELETE FROM notifications
  WHERE id IN (
    SELECT id FROM (
      SELECT id,
             ROW_NUMBER() OVER (PARTITION BY target_user_id ORDER BY created_at DESC) AS rn,
             created_at
      FROM notifications
    ) ranked
    WHERE rn > 1000
      AND created_at < NOW() - INTERVAL '90 days'
  );
END;
$$ LANGUAGE plpgsql;
