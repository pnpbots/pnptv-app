-- Migration 084: Add member_monthly plan
-- PNP Member tier at $4.99/month (tier: member, not PRIME)

INSERT INTO plans (id, sku, name, display_name, tier, price, currency, duration, duration_days, features, active, is_recurring, billing_interval, billing_interval_count, created_at, updated_at)
VALUES (
  'member_monthly',
  'EASYBOTS-PNP-M30',
  'PNP Member',
  'PNP Member',
  'member',
  4.99,
  'USD',
  30,
  30,
  '["Private hangout rooms","Social feed access","Nearby users discovery"]',
  true,
  true,
  'month',
  1,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  sku = EXCLUDED.sku,
  name = EXCLUDED.name,
  display_name = EXCLUDED.display_name,
  tier = EXCLUDED.tier,
  price = EXCLUDED.price,
  currency = EXCLUDED.currency,
  duration = EXCLUDED.duration,
  duration_days = EXCLUDED.duration_days,
  features = EXCLUDED.features,
  active = EXCLUDED.active,
  is_recurring = EXCLUDED.is_recurring,
  billing_interval = EXCLUDED.billing_interval,
  billing_interval_count = EXCLUDED.billing_interval_count,
  updated_at = NOW();
