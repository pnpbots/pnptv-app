-- Add btree index on user_access_logs(created_at) to support analytics range scans.
-- BRIN-only was insufficient for COUNT(DISTINCT) queries on 5.5M+ rows causing statement timeouts.
-- CONCURRENTLY avoids table lock; safe to run on live production.
-- Note: idx_access_logs_user (user_id, created_at DESC) already existed — skipped.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_access_logs_created_at_btree
  ON user_access_logs (created_at DESC);
