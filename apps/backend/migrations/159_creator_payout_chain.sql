-- Migration 159: Add creator payout chain preference
-- Allows creators to choose which EVM chain to receive USDC payouts on
ALTER TABLE users ADD COLUMN IF NOT EXISTS creator_payout_chain_id INTEGER NOT NULL DEFAULT 10;

COMMENT ON COLUMN users.creator_payout_chain_id IS 'EVM chain ID for USDC payouts (10=Optimism, 8453=Base, 42161=Arbitrum, 137=Polygon, 1=Ethereum)';
