-- Migration 235: allow 'btcpay' and 'dash' in payments.provider
--
-- Reason: grantEntitlementsForPlan accepts source='btcpay' as the third
-- argument and routes.js BTCPay flows can route through PaymentModel paths
-- that may insert into `payments`. The current CHECK constraint excludes
-- both, which would crash any future code path that tries to write a Dash
-- payment to the unified `payments` table.
--
-- This is additive; no existing rows are affected.

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_provider_valid;

ALTER TABLE payments ADD CONSTRAINT payments_provider_valid
  CHECK (provider IS NULL OR provider IN (
    'epayco', 'daimo', 'paypal', 'stripe', 'manual', 'btcpay', 'dash'
  ));
