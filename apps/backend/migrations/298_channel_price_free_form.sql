-- Migration 298: Remove fixed-tier price constraint on creator_channels.
-- The Stripe-tied tiers (0, 4.99, 9.99, 14.99) are obsolete since Stripe was
-- removed. NowPayments and BTCPay accept any amount. Creators should be free
-- to set any price between $1.99 and $499.
ALTER TABLE creator_channels DROP CONSTRAINT IF EXISTS chk_channel_price;
