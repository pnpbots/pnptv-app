-- Migration 144: Emoji reactions for PRIME content (Directus content items)
--
-- content_id is a Directus integer ID. No FK to a local table because the
-- authoritative record lives in the Directus CMS database, not pnptvbot.
-- UNIQUE(content_id, user_id) enforces one reaction per user per content item,
-- matching the same one-reaction-per-user pattern used by post_reactions.

CREATE TABLE IF NOT EXISTS content_reactions (
  id          SERIAL PRIMARY KEY,
  content_id  INTEGER NOT NULL,
  user_id     VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       VARCHAR(50) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (content_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_content_reactions_content_id ON content_reactions(content_id);
CREATE INDEX IF NOT EXISTS idx_content_reactions_user_id    ON content_reactions(user_id);
