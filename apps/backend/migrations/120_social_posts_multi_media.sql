-- Support multiple media files per post (up to 4 images)
-- media_urls stores a JSON array of { url, type, thumbnail_url? } objects
-- Existing media_url/media_type columns are preserved for backward compatibility
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS media_urls JSONB DEFAULT NULL;

-- Example value: [{"url":"/uploads/posts/img-1.webp","type":"image"},{"url":"/uploads/posts/img-2.webp","type":"image"}]
