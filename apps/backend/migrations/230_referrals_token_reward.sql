-- Migration 230: Replace day-based referral reward with PNP Live tokens (2026-04-25).
--
-- The referral reward used to be "+3 days PRIME for both parties" via direct
-- users.tier UPDATEs. That path was completely broken (violated
-- chk_tier_status_consistency, never granted real entitlements) and 0
-- redemptions had ever succeeded despite 828 codes being issued.
--
-- New reward (referrer only, granted when the referee buys a paid plan):
--   • week_pass or member-monthly → 1 PNP Live token
--   • any other paid plan          → 3 PNP Live tokens
--
-- Tokens are credited to user_token_wallets via tokenService.creditTokens.
-- Attribution happens at redeem time (status='pending'), reward fires once
-- per referee from grantEntitlementsForPlan (status='completed').
--
-- Idempotent — IF NOT EXISTS guard.

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS reward_tokens INTEGER NOT NULL DEFAULT 0
    CHECK (reward_tokens >= 0);

COMMENT ON COLUMN referrals.reward_tokens IS
  'PNP Live tokens credited to the referrer when the referee bought their first paid plan. 0 while pending.';

-- The legacy reward_days column is kept for historical rows (currently 0
-- since no redemption ever succeeded). New redemptions ignore it.
COMMENT ON COLUMN referrals.reward_days IS
  'DEPRECATED: legacy day-based reward, superseded by reward_tokens (migration 230). Kept for historical rows.';
