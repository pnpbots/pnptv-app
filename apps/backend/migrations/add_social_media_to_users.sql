-- Migration: Add social media fields to users table
-- This adds support for storing social media links in user profiles

-- Add social media columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS instagram VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS twitter VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS tiktok VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS youtube VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram VARCHAR(255);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_instagram ON users(instagram);
CREATE INDEX IF NOT EXISTS idx_users_twitter ON users(twitter);
CREATE INDEX IF NOT EXISTS idx_users_tiktok ON users(tiktok);

-- Add comment
COMMENT ON COLUMN users.instagram IS 'Instagram handle (without @)';
COMMENT ON COLUMN users.twitter IS 'Twitter handle (without @)';
COMMENT ON COLUMN users.tiktok IS 'TikTok handle (without @)';
COMMENT ON COLUMN users.youtube IS 'YouTube channel URL or handle';
COMMENT ON COLUMN users.telegram IS 'Telegram username (without @)';
