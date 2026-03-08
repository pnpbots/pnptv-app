-- Migration 120: Add purchase_uuid and checkout_data to token_purchases
-- purchase_uuid is the externally-visible, URL-safe identifier used by TokenCheckoutService.
-- checkout_data stores Daimo session credentials so the checkout page can render
-- the payment widget without a round-trip to the Daimo API.

ALTER TABLE token_purchases
  ADD COLUMN IF NOT EXISTS purchase_uuid  UUID UNIQUE DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS checkout_data  JSONB;

-- Backfill any existing rows that are NULL (the DEFAULT only fires on INSERT)
UPDATE token_purchases
SET purchase_uuid = gen_random_uuid()
WHERE purchase_uuid IS NULL;

-- Enforce NOT NULL now that backfill is done
ALTER TABLE token_purchases
  ALTER COLUMN purchase_uuid SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_token_purchases_purchase_uuid
  ON token_purchases(purchase_uuid);

COMMENT ON COLUMN token_purchases.purchase_uuid IS
  'External UUID used in checkout URLs (/token-checkout/:uuid). Separate from the integer PK.';

COMMENT ON COLUMN token_purchases.checkout_data IS
  'JSONB blob storing provider-specific session data (e.g. daimo_session_id, daimo_client_secret).';
