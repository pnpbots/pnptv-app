BEGIN;

CREATE TABLE IF NOT EXISTS creator_channels (
  id              SERIAL PRIMARY KEY,
  creator_id      VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL,
  slug            VARCHAR(100) NOT NULL UNIQUE,
  description     TEXT,
  cover_image_url TEXT,
  tags            TEXT[] DEFAULT '{}',
  is_premium      BOOLEAN NOT NULL DEFAULT false,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  post_count      INT NOT NULL DEFAULT 0,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creator_channels_creator ON creator_channels (creator_id, sort_order) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_creator_channels_slug ON creator_channels (slug);

ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS channel_id INT REFERENCES creator_channels(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_social_posts_channel ON social_posts (channel_id, id DESC) WHERE channel_id IS NOT NULL AND is_deleted = false;

COMMIT;
