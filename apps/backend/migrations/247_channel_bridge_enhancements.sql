-- Telegram channel bridge enhancements
-- Adds telegram_message_id to channel_videos for import deduplication.

ALTER TABLE channel_videos
  ADD COLUMN IF NOT EXISTS telegram_message_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_videos_tg_msg
  ON channel_videos(telegram_message_id)
  WHERE telegram_message_id IS NOT NULL;
