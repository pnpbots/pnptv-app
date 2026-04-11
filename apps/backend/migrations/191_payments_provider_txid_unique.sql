-- Migration 191: Defence-in-depth uniqueness for (provider, transaction_id).
--
-- Rationale:
--   Webhook idempotency today relies on a Redis lock keyed on x_ref_payco + state
--   plus a CAS guard (status != 'completed') on the UPDATE. If Redis is evicted or
--   the CAS window races (two workers read the same row simultaneously), a duplicate
--   grant is still theoretically possible. A partial unique index on
--   (provider, transaction_id) makes duplicate completed rows impossible at the
--   storage layer, closing the race for good.
--
--   The index is partial (WHERE transaction_id IS NOT NULL) because:
--     - transaction_id is only populated after a provider webhook arrives
--     - pending rows legitimately have NULL transaction_id and must not collide
--
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS is safe to re-run.
--
-- Pre-flight: if this migration fails due to existing duplicates, inspect with:
--   SELECT provider, transaction_id, count(*), array_agg(id)
--     FROM payments
--    WHERE transaction_id IS NOT NULL
--    GROUP BY provider, transaction_id
--   HAVING count(*) > 1;
-- Resolve by marking all but the canonical row as status='duplicate' (new status
-- value) or by nulling transaction_id on the non-canonical rows. DO NOT delete
-- payment rows — they carry audit history.

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_txid_unique
  ON payments (provider, transaction_id)
  WHERE transaction_id IS NOT NULL;

COMMENT ON INDEX payments_provider_txid_unique IS
  'Defence-in-depth: prevents duplicate completion of the same provider transaction. Added 2026-04 after ePayco audit.';
