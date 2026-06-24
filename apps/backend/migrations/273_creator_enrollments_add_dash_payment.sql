-- Migration 273: Add 'dash' to creator_enrollments payment_method CHECK constraint
-- The enrollment wizard defaults to Dash, and creatorService validates it as a
-- valid method, but the original constraint only listed ('meru', 'usdc', 'usdt').
-- Every Dash enrollment was failing with a DB constraint violation.

ALTER TABLE creator_enrollments
  DROP CONSTRAINT creator_enrollments_payment_method_check;

ALTER TABLE creator_enrollments
  ADD CONSTRAINT creator_enrollments_payment_method_check
  CHECK (payment_method IN ('dash', 'meru', 'usdc', 'usdt'));
