-- Migration 233: dash_subscription_orders.notes column + 'failed' status
--
-- The webhook handler (routes.js ~7715, ~7757, etc.) and reconciler
-- (paymentRecoveryService.js ~301) write to a `notes` column that never
-- existed. The same SQL also tries to set status='failed', which the
-- chk_dso_status check constraint rejects. Both bugs cause the error
-- branches to crash silently inside catch blocks, leaving orders stuck
-- pending and operators blind to the failure mode.
--
-- This migration:
--   1. Adds notes TEXT column (NULL allowed)
--   2. Replaces chk_dso_status to also allow 'failed'

ALTER TABLE dash_subscription_orders
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE dash_subscription_orders
  DROP CONSTRAINT IF EXISTS chk_dso_status;

ALTER TABLE dash_subscription_orders
  ADD CONSTRAINT chk_dso_status
  CHECK (status::text = ANY (ARRAY[
    'pending'::varchar,
    'completed'::varchar,
    'expired'::varchar,
    'invalid'::varchar,
    'failed'::varchar
  ]::text[]));
