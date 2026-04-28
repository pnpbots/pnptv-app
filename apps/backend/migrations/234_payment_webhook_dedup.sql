-- Migration 234: enforce uniqueness on payment_webhook_events for idempotency
--
-- Reason: ePayco webhook processing currently dedupes only via a 2-minute
-- Redis lock (paymentService.processEpaycoWebhook). On a Redis flush a
-- delayed redelivery + a recovery-cron synthetic replay can race within the
-- TTL window and both proceed. The payment_webhook_events table already
-- exists (logger-only, 559 rows) — converting it into a permanent
-- idempotency surface closes the race for free.
--
-- Step 1: clean up historical duplicates. Keep the earliest row per
-- (provider, event_id, state_code) tuple.
WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY provider, event_id, state_code
           ORDER BY created_at, id
         ) AS rn
  FROM payment_webhook_events
  WHERE event_id IS NOT NULL
)
DELETE FROM payment_webhook_events
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

-- Step 2: enforce uniqueness going forward. Partial index — events without
-- an event_id (rare, malformed deliveries) are still loggable but can't be
-- deduped; that's an acceptable trade-off versus blocking valid logs.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_webhook_events_dedup
  ON payment_webhook_events (provider, event_id, state_code)
  WHERE event_id IS NOT NULL;
