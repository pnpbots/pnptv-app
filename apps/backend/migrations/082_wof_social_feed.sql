-- Migration 082: Wall of Fame social feed integration
-- Date: 2026-02-28
-- Purpose: Add is_wof flag to social_posts and wof_photo_consent to users

BEGIN;

-- ── social_posts: WoF flag ──────────────────────────────────────────────────
ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS is_wof BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index for the WoF sub-feed query
CREATE INDEX IF NOT EXISTS idx_social_posts_wof_feed
  ON social_posts (id DESC)
  WHERE is_wof = TRUE AND is_deleted = FALSE AND reply_to_id IS NULL;

-- ── users: photo consent flag ───────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS wof_photo_consent BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
