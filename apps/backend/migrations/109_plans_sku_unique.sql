-- Add unique constraint on plans.sku to prevent duplicate payment SKUs
-- Prevents ambiguity when a payment provider references a SKU
ALTER TABLE plans ADD CONSTRAINT plans_sku_unique UNIQUE (sku);
