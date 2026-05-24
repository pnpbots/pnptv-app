-- Migration 257: Extend dash_subscription_orders status constraint for NOWPayments flows
--
-- The NOWPayments webhook IPN handler writes 'confirming', 'confirmed',
-- and 'partially_paid' statuses. The existing chk_dso_status constraint
-- (set by migration 233) only allows pending/completed/expired/invalid/failed.
-- Writing any intermediate status throws pg error 23514, making all
-- intermediate-status IPNs crash silently.
--
-- Fix: add the three new values.

ALTER TABLE dash_subscription_orders
  DROP CONSTRAINT IF EXISTS chk_dso_status;

ALTER TABLE dash_subscription_orders
  ADD CONSTRAINT chk_dso_status CHECK (status::text = ANY (ARRAY[
    'pending',
    'confirming',
    'confirmed',
    'partially_paid',
    'completed',
    'expired',
    'invalid',
    'failed'
  ]::text[]));
