-- Migration 227: Audit-driven DB perf + integrity fixes (2026-04-25).
--
-- Driven by the QA / DB architect audit. Each statement is independent and
-- runs auto-commit (no BEGIN/COMMIT wrapping) because CREATE INDEX
-- CONCURRENTLY cannot run inside a transaction.
--
-- ─── Hot-path indexes (the audit identified missing or unused indexes) ───

-- M2: direct_messages — markAsRead path filters on (recipient_id, sender_id)
-- with is_read=false. Existing idx_dm_recipient_read covers (recipient_id,
-- is_read) only. Partial index on the unread inbox is much more selective
-- and avoids hitting old conversations.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dm_unread_inbox
  ON direct_messages (recipient_id, sender_id)
  WHERE is_read = false AND is_deleted = false;

-- M3: mainstage_admin_log — 262k seq_scans on 255 rows. Existing
-- mainstage_admin_log_created_idx on (created_at) is never used because
-- queries filter by user_id or action without a date constraint. Add
-- composite indexes that match the actual access patterns.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mainstage_log_user
  ON mainstage_admin_log (user_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mainstage_log_action
  ON mainstage_admin_log (action, created_at DESC);

-- LOW-5: drop the redundant social_posts repost_of index (idx_social_posts_repost_of
-- and idx_social_posts_repost_of_id are identical; both have zero scans).
-- Keep idx_social_posts_repost_of_id (more descriptive name).
DROP INDEX CONCURRENTLY IF EXISTS idx_social_posts_repost_of;

-- ─── FK cascade fixes (M5) — verified already SET NULL post-audit ───
-- social_posts.channel_id → creator_channels(id) ON DELETE SET NULL ✓
-- social_posts.hangout_group_id → hangout_groups(id) ON DELETE SET NULL ✓
-- The audit flagged these as NO ACTION but live schema confirms SET NULL.
-- No statement needed; documented for posterity.

-- ─── Statistics refresh (audit found stale stats causing index bypass) ───
-- user_access_logs has 4.9M rows and an idx_access_logs_user_id that reports
-- zero scans because PostgreSQL estimates a seq-scan would be cheaper based
-- on stale statistics. Refreshing fixes plan choice for platformBanService's
-- per-user IP lookup.
ANALYZE user_access_logs;
ANALYZE direct_messages;
ANALYZE mainstage_admin_log;
ANALYZE social_posts;
