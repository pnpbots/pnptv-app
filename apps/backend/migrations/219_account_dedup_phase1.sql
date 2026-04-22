-- =============================================================================
-- Migration 219: Account Deduplication Phase 1 — SAFE SETUP
-- Created: 2026-04-22
-- Purpose: Install the tooling + clean up system accounts + flag categories.
--          Per-user merges (Cat A) and renames (Cat B) are intentionally NOT
--          run here — they are executed in small, isolated transactions via
--          accountMergeService.js from the admin UI, so they don't lock prod
--          tables while live traffic is flowing.
--
-- WHAT THIS MIGRATION DOES:
--   1. Create helper function pnptv_transfer_user_fks(src, dst)
--   2. Create partial unique index on LOWER(email) to prevent future dupes
--   3. Flag Category C (PRIME no-TG) with merge_notes for outreach
--   4. Flag Category C2 (free no-TG) with merge_notes for delayed deletion
--   5. Soft-delete akadmin (Authentik system account; superadmin is SantinoFurioso)
--   6. Delete meru-test-user-uuid (test fixture)
--
-- WHAT THIS MIGRATION DOES NOT DO:
--   - Merge Category A pairs (5 users) — run from /admin/duplicate-accounts
--   - Rename Category B pairs (348 users) — same, or via batch script
--     apps/backend/scripts/run_dedup_batch.js after review.
--
-- PRE-REQUISITES (already present from migration 127):
--   users.is_deleted / deleted_at / merge_winner_id / merge_notes
--   table user_merge_log
--   trigger protect_users_lifetime_fields     (honors pnptv.superadmin_bypass)
--   trigger protect_lifetime_entitlements     (honors pnptv.superadmin_bypass)
--
-- BACKUP BEFORE APPLY:
--   docker exec pg-pnptv pg_dump -U pnptvbot -d pnptvbot -t users \
--     -t user_entitlements -t payments -t user_merge_log \
--     > /opt/pnptv_backups/pre_219_$(date +%Y%m%d_%H%M%S).sql
-- =============================================================================


-- =============================================================================
-- STEP 1: Create the reusable FK-transfer helper function
-- =============================================================================
-- pnptv_transfer_user_fks(src_id, dst_id) re-points every FK-bearing
-- user-reference column from src_id to dst_id. For tables with composite
-- unique constraints containing a user-ref column, rows owned by src that
-- would collide with rows owned by dst are deleted FIRST (src loses).
-- Returns a JSONB object mapping "table.column" → row-count transferred.
-- Requires pnptv.superadmin_bypass to be set by the caller transaction.

