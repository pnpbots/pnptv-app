-- Migration 231 — add auto_renew flag to user_entitlements
-- Lets users cancel future renewal of paid channel/hangout 30-day passes
-- without losing access to the current period. Default true so existing
-- scoped entitlements (channel-access, hangout-access) renew unless
-- explicitly cancelled.
--
-- Lifetime entitlements are never auto-renewed regardless of this flag —
-- the renewal cron filters on is_lifetime=false anyway.

ALTER TABLE user_entitlements
  ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_ue_renew_due
  ON user_entitlements (expires_at)
  WHERE is_consumed = false
    AND is_lifetime = false
    AND auto_renew = true
    AND expires_at IS NOT NULL;
