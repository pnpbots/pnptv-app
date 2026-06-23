-- Migration 268: fix two payment infrastructure gaps found via simulation
-- 1. payments.transaction_id: add partial unique index (rows without a txid remain unaffected)
-- 2. confirmation_tokens.check_provider: expand to cover all active payment providers

-- ── 1. payments unique index ──────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_transaction_id_unique
  ON payments (transaction_id)
  WHERE transaction_id IS NOT NULL;

-- ── 2. confirmation_tokens.payment_id: make nullable ─────────────────────
-- payment_id is a FK to payments.id, but NowPayments/BTCPay call
-- deliverPurchaseConfirmation without a payments.id at token-generation time.
-- NULL is correct here — FK still enforces non-null rows.
ALTER TABLE confirmation_tokens ALTER COLUMN payment_id DROP NOT NULL;

-- ── 3. confirmation_tokens provider constraint ────────────────────────────
-- Drop the old constraint that only allowed paypal/daimo/epayco, then recreate
-- to include all active providers (nowpayments, btcpay, stripe, manual, dash).
ALTER TABLE confirmation_tokens DROP CONSTRAINT IF EXISTS check_provider;

ALTER TABLE confirmation_tokens ADD CONSTRAINT check_provider
  CHECK (provider IN (
    'epayco',
    'nowpayments',
    'btcpay',
    'stripe',
    'daimo',
    'paypal',
    'manual',
    'dash'
  ));
