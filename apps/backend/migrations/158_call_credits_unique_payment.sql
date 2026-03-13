-- 158: Add UNIQUE constraint to call_credits.payment_id
-- Prevents double-grant on concurrent webhooks (e.g. two simultaneous ePayco callbacks).
-- The application-level idempotency guard in callCheckoutService.js provides a fast path,
-- but this DB constraint is the last-resort safety net against race conditions.

ALTER TABLE call_credits ADD CONSTRAINT uq_call_credits_payment_id UNIQUE (payment_id);
