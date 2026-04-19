-- Migration 208: VOD replay recordings table
-- Records HLS recordings produced by ffmpeg during live streams.
-- creator_id matches users.id type (VARCHAR 255) used throughout the schema.

CREATE TABLE IF NOT EXISTS stream_recordings (
  id                BIGSERIAL    PRIMARY KEY,
  session_id        BIGINT       REFERENCES stream_sessions(id) ON DELETE SET NULL,
  creator_id        VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_ref       TEXT         NOT NULL,
  started_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,
  duration_seconds  INTEGER,
  file_path         TEXT         NOT NULL,
  manifest_url      TEXT,
  size_bytes        BIGINT,
  status            TEXT         NOT NULL DEFAULT 'recording'
                                 CHECK (status IN ('recording','completed','failed','deleted')),
  is_deleted        BOOLEAN      NOT NULL DEFAULT FALSE,
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stream_recordings_creator
  ON stream_recordings(creator_id, started_at DESC)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_stream_recordings_expiry
  ON stream_recordings(ended_at)
  WHERE is_deleted = FALSE AND status = 'completed';
