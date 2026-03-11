-- Migration 140: Events system (Live & Hangout scheduled events)
-- Allows models to schedule live streams and any user to schedule hangout events

CREATE TABLE IF NOT EXISTS events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('live_stream', 'hangout_event')),
  title         TEXT NOT NULL,
  description   TEXT,
  cover_image   TEXT,
  scheduled_at  TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  status        TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'live', 'ended', 'cancelled')),
  is_featured   BOOLEAN NOT NULL DEFAULT FALSE,
  max_attendees INTEGER,
  hangout_group_id INTEGER REFERENCES hangout_groups(id) ON DELETE SET NULL,
  tags          TEXT[] DEFAULT '{}',
  rsvp_count    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_events_creator      ON events(creator_id);
CREATE INDEX IF NOT EXISTS idx_events_status       ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_scheduled_at ON events(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_events_type         ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_featured     ON events(is_featured) WHERE is_featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_event_rsvps_user    ON event_rsvps(user_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_events_updated_at ON events;
CREATE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_events_updated_at();
