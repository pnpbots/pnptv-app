-- ============================================================================
-- 077: Hangout media sharing hardening + JaaS video call table completeness
-- ============================================================================
--
-- SCOPE
-- -----
-- A) chat_messages: allow media-only hangout messages (content NOT NULL → relaxed)
--    and add a content-or-media CHECK so the constraint is business-safe.
--
-- B) hangout_video_calls: add missing JaaS/operational columns that the
--    hangoutGroupController already reads/writes (jaas_room_name, participant_count,
--    title, jitsi_domain). Also fix the creator_id / ended_by type mismatch —
--    the live table has INTEGER but users.id is VARCHAR, so we migrate to TEXT.
--
-- C) hangout_call_participants: add total_duration_seconds, is_moderator,
--    was_kicked to match the tracking done in the general call_participants table.
--    Fix user_id INTEGER → TEXT to match users.id.
--
-- TABLES AFFECTED
--   chat_messages
--   hangout_video_calls
--   hangout_call_participants
--
-- WHAT IS *NOT* TOUCHED
--   jitsi_rooms / jitsi_participants / jitsi_tier_access — these belong to the
--   general Jitsi feature (non-hangout) and must not be disturbed.
--   video_calls / call_participants — general video call tables, untouched.
--
-- IDEMPOTENCY
--   Every ALTER uses IF NOT EXISTS / IF EXISTS guards.
--   Type migrations check current type before altering to avoid repeat-run errors.
--
-- ============================================================================

BEGIN;

-- ============================================================================
-- A) chat_messages: allow media-only messages in hangout rooms
-- ============================================================================

-- 1. Relax the NOT NULL constraint on content.
--    Migration 072 left content NOT NULL, but chatMediaController inserts rows
--    with caption = null when the user sends a bare image/video.
--    We use a CHECK instead of NOT NULL to enforce the business rule:
--    "a message must have text OR a media attachment — never neither."
ALTER TABLE chat_messages
  ALTER COLUMN content DROP NOT NULL;

-- 2. Add the content-or-media CHECK (mirrors the pattern used in 073 for DMs).
--    Guard: only add if the constraint doesn't already exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'chat_messages'::regclass
      AND conname   = 'chat_messages_content_or_media'
  ) THEN
    ALTER TABLE chat_messages
      ADD CONSTRAINT chat_messages_content_or_media
        CHECK (content IS NOT NULL OR media_url IS NOT NULL);
  END IF;
END $$;


-- ============================================================================
-- B) hangout_video_calls: add missing columns + fix type mismatches
-- ============================================================================

-- 2a. Fix creator_id: INTEGER → TEXT to match users.id (VARCHAR).
--     The live column is INTEGER; users.id is VARCHAR(50).  We cast via text.
--     Guard against re-run by checking the current type first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'hangout_video_calls'
      AND column_name  = 'creator_id'
      AND data_type    = 'integer'
  ) THEN
    ALTER TABLE hangout_video_calls
      ALTER COLUMN creator_id TYPE TEXT USING creator_id::TEXT;
  END IF;
END $$;

-- 2b. Fix ended_by: INTEGER → TEXT (same reason — references users.id).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'hangout_video_calls'
      AND column_name  = 'ended_by'
      AND data_type    = 'integer'
  ) THEN
    ALTER TABLE hangout_video_calls
      ALTER COLUMN ended_by TYPE TEXT USING ended_by::TEXT;
  END IF;
END $$;

-- 2c. Add operational columns needed by hangoutGroupController and jaasService.

-- jaas_room_name: the JaaS-namespaced room identifier (e.g. "call_8b1019bf...").
--   Distinct from room_name (which was the raw Agora channel name in older code).
--   UNIQUE because JaaS room names must be globally unique per tenant.
ALTER TABLE hangout_video_calls
  ADD COLUMN IF NOT EXISTS jaas_room_name TEXT UNIQUE;

-- title: optional human-readable title shown in the group UI.
ALTER TABLE hangout_video_calls
  ADD COLUMN IF NOT EXISTS title TEXT;

-- jitsi_domain: defaults to 8x8.vc (JaaS). Stored so the client can build the
--   meeting URL without server involvement.
ALTER TABLE hangout_video_calls
  ADD COLUMN IF NOT EXISTS jitsi_domain TEXT NOT NULL DEFAULT '8x8.vc';

-- participant_count: live counter maintained by join/leave endpoints.
--   GREATEST() guards prevent underflow in concurrent leave scenarios.
ALTER TABLE hangout_video_calls
  ADD COLUMN IF NOT EXISTS participant_count INTEGER NOT NULL DEFAULT 0;

