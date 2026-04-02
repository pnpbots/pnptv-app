-- Migration 178: Telegram-style chat features
-- Adds message editing, deletion metadata, read receipts,
-- full-text search, and pinned message support.
-- All ALTER TABLE statements use IF NOT EXISTS for idempotency.
-- All CREATE INDEX statements use IF NOT EXISTS for idempotency.
-- Down migration: see bottom of file (commented out).

BEGIN;

-- ============================================================
-- 1. Message editing columns on chat_messages
-- ============================================================

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS edit_count INTEGER DEFAULT 0;

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS original_content TEXT DEFAULT NULL;

-- ============================================================
-- 2. Message deletion metadata on chat_messages
-- ============================================================

-- deleted_by: stores the user_id of whoever deleted the message
-- (may differ from author when a moderator performs the deletion)
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(255) DEFAULT NULL;

-- deleted_for_all: TRUE = message hidden from all participants;
-- FALSE (default) = soft-delete only for the sender (future use)
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS deleted_for_all BOOLEAN DEFAULT FALSE;

-- ============================================================
-- 3. Read receipt tracking on hangout_group_members
-- ============================================================

-- last_read_message_id: the highest chat_messages.id the member
-- has confirmed as seen.  No FK constraint — the message may be
-- deleted and we still want to preserve the read horizon.
ALTER TABLE hangout_group_members
  ADD COLUMN IF NOT EXISTS last_read_message_id INTEGER DEFAULT NULL;

-- ============================================================
-- 4. Full-text search index on chat_messages (GIN / tsvector)
-- ============================================================

-- Partial index: only live messages (is_deleted = false).
-- COALESCE handles nullable content (media-only messages).
-- 'english' dictionary — replace with 'simple' if multilingual
-- content becomes the norm and stemming causes recall issues.
CREATE INDEX IF NOT EXISTS idx_chat_messages_fts
  ON chat_messages
  USING GIN (to_tsvector('english', COALESCE(content, '')))
  WHERE is_deleted = false;

-- ============================================================
-- 5. Pinned message columns on chat_messages
-- ============================================================

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;

-- pinned_by: user_id of the member who pinned the message
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS pinned_by VARCHAR(255) DEFAULT NULL;

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ DEFAULT NULL;

-- Supporting index: fast retrieval of pinned messages per room.
-- Partial index keeps it tiny — only rows where is_pinned = true
-- are included, which will be a very small fraction of the table.
CREATE INDEX IF NOT EXISTS idx_chat_messages_pinned
  ON chat_messages (room, pinned_at DESC)
  WHERE is_pinned = true AND is_deleted = false;

-- ============================================================
-- Verification query (runs at end of migration, results visible
-- in psql output but do not affect transaction success/failure)
-- ============================================================

DO $$
DECLARE
  missing_cols TEXT := '';
BEGIN
  -- chat_messages checks
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chat_messages' AND column_name='edited_at') THEN
    missing_cols := missing_cols || ' edited_at';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chat_messages' AND column_name='edit_count') THEN
    missing_cols := missing_cols || ' edit_count';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chat_messages' AND column_name='original_content') THEN
    missing_cols := missing_cols || ' original_content';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chat_messages' AND column_name='deleted_by') THEN
    missing_cols := missing_cols || ' deleted_by';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chat_messages' AND column_name='deleted_for_all') THEN
    missing_cols := missing_cols || ' deleted_for_all';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chat_messages' AND column_name='is_pinned') THEN
    missing_cols := missing_cols || ' is_pinned';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chat_messages' AND column_name='pinned_by') THEN
    missing_cols := missing_cols || ' pinned_by';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chat_messages' AND column_name='pinned_at') THEN
    missing_cols := missing_cols || ' pinned_at';
  END IF;
  -- hangout_group_members check
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hangout_group_members' AND column_name='last_read_message_id') THEN
    missing_cols := missing_cols || ' last_read_message_id';
  END IF;

  IF missing_cols <> '' THEN
    RAISE EXCEPTION 'Migration 178 FAILED — missing columns:%', missing_cols;
  ELSE
    RAISE NOTICE 'Migration 178 OK — all columns present.';
  END IF;
END;
$$;

COMMIT;

-- ============================================================
-- DOWN MIGRATION (run manually to reverse)
-- ============================================================
-- BEGIN;
-- DROP INDEX IF EXISTS idx_chat_messages_fts;
-- DROP INDEX IF EXISTS idx_chat_messages_pinned;
-- ALTER TABLE chat_messages DROP COLUMN IF EXISTS edited_at;
-- ALTER TABLE chat_messages DROP COLUMN IF EXISTS edit_count;
-- ALTER TABLE chat_messages DROP COLUMN IF EXISTS original_content;
-- ALTER TABLE chat_messages DROP COLUMN IF EXISTS deleted_by;
-- ALTER TABLE chat_messages DROP COLUMN IF EXISTS deleted_for_all;
-- ALTER TABLE chat_messages DROP COLUMN IF EXISTS is_pinned;
-- ALTER TABLE chat_messages DROP COLUMN IF EXISTS pinned_by;
-- ALTER TABLE chat_messages DROP COLUMN IF EXISTS pinned_at;
-- ALTER TABLE hangout_group_members DROP COLUMN IF EXISTS last_read_message_id;
-- COMMIT;
