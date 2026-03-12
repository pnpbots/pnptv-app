-- Migration 138: Creator availability schedules (weekly recurring slots for "Book a Call")
-- Separate from call_availability_slots which uses performers.id (Directus UUID).
-- This table uses creator_id → users.id (VARCHAR) for app-native creators.

CREATE TABLE IF NOT EXISTS creator_availability_schedules (
  id          SERIAL PRIMARY KEY,
  creator_id  VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun, 6=Sat
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  timezone    VARCHAR(100) NOT NULL DEFAULT 'UTC',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_schedule_times CHECK (end_time > start_time),
  UNIQUE (creator_id, day_of_week, start_time)
);

CREATE INDEX IF NOT EXISTS idx_creator_avail_creator
  ON creator_availability_schedules(creator_id)
  WHERE is_active = true;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_creator_avail_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_creator_avail_updated_at ON creator_availability_schedules;
CREATE TRIGGER trg_creator_avail_updated_at
  BEFORE UPDATE ON creator_availability_schedules
  FOR EACH ROW EXECUTE FUNCTION update_creator_avail_updated_at();
