-- Migration 204: Stream session analytics table
-- Records per-session metrics for creator live streams.
-- creator_id matches users.id type (VARCHAR 255) used throughout the schema.

CREATE TABLE IF NOT EXISTS stream_sessions (
  id              BIGSERIAL    PRIMARY KEY,
  creator_id      VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_ref     TEXT         NOT NULL,
  started_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  peak_viewers    INTEGER      NOT NULL DEFAULT 0,
  unique_viewers  INTEGER,
  total_tips_tokens INTEGER    NOT NULL DEFAULT 0,
  total_tips_usd  NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_stream_sessions_creator_started
  ON stream_sessions(creator_id, started_at DESC);
