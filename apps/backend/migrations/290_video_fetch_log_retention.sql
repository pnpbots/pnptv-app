-- Migration 290: video_fetch_log retention policy
-- Keep 90 days of fetch logs; older rows serve no security purpose.

-- Ensure pg_cron extension is available (already present on this server).
-- Schedule nightly cleanup at 03:00 UTC.
SELECT cron.schedule(
  'video_fetch_log_cleanup',
  '0 3 * * *',
  $$DELETE FROM video_fetch_log WHERE fetched_at < NOW() - INTERVAL '90 days'$$
);
