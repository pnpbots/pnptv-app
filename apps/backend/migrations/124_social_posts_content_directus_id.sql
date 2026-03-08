-- Migration 124: Link social posts to Directus content items
ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS content_directus_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_social_posts_content_directus_id
  ON social_posts (content_directus_id) WHERE content_directus_id IS NOT NULL;
