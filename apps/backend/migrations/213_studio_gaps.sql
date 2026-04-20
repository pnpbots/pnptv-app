-- Migration 213: Studio gaps — thumbnail, metrics samples, local upload recordings, scene/mixer presets

-- Gap 2: Persistent thumbnail URL on streamer_settings
ALTER TABLE streamer_settings
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Gap 3: Bitrate/FPS telemetry samples during live streams
CREATE TABLE IF NOT EXISTS stream_metrics_samples (
  id          BIGSERIAL    PRIMARY KEY,
  session_id  TEXT         NOT NULL,
  user_id     BIGINT       NOT NULL,
  sampled_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  kbps        INT,
  fps         REAL,
  dropped_frames INT,
  rtt_ms      INT
);
CREATE INDEX IF NOT EXISTS idx_stream_metrics_samples_session
  ON stream_metrics_samples(session_id, sampled_at);
CREATE INDEX IF NOT EXISTS idx_stream_metrics_samples_user_time
  ON stream_metrics_samples(user_id, sampled_at DESC);

-- Gap 4: User-uploaded local recording blobs (distinct from server-side HLS recordings)
CREATE TABLE IF NOT EXISTS stream_local_uploads (
  id           BIGSERIAL    PRIMARY KEY,
  user_id      BIGINT       NOT NULL,
  session_id   TEXT,
  storage_path TEXT         NOT NULL,
  public_url   TEXT         NOT NULL,
  size_bytes   BIGINT       NOT NULL,
  duration_sec INT,
  mime_type    TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stream_local_uploads_user_time
  ON stream_local_uploads(user_id, created_at DESC);

-- Gap 5: Scene presets
CREATE TABLE IF NOT EXISTS stream_scene_presets (
  id         BIGSERIAL    PRIMARY KEY,
  user_id    BIGINT       NOT NULL,
  name       TEXT         NOT NULL,
  config     JSONB        NOT NULL,
  is_default BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stream_scene_presets_user
  ON stream_scene_presets(user_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_stream_scene_presets_user_name
  ON stream_scene_presets(user_id, name);

-- Gap 5: Mixer presets
CREATE TABLE IF NOT EXISTS stream_mixer_presets (
  id         BIGSERIAL    PRIMARY KEY,
  user_id    BIGINT       NOT NULL,
  name       TEXT         NOT NULL,
  config     JSONB        NOT NULL,
  is_default BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stream_mixer_presets_user
  ON stream_mixer_presets(user_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_stream_mixer_presets_user_name
  ON stream_mixer_presets(user_id, name);
