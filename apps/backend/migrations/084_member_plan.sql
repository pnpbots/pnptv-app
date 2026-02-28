-- Migration 084: Add member_monthly plan
-- PNP Member tier at $4.99/month (tier: member, not PRIME)

INSERT INTO plans (id, sku, name, name_es, price, currency, duration_days, features, features_es, active, created_at, updated_at)
VALUES (
  'member_monthly',
  'EASYBOTS-PNP-M30',
  'PNP Member',
  'PNP Miembro',
  4.99,
  'USD',
  30,
  '["Private hangout rooms","Social feed access","Nearby users discovery"]',
  '["Salas de hangout privadas","Acceso al feed social","Descubrimiento de usuarios cercanos"]',
  true,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  sku = EXCLUDED.sku,
  name = EXCLUDED.name,
  name_es = EXCLUDED.name_es,
  price = EXCLUDED.price,
  currency = EXCLUDED.currency,
  duration_days = EXCLUDED.duration_days,
  features = EXCLUDED.features,
  features_es = EXCLUDED.features_es,
  active = EXCLUDED.active,
  updated_at = NOW();
