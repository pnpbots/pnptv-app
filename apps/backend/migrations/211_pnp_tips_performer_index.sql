-- Migration 211: Composite index on pnp_tips for creator-revenue aggregations.
--
-- The revenue dashboard query (getCreatorRevenue) groups by (performer_id,
-- payment_status, created_at) across time ranges. Existing idx_pnp_tips_model
-- only covers model_id and makes the revenue query scan at high tip counts.
--
-- CONCURRENTLY so it doesn't lock writes; safe to re-run via IF NOT EXISTS.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pnp_tips_performer_status_created
  ON pnp_tips (performer_id, payment_status, created_at DESC);
