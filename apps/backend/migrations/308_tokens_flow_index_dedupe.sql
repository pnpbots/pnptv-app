-- Migration 308: drop redundant indexes on the token-purchase flow tables
--
-- Findings from the 2026-07-17 tokens-flow audit (DB agent M-3/M-4/M-5):
--   * user_token_wallets has both a UNIQUE constraint and a plain btree on user_id
--   * token_purchases has both an auto-created UNIQUE constraint index and a
--     plain btree on btcpay_invoice_id
--   * token_purchases has both a full and a partial index on stripe_session_id
--   * dash_subscription_orders has the same UNIQUE + plain index duplication
--     on btcpay_invoice_id
--
-- Plus an FK gap: dash_subscription_orders.user_id had no FK on users.id
-- despite storing 52K+ rows. Add ON DELETE CASCADE to match token_purchases.
--
-- All operations are IF EXISTS / IF NOT EXISTS so this can re-run safely.

-- Redundant indexes ---------------------------------------------------------
DROP INDEX IF EXISTS idx_user_token_wallets_user_id;
DROP INDEX IF EXISTS idx_token_purchases_invoice;
DROP INDEX IF EXISTS idx_token_purchases_stripe_session;
DROP INDEX IF EXISTS idx_dash_sub_orders_invoice;

-- Missing indexes -----------------------------------------------------------
-- Partial covering index for the NowPayments branch of getPurchaseHistory().
CREATE INDEX IF NOT EXISTS idx_dso_token_purchases_history
  ON dash_subscription_orders (user_id, created_at DESC)
  WHERE plan_id = 'token_purchase';

CREATE INDEX IF NOT EXISTS idx_tp_user_history
  ON token_purchases (user_id, created_at DESC);

-- Missing FK ----------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_dso_user_id'
      AND conrelid = 'dash_subscription_orders'::regclass
  ) THEN
    ALTER TABLE dash_subscription_orders
      ADD CONSTRAINT fk_dso_user_id
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      NOT VALID;
    -- NOT VALID skips the initial full-table validation; new rows are
    -- enforced immediately. Run VALIDATE separately if a full sweep is
    -- desired: ALTER TABLE dash_subscription_orders VALIDATE CONSTRAINT fk_dso_user_id;
  END IF;
END $$;
