-- 073: Add media attachment support to direct_messages
-- Enables photo/video sharing in 1-to-1 direct messages.
-- Also relaxes the NOT NULL constraint on `content` so media-only DMs
-- (no caption) can be stored without a placeholder empty string.

BEGIN;

-- Allow content to be NULL (media-only DM has no mandatory text)
ALTER TABLE direct_messages
  ALTER COLUMN content DROP NOT NULL;

-- Add media attachment columns mirroring chat_messages
ALTER TABLE direct_messages
  ADD COLUMN IF NOT EXISTS media_url       TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS media_type      VARCHAR(10) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS media_mime      VARCHAR(80) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS media_thumb_url TEXT        DEFAULT NULL;

-- Constraint: a message must have at least content OR a media attachment
ALTER TABLE direct_messages
  ADD CONSTRAINT dm_content_or_media
    CHECK (content IS NOT NULL OR media_url IS NOT NULL);

-- Index for fetching media messages in a conversation (e.g. photo gallery)
CREATE INDEX IF NOT EXISTS idx_dm_media
  ON direct_messages (sender_id, recipient_id, created_at DESC)
  WHERE media_url IS NOT NULL AND is_deleted = false;

COMMIT;
