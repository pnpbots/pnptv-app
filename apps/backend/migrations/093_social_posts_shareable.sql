-- 093: Add is_shareable column to social_posts (default true preserves existing behavior)
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS is_shareable BOOLEAN NOT NULL DEFAULT true;
