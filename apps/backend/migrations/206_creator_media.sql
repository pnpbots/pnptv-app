-- Migration 206: Creator Album / Media
-- creator_id is VARCHAR(255) to match users.id in this codebase.

CREATE TABLE IF NOT EXISTS creator_media (
  id BIGSERIAL PRIMARY KEY,
  creator_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('photo','video')),
  url TEXT NOT NULL,
  thumb_url TEXT,
  caption TEXT,
  is_premium BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creator_media_creator_sort
  ON creator_media(creator_id, sort_order ASC, created_at DESC);
