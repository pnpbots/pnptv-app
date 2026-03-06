-- 116: Drop confirmed-empty, unreferenced legacy tables
-- Verified 2026-03-06: all have 0 rows and no active code paths

DROP TABLE IF EXISTS pnp_live_promo_usage CASCADE;
DROP TABLE IF EXISTS pnp_live_promo_codes CASCADE;
DROP TABLE IF EXISTS meet_greet_payments CASCADE;
DROP TABLE IF EXISTS meet_greet_bookings CASCADE;
DROP TABLE IF EXISTS booking_payments CASCADE;
DROP TABLE IF EXISTS model_bookings CASCADE;
DROP TABLE IF EXISTS pnp_bookings CASCADE;
DROP TABLE IF EXISTS pnp_payments CASCADE;
DROP TABLE IF EXISTS pnp_models CASCADE;
DROP TABLE IF EXISTS recurring_subscriptions CASCADE;
DROP TABLE IF EXISTS subscription_expiry_queue CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
