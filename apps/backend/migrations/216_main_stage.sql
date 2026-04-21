-- Migration 216: Main Stage tables
-- Tracks admin actions and cammer statistics for the 24/7 Main Stage LiveKit room.

CREATE TABLE IF NOT EXISTS mainstage_admin_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  payload    JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mainstage_admin_log_created_idx
  ON mainstage_admin_log (created_at DESC);

CREATE TABLE IF NOT EXISTS mainstage_cammer_stats (
  identity          TEXT PRIMARY KEY,
  user_id           VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  total_seconds     BIGINT DEFAULT 0,
  last_spotlight_at TIMESTAMPTZ,
  last_seen_at      TIMESTAMPTZ DEFAULT now()
);
