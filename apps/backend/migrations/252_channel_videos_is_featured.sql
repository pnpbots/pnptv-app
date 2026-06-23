-- Migration 252: add is_featured to channel_videos
ALTER TABLE channel_videos
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_channel_videos_featured
  ON channel_videos (channel_id, is_featured)
  WHERE is_featured = true;
