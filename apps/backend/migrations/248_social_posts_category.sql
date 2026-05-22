-- Migration 248: Add category column to social_posts for smart feed diversification
ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS category VARCHAR(30) DEFAULT 'social'
    CHECK (category IN ('fun', 'wellness', 'adult', 'community', 'social', 'media'));

-- Backfill wellness posts by keyword
UPDATE social_posts SET category = 'wellness'
WHERE category = 'social' AND is_deleted = false AND (
  content ILIKE '%harm reduction%' OR content ILIKE '%naloxone%' OR content ILIKE '%narcan%'
  OR content ILIKE '%recovery%' OR content ILIKE '% sober%' OR content ILIKE '%clean time%'
  OR content ILIKE '%mental health%' OR content ILIKE '%reducción de daños%'
  OR content ILIKE '%bienestar%' OR content ILIKE '%salud%'
);

-- Backfill media posts
UPDATE social_posts SET category = 'media'
WHERE category = 'social' AND is_deleted = false AND (
  media_type ILIKE 'video%' OR video_title IS NOT NULL
);

-- Backfill community posts
UPDATE social_posts SET category = 'community'
WHERE category = 'social' AND is_deleted = false AND (
  content ILIKE '%announcement%' OR content ILIKE '%join us%'
  OR content ILIKE '%evento%' OR content ILIKE '%bienvenid%'
);

-- Backfill fun posts
UPDATE social_posts SET category = 'fun'
WHERE category = 'social' AND is_deleted = false AND (
  content ILIKE '%party%' OR content ILIKE '%fiesta%' OR content ILIKE '%hookup%'
  OR (content ILIKE '%pnp%' AND content ILIKE '%play%')
);

CREATE INDEX IF NOT EXISTS idx_social_posts_category ON social_posts(category) WHERE is_deleted = false;
