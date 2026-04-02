-- Migration 180: Telegram-style features for DM system + DM video calls table
-- Adds message editing, reply threading, full-text search to direct_messages,
-- and creates the dm_video_calls table with one-active-call-per-pair enforcement.
-- All ALTER TABLE statements use IF NOT EXISTS for idempotency.
-- All CREATE INDEX / CREATE TABLE statements use IF NOT EXISTS for idempotency.
-- Down migration: see bottom of file (commented out).

BEGIN;

-- ============================================================
-- 1. Message editing columns on direct_messages
-- ============================================================

-- edited_at: timestamp of the most recent edit (NULL = never edited)
ALTER TABLE direct_messages
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ DEFAULT NULL;

-- edit_count: number of times the message has been edited
ALTER TABLE direct_messages
  ADD COLUMN IF NOT EXISTS edit_count INTEGER DEFAULT 0;

-- original_content: verbatim text before the first edit, for audit trail
ALTER TABLE direct_messages
  ADD COLUMN IF NOT EXISTS original_content TEXT DEFAULT NULL;

-- ============================================================
-- 2. Reply threading column on direct_messages
-- ============================================================

-- reply_to_id: references another row in direct_messages (same conversation).
-- No FK constraint — the referenced message may be deleted and we still want
-- to preserve the reply relationship (shown as "reply to [deleted message]").
ALTER TABLE direct_messages
  ADD COLUMN IF NOT EXISTS reply_to_id INTEGER DEFAULT NULL;

-- Index for efficient "fetch all replies to message X" lookups.
CREATE INDEX IF NOT EXISTS idx_dm_reply_to_id
  ON direct_messages (reply_to_id)
  WHERE reply_to_id IS NOT NULL AND is_deleted = false;

-- ============================================================
-- 3. Full-text search index on direct_messages (GIN / tsvector)
-- ============================================================

-- Partial index: only live messages (is_deleted = false).
-- COALESCE handles nullable content (media-only messages).
-- 'english' dictionary — matches the pattern established in migration 178
-- for chat_messages FTS. Replace with 'simple' if multilingual content
-- becomes the norm and stemming causes recall issues.
CREATE INDEX IF NOT EXISTS idx_dm_fts
  ON direct_messages
  USING GIN (to_tsvector('english', COALESCE(content, '')))
  WHERE is_deleted = false;

-- ============================================================
-- 4. DM video calls table
-- ============================================================

-- dm_video_calls tracks 1-to-1 video calls initiated from the DM interface.
-- The UNIQUE partial index on (LEAST, GREATEST) of the two participant IDs
-- enforces at most one active call per ordered pair, regardless of who is
-- caller vs callee (mirrors the dm_threads.user_a/user_b sorted-pair pattern).

CREATE TABLE IF NOT EXISTS dm_video_calls (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_id   VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  callee_id   VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_name   VARCHAR(255) NOT NULL,
  status      VARCHAR(20)  NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'ended', 'missed', 'declined')),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMPTZ  DEFAULT NULL,
  ended_by    VARCHAR(255) DEFAULT NULL
);

-- One active call per ordered pair at a time.
-- LEAST/GREATEST normalises (A,B) and (B,A) to the same index entry.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dm_calls_active
  ON dm_video_calls (LEAST(caller_id, callee_id), GREATEST(caller_id, callee_id))
  WHERE status = 'active';

-- Fast lookup of all currently active calls (used by presence / ringing checks).
CREATE INDEX IF NOT EXISTS idx_dm_calls_status
  ON dm_video_calls (status)
  WHERE status = 'active';

-- Fast lookup of call history per user (caller or callee).
CREATE INDEX IF NOT EXISTS idx_dm_calls_caller_id
  ON dm_video_calls (caller_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dm_calls_callee_id
  ON dm_video_calls (callee_id, created_at DESC);

-- ============================================================
-- Verification DO block
-- ============================================================

DO $$
DECLARE
  missing_cols TEXT := '';
  missing_objs TEXT := '';
BEGIN
  -- direct_messages column checks
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'direct_messages' AND column_name = 'edited_at') THEN
    missing_cols := missing_cols || ' edited_at';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'direct_messages' AND column_name = 'edit_count') THEN
    missing_cols := missing_cols || ' edit_count';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'direct_messages' AND column_name = 'original_content') THEN
    missing_cols := missing_cols || ' original_content';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'direct_messages' AND column_name = 'reply_to_id') THEN
    missing_cols := missing_cols || ' reply_to_id';
  END IF;

  -- dm_video_calls table check
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dm_video_calls') THEN
    missing_objs := missing_objs || ' dm_video_calls(table)';
  END IF;

  -- Index checks
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_dm_fts') THEN
    missing_objs := missing_objs || ' idx_dm_fts';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_dm_calls_active') THEN
    missing_objs := missing_objs || ' idx_dm_calls_active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_dm_calls_status') THEN
    missing_objs := missing_objs || ' idx_dm_calls_status';
  END IF;

  IF missing_cols <> '' OR missing_objs <> '' THEN
    RAISE EXCEPTION 'Migration 180 FAILED — missing columns: [%] missing objects: [%]',
      missing_cols, missing_objs;
  ELSE
    RAISE NOTICE 'Migration 180 OK — all columns, table, and indexes present.';
  END IF;
END;
$$;

COMMIT;

-- ============================================================
-- DOWN MIGRATION (run manually to reverse)
-- ============================================================
-- BEGIN;
-- DROP TABLE IF EXISTS dm_video_calls;
-- DROP INDEX IF EXISTS idx_dm_fts;
-- DROP INDEX IF EXISTS idx_dm_reply_to_id;
-- ALTER TABLE direct_messages DROP COLUMN IF EXISTS edited_at;
-- ALTER TABLE direct_messages DROP COLUMN IF EXISTS edit_count;
-- ALTER TABLE direct_messages DROP COLUMN IF EXISTS original_content;
-- ALTER TABLE direct_messages DROP COLUMN IF EXISTS reply_to_id;
-- COMMIT;
