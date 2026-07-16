-- Migration 306: Convert token balances to Fichas denomination
-- Before: 1 token = $1 USD
-- After:  100 Fichas = $1 USD (multiply all balances × 100)
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
