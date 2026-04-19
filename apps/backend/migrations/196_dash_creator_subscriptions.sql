-- Migration 121: Allow Dash subscription orders to carry a creator_id so the
-- BTCPay/Dash flow can support per-creator subscriptions (creator_monthly plan)
-- with the same 80/20 (or 70/30) revenue split as the ePayco path.
--
-- Without this column, /api/webapp/payments/dash/create has no way to route a
-- settled invoice through CreatorService.subscribeToCreator(), so the creator
-- never gets credited.

ALTER TABLE dash_subscription_orders
  ADD COLUMN IF NOT EXISTS creator_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_dash_sub_orders_creator
  ON dash_subscription_orders(creator_id)
  WHERE creator_id IS NOT NULL;
