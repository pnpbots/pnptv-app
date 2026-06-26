-- Add view counter to channel_videos (independent of social_posts.view_count
-- which tracks promo-post feed scrolls, not actual video plays).
ALTER TABLE channel_videos ADD COLUMN IF NOT EXISTS view_count INT NOT NULL DEFAULT 0;
