-- 071: Realign social_posts indexes for ID-based cursor pagination
-- Feed/wall/replies queries now ORDER BY id (not created_at) after cursor bug fix

BEGIN;

-- Feed: ORDER BY id DESC WHERE is_deleted=false AND reply_to_id IS NULL
DROP INDEX IF EXISTS idx_social_posts_feed;
CREATE INDEX idx_social_posts_feed ON social_posts (id DESC)
  WHERE is_deleted = false AND reply_to_id IS NULL;

-- User wall: ORDER BY id DESC per user
DROP INDEX IF EXISTS idx_social_posts_user;
CREATE INDEX idx_social_posts_user ON social_posts (user_id, id DESC)
  WHERE is_deleted = false;

-- Replies: ORDER BY id ASC per parent post
DROP INDEX IF EXISTS idx_social_posts_replies;
CREATE INDEX idx_social_posts_replies ON social_posts (reply_to_id, id ASC)
  WHERE is_deleted = false;

COMMIT;
