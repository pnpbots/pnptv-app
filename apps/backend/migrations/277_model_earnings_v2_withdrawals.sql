-- Migration 277: Upgrade model_earnings schema + add withdrawals tables
-- The modelEarningsModel and withdrawalModel were written against a new schema
-- that was never applied to the DB. This migration:
--   1. Adds missing columns to model_earnings (non-destructive, keeps old cols)
--   2. Creates withdrawals table
--   3. Creates withdrawal_audit_log table

-- ── model_earnings: add missing columns ──────────────────────────────────────
ALTER TABLE model_earnings
  ADD COLUMN IF NOT EXISTS earnings_type    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS source_id        VARCHAR(255),
  ADD COLUMN IF NOT EXISTS source_type      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS amount_usd       NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS amount_cop       NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS platform_fee_usd NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS status           VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT NOW();

-- Back-fill amount_usd from existing amount column for old rows
UPDATE model_earnings SET amount_usd = amount WHERE amount_usd IS NULL AND amount IS NOT NULL;
-- Back-fill status from payment_status for old rows
UPDATE model_earnings SET status = payment_status WHERE status IS NULL AND payment_status IS NOT NULL;

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_model_earnings_model_id ON model_earnings(model_id);
CREATE INDEX IF NOT EXISTS idx_model_earnings_status   ON model_earnings(status);

-- ── withdrawals ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS withdrawals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id           VARCHAR(255) NOT NULL,
  amount_usd         NUMERIC(10,2) NOT NULL,
  amount_cop         NUMERIC(12,2),
  method             VARCHAR(50)  NOT NULL DEFAULT 'dash',
  status             VARCHAR(20)  NOT NULL DEFAULT 'pending',
  reason             TEXT,
  response_code      VARCHAR(50),
  response_message   TEXT,
  transaction_id     VARCHAR(255),
  external_reference VARCHAR(255),
  requested_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  approved_at        TIMESTAMPTZ,
  processed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_model_id ON withdrawals(model_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status   ON withdrawals(status);

-- ── withdrawal_audit_log ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS withdrawal_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_id UUID NOT NULL REFERENCES withdrawals(id) ON DELETE CASCADE,
  action        VARCHAR(50)  NOT NULL,
  old_status    VARCHAR(20),
  new_status    VARCHAR(20),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_audit_withdrawal_id ON withdrawal_audit_log(withdrawal_id);
