-- Migration 285: Log table retention + index cleanup
-- 2026-06-28
--
-- user_access_logs: 14.5M rows (4.7 GB) accumulated since March 2026.
-- The 325 MB PK B-tree caused INSERT latency of 400-700ms under load.
-- Fix: weekly cron retention (30-day window) via cron.js; this migration
-- documents the one-time backfill that ran as a DO-block batch delete.
--
-- video_fetch_log: DROP the (media_url, fetched_at) B-tree. The admin
-- analytics query can hash-join on media_url in memory (100K rows ≤ 7 days);
-- the fetched_at B-tree alone covers the time-range filter.

BEGIN;

DROP INDEX IF EXISTS idx_video_fetch_log_url_time;

COMMIT;
