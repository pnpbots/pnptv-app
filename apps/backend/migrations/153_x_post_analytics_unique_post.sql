-- Migration 153: Add unique constraint on x_post_analytics.post_id
-- Required for ON CONFLICT upsert in the analytics ingestion scheduler.

CREATE UNIQUE INDEX IF NOT EXISTS idx_x_post_analytics_post_unique ON x_post_analytics(post_id);
