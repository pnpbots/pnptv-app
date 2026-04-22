-- 222_social_likes_count_trigger.sql
-- Fix likes_count drift caused by FK cascade from user deletion.
--
-- Root cause: social_post_likes has ON DELETE CASCADE for user_id. When a user
-- is deleted, their like rows are removed — but social_posts.likes_count is
-- not decremented, causing stored count > actual row count.
--
-- Fix: maintain likes_count via a database trigger so cascades can't escape.
-- The application-level toggleLike is simplified to let the trigger own counts.
--
-- One-time reconciliation of all existing drifted rows included at end.

BEGIN;

CREATE OR REPLACE FUNCTION social_post_likes_maintain_count()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE social_posts
       SET likes_count = likes_count + 1
     WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE social_posts
       SET likes_count = GREATEST(0, likes_count - 1)
     WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_social_post_likes_count ON social_post_likes;

CREATE TRIGGER trg_social_post_likes_count
AFTER INSERT OR DELETE ON social_post_likes
FOR EACH ROW EXECUTE FUNCTION social_post_likes_maintain_count();

-- One-time reconciliation: sync likes_count to actual row count
UPDATE social_posts sp
   SET likes_count = COALESCE(c.cnt, 0)
  FROM (
    SELECT post_id, COUNT(*)::int AS cnt
      FROM social_post_likes
     GROUP BY post_id
  ) c
 WHERE sp.id = c.post_id
   AND sp.likes_count != c.cnt;

-- Also zero out any posts that have likes_count > 0 but no like rows
UPDATE social_posts sp
   SET likes_count = 0
 WHERE sp.likes_count > 0
   AND NOT EXISTS (SELECT 1 FROM social_post_likes l WHERE l.post_id = sp.id);

COMMIT;