-- CHECK: participant_count must be non-negative.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'hangout_video_calls'::regclass
      AND conname   = 'hvc_participant_count_nonneg'
  ) THEN
    ALTER TABLE hangout_video_calls
      ADD CONSTRAINT hvc_participant_count_nonneg
        CHECK (participant_count >= 0);
  END IF;
END $$;


-- ============================================================================
-- C) hangout_call_participants: fix user_id type + add tracking columns
-- ============================================================================

-- 3a. Fix user_id: INTEGER → TEXT to match users.id.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'hangout_call_participants'
      AND column_name  = 'user_id'
      AND data_type    = 'integer'
  ) THEN
    ALTER TABLE hangout_call_participants
      ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;
  END IF;
END $$;

-- 3b. total_duration_seconds: computed at leave time via EXTRACT(EPOCH FROM ...).
ALTER TABLE hangout_call_participants
  ADD COLUMN IF NOT EXISTS total_duration_seconds INTEGER;

-- 3c. is_moderator: true for the call creator; set at insert time.
ALTER TABLE hangout_call_participants
  ADD COLUMN IF NOT EXISTS is_moderator BOOLEAN NOT NULL DEFAULT FALSE;

-- 3d. was_kicked: set to true when the moderator removes a participant.
ALTER TABLE hangout_call_participants
  ADD COLUMN IF NOT EXISTS was_kicked BOOLEAN NOT NULL DEFAULT FALSE;


-- ============================================================================
-- D) Indexes
-- ============================================================================

-- D1. hangout_video_calls: index calls by creator for "my active call" queries.
CREATE INDEX IF NOT EXISTS idx_hvc_creator_id
  ON hangout_video_calls (creator_id);

-- D2. hangout_video_calls: index on jaas_room_name for join-by-room lookups.
CREATE INDEX IF NOT EXISTS idx_hvc_jaas_room_name
  ON hangout_video_calls (jaas_room_name)
  WHERE jaas_room_name IS NOT NULL;

-- D3. hangout_call_participants: composite index for "who is currently in call X"
--   (left_at IS NULL means still present — partial index for hot queries).
CREATE INDEX IF NOT EXISTS idx_hcp_call_active
  ON hangout_call_participants (call_id)
  WHERE left_at IS NULL;

-- D4. hangout_call_participants: user's call history.
CREATE INDEX IF NOT EXISTS idx_hcp_user_id
  ON hangout_call_participants (user_id);

-- D5. chat_messages: partial index for media-only messages per room.
--   The existing idx_chat_messages_room_media already covers media_url IS NOT NULL;
--   this is already applied (from migration 072). No duplicate needed.
--   But we want a fast path for "messages with no text but have media" (caption-less):
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_media_only
  ON chat_messages (room, created_at DESC)
  WHERE media_url IS NOT NULL AND content IS NULL AND is_deleted = FALSE;


-- ============================================================================
-- DOWN MIGRATION (run manually to reverse)
-- ============================================================================
-- To reverse this migration:
--
--   BEGIN;
--
--   -- Reverse A
--   DROP INDEX IF EXISTS idx_chat_messages_room_media_only;
--   ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_content_or_media;
--   -- Note: restoring NOT NULL on content requires all rows to have content set.
--   -- UPDATE chat_messages SET content = '' WHERE content IS NULL;
--   -- ALTER TABLE chat_messages ALTER COLUMN content SET NOT NULL;
--
--   -- Reverse B
--   ALTER TABLE hangout_video_calls DROP CONSTRAINT IF EXISTS hvc_participant_count_nonneg;
--   ALTER TABLE hangout_video_calls DROP COLUMN IF EXISTS participant_count;
--   ALTER TABLE hangout_video_calls DROP COLUMN IF EXISTS jitsi_domain;
--   ALTER TABLE hangout_video_calls DROP COLUMN IF EXISTS title;
--   ALTER TABLE hangout_video_calls DROP COLUMN IF EXISTS jaas_room_name;
--   DROP INDEX IF EXISTS idx_hvc_jaas_room_name;
--   DROP INDEX IF EXISTS idx_hvc_creator_id;
--   -- creator_id / ended_by type change is not safely reversible with live data.
--
--   -- Reverse C
--   DROP INDEX IF EXISTS idx_hcp_user_id;
--   DROP INDEX IF EXISTS idx_hcp_call_active;
--   ALTER TABLE hangout_call_participants DROP COLUMN IF EXISTS was_kicked;
--   ALTER TABLE hangout_call_participants DROP COLUMN IF EXISTS is_moderator;
--   ALTER TABLE hangout_call_participants DROP COLUMN IF EXISTS total_duration_seconds;
--   -- user_id type change is not safely reversible with live data.
--
--   COMMIT;

COMMIT;
