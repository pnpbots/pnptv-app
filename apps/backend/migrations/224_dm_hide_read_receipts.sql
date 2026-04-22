-- 224_dm_hide_read_receipts.sql
-- N-07: per-thread "hide read receipts" toggle for DMs.
--
-- When hide_read_receipts = TRUE for a (user_id, partner_id) pair:
--   - user's reads still mark messages as is_read=TRUE for inbox counts
--   - but direct_messages.read_at is NOT stamped
--   - and the dm:message:read socket event is NOT emitted to partner
-- Net effect: the partner does not see ✓✓ for messages they sent to this user.
--
-- Asymmetric (Telegram-style): this user still sees ✓✓ on messages partner
-- has read, unless partner also hides.

BEGIN;

ALTER TABLE dm_thread_state
  ADD COLUMN IF NOT EXISTS hide_read_receipts BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN dm_thread_state.hide_read_receipts IS
  'When TRUE, this user''s reads of partner''s messages do NOT stamp read_at or emit dm:message:read. Per-thread privacy toggle.';

COMMIT;
