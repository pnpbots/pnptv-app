-- Migration 094: PRIME channel content mirror to social feed
-- Adds tracking columns to social_posts, migration log, and app_settings table

BEGIN;

-- 1. Source tracking columns on social_posts
ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS telegram_message_id BIGINT,
  ADD COLUMN IF NOT EXISTS source_channel VARCHAR(100);

CREATE UNIQUE INDEX IF NOT EXISTS idx_social_posts_telegram_msg_id
  ON social_posts (telegram_message_id)
  WHERE telegram_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_social_posts_source_channel
  ON social_posts (source_channel)
  WHERE source_channel IS NOT NULL;

-- 2. Migration tracking log
CREATE TABLE IF NOT EXISTS prime_channel_migration_log (
  message_id   BIGINT       PRIMARY KEY,
  status       VARCHAR(20)  NOT NULL CHECK (status IN ('success','skipped','failed','deleted')),
  post_id      BIGINT       REFERENCES social_posts(id) ON DELETE SET NULL,
  media_type   VARCHAR(20),
  error_msg    TEXT,
  attempted_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 3. App-level settings table
CREATE TABLE IF NOT EXISTS app_settings (
  key        VARCHAR(100) PRIMARY KEY,
  value      TEXT         NOT NULL,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Default: mirror disabled until admin enables it
INSERT INTO app_settings (key, value)
  VALUES ('prime_channel_mirror_enabled', 'false')
  ON CONFLICT (key) DO NOTHING;

COMMIT;