CREATE OR REPLACE FUNCTION pnptv_transfer_user_fks(
  p_src_id TEXT,
  p_dst_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
AS $fn$
DECLARE
  fk_rec    RECORD;
  result    JSONB := '{}'::jsonb;
  rc        BIGINT;
  dyn_sql   TEXT;
BEGIN
  IF p_src_id = p_dst_id THEN
    RAISE EXCEPTION 'transfer_user_fks: source equals destination (%)', p_src_id;
  END IF;

  -- --------------------------------------------------------------
  -- COLLISION PRE-RESOLUTION
  -- For each table with a unique constraint that contains a user-ref
  -- column, delete src's rows that would collide with dst's rows.
  -- Pattern: DELETE FROM t WHERE user_col = src AND (other_cols) IN
  --          (SELECT other_cols FROM t WHERE user_col = dst).
  -- --------------------------------------------------------------

  -- user_follows (PK: follower_id, following_id) — both directions
  DELETE FROM user_follows
   WHERE follower_id = p_src_id
     AND following_id IN (SELECT following_id FROM user_follows WHERE follower_id = p_dst_id);
  DELETE FROM user_follows
   WHERE following_id = p_src_id
     AND follower_id IN (SELECT follower_id FROM user_follows WHERE following_id = p_dst_id);

  -- social_post_likes (PK: post_id, user_id)
  DELETE FROM social_post_likes
   WHERE user_id = p_src_id
     AND post_id IN (SELECT post_id FROM social_post_likes WHERE user_id = p_dst_id);

  -- post_reactions (U: post_id, user_id)
  DELETE FROM post_reactions
   WHERE user_id = p_src_id
     AND post_id IN (SELECT post_id FROM post_reactions WHERE user_id = p_dst_id);

  -- content_reactions (U: content_id, user_id)
  DELETE FROM content_reactions
   WHERE user_id = p_src_id
     AND content_id IN (SELECT content_id FROM content_reactions WHERE user_id = p_dst_id);

  -- dm_reactions (U: message_id, user_id)
  DELETE FROM dm_reactions
   WHERE user_id = p_src_id
     AND message_id IN (SELECT message_id FROM dm_reactions WHERE user_id = p_dst_id);

  -- chat_message_reactions (U: message_id, user_id, emoji)
  DELETE FROM chat_message_reactions
   WHERE user_id = p_src_id
     AND (message_id, emoji) IN (SELECT message_id, emoji FROM chat_message_reactions WHERE user_id = p_dst_id);

  -- user_token_wallets (U: user_id) — single-row-per-user; absorb src's balance into dst, then drop src
  UPDATE user_token_wallets d
     SET balance_tokens = COALESCE(d.balance_tokens, 0) + COALESCE(s.balance_tokens, 0),
         updated_at = NOW()
    FROM (SELECT balance_tokens FROM user_token_wallets WHERE user_id = p_src_id) s
   WHERE d.user_id = p_dst_id;
  DELETE FROM user_token_wallets WHERE user_id = p_src_id
    AND EXISTS (SELECT 1 FROM user_token_wallets WHERE user_id = p_dst_id);

  -- user_entitlements (U: user_id, add_on_id, creator_id NULLS NOT DISTINCT)
  -- Prefer dst's row; delete src's duplicate tuple.
  DELETE FROM user_entitlements
   WHERE user_id = p_src_id
     AND (add_on_id, COALESCE(creator_id, '__null__')) IN (
           SELECT add_on_id, COALESCE(creator_id, '__null__')
             FROM user_entitlements WHERE user_id = p_dst_id
         );

  -- gamification (U: user_id)
  UPDATE gamification d
     SET points = COALESCE(d.points, 0) + COALESCE(s.points, 0),
         level = GREATEST(COALESCE(d.level, 1), COALESCE(s.level, 1)),
         total_calls = COALESCE(d.total_calls, 0) + COALESCE(s.total_calls, 0),
         total_messages = COALESCE(d.total_messages, 0) + COALESCE(s.total_messages, 0),
         referrals_count = COALESCE(d.referrals_count, 0) + COALESCE(s.referrals_count, 0),
         updated_at = NOW()
    FROM (SELECT points, level, total_calls, total_messages, referrals_count
            FROM gamification WHERE user_id = p_src_id) s
   WHERE d.user_id = p_dst_id;
  DELETE FROM gamification WHERE user_id = p_src_id
    AND EXISTS (SELECT 1 FROM gamification WHERE user_id = p_dst_id);

  -- user_locations (U: user_id) — keep dst's, drop src's
  DELETE FROM user_locations WHERE user_id = p_src_id
    AND EXISTS (SELECT 1 FROM user_locations WHERE user_id = p_dst_id);

  -- user_roles (PK: user_id) — merge by discarding src's duplicate
  DELETE FROM user_roles WHERE user_id = p_src_id
    AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = p_dst_id);

  -- user_broadcast_preferences (U: user_id)
  DELETE FROM user_broadcast_preferences WHERE user_id = p_src_id
    AND EXISTS (SELECT 1 FROM user_broadcast_preferences WHERE user_id = p_dst_id);

  -- creator_enrollments (U: user_id)
  DELETE FROM creator_enrollments WHERE user_id = p_src_id
    AND EXISTS (SELECT 1 FROM creator_enrollments WHERE user_id = p_dst_id);

  -- streamer_settings (PK: user_id) — FK is on pnptv_id, not id. Skip safely.

  -- player_states (U: user_id)
  DELETE FROM player_states WHERE user_id = p_src_id
    AND EXISTS (SELECT 1 FROM player_states WHERE user_id = p_dst_id);

  -- stream_auto_messages (U: user_id)
  DELETE FROM stream_auto_messages WHERE user_id = p_src_id
    AND EXISTS (SELECT 1 FROM stream_auto_messages WHERE user_id = p_dst_id);

  -- support_topics (PK: user_id)
  DELETE FROM support_topics WHERE user_id = p_src_id
    AND EXISTS (SELECT 1 FROM support_topics WHERE user_id = p_dst_id);

  -- radio_subscribers (PK: user_id)
  DELETE FROM radio_subscribers WHERE user_id = p_src_id
    AND EXISTS (SELECT 1 FROM radio_subscribers WHERE user_id = p_dst_id);

  -- hangout_group_members (PK: group_id, user_id)
  DELETE FROM hangout_group_members WHERE user_id = p_src_id
    AND group_id IN (SELECT group_id FROM hangout_group_members WHERE user_id = p_dst_id);

  -- hangout_join_requests (U: group_id, user_id)
  DELETE FROM hangout_join_requests WHERE user_id = p_src_id
    AND group_id IN (SELECT group_id FROM hangout_join_requests WHERE user_id = p_dst_id);

  -- hangout_call_participants (U: call_id, user_id)
  DELETE FROM hangout_call_participants WHERE user_id = p_src_id
    AND call_id IN (SELECT call_id FROM hangout_call_participants WHERE user_id = p_dst_id);

  -- channel_subscribers (PK: channel_id, user_id)
  DELETE FROM channel_subscribers WHERE user_id = p_src_id
    AND channel_id IN (SELECT channel_id FROM channel_subscribers WHERE user_id = p_dst_id);

  -- event_rsvps (PK: event_id, user_id)
  DELETE FROM event_rsvps WHERE user_id = p_src_id
    AND event_id IN (SELECT event_id FROM event_rsvps WHERE user_id = p_dst_id);

  -- creator_subscriptions (U: creator_id, subscriber_id) — transfer both sides
  DELETE FROM creator_subscriptions WHERE subscriber_id = p_src_id
    AND creator_id IN (SELECT creator_id FROM creator_subscriptions WHERE subscriber_id = p_dst_id);
  DELETE FROM creator_subscriptions WHERE creator_id = p_src_id
    AND subscriber_id IN (SELECT subscriber_id FROM creator_subscriptions WHERE creator_id = p_dst_id);

  -- creator_milestone_notifications (U: user_id, milestone_type, status)
  DELETE FROM creator_milestone_notifications WHERE user_id = p_src_id
    AND (milestone_type, status) IN (SELECT milestone_type, status FROM creator_milestone_notifications WHERE user_id = p_dst_id);

  -- creator_availability_schedules (U: creator_id, day_of_week, start_time)
  DELETE FROM creator_availability_schedules WHERE creator_id = p_src_id
    AND (day_of_week, start_time) IN (SELECT day_of_week, start_time FROM creator_availability_schedules WHERE creator_id = p_dst_id);

  -- blocked_users (U: user_id, blocked_user_id) — both roles
  DELETE FROM blocked_users WHERE user_id = p_src_id
    AND blocked_user_id IN (SELECT blocked_user_id FROM blocked_users WHERE user_id = p_dst_id);
  DELETE FROM blocked_users WHERE blocked_user_id = p_src_id
    AND user_id IN (SELECT user_id FROM blocked_users WHERE blocked_user_id = p_dst_id);

  -- banned_users (U: user_id, group_id)
  DELETE FROM banned_users WHERE user_id = p_src_id
    AND group_id IN (SELECT group_id FROM banned_users WHERE user_id = p_dst_id);

  -- ab_test_assignments (U: ab_test_id, user_id)
  DELETE FROM ab_test_assignments WHERE user_id = p_src_id
    AND ab_test_id IN (SELECT ab_test_id FROM ab_test_assignments WHERE user_id = p_dst_id);

  -- broadcast_engagement (U: broadcast_id, user_id)
  DELETE FROM broadcast_engagement WHERE user_id = p_src_id
    AND broadcast_id IN (SELECT broadcast_id FROM broadcast_engagement WHERE user_id = p_dst_id);

  -- broadcast_recipients (U: broadcast_id, user_id)
  DELETE FROM broadcast_recipients WHERE user_id = p_src_id
    AND broadcast_id IN (SELECT broadcast_id FROM broadcast_recipients WHERE user_id = p_dst_id);

  -- card_tokens (U: user_id, token)
  DELETE FROM card_tokens WHERE user_id = p_src_id
    AND token IN (SELECT token FROM card_tokens WHERE user_id = p_dst_id);

  -- cult_event_registrations (U: user_id, event_type, month_key)
  DELETE FROM cult_event_registrations WHERE user_id = p_src_id
    AND (event_type, month_key) IN (SELECT event_type, month_key FROM cult_event_registrations WHERE user_id = p_dst_id);

  -- custom_emotes (U: user_id, name)
  DELETE FROM custom_emotes WHERE user_id = p_src_id
    AND name IN (SELECT name FROM custom_emotes WHERE user_id = p_dst_id);

  -- jitsi_user_usage (U: user_id, date, tier)
  DELETE FROM jitsi_user_usage WHERE user_id = p_src_id
    AND (date, tier) IN (SELECT date, tier FROM jitsi_user_usage WHERE user_id = p_dst_id);

  -- live_rules_acknowledgments (U: user_id, version)
  DELETE FROM live_rules_acknowledgments WHERE user_id = p_src_id
    AND version IN (SELECT version FROM live_rules_acknowledgments WHERE user_id = p_dst_id);

  -- live_show_tickets (U: slot_id, user_id)
  DELETE FROM live_show_tickets WHERE user_id = p_src_id
    AND slot_id IN (SELECT slot_id FROM live_show_tickets WHERE user_id = p_dst_id);

  -- media_favorites (U: user_id, media_id)
  DELETE FROM media_favorites WHERE user_id = p_src_id
    AND media_id IN (SELECT media_id FROM media_favorites WHERE user_id = p_dst_id);

  -- media_playlists (U: owner_id, name)
  DELETE FROM media_playlists WHERE owner_id = p_src_id
    AND name IN (SELECT name FROM media_playlists WHERE owner_id = p_dst_id);

  -- media_ratings (U: user_id, media_id)
  DELETE FROM media_ratings WHERE user_id = p_src_id
    AND media_id IN (SELECT media_id FROM media_ratings WHERE user_id = p_dst_id);

  -- nearby_place_favorites (U: user_id, place_id)
  DELETE FROM nearby_place_favorites WHERE user_id = p_src_id
    AND place_id IN (SELECT place_id FROM nearby_place_favorites WHERE user_id = p_dst_id);

  -- place_reports (U: user_id, place_id) — user_id is BIGINT; guard for numeric src/dst
  IF p_src_id ~ '^[0-9]+$' AND p_dst_id ~ '^[0-9]+$' THEN
    DELETE FROM place_reports WHERE user_id = p_src_id::bigint
      AND place_id IN (SELECT place_id FROM place_reports WHERE user_id = p_dst_id::bigint);
  END IF;

  -- profile_compliance (U: user_id, group_id)
  DELETE FROM profile_compliance WHERE user_id = p_src_id
    AND group_id IN (SELECT group_id FROM profile_compliance WHERE user_id = p_dst_id);

  -- promo_redemptions (U: promo_id, user_id)
  DELETE FROM promo_redemptions WHERE user_id = p_src_id
    AND promo_id IN (SELECT promo_id FROM promo_redemptions WHERE user_id = p_dst_id);

  -- push_subscriptions (U: user_id, endpoint)
  DELETE FROM push_subscriptions WHERE user_id = p_src_id
    AND endpoint IN (SELECT endpoint FROM push_subscriptions WHERE user_id = p_dst_id);

  -- segment_membership (U: segment_id, user_id)
  DELETE FROM segment_membership WHERE user_id = p_src_id
    AND segment_id IN (SELECT segment_id FROM segment_membership WHERE user_id = p_dst_id);

  -- stream_notifications (U: user_id, streamer_id) — both roles
  DELETE FROM stream_notifications WHERE user_id = p_src_id
    AND streamer_id IN (SELECT streamer_id FROM stream_notifications WHERE user_id = p_dst_id);
  DELETE FROM stream_notifications WHERE streamer_id = p_src_id
    AND user_id IN (SELECT user_id FROM stream_notifications WHERE streamer_id = p_dst_id);

  -- topic_analytics (U: topic_id, user_id) — user_id is BIGINT; guard for numeric src/dst
  IF p_src_id ~ '^[0-9]+$' AND p_dst_id ~ '^[0-9]+$' THEN
    DELETE FROM topic_analytics WHERE user_id = p_src_id::bigint
      AND topic_id IN (SELECT topic_id FROM topic_analytics WHERE user_id = p_dst_id::bigint);
  END IF;

  -- user_badges (U: user_id, badge_id)
  DELETE FROM user_badges WHERE user_id = p_src_id
    AND badge_id IN (SELECT badge_id FROM user_badges WHERE user_id = p_dst_id);

  -- user_media_favorites (PK: user_id, item_id)
  DELETE FROM user_media_favorites WHERE user_id = p_src_id
    AND item_id IN (SELECT item_id FROM user_media_favorites WHERE user_id = p_dst_id);

  -- user_notifications (U: user_id, model_id, notification_type)
  DELETE FROM user_notifications WHERE user_id = p_src_id
    AND (model_id, notification_type) IN (SELECT model_id, notification_type FROM user_notifications WHERE user_id = p_dst_id);

  -- user_place_favorites (PK: user_id, place_id) — user_id is BIGINT; guard for numeric src/dst
  IF p_src_id ~ '^[0-9]+$' AND p_dst_id ~ '^[0-9]+$' THEN
    DELETE FROM user_place_favorites WHERE user_id = p_src_id::bigint
      AND place_id IN (SELECT place_id FROM user_place_favorites WHERE user_id = p_dst_id::bigint);
  END IF;

  -- wall_of_fame_daily_stats (PK: date_key, user_id)
  DELETE FROM wall_of_fame_daily_stats WHERE user_id = p_src_id
    AND date_key IN (SELECT date_key FROM wall_of_fame_daily_stats WHERE user_id = p_dst_id);

  -- webinar_registrations (U: webinar_id, user_id)
  DELETE FROM webinar_registrations WHERE user_id = p_src_id
    AND webinar_id IN (SELECT webinar_id FROM webinar_registrations WHERE user_id = p_dst_id);

  -- dm_thread_state (PK: user_id, partner_id) — four cases by role
  DELETE FROM dm_thread_state WHERE user_id = p_src_id
    AND partner_id IN (SELECT partner_id FROM dm_thread_state WHERE user_id = p_dst_id);
  DELETE FROM dm_thread_state WHERE partner_id = p_src_id
    AND user_id IN (SELECT user_id FROM dm_thread_state WHERE partner_id = p_dst_id);

  -- dm_threads (PK: user_a, user_b; CHECK user_a < user_b) — handled specially below
  -- dm_matrix_rooms (U: user_a, user_b) — handled with dm_threads below

  -- bot_addition_attempts, age_verification_attempts, user_warnings, etc. — no unique ci on user_id; plain update below.

  -- --------------------------------------------------------------
  -- PLAIN UPDATE PASS
  -- For every FK referencing users(id), UPDATE src → dst.
  -- After the collision pre-resolution above, these should succeed cleanly.
  -- --------------------------------------------------------------
  FOR fk_rec IN
    SELECT tc.table_name, kcu.column_name
      FROM information_schema.referential_constraints rc
      JOIN information_schema.table_constraints tc  ON tc.constraint_name = rc.constraint_name
      JOIN information_schema.key_column_usage kcu  ON kcu.constraint_name = rc.constraint_name
     WHERE rc.unique_constraint_name IN (
             SELECT constraint_name FROM information_schema.table_constraints
              WHERE table_name = 'users' AND constraint_type = 'PRIMARY KEY'
           )
       AND tc.table_schema = 'public'
       -- Skip tables with ordering/check constraints that need atomic two-column updates
       AND tc.table_name NOT IN ('dm_threads', 'dm_matrix_rooms')
  LOOP
    dyn_sql := format(
      'UPDATE %I SET %I = $1::varchar WHERE %I = $2::varchar',
      fk_rec.table_name, fk_rec.column_name, fk_rec.column_name
    );
    BEGIN
      EXECUTE dyn_sql USING p_dst_id, p_src_id;
      GET DIAGNOSTICS rc = ROW_COUNT;
      IF rc > 0 THEN
        result := result || jsonb_build_object(
          fk_rec.table_name || '.' || fk_rec.column_name, rc
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'transfer failure: table=%.% err=%',
        fk_rec.table_name, fk_rec.column_name, SQLERRM;
      RAISE;
    END;
  END LOOP;

  -- --------------------------------------------------------------
  -- SPECIAL HANDLING: dm_threads (CHECK user_a < user_b)
  -- Rebuild rows so that (user_a, user_b) stays ordered after the rename.
  -- --------------------------------------------------------------

  -- Drop src rows that would collide with existing dst rows (same partner pair)
  DELETE FROM dm_threads d1
   USING dm_threads d2
   WHERE d2.user_a = p_dst_id AND d1.user_b = d2.user_b AND d1.user_a = p_src_id;
  DELETE FROM dm_threads d1
   USING dm_threads d2
   WHERE d2.user_b = p_dst_id AND d1.user_a = d2.user_a AND d1.user_b = p_src_id;
  DELETE FROM dm_threads d1
   USING dm_threads d2
   WHERE d2.user_a = p_dst_id AND d1.user_a = d2.user_b AND d1.user_b = p_src_id;
  DELETE FROM dm_threads d1
   USING dm_threads d2
   WHERE d2.user_b = p_dst_id AND d1.user_b = d2.user_a AND d1.user_a = p_src_id;
  -- Degenerate self-loop: src talking to dst (same person post-merge) — drop
  DELETE FROM dm_threads
   WHERE (user_a = p_src_id AND user_b = p_dst_id)
      OR (user_a = p_dst_id AND user_b = p_src_id);

  -- Rewrite remaining src rows with canonical ordering
  FOR fk_rec IN SELECT user_a, user_b, last_message, last_message_at, unread_for_a, unread_for_b
                  FROM dm_threads WHERE user_a = p_src_id OR user_b = p_src_id
  LOOP
    DELETE FROM dm_threads WHERE user_a = fk_rec.user_a AND user_b = fk_rec.user_b;
    IF fk_rec.user_a = p_src_id THEN
      -- user_a becomes dst
      IF p_dst_id < fk_rec.user_b THEN
        INSERT INTO dm_threads VALUES (p_dst_id, fk_rec.user_b, fk_rec.last_message, fk_rec.last_message_at, fk_rec.unread_for_a, fk_rec.unread_for_b)
          ON CONFLICT DO NOTHING;
      ELSE
        -- swap: dst goes to user_b slot
        INSERT INTO dm_threads VALUES (fk_rec.user_b, p_dst_id, fk_rec.last_message, fk_rec.last_message_at, fk_rec.unread_for_b, fk_rec.unread_for_a)
          ON CONFLICT DO NOTHING;
      END IF;
    ELSE
      -- user_b becomes dst
      IF fk_rec.user_a < p_dst_id THEN
        INSERT INTO dm_threads VALUES (fk_rec.user_a, p_dst_id, fk_rec.last_message, fk_rec.last_message_at, fk_rec.unread_for_a, fk_rec.unread_for_b)
          ON CONFLICT DO NOTHING;
      ELSE
        INSERT INTO dm_threads VALUES (p_dst_id, fk_rec.user_a, fk_rec.last_message, fk_rec.last_message_at, fk_rec.unread_for_b, fk_rec.unread_for_a)
          ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END LOOP;

  -- dm_matrix_rooms has no CHECK (confirmed); simple UPDATE is safe
  UPDATE dm_matrix_rooms SET user_a = p_dst_id WHERE user_a = p_src_id
    AND NOT EXISTS (SELECT 1 FROM dm_matrix_rooms WHERE user_a = p_dst_id AND user_b = dm_matrix_rooms.user_b);
  UPDATE dm_matrix_rooms SET user_b = p_dst_id WHERE user_b = p_src_id
    AND NOT EXISTS (SELECT 1 FROM dm_matrix_rooms WHERE user_b = p_dst_id AND user_a = dm_matrix_rooms.user_a);
  DELETE FROM dm_matrix_rooms WHERE user_a = p_src_id OR user_b = p_src_id;

  RETURN result;
END;
$fn$;

COMMENT ON FUNCTION pnptv_transfer_user_fks IS
  'Re-points every FK referencing users(id) from src to dst, deleting src''s rows that would collide on unique constraints. Caller must SET LOCAL pnptv.superadmin_bypass = ''true'' to satisfy the protect_* triggers.';


-- =============================================================================
-- STEP 2: Enforce future uniqueness — case-insensitive email
-- =============================================================================
-- Allows NULL or empty email (Telegram-only users), but prevents two active
-- accounts from sharing an email going forward.

CREATE UNIQUE INDEX IF NOT EXISTS users_email_ci_uidx
  ON users (LOWER(email))
  WHERE email IS NOT NULL AND email <> '' AND COALESCE(is_deleted, false) = false;


-- =============================================================================
-- STEP 3: FLAG / CLEANUP phase — runs in a single transaction
-- =============================================================================
BEGIN;
SET LOCAL pnptv.superadmin_bypass = 'true';
SET LOCAL lock_timeout = '10s';

-- NOTE: Category A merges (5 pairs) and Category B renames (~348 pairs) are
-- NOT performed in this migration. They run as separate per-pair transactions
-- via accountMergeService.mergeUserAccounts / renameToTelegramId from the
-- /admin/duplicate-accounts UI (or the batch script).
-- This keeps table locks short and avoids blocking live app traffic.
-- (The full Cat A/B SQL used to live here — see git history for the inline version.)

-- ================ BEGIN REMOVED CAT A/B BLOCKS ================
/* preserved for reference; do not execute from the migration
DO $merge_A$
DECLARE
  pair       RECORD;
  transferred JSONB;
  merged_count INT := 0;
BEGIN
  FOR pair IN
    SELECT u_loser.id AS loser_id, u_winner.id AS winner_id
      FROM users u_loser
      JOIN users u_winner
        ON u_loser.telegram = u_winner.id
       AND u_winner.id ~ '^[0-9]+$'
     WHERE u_loser.id !~ '^[0-9]+$'
       AND u_loser.telegram IS NOT NULL
       AND u_loser.telegram <> ''
       AND u_loser.id <> 'SYSTEM'
       AND COALESCE(u_loser.is_deleted, false) = false
       AND COALESCE(u_winner.is_deleted, false) = false
  LOOP
    -- Absorb best attributes from loser → winner
    UPDATE users w
       SET first_name = CASE
             WHEN (w.first_name IS NULL OR w.first_name = '' OR w.first_name = 'User')
               AND (l.first_name IS NOT NULL AND l.first_name <> '')
             THEN l.first_name ELSE w.first_name END,
           last_name = COALESCE(NULLIF(w.last_name, ''), l.last_name),
           email = COALESCE(NULLIF(w.email, ''), l.email),
           password_hash = COALESCE(w.password_hash, l.password_hash),
           telegram = COALESCE(NULLIF(w.telegram, ''), l.telegram),
           bio = COALESCE(NULLIF(w.bio, ''), l.bio),
           photo_file_id = COALESCE(NULLIF(w.photo_file_id, ''), l.photo_file_id),
           xp = COALESCE(w.xp, 0) + COALESCE(l.xp, 0),
           profile_views = COALESCE(w.profile_views, 0) + COALESCE(l.profile_views, 0),
           -- Prefer loser's tier/plan if stronger (PRIME > member > free)
           tier = CASE
             WHEN l.tier = 'PRIME' AND w.tier NOT IN ('PRIME','banned') THEN 'PRIME'
             WHEN l.tier = 'member' AND w.tier = 'free' THEN 'member'
             ELSE w.tier END,
           plan_id = CASE
             WHEN l.tier = 'PRIME' AND w.tier NOT IN ('PRIME','banned') THEN l.plan_id
             ELSE w.plan_id END,
           plan_expiry = CASE
             WHEN l.plan_expiry IS NOT NULL AND (w.plan_expiry IS NULL OR l.plan_expiry > w.plan_expiry)
             THEN l.plan_expiry ELSE w.plan_expiry END,
           subscription_status = CASE
             WHEN l.subscription_status = 'active' AND w.subscription_status <> 'active'
             THEN 'active' ELSE w.subscription_status END,
           updated_at = NOW()
      FROM users l
     WHERE w.id = pair.winner_id AND l.id = pair.loser_id;

    -- Transfer all FK references
    transferred := pnptv_transfer_user_fks(pair.loser_id, pair.winner_id);

    -- Soft-delete loser; null out identity fields to prevent future false matches
    UPDATE users
       SET is_deleted = true,
           deleted_at = NOW(),
           is_active = false,
           deactivated_at = NOW(),
           deactivation_reason = 'merged_into_' || pair.winner_id,
           merge_winner_id = pair.winner_id,
           merge_notes = COALESCE(merge_notes, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
             'action', 'merged_into',
             'winner_id', pair.winner_id,
             'dimension', 'telegram_col_match',
             'migration', '219',
             'merged_at', NOW()::text
           )),
           email = NULL,
           telegram = NULL,
           x_id = NULL,
           password_hash = NULL
     WHERE id = pair.loser_id;

    INSERT INTO user_merge_log (loser_id, winner_id, merge_reason, dimension, rows_transferred, performed_by)
    VALUES (
      pair.loser_id,
      pair.winner_id,
      'Cat A: UUID.telegram matches existing TG-ID row. Winner = Telegram-ID per 2026-04-22 dedup policy.',
      'telegram',
      transferred,
      'migration_219'
    );

    merged_count := merged_count + 1;
  END LOOP;

  RAISE NOTICE 'Category A merges completed: % users', merged_count;
END;
$merge_A$;


-- =============================================================================
-- STEP 4: Category B renames (~348 users) — UUID id → declared numeric TG id
-- =============================================================================
-- For each UUID account whose `telegram` column is a numeric Telegram id but
-- no TG-ID row exists yet:
--   (1) INSERT a new users row with id = <declared_tg> copying every column
--       (except id/pnptv_id which get regenerated)
--   (2) Transfer all FK references src=UUID → dst=<declared_tg>
--   (3) Soft-delete the UUID row

DO $rename_B$
DECLARE
  pair         RECORD;
  src          users%ROWTYPE;
  transferred  JSONB;
  renamed_count INT := 0;
  skipped_count INT := 0;
BEGIN
  FOR pair IN
    SELECT u.id AS src_uuid, u.telegram AS dst_tg
      FROM users u
     WHERE u.id !~ '^[0-9]+$'
       AND u.id <> 'SYSTEM'
       AND u.telegram IS NOT NULL
       AND u.telegram ~ '^[0-9]+$'
       AND COALESCE(u.is_deleted, false) = false
       AND NOT EXISTS (SELECT 1 FROM users t WHERE t.id = u.telegram)
       AND u.id NOT IN ('dfcb5ad4-13d8-4102-9697-7ea662185d5b','meru-test-user-uuid')
  LOOP
    BEGIN
      -- Defensive re-check (another concurrent insert could have taken the id)
      IF EXISTS (SELECT 1 FROM users WHERE id = pair.dst_tg) THEN
        skipped_count := skipped_count + 1;
        CONTINUE;
      END IF;

      -- Snapshot the source row so we can copy its data to the new row
      SELECT * INTO src FROM users WHERE id = pair.src_uuid;

      -- STEP B1: Move the unique-constrained fields off the source BEFORE insert
      -- so the clone doesn't collide with its own source.
      -- Source rows have NOT NULL pnptv_id, so rotate it to a fresh UUID and
      -- null out the others (username, email, telegram, x_id are nullable).
      UPDATE users
         SET username  = NULL,
             email     = NULL,
             telegram  = NULL,
             pnptv_id  = gen_random_uuid()::text,
             x_id      = NULL
       WHERE id = pair.src_uuid;

      -- STEP B2: INSERT the new canonical TG-ID row using the snapshot
      INSERT INTO users (
        id, username, first_name, last_name, email, email_verified, bio,
        photo_file_id, photo_updated_at, interests,
        location_lat, location_lng, location_name, location_geohash, location_updated_at,
        subscription_status, plan_id, plan_expiry, tier, role, assigned_by, role_assigned_at,
        privacy, profile_views, xp, favorites, blocked, badges,
        onboarding_complete, age_verified, age_verified_at, age_verification_expires_at,
        age_verification_interval_hours, terms_accepted, privacy_accepted,
        last_active, last_activity_in_group, group_activity_log,
        timezone, timezone_detected, timezone_updated_at, language, is_active,
        deactivated_at, deactivation_reason,
        created_at, updated_at, is_restricted, risk_flags,
        private_calls_enabled, total_calls_booked, total_calls_completed, last_call_at,
        looking_for, location_sharing_enabled, card_token, card_token_mask, card_franchise,
        auto_renew, subscription_type, recurring_plan_id, next_billing_date,
        billing_failures, last_billing_attempt, has_seen_tutorial, age_verification_method,
        city, country, instagram, twitter, facebook, tiktok, youtube, telegram, tribe,
        last_payment_date, last_payment_amount,
        password_hash, pnptv_id
      ) VALUES (
        pair.dst_tg, src.username, src.first_name, src.last_name, src.email, src.email_verified, src.bio,
        src.photo_file_id, src.photo_updated_at, src.interests,
        src.location_lat, src.location_lng, src.location_name, src.location_geohash, src.location_updated_at,
        src.subscription_status, src.plan_id, src.plan_expiry, src.tier, src.role, src.assigned_by, src.role_assigned_at,
        src.privacy, src.profile_views, src.xp, src.favorites, src.blocked, src.badges,
        src.onboarding_complete, src.age_verified, src.age_verified_at, src.age_verification_expires_at,
        src.age_verification_interval_hours, src.terms_accepted, src.privacy_accepted,
        src.last_active, src.last_activity_in_group, src.group_activity_log,
        src.timezone, src.timezone_detected, src.timezone_updated_at, src.language, true /* is_active */,
        NULL, NULL,
        src.created_at, NOW(), src.is_restricted, src.risk_flags,
        src.private_calls_enabled, src.total_calls_booked, src.total_calls_completed, src.last_call_at,
        src.looking_for, src.location_sharing_enabled, src.card_token, src.card_token_mask, src.card_franchise,
        src.auto_renew, src.subscription_type, src.recurring_plan_id, src.next_billing_date,
        src.billing_failures, src.last_billing_attempt, src.has_seen_tutorial, src.age_verification_method,
        src.city, src.country, src.instagram, src.twitter, src.facebook, src.tiktok, src.youtube,
        NULL /* telegram col redundant when id IS the tg numeric */, src.tribe,
        src.last_payment_date, src.last_payment_amount,
        src.password_hash, src.pnptv_id
      );

      transferred := pnptv_transfer_user_fks(pair.src_uuid, pair.dst_tg);

      UPDATE users
         SET is_deleted = true,
             deleted_at = NOW(),
             is_active = false,
             deactivated_at = NOW(),
             deactivation_reason = 'renamed_to_' || pair.dst_tg,
             merge_winner_id = pair.dst_tg,
             merge_notes = COALESCE(merge_notes, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
               'action', 'renamed_to_telegram_id',
               'winner_id', pair.dst_tg,
               'dimension', 'declared_telegram_col',
               'migration', '219',
               'renamed_at', NOW()::text
             )),
             tier = 'free',
             subscription_status = 'free',
             plan_id = NULL,
             plan_expiry = NULL,
             password_hash = NULL
       WHERE id = pair.src_uuid;

      INSERT INTO user_merge_log (loser_id, winner_id, merge_reason, dimension, rows_transferred, performed_by)
      VALUES (
        pair.src_uuid,
        pair.dst_tg,
        'Cat B: UUID renamed to declared numeric Telegram id. No pre-existing TG-ID row.',
        'rename_tg',
        transferred,
        'migration_219'
      );

      renamed_count := renamed_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Category B rename failed for % → %: %', pair.src_uuid, pair.dst_tg, SQLERRM;
      skipped_count := skipped_count + 1;
    END;
  END LOOP;

  RAISE NOTICE 'Category B renames completed: % renamed, % skipped', renamed_count, skipped_count;
