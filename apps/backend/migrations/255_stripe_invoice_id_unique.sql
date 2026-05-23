ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS stripe_invoice_id VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_stripe_invoice_id
  ON payments (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;
