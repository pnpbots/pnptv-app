-- Add unique constraint on creator_earnings.source_payment_id to prevent
-- double-earnings on concurrent webhook delivery for call package payments.
ALTER TABLE creator_earnings
  ADD CONSTRAINT uq_creator_earnings_source_payment
  UNIQUE (source_payment_id);
