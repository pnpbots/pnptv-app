-- Migration 083: Backfill Wall of Fame data from hangout chat to social_posts
-- Date: 2026-02-28
-- Purpose: Copy WoF media messages from chat_messages into social_posts
--          and grant implicit consent to users who already have WoF posts.
-- Idempotent: only runs if no is_wof posts exist yet.

BEGIN;

DO $$
DECLARE
  wof_group_id INT;
  existing_count INT;
BEGIN
  -- Check idempotency: skip if WoF posts already exist
  SELECT COUNT(*) INTO existing_count FROM social_posts WHERE is_wof = TRUE;
  IF existing_count > 0 THEN
    RAISE NOTICE 'WoF backfill already applied (% rows), skipping.', existing_count;
    RETURN;
  END IF;

  -- Find the WoF hangout group
  SELECT id INTO wof_group_id FROM hangout_groups WHERE is_wall_of_fame = TRUE LIMIT 1;
  IF wof_group_id IS NULL THEN
    RAISE NOTICE 'No WoF hangout group found, skipping backfill.';
    RETURN;
  END IF;

  -- Copy media messages from the WoF hangout group into social_posts
  INSERT INTO social_posts (user_id, content, media_url, media_type, is_wof, created_at, updated_at)
  SELECT
    cm.user_id,
    COALESCE(cm.content, ''),
    cm.media_url,
    cm.media_type,
    TRUE,
    cm.created_at,
    cm.created_at
  FROM chat_messages cm
  WHERE cm.room = 'hangout:' || wof_group_id
    AND cm.media_url IS NOT NULL
    AND cm.user_id IS NOT NULL;

  GET DIAGNOSTICS existing_count = ROW_COUNT;
  RAISE NOTICE 'Backfilled % WoF posts into social_posts.', existing_count;

  -- Grant implicit consent to users who already have WoF posts
  UPDATE users
  SET wof_photo_consent = TRUE
  WHERE id IN (
    SELECT DISTINCT user_id FROM social_posts WHERE is_wof = TRUE
  );
END;
$$;

COMMIT;
