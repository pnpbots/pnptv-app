-- Migration 085: Internal Follow System
-- Adds user_follows table, follower/following counters, and 'follows' notification pref

CREATE TABLE IF NOT EXISTS user_follows (
  follower_id  VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id),
  CONSTRAINT no_self_follow CHECK (follower_id != following_id)
);

CREATE INDEX IF NOT EXISTS idx_user_follows_follower  ON user_follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_user_follows_following ON user_follows(following_id);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS followers_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS following_count INT NOT NULL DEFAULT 0;

-- Backfill counts in case rows already exist
UPDATE users u
SET
  followers_count = (SELECT COUNT(*) FROM user_follows WHERE following_id = u.id),
  following_count = (SELECT COUNT(*) FROM user_follows WHERE follower_id  = u.id);

-- Add 'follows' to notification_preferences default so future new users get it
ALTER TABLE users
  ALTER COLUMN notification_preferences SET DEFAULT
    '{"likes":true,"replies":true,"dms":true,"group_messages":true,"group_joins":true,"wof":true,"payments":true,"announcements":true,"follows":true}'::jsonb;
