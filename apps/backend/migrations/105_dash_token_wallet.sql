-- Migration 105: Dash Token Wallet System
-- Token-based tipping powered by Dash Pay via BTCPay Server
-- 1 token = $1 USD equivalent

-- User token wallet (one per user)
CREATE TABLE IF NOT EXISTS user_token_wallets (
  id              SERIAL PRIMARY KEY,
  user_id         VARCHAR(255) NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance_tokens  INTEGER NOT NULL DEFAULT 0 CHECK (balance_tokens >= 0),
  dash_dpns       VARCHAR(255),          -- optional: e.g. "alice.dash"
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_token_wallets_user_id ON user_token_wallets(user_id);

-- Token purchase records (Dash via BTCPay Server)
CREATE TABLE IF NOT EXISTS token_purchases (
  id                  SERIAL PRIMARY KEY,
  user_id             VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tokens_credited     INTEGER NOT NULL CHECK (tokens_credited > 0),
  dash_amount         NUMERIC(18, 8),        -- actual DASH amount at time of payment
  usd_amount          NUMERIC(10, 2) NOT NULL,
  btcpay_invoice_id   VARCHAR(255) UNIQUE,   -- BTCPay Server invoice ID (idempotency key)
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'paid', 'expired', 'invalid')),
  payment_method      VARCHAR(50) DEFAULT 'dash',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_token_purchases_user_id  ON token_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_token_purchases_invoice  ON token_purchases(btcpay_invoice_id);
CREATE INDEX IF NOT EXISTS idx_token_purchases_status   ON token_purchases(status);

-- Add payment_method column to pnp_tips to track token vs daimo tips
ALTER TABLE pnp_tips
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'daimo';
