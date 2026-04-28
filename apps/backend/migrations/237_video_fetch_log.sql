-- Migration 237: video fetch log for leak detection.
--
-- Records every successful fetch of a /uploads/posts/vid-* file. The leak
-- detector cron then groups by media_url over a 10-minute window and alerts
-- when 3+ distinct user_ids (or 5+ distinct IPs) hit the same URL — that's
-- the signature of a paid user sharing a URL on Twitter/Discord and randos
-- piling on.
--
-- Retention: 14 days (truncated by the cleanup cron). 14d covers a full
-- weekly review cycle and keeps the table small.

CREATE TABLE IF NOT EXISTS video_fetch_log (
  id BIGSERIAL PRIMARY KEY,
  media_url TEXT NOT NULL,
  user_id VARCHAR(255),
  ip_address INET,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup pattern: aggregate by media_url over a recent time window.
CREATE INDEX IF NOT EXISTS idx_video_fetch_log_url_time
  ON video_fetch_log (media_url, fetched_at DESC);

-- Cleanup index for the retention sweep.
CREATE INDEX IF NOT EXISTS idx_video_fetch_log_fetched_at
  ON video_fetch_log (fetched_at);
