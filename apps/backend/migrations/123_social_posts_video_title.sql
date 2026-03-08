-- Migration 123: Add video title and description to social_posts
ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS video_title       VARCHAR(150),
  ADD COLUMN IF NOT EXISTS video_description TEXT;
