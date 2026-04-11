-- Migration 189: Scoped entitlements for channels, hangouts, creators.
--
-- Goals:
--   1) Remove the polluting "channel_access" plan from the /subscribe page by
--      marking it inactive. Channel access should originate from the channel
--      itself, not from the generic subscribe page.
--   2) Register a dedicated "hangout-access" add-on for standalone paid
--      hangouts that are not linked to a creator channel.
--   3) Add a fast-path index for scope lookups
--      (user_id, add_on_id, creator_id) filtered to is_consumed = false.
--   4) Backfill legacy creator_subscriptions rows into user_entitlements using
--      the 'creator-subscription' add-on, scoped by creator_id, so the new
--      unified resolver has everything it needs on day one.
--
-- Idempotent: safe to re-run.

-- 1) Deactivate the polluting channel plan so it cannot resurface on /subscribe.
--    We do not delete it — historical payments still reference plans.id.
UPDATE plans SET active = false WHERE id = 'channel_access';

-- 2) Register the hangout-access add-on for standalone paid hangouts.
INSERT INTO add_ons (id, name, add_on_type, description)
VALUES (
  'hangout-access',
  'Hangout Access',
  'one-time',
  'One-time access to a standalone paid hangout not linked to a creator channel'
)
ON CONFLICT (id) DO NOTHING;

-- 3) Fast-path scope lookup index. The existing UNIQUE constraint
--    (user_id, add_on_id, creator_id) already covers exact matches, but this
--    partial index makes the hot-path hasResourceAccess() query faster by
--    excluding consumed rows.
CREATE INDEX IF NOT EXISTS idx_user_entitlements_active_scope
  ON user_entitlements (user_id, add_on_id, creator_id)
  WHERE is_consumed = false;

-- 4) Backfill legacy creator_subscriptions into user_entitlements.
--    Only active rows that have not yet expired. The UNIQUE constraint
--    prevents duplicates for existing dual-writes.
INSERT INTO user_entitlements (
  user_id,
  add_on_id,
  creator_id,
  source_plan_id,
  is_lifetime,
  is_consumed,
  granted_at,
  expires_at
)
SELECT
  cs.subscriber_id::text,
  'creator-subscription',
  cs.creator_id::text,
  NULL,
  false,
  false,
  cs.started_at,
  cs.expires_at
FROM creator_subscriptions cs
WHERE cs.status = 'active'
  AND (cs.expires_at IS NULL OR cs.expires_at > NOW())
ON CONFLICT (user_id, add_on_id, creator_id) DO NOTHING;
