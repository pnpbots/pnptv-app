-- Migration 156: Book-a-Call Audit Fixes
-- Idempotent — safe to run multiple times
BEGIN;

-- DB-H1: Add break_minutes to creator_availability_schedules
ALTER TABLE creator_availability_schedules
  ADD COLUMN IF NOT EXISTS break_minutes SMALLINT NOT NULL DEFAULT 10;

-- MED-01: Add credit_id to bookings (links booking row → call_credits row)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS credit_id INTEGER;

-- MED-01: Idempotent FK from bookings.credit_id → call_credits.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_bookings_credit_id'
      AND table_name = 'bookings'
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT fk_bookings_credit_id
      FOREIGN KEY (credit_id) REFERENCES call_credits(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- DB-C1: Document existing schema — create tables if they don't exist yet
-- (They should already exist from migration 154, but this makes the migration self-contained)
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id),
  performer_id INTEGER REFERENCES performers(id),
  slot_id UUID,
  call_type TEXT NOT NULL DEFAULT 'video',
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  price_cents INTEGER DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  start_time_utc TIMESTAMPTZ,
  end_time_utc TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft',
  hold_expires_at TIMESTAMPTZ,
  cancel_reason TEXT,
  cancelled_by TEXT,
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  rules_accepted_at TIMESTAMPTZ,
  credit_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_payment_id TEXT,
  payment_link TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'created',
  expires_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  refund_reason TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup of bookings by credit_id
CREATE INDEX IF NOT EXISTS idx_bookings_credit_id ON bookings(credit_id) WHERE credit_id IS NOT NULL;

COMMIT;
