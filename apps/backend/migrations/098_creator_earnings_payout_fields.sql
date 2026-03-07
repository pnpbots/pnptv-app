-- 098: Add missing paid_at and metadata columns to creator_earnings
-- Required by creatorPayoutService.js for payout tracking and idempotency
ALTER TABLE creator_earnings ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE creator_earnings ADD COLUMN IF NOT EXISTS metadata JSONB;
