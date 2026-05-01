-- Migration 241: Harm-reduction use tracker.
-- Private per-user log of slam / smoke events. Data is never public.

CREATE TABLE IF NOT EXISTS use_tracker_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(10) NOT NULL CHECK (type IN ('slam', 'smoke')),
  logged_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_use_tracker_logs_user_type
  ON use_tracker_logs (user_id, type, logged_at DESC);
