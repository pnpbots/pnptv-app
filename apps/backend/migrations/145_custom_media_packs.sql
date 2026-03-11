-- Migration 145: Custom stickers, emojis, and GIFs infrastructure

CREATE TABLE IF NOT EXISTS custom_media_packs (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  pack_type VARCHAR(20) NOT NULL CHECK (pack_type IN ('sticker', 'emoji', 'gif')),
  cover_url VARCHAR(1000),
  is_active BOOLEAN DEFAULT true,
  is_premium BOOLEAN DEFAULT false,
  created_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS custom_media_items (
  id SERIAL PRIMARY KEY,
  pack_id INTEGER NOT NULL REFERENCES custom_media_packs(id) ON DELETE CASCADE,
  slug VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  alt_text VARCHAR(255),
  file_url VARCHAR(1000) NOT NULL,
  thumbnail_url VARCHAR(1000),
  file_type VARCHAR(20) NOT NULL CHECK (file_type IN ('webp', 'gif', 'lottie', 'png')),
  file_size_bytes INTEGER,
  width_px INTEGER,
  height_px INTEGER,
  tags TEXT[] DEFAULT '{}',
  sort_order INTEGER DEFAULT 0,
  use_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pack_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_custom_media_items_pack ON custom_media_items(pack_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_custom_media_items_tags ON custom_media_items USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_custom_media_packs_type ON custom_media_packs(pack_type) WHERE is_active = true;

-- User favorites / recently used
CREATE TABLE IF NOT EXISTS user_media_favorites (
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES custom_media_items(id) ON DELETE CASCADE,
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  use_count INTEGER DEFAULT 1,
  PRIMARY KEY(user_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_media_favorites_user ON user_media_favorites(user_id, last_used_at DESC);
