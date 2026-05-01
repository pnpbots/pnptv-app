-- Migration 240: Wellness break day tracking.
--
-- Adds two columns so we can display a lifetime "wellness days" counter on
-- every user profile — a positive, empowering signal of self-care commitment.
--
--   wellness_mode_started_at  — when the current (or most recent) session began.
--     Set on first enable, cleared when the session is fully disabled.
--   wellness_days_accumulated — running total of calendar days spent in
--     wellness mode across all past sessions. Incremented on disable using
--     EXTRACT(EPOCH FROM NOW() - wellness_mode_started_at)/86400, rounded up.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS wellness_mode_started_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS wellness_days_accumulated INTEGER NOT NULL DEFAULT 0;
