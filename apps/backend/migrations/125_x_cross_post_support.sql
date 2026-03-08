-- Migration 125: X (Twitter) cross-post support
-- Date: 2026-03-08
-- Purpose: Track granted OAuth scopes per user (so the backend can verify tweet.write
--          before attempting a post), and log every cross-post attempt for deduplication
--          and audit purposes.

BEGIN;

-- Store the space-separated OAuth scope string returned by X at token-grant time.
-- NULL means the user connected X before this column existed (legacy) and their
-- scopes are unknown — the frontend should prompt them to reconnect.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS x_oauth_scopes TEXT;

-- Cross-post audit log.
-- One row per (social_post_id, user_id) pair (unique index below).
CREATE TABLE IF NOT EXISTS x_cross_post_log (
  id               SERIAL PRIMARY KEY,
  user_id          VARCHAR(64)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  social_post_id   INTEGER      NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  x_tweet_id       VARCHAR(64),
  status           VARCHAR(20)  NOT NULL DEFAULT 'pending',  -- pending | posted | failed
  error_message    TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Lookup by user (my cross-posts history)
CREATE INDEX IF NOT EXISTS idx_x_cross_post_user
  ON x_cross_post_log (user_id);

-- Lookup by post (has this post been shared to X?)
CREATE INDEX IF NOT EXISTS idx_x_cross_post_post
  ON x_cross_post_log (social_post_id);

-- Prevent duplicate cross-posts: one successful share per (post, user) pair
CREATE UNIQUE INDEX IF NOT EXISTS idx_x_cross_post_unique
  ON x_cross_post_log (social_post_id, user_id);

COMMIT;
