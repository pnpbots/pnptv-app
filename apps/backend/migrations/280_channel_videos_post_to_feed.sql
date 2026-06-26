-- Migration 280: add post_to_feed to channel_videos
-- Creator-controlled toggle for the promo post on the public social feed
-- AND the broadcast (Telegram DM / push / email) to channel followers.
-- Default TRUE preserves prior behavior for in-flight uploads.
ALTER TABLE channel_videos
  ADD COLUMN IF NOT EXISTS post_to_feed BOOLEAN NOT NULL DEFAULT true;
