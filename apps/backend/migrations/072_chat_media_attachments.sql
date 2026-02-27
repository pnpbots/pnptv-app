-- 072: Add media attachment support to chat_messages
-- Enables photo/video sharing in community chat and hangout group chat.
-- media_url       : public URL to the uploaded file (image or video)
-- media_type      : 'image' | 'video'
-- media_mime      : original mime type e.g. 'image/jpeg', 'video/mp4'
-- media_thumb_url : URL to auto-generated thumbnail (videos get a poster frame; images get a 400px thumb)
-- media_width     : width in pixels (images only, null for video)
-- media_height    : height in pixels (images only, null for video)

BEGIN;

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS media_url       TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS media_type      VARCHAR(10) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS media_mime      VARCHAR(80) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS media_thumb_url TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS media_width     INTEGER     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS media_height    INTEGER     DEFAULT NULL;

-- Index to quickly fetch media-only messages per room (e.g. photo gallery view)
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_media
  ON chat_messages (room, created_at DESC)
  WHERE media_url IS NOT NULL AND is_deleted = false;

COMMIT;
