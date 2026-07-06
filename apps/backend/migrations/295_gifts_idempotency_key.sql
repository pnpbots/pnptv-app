-- Add idempotency key to gifts table to prevent duplicate rows on concurrent admin calls.
ALTER TABLE gifts ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE gifts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE gifts ADD CONSTRAINT gifts_idempotency_key_unique UNIQUE (idempotency_key);
