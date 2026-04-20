-- Migration 214: Studio extras
-- 1. stream_snapshots table (Gap 2 — snapshot persistence)
-- 2. streamer_settings extra columns (Gap 5 — title/description persistence)

CREATE TABLE IF NOT EXISTS stream_snapshots (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT    NOT NULL,
  session_id  TEXT,
  storage_path TEXT     NOT NULL,
  public_url  TEXT      NOT NULL,
  size_bytes  INT       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stream_snapshots_user_time
  ON stream_snapshots(user_id, created_at DESC);

ALTER TABLE streamer_settings
  ADD COLUMN IF NOT EXISTS last_stream_title       TEXT,
  ADD COLUMN IF NOT EXISTS last_stream_description TEXT;
