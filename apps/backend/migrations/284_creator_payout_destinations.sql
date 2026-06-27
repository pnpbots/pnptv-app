-- Migration 284: Multi-destination payout wallet + new cashout lane enum.
-- 2026-06-27
--
-- Before: creators picked ONE payout method (dash | meru | fiat) stored in
-- payout_method + creator_dash_address / meru_account / fiat_payout_account.
--
-- After: creators save destinations for multiple lanes in a single jsonb blob.
-- They then pick a lane at cashout time. Cashout lanes are now:
--   meru, btc, dash, usdt_tron, usdt_base
-- The legacy bitrefill / transak lanes are removed (zero existing orders).
-- Legacy columns (creator_dash_address, meru_account, payout_method) stay
-- in place as read-only mirrors so existing reads don't break during testing.

BEGIN;

-- 1. New canonical store: { meru: {handle}, btc: {address}, dash: {address},
--                           usdt_tron: {address}, usdt_base: {address} }
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS creator_payout_destinations JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN users.creator_payout_destinations IS
  'Creator payout destinations keyed by lane. Each lane object has a single field — meru.handle, btc.address, dash.address, usdt_tron.address, usdt_base.address. Empty {} when nothing saved yet. Legacy creator_dash_address + meru_account columns mirror this.';

-- 2. Backfill from legacy columns.
UPDATE users
   SET creator_payout_destinations = creator_payout_destinations
       || jsonb_build_object('dash', jsonb_build_object('address', creator_dash_address))
 WHERE creator_dash_address IS NOT NULL
   AND creator_dash_address <> ''
   AND NOT (creator_payout_destinations ? 'dash');

UPDATE users
   SET creator_payout_destinations = creator_payout_destinations
       || jsonb_build_object('meru', jsonb_build_object('handle', meru_account))
 WHERE meru_account IS NOT NULL
   AND meru_account <> ''
   AND NOT (creator_payout_destinations ? 'meru');

-- 3. Swap fiat_cashout_orders.lane CHECK to the new lane set.
ALTER TABLE fiat_cashout_orders
  DROP CONSTRAINT IF EXISTS fiat_cashout_orders_lane_check;

ALTER TABLE fiat_cashout_orders
  ADD CONSTRAINT fiat_cashout_orders_lane_check
    CHECK (lane = ANY (ARRAY[
      'meru', 'btc', 'dash', 'usdt_tron', 'usdt_base'
    ]));

COMMENT ON COLUMN fiat_cashout_orders.lane IS
  'Payout rail. meru/btc/dash/usdt_tron/usdt_base. All currently manual-settled — operator dispatches from treasury.';

COMMIT;
