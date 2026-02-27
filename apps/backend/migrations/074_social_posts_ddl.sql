-- Migration 074: Canonical DDL for social_posts, social_post_likes, and pds_posts
-- Date: 2026-02-27
-- Purpose: These tables exist in the live database but have no DDL recorded
--          anywhere in the codebase. This migration is idempotent (IF NOT EXISTS)
--          and safe to run against a DB that already has the tables.
--          It also adds any missing columns and ensures all required indexes exist.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────────
-- social_posts
-- Primary table for all community social posts created through the PNPtv! app.
-- Media files are stored locally at /public/uploads/posts/ and referenced by
-- media_url (a root-relative path like /uploads/posts/img-<userId>-<ts>.webp).
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_posts (
  id            BIGSERIAL    PRIMARY KEY,
  user_id       VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content       TEXT         NOT NULL CHECK (char_length(content) <= 5000),
  media_url     TEXT,
  media_type    VARCHAR(20)  CHECK (media_type IN ('image', 'video')),
  reply_to_id   BIGINT       REFERENCES social_posts(id) ON DELETE SET NULL,
  repost_of_id  BIGINT       REFERENCES social_posts(id) ON DELETE SET NULL,
  likes_count   INT          NOT NULL DEFAULT 0 CHECK (likes_count >= 0),
  reposts_count INT          NOT NULL DEFAULT 0 CHECK (reposts_count >= 0),
  replies_count INT          NOT NULL DEFAULT 0 CHECK (replies_count >= 0),
  mastodon_id   TEXT,
  is_deleted    BOOLEAN      NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Add missing columns to existing table (idempotent via IF NOT EXISTS)
ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS mastodon_id   TEXT,
  ADD COLUMN IF NOT EXISTS is_deleted    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Enforce media_type constraint if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'social_posts_media_type_check'
  ) THEN
    ALTER TABLE social_posts
      ADD CONSTRAINT social_posts_media_type_check
      CHECK (media_type IN ('image', 'video'));
  END IF;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- Indexes for social_posts
-- Query patterns:
--   Feed:    WHERE is_deleted=false AND reply_to_id IS NULL ORDER BY id DESC
--   Wall:    WHERE is_deleted=false AND user_id=? ORDER BY id DESC
--   Replies: WHERE reply_to_id=? AND is_deleted=false ORDER BY id ASC
-- ──────────────────────────────────────────────────────────────────────────────

-- Feed index (partial, covers the most common query path)
CREATE INDEX IF NOT EXISTS idx_social_posts_feed
  ON social_posts (id DESC)
  WHERE is_deleted = false AND reply_to_id IS NULL;

-- User wall index
CREATE INDEX IF NOT EXISTS idx_social_posts_user
  ON social_posts (user_id, id DESC)
  WHERE is_deleted = false;

-- Replies index
CREATE INDEX IF NOT EXISTS idx_social_posts_replies
  ON social_posts (reply_to_id, id ASC)
  WHERE is_deleted = false;

-- Mastodon ID lookup (for deduplication during mirror)
CREATE INDEX IF NOT EXISTS idx_social_posts_mastodon_id
  ON social_posts (mastodon_id)
  WHERE mastodon_id IS NOT NULL;

-- Media posts — partial index for admin media queries
CREATE INDEX IF NOT EXISTS idx_social_posts_has_media
  ON social_posts (created_at DESC)
  WHERE media_url IS NOT NULL AND is_deleted = false;

-- ──────────────────────────────────────────────────────────────────────────────
-- social_post_likes
-- Tracks which user has liked which post. Composite PK prevents duplicates.
-- ON DELETE CASCADE removes likes when the post or user is deleted.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_post_likes (
  post_id    BIGINT       NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  user_id    VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

-- Index for "did this user like any of these posts?" queries
CREATE INDEX IF NOT EXISTS idx_social_post_likes_user
  ON social_post_likes (user_id, post_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- pds_posts
-- Ephemeral cache of Bluesky/PDS posts fetched by BlueskyService.cachePosts().
-- Rows expire after 24 hours (expires_at). This is a read-only cache; content
-- is never created here, only mirrored from external Bluesky instances.
-- Included in the unified social feed when the viewer has linked their Bluesky
-- account and pds_posts are not expired.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pds_posts (
  id                        BIGSERIAL    PRIMARY KEY,
  bluesky_uri               TEXT         NOT NULL UNIQUE,
  bluesky_cid               TEXT,
  author_external_user_id   TEXT         NOT NULL,
  author_external_username  TEXT         NOT NULL,
  post_text                 TEXT         NOT NULL DEFAULT '',
  post_facets               JSONB        NOT NULL DEFAULT '[]',
  embedded_images           JSONB        NOT NULL DEFAULT '[]',
  cached_by_user_id         VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
  reason_cached             VARCHAR(100) DEFAULT 'timeline',
  likes_count               INT          NOT NULL DEFAULT 0 CHECK (likes_count >= 0),
  replies_count             INT          NOT NULL DEFAULT 0 CHECK (replies_count >= 0),
  reposts_count             INT          NOT NULL DEFAULT 0 CHECK (reposts_count >= 0),
  expires_at                TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Lookup by author (for ExternalProfileService)
CREATE INDEX IF NOT EXISTS idx_pds_posts_author
  ON pds_posts (author_external_user_id, created_at DESC);

-- Expiry sweep index
CREATE INDEX IF NOT EXISTS idx_pds_posts_expires_at
  ON pds_posts (expires_at);

-- Cache lookup by caching user
CREATE INDEX IF NOT EXISTS idx_pds_posts_cached_by
  ON pds_posts (cached_by_user_id, created_at DESC)
  WHERE cached_by_user_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────────────
-- updated_at trigger for social_posts
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_social_posts_updated_at ON social_posts;
CREATE TRIGGER trg_social_posts_updated_at
  BEFORE UPDATE ON social_posts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

-- ──────────────────────────────────────────────────────────────────────────────
-- DOWN migration (destructive — only run in development, never in production)
-- ──────────────────────────────────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS trg_social_posts_updated_at ON social_posts;
-- DROP TABLE IF EXISTS social_post_likes CASCADE;
-- DROP TABLE IF EXISTS pds_posts CASCADE;
-- DROP TABLE IF EXISTS social_posts CASCADE;