END;
$rename_B$;
*/
-- ================ END REMOVED CAT A/B BLOCKS ================


-- =============================================================================
-- STEP 5: Category C PRIME — flag only, do NOT delete
-- =============================================================================
-- 8 PRIME users without any Telegram link. They remain active; merge_notes
-- is appended so the admin UI and outreach tooling can identify them.

UPDATE users
   SET merge_notes = COALESCE(merge_notes, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
         'action', 'flagged_for_outreach',
         'reason', 'prime_no_telegram_link',
         'migration', '219',
         'flagged_at', NOW()::text,
         'grace_days', 30
       ))
 WHERE id !~ '^[0-9]+$'
   AND id NOT IN ('SYSTEM','dfcb5ad4-13d8-4102-9697-7ea662185d5b','meru-test-user-uuid')
   AND tier = 'PRIME'
   AND COALESCE(is_deleted, false) = false
   AND (telegram IS NULL OR telegram = '' OR telegram !~ '^[0-9]+$');


-- =============================================================================
-- STEP 6: Category C2 free — flag for outreach + delayed deletion
-- =============================================================================
-- 174 free-tier non-Telegram accounts with no TG link. Flagged now; outreach
-- email sent from application. Deletion in a follow-up migration 220 after
-- the 30-day grace window (target: 2026-05-22).

