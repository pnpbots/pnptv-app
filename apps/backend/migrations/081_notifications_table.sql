-- 081_notifications_table.sql
-- Unified notification system: single table for all notification types

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  category VARCHAR(30) NOT NULL DEFAULT 'social',
  priority VARCHAR(10) NOT NULL DEFAULT 'normal',
  actor_id VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
  target_user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type VARCHAR(50),
  entity_id VARCHAR(255),
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_notification_dedup UNIQUE (type, actor_id, target_user_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_notifications_target_user ON notifications(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_target_unread ON notifications(target_user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_notifications_category ON notifications(target_user_id, category);

ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB
  DEFAULT '{"likes":true,"replies":true,"dms":true,"group_messages":true,"announcements":true,"payments":true,"wof":true,"group_joins":true}'::jsonb;
