-- Migration 118: stream_overlays table
-- Stores per-channel overlay configuration for live streams:
-- logo image placement, banner text, styling, and active state.
-- Controlled exclusively by admins via the admin panel.
-- channel_ref matches users.live_channel (the Restreamer slug, e.g. 'pnptv-santino').
-- One row per channel; upserted by the admin overlay editor.

-- ============================================================
-- UP
-- ============================================================

CREATE TABLE IF NOT EXISTS stream_overlays (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Restreamer channel reference slug. Must match users.live_channel.
  -- UNIQUE enforces one overlay config per channel.
  channel_ref      VARCHAR(100)  NOT NULL UNIQUE,

  -- Logo overlay settings
  logo_url         TEXT,
  logo_position    VARCHAR(20)   NOT NULL DEFAULT 'top-right'
                     CHECK (logo_position IN ('top-left', 'top-right', 'bottom-left', 'bottom-right')),
  logo_size        INTEGER       NOT NULL DEFAULT 80
                     CHECK (logo_size BETWEEN 10 AND 500),
  logo_opacity     REAL          NOT NULL DEFAULT 0.8
                     CHECK (logo_opacity BETWEEN 0.0 AND 1.0),

  -- Banner overlay settings
  banner_text      TEXT,
  banner_position  VARCHAR(20)   NOT NULL DEFAULT 'bottom'
                     CHECK (banner_position IN ('top', 'bottom')),
  banner_bg_color  VARCHAR(20)   NOT NULL DEFAULT 'rgba(0,0,0,0.7)',
  banner_text_color VARCHAR(20)  NOT NULL DEFAULT '#ffffff',
  banner_style     VARCHAR(20)   NOT NULL DEFAULT 'static'
                     CHECK (banner_style IN ('static', 'scroll')),

  -- Operational flags
  is_active        BOOLEAN       NOT NULL DEFAULT true,

  -- Audit
  updated_by       VARCHAR(100),           -- admin users.id who last modified this row
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Fast lookup by channel_ref (also serves UNIQUE constraint, but an explicit
-- B-tree index is named for clarity and to support partial/covering scans).
CREATE INDEX IF NOT EXISTS idx_stream_overlays_channel_ref
  ON stream_overlays (channel_ref);

-- Partial index: quickly fetch all currently active overlays (used by the
-- frontend overlay renderer to filter only active configs without a full scan).
CREATE INDEX IF NOT EXISTS idx_stream_overlays_active
  ON stream_overlays (channel_ref)
  WHERE is_active = true;

-- Auto-update updated_at on every row change.
CREATE OR REPLACE FUNCTION stream_overlays_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stream_overlays_updated_at ON stream_overlays;
CREATE TRIGGER trg_stream_overlays_updated_at
  BEFORE UPDATE ON stream_overlays
  FOR EACH ROW EXECUTE FUNCTION stream_overlays_set_updated_at();

COMMENT ON TABLE stream_overlays IS
  'Admin-controlled visual overlay configuration per Restreamer live-stream channel.';
COMMENT ON COLUMN stream_overlays.channel_ref IS
  'Restreamer channel slug; matches users.live_channel (e.g. pnptv-santino).';
COMMENT ON COLUMN stream_overlays.logo_opacity IS
  '0.0 = fully transparent, 1.0 = fully opaque.';
COMMENT ON COLUMN stream_overlays.updated_by IS
  'users.id (VARCHAR) of the admin who last saved this overlay config.';

-- Seed: one default row for each of the five known Restreamer channels.
-- All settings stay at defaults (logo_url NULL = no logo, banner_text NULL = no banner).
-- ON CONFLICT DO NOTHING makes this idempotent (safe to re-run).
INSERT INTO stream_overlays (channel_ref) VALUES
  ('pnptv-main'),
  ('pnptv-lex'),
  ('pnptv-santino'),
  ('pnptv-milo'),
  ('pnptv-frank')
ON CONFLICT (channel_ref) DO NOTHING;

-- ============================================================
-- DOWN (reverse with: psql -f <(sed -n '/^-- DOWN/,$ p' 118_stream_overlays.sql))
-- ============================================================
-- DROP TRIGGER IF EXISTS trg_stream_overlays_updated_at ON stream_overlays;
-- DROP FUNCTION IF EXISTS stream_overlays_set_updated_at();
-- DROP TABLE IF EXISTS stream_overlays;
