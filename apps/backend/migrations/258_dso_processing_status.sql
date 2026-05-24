-- Add 'processing' to chk_dso_status to support atomic lock pattern in NOWPayments IPN
ALTER TABLE dash_subscription_orders
  DROP CONSTRAINT chk_dso_status,
  ADD CONSTRAINT chk_dso_status CHECK (status IN (
    'pending','processing','confirming','confirmed','partially_paid',
    'completed','expired','invalid','failed'
  ));
