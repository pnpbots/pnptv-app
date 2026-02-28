-- Migration 075: Add Bluesky cross-post columns to social_posts
-- Date: 2026-02-28
-- Purpose: When users cross-post a PNPtv social post to Bluesky, store the
--          resulting AT Protocol URI and CID so we can link back to the post,
--          avoid duplicate cross-posts, and display the Bluesky source badge.

BEGIN;

ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS bluesky_uri TEXT,
  ADD COLUMN IF NOT EXISTS bluesky_cid TEXT;

-- Partial index: only rows that have been cross-posted to Bluesky
CREATE INDEX IF NOT EXISTS idx_social_posts_bluesky_uri
  ON social_posts (bluesky_uri)
  WHERE bluesky_uri IS NOT NULL;

COMMIT;