UPDATE users
   SET merge_notes = COALESCE(merge_notes, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
         'action', 'flagged_for_deletion',
         'reason', 'free_tier_no_telegram',
         'migration', '219',
         'flagged_at', NOW()::text,
         'scheduled_delete_after', (NOW() + INTERVAL '30 days')::text
       ))
 WHERE id !~ '^[0-9]+$'
   AND id NOT IN ('SYSTEM','dfcb5ad4-13d8-4102-9697-7ea662185d5b','meru-test-user-uuid')
   AND tier = 'free'
   AND COALESCE(is_deleted, false) = false
   AND (telegram IS NULL OR telegram = '' OR telegram !~ '^[0-9]+$');


-- =============================================================================
-- STEP 7: akadmin — soft-delete (Authentik system account, not a real user)
-- =============================================================================
-- Superadmin is already SantinoFurioso (id 8599671840, PRIME diamond-pass).
-- akadmin's lifetime pnp-member/prime entitlements are an artifact of the
-- Authentik provisioning flow and should not persist on a soft-deleted row.

DO $akadmin$
DECLARE
  ak_id TEXT := 'dfcb5ad4-13d8-4102-9697-7ea662185d5b';
  transferred JSONB := '{}'::jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id = ak_id AND COALESCE(is_deleted, false) = false) THEN
    -- Revoke akadmin's lifetime entitlements (bypass honored by set local above)
    DELETE FROM user_entitlements WHERE user_id = ak_id;

    UPDATE users
       SET is_deleted = true,
           deleted_at = NOW(),
           is_active = false,
           deactivated_at = NOW(),
           deactivation_reason = 'authentik_system_account_retired',
           merge_winner_id = '8599671840',
           merge_notes = COALESCE(merge_notes, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
             'action', 'retired_authentik_admin',
             'reason', 'superadmin_consolidated_to_santinofurioso',
             'migration', '219',
             'retired_at', NOW()::text
           )),
           email = NULL,
           telegram = NULL,
           x_id = NULL,
           password_hash = NULL,
           tier = 'free',
           subscription_status = 'free',
           plan_id = NULL,
           plan_expiry = NULL
     WHERE id = ak_id;

    INSERT INTO user_merge_log (loser_id, winner_id, merge_reason, dimension, rows_transferred, performed_by)
    VALUES (
      ak_id,
      '8599671840',
      'Cat D: akadmin Authentik system account retired. Superadmin is @SantinoFurioso.',
      'manual',
      transferred,
      'migration_219'
    );
  END IF;
