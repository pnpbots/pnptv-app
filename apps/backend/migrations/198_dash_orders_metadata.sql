-- 198_dash_orders_metadata.sql
-- Carry per-resource scope (hangoutGroupId, channelId) on Dash orders so the
-- BTCPay webhook can grant scoped entitlements (hangout-access, channel-access)
-- via PaymentService.grantEntitlementsForPlan — same code path the ePayco
-- webhook uses, just with source='dash'.
--
-- Without this column, a Dash invoice settled for a paid hangout/channel had
-- nowhere to record the resource id, so the webhook had to fall back to
-- generic plan-tier upgrades (wrong for hangout_access / channel_access).

ALTER TABLE dash_subscription_orders
  ADD COLUMN IF NOT EXISTS metadata JSONB;

CREATE INDEX IF NOT EXISTS idx_dso_metadata_hangout
  ON dash_subscription_orders ((metadata->>'hangoutGroupId'))
  WHERE metadata ? 'hangoutGroupId';

CREATE INDEX IF NOT EXISTS idx_dso_metadata_channel
  ON dash_subscription_orders ((metadata->>'channelId'))
  WHERE metadata ? 'channelId';
