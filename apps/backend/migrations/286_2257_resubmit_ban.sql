-- Migration 286: 2257 resubmission tracking and 6-month ban support
-- Adds resubmit counter and ban column so admins can re-reject approved records
-- and the system enforces a 6-month cooldown after a second rejection.

ALTER TABLE creator_2257_records
  ADD COLUMN IF NOT EXISTS resubmission_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS banned_from_applying_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_2257_banned_until
  ON creator_2257_records (banned_from_applying_until)
  WHERE banned_from_applying_until IS NOT NULL;
