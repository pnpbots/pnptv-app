-- Migration 122: Switch creator outbound payouts from Daimo USDC (on-chain push)
-- to Dash via BTCPay Server Pull Payments (creator-claimed).
--
-- Two changes:
--   1. users.creator_dash_address — separate from creator_wallet_address (which
--      is the legacy 0x EVM address kept for the final USDC sweep). Lets a
--      creator set their Dash address without losing the EVM record while we
--      drain in-flight USDC payouts.
--
--   2. creator_payouts — first-class payout tracking. Old design wedged payout
--      metadata into creator_earnings.metadata which made it impossible to
--      query "what payouts have I created?" without scanning every earning row.
--      Each row links one BTCPay pull payment to the underlying earnings.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS creator_dash_address VARCHAR(64);

CREATE TABLE IF NOT EXISTS creator_payouts (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id              VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_usd              NUMERIC(10,2) NOT NULL,
  method                  VARCHAR(20)   NOT NULL DEFAULT 'dash_btcpay',
                                                        -- 'dash_btcpay' | 'bank_transfer' | 'manual_usdc'
  btcpay_pull_payment_id  VARCHAR(255),
  view_url                TEXT,
  status                  VARCHAR(20)   NOT NULL DEFAULT 'pending',
                                                        -- pending | claimed | completed | expired | cancelled
  earning_ids             UUID[]        NOT NULL,       -- links back to creator_earnings rows
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  claimed_at              TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  notes                   TEXT
);

CREATE INDEX IF NOT EXISTS idx_creator_payouts_creator       ON creator_payouts(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_payouts_status        ON creator_payouts(status);
CREATE INDEX IF NOT EXISTS idx_creator_payouts_pullpayment   ON creator_payouts(btcpay_pull_payment_id)
  WHERE btcpay_pull_payment_id IS NOT NULL;

-- Allow creator_earnings.status to carry an intermediate "in_payout" state so
-- earnings tied to a pending pull payment cannot be double-paid by the next cron run.
ALTER TABLE creator_earnings
  DROP CONSTRAINT IF EXISTS creator_earnings_status_check;

ALTER TABLE creator_earnings
  ADD CONSTRAINT creator_earnings_status_check
  CHECK (status IN ('pending', 'available', 'in_payout', 'paid_out'));
