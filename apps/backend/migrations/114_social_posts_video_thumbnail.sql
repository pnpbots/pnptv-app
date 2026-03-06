-- 114: Add video_thumbnail_url to social_posts
-- Required by SocialPostService.createPost() which INSERTs and SELECTs this column.
-- Without it, every video post creation fails with a 500 error.

ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS video_thumbnail_url TEXT;
