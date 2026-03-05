-- Migration 104: Creator payout wallet address
-- Stores the Ethereum/Daimo wallet address for creator monthly payouts

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS creator_wallet_address TEXT,
  ADD COLUMN IF NOT EXISTS creator_wallet_verified BOOLEAN NOT NULL DEFAULT FALSE;
