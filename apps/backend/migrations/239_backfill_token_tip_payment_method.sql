-- Migration 239: Backfill stale payment_method='daimo' on token tips.
--
-- Prior to the CRIT-02 fix, processTipWithTokens did not set payment_method
-- explicitly when inserting into pnp_tips. Rows were written with whatever
-- column default the DB had — which for some installations defaulted to
-- 'daimo'. This broke the idempotency check in routes.js, which correctly
-- filters on payment_method = 'tokens'.
--
-- The TOKEN- prefix on transaction_id is the definitive marker of a token tip
-- (set in processTipWithTokens with `TOKEN-${uuid}`). Any row with that prefix
-- that still carries payment_method='daimo' is a false value from the missing
-- explicit set — this UPDATE corrects them.

UPDATE pnp_tips
   SET payment_method = 'tokens'
 WHERE payment_method = 'daimo'
   AND transaction_id LIKE 'TOKEN-%';
