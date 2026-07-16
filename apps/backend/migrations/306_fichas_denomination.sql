-- Migration 306: Convert token balances to Fichas denomination
-- Before: 1 token = $1 USD
-- After:  100 Fichas = $1 USD (multiply all balances × 100)
--
-- Idempotency guard: skip if balances already look like Fichas.
-- Heuristic: if the median non-zero wallet balance is >= 100 the migration
-- has already run (pre-Fichas balances were typically 1–50 tokens).
DO $$
BEGIN
  IF (
    SELECT COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY balance_tokens), 0)
    FROM user_token_wallets
    WHERE balance_tokens > 0
  ) >= 100 THEN
    RAISE NOTICE 'Migration 306 skipped — balances already in Fichas denomination';
    RETURN;
  END IF;
END $$;

BEGIN;

-- Existing wallet balances
UPDATE user_token_wallets
SET
  balance_tokens = balance_tokens * 100,
  gifted_balance = gifted_balance * 100,
  updated_at     = NOW()
WHERE balance_tokens > 0 OR gifted_balance > 0;

-- Pending purchases not yet credited — update so webhook credits correct amount
UPDATE token_purchases
SET tokens_credited = tokens_credited * 100
WHERE status = 'pending';

COMMIT;
