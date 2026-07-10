-- Migration 300: EfiPay support for token purchases
--
-- Adds efipay_payment_id + unique index so the /api/internal/efipay-reseller/grant
-- callback can attribute an easybots-mediated EfiPay payment to exactly one
-- token_purchases row. Enforces idempotency at the DB level.

ALTER TABLE token_purchases
  ADD COLUMN IF NOT EXISTS efipay_payment_id VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_token_purchases_efipay_payment_id
  ON token_purchases (efipay_payment_id)
  WHERE efipay_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_token_purchases_efipay_pending
  ON token_purchases (status, created_at)
  WHERE status = 'pending' AND efipay_payment_id IS NOT NULL;
