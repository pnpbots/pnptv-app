-- Migration 130: Persistent streamer settings per user
-- Stores encoder quality, streaming options, and visual filter preferences.
--
-- users.pnptv_id has a partial unique index (WHERE pnptv_id IS NOT NULL) but
-- no formal UNIQUE constraint, so it cannot be referenced as a FK target.
-- We promote it to a full unique constraint here first.

ALTER TABLE users
  ADD CONSTRAINT users_pnptv_id_unique UNIQUE (pnptv_id);

CREATE TABLE IF NOT EXISTS streamer_settings (
  user_id           TEXT        PRIMARY KEY REFERENCES users(pnptv_id) ON DELETE CASCADE,

  -- Encoder quality
  quality_preset    TEXT        NOT NULL DEFAULT '720p'
                                CHECK (quality_preset IN ('360p', '480p', '720p', '1080p')),
  fps               INTEGER     NOT NULL DEFAULT 30
                                CHECK (fps IN (24, 30, 60)),

  -- Streaming options
  auto_reconnect    BOOLEAN     NOT NULL DEFAULT TRUE,
  low_latency       BOOLEAN     NOT NULL DEFAULT TRUE,
  hardware_accel    BOOLEAN     NOT NULL DEFAULT FALSE,
  local_record      BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Visual filters
  filter_preset     TEXT        NOT NULL DEFAULT 'None'
                                CHECK (filter_preset IN ('None', 'Vivid', 'Warm', 'Cool', 'B&W', 'Cinematic', 'Night', 'Glow')),
  filter_brightness INTEGER     NOT NULL DEFAULT 0
                                CHECK (filter_brightness BETWEEN -100 AND 100),
  filter_contrast   INTEGER     NOT NULL DEFAULT 0
                                CHECK (filter_contrast BETWEEN -100 AND 100),
  filter_saturation INTEGER     NOT NULL DEFAULT 0
                                CHECK (filter_saturation BETWEEN -100 AND 100),
  filter_warmth     INTEGER     NOT NULL DEFAULT 0
                                CHECK (filter_warmth BETWEEN -50 AND 50),
  filter_sharpness  INTEGER     NOT NULL DEFAULT 0
                                CHECK (filter_sharpness BETWEEN 0 AND 100),
  beauty_mode       BOOLEAN     NOT NULL DEFAULT FALSE,

  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE streamer_settings IS 'Persistent encoder and filter preferences for each streamer, keyed by pnptv_id.';
