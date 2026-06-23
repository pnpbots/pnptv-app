-- Add idempotency_key to pnp_tips for atomic dedup of token tips
ALTER TABLE pnp_tips
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pnp_tips_idempotency_key
  ON pnp_tips (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
