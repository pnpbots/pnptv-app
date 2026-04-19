-- Migration 123: Drop legacy EVM payout columns from users.
--
-- Context: pre-Dash, creator payouts went out as USDC over EVM (Optimism/Base/etc.)
-- via Daimo or a treasury hot wallet. Both flows are retired:
--   • Daimo: scrubbed in migration era 121-122 + commit set
--   • Treasury USDC sweep: removed in creatorPayoutService.js
--
-- Every code path that read these columns has been refactored in this same
-- commit to read `creator_dash_address` instead (or, in the case of `payoutChainId`,
-- removed entirely from the API response).
--
-- This migration is destructive: any grandfathered EVM address still on file is
-- erased. We accept that loss because: (a) we have no remaining code that can
-- send USDC to those addresses, and (b) the address is in the creator's wallet,
-- not ours — they re-enter it themselves if they ever need it.

ALTER TABLE users
  DROP COLUMN IF EXISTS creator_wallet_address,
  DROP COLUMN IF EXISTS creator_payout_chain_id;
