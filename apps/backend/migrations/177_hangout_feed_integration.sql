-- Migration 177: Hangout ↔ Social Feed Integration
-- Links social_posts to hangout_groups, adds feed visibility mode per group

-- 1. Add hangout_group_id to social_posts (nullable = global post when NULL)
ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS hangout_group_id INTEGER REFERENCES hangout_groups(id) ON DELETE SET NULL;

-- Index for fetching a hangout's feed efficiently
CREATE INDEX IF NOT EXISTS idx_social_posts_hangout_feed
  ON social_posts (hangout_group_id, id DESC)
  WHERE hangout_group_id IS NOT NULL AND is_deleted = false AND reply_to_id IS NULL;

-- 2. Add feed_visibility to hangout_groups: public | shadow | ghost
--    public = feed visible to everyone, posts appear in global feed
--    shadow = feed only visible to members
--    ghost  = no feed recorded (ephemeral chat only)
ALTER TABLE hangout_groups
  ADD COLUMN IF NOT EXISTS feed_visibility VARCHAR(10) NOT NULL DEFAULT 'public'
  CHECK (feed_visibility IN ('public', 'shadow', 'ghost'));

-- 3. Add source_message_id to social_posts for "drop to feed" traceability
--    Links back to the chat_messages.id that was promoted to a post
ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS source_message_id BIGINT REFERENCES chat_messages(id) ON DELETE SET NULL;

-- Unique constraint: a chat message can only be dropped to feed once
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_posts_source_message
  ON social_posts (source_message_id)
  WHERE source_message_id IS NOT NULL;
