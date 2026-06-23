-- Migration 267: Add mention_type to post_mentions for performer tagging
-- Distinguishes text @mentions ('mention') from explicit performer tags ('tag')

ALTER TABLE post_mentions ADD COLUMN IF NOT EXISTS mention_type VARCHAR(10) NOT NULL DEFAULT 'mention';

-- Replace the old unique constraint so a user can be both @mentioned AND tagged in the same post
ALTER TABLE post_mentions DROP CONSTRAINT IF EXISTS post_mentions_post_id_mentioned_user_id_key;
ALTER TABLE post_mentions ADD CONSTRAINT IF NOT EXISTS post_mentions_post_id_mentioned_user_id_mention_type_key
  UNIQUE (post_id, mentioned_user_id, mention_type);

-- Index for efficient tag lookups on post detail / feed enrichment
CREATE INDEX IF NOT EXISTS idx_post_mentions_tags ON post_mentions (post_id, mention_type)
  WHERE mention_type = 'tag';