END;
$akadmin$;


-- =============================================================================
-- STEP 8: Delete meru test user
-- =============================================================================

DO $meru$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id = 'meru-test-user-uuid') THEN
    DELETE FROM user_entitlements WHERE user_id = 'meru-test-user-uuid';
    DELETE FROM users WHERE id = 'meru-test-user-uuid';
    INSERT INTO user_merge_log (loser_id, winner_id, merge_reason, dimension, rows_transferred, performed_by)
    VALUES ('meru-test-user-uuid', 'SYSTEM', 'Cat D: test fixture removed.', 'manual', '{}'::jsonb, 'migration_219');
  END IF;
END;
$meru$;


-- =============================================================================
-- STEP 9: Summary report (for human review before COMMIT)
-- =============================================================================

\echo '--- Dedup summary ---'
SELECT
  COUNT(*) FILTER (WHERE performed_by = 'migration_219' AND dimension = 'telegram')   AS cat_a_merges,
  COUNT(*) FILTER (WHERE performed_by = 'migration_219' AND dimension = 'rename_tg')  AS cat_b_renames,
  COUNT(*) FILTER (WHERE performed_by = 'migration_219' AND dimension = 'manual')     AS cat_d_deletions,
  COUNT(*) FILTER (WHERE performed_by = 'migration_219')                               AS total_ops
FROM user_merge_log
WHERE merged_at >= CURRENT_DATE;

SELECT
  COUNT(*) FILTER (WHERE id !~ '^[0-9]+$' AND COALESCE(is_deleted,false) = false AND id <> 'SYSTEM') AS remaining_non_tg_active,
  COUNT(*) FILTER (WHERE id !~ '^[0-9]+$' AND COALESCE(is_deleted,false) = false AND tier = 'PRIME' AND id <> 'SYSTEM') AS remaining_non_tg_prime,
  COUNT(*) FILTER (WHERE id ~ '^[0-9]+$' AND COALESCE(is_deleted,false) = false) AS active_telegram
FROM users;

-- =============================================================================
-- COMMIT the transaction (or ROLLBACK manually if numbers look wrong)
-- =============================================================================
COMMIT;


-- =============================================================================
-- DOWN (NOT SAFE in production — restore from pg_dump instead)
-- =============================================================================
--
-- DROP FUNCTION IF EXISTS pnptv_transfer_user_fks(TEXT, TEXT);
-- DROP INDEX IF EXISTS users_email_ci_uidx;
-- (Per-user reversal requires the pre_219 pg_dump.)
