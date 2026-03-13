-- 157: Add next_show_date to performers table
-- Stores the creator's next available show/call date, auto-computed from availability schedules.

ALTER TABLE performers
  ADD COLUMN IF NOT EXISTS next_show_date TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_performers_next_show
  ON performers (next_show_date)
  WHERE next_show_date IS NOT NULL AND status = 'active';

COMMENT ON COLUMN performers.next_show_date IS
  'Next available call/show date, auto-computed from creator_availability_schedules';
