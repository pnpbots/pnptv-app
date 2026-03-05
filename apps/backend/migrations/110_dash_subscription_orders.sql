-- Migration 110: Dash subscription orders via BTCPay Server
-- Tracks pending/completed Dash payments for PNPtv subscriptions

CREATE TABLE IF NOT EXISTS dash_subscription_orders (
  id                  SERIAL PRIMARY KEY,
  user_id             VARCHAR(255) NOT NULL,
  plan_id             VARCHAR(255) NOT NULL,
  email               VARCHAR(255),
  usd_amount          NUMERIC(10,2) NOT NULL,
  btcpay_invoice_id   VARCHAR(255) UNIQUE,
  status              VARCHAR(50) NOT NULL DEFAULT 'pending',  -- pending, completed, expired, invalid
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dash_sub_orders_user    ON dash_subscription_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_dash_sub_orders_invoice ON dash_subscription_orders(btcpay_invoice_id);
CREATE INDEX IF NOT EXISTS idx_dash_sub_orders_status  ON dash_subscription_orders(status);
