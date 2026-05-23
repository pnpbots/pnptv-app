-- Migration 255: Standardise creator channel price tiers to 3 fixed points
-- Stripe product "Creator Content" (prod_UZT2ogeGLowQgU) has prices at exactly these values.

-- 1. Migrate any existing rows with old price values to the nearest new tier
UPDATE creator_channels SET price_usd = 4.99  WHERE price_usd = 5;
UPDATE creator_channels SET price_usd = 9.99  WHERE price_usd = 10;
UPDATE creator_channels SET price_usd = 14.99 WHERE price_usd = 15;
UPDATE creator_channels SET price_usd = 9.99  WHERE price_usd IN (20, 25);

-- 2. Replace the old constraint (0, 5, 10, 15, 20, 25) with the new 4-value set
ALTER TABLE creator_channels DROP CONSTRAINT IF EXISTS chk_channel_price;

ALTER TABLE creator_channels ADD CONSTRAINT chk_channel_price
  CHECK (price_usd = ANY (ARRAY[0, 4.99, 9.99, 14.99]::numeric[]));
