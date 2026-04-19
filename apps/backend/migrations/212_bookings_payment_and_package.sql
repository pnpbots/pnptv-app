-- Migration 212: Add payment_id + package_id to bookings for Book-a-Call Dash flow.
-- Also adds a partial index that the slot-lock FOR UPDATE query can use efficiently.
-- Idempotent — safe to run multiple times.
BEGIN;

-- Link a booking to the payments row that funded it.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES payments(id) ON DELETE SET NULL;

-- Link a booking to the call_packages row selected at checkout time.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS package_id INTEGER REFERENCES call_packages(id) ON DELETE SET NULL;

-- Index for efficient slot-overlap look-ups and payment-based look-ups.
CREATE INDEX IF NOT EXISTS idx_bookings_payment_id
  ON bookings(payment_id) WHERE payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_performer_time_active
  ON bookings(performer_id, start_time_utc)
  WHERE status IN ('held', 'awaiting_payment', 'confirmed');

COMMIT;
