-- Migration 293: Add user_id index to user_access_logs
-- CONCURRENTLY so it doesn't lock the table (330k inserts/day)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_access_logs_user
  ON user_access_logs (user_id, created_at DESC);
