-- Migration 102: Add promoted post support for CMS-managed featured content
-- Promoted posts are synced from Directus CMS and pinned at the top of the Social feed

ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS is_promoted BOOLEAN DEFAULT FALSE;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS promoted_link TEXT;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS promoted_link_label TEXT;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS promoted_thumbnail TEXT;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS directus_id INTEGER;

-- Index for quickly finding the latest promoted post for feed pinning
CREATE INDEX IF NOT EXISTS idx_social_posts_promoted ON social_posts(created_at DESC) WHERE is_promoted = TRUE AND is_deleted = FALSE;

-- Ensure one-to-one mapping between Directus items and social_posts
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_posts_directus_id ON social_posts(directus_id) WHERE directus_id IS NOT NULL;

-- System user that owns all promoted posts
INSERT INTO users (id, telegram, username, first_name, subscription_status, tier, role, photo_file_id)
VALUES ('pnptv-official', 0, 'PNPtv', 'PNPtv!', 'active', 'PRIME', 'system', '/Logo2-50.png')
ON CONFLICT (id) DO NOTHING;
