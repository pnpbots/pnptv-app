-- Migration 229: Resync users.tier from active entitlements (2026-04-25).
--
-- The PRIME / BASIC / FREE badge that renders next to a user's name on their
-- profile is driven by users.tier. Under the legacy plan-based system the
-- tier was kept in sync by the plan-purchase flow. After the move to
-- entitlement-based access, EntitlementModel.grantEntitlement and
-- PaymentService.grantEntitlementsForPlan write tier on every grant — but
-- some users have drifted because:
--   • revokeEntitlement never downgraded tier (fixed in code)
--   • the expiry sweep marked entitlements consumed but didn't recompute tier
--     (fixed in code)
--   • some legacy direct INSERTs into user_entitlements bypassed both writers
--
-- This migration reconciles every user's tier in one statement, mirroring the
-- runtime rule in EntitlementAccessService.recomputeUserTier:
--
--   active 'prime' entitlement      → tier = 'PRIME'
--   active 'pnp-member' only        → tier = 'member'
--   neither                          → tier = 'free'
--
-- Banned users (tier='banned') are intentionally left untouched — bans are a
-- separate axis. Creator-tier users are also preserved when the computed
-- value would be 'free' (creator tier is managed by creatorService).
--
-- Idempotent — re-running has no effect once the system is converged.

BEGIN;
SET LOCAL pnptv.superadmin_bypass = 'true';
SET LOCAL lock_timeout = '30s';

-- Diagnostic: count current tier distribution before the fix.
DO $$
DECLARE
  v_before_prime  int;
  v_before_member int;
  v_before_free   int;
  v_before_other  int;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE tier = 'PRIME'),
    COUNT(*) FILTER (WHERE tier = 'member'),
    COUNT(*) FILTER (WHERE tier = 'free' OR tier IS NULL),
    COUNT(*) FILTER (WHERE tier NOT IN ('PRIME','member','free') AND tier IS NOT NULL)
  INTO v_before_prime, v_before_member, v_before_free, v_before_other
  FROM users;

  RAISE NOTICE 'Migration 229 — tier distribution BEFORE: PRIME=%  member=%  free/null=%  other=%',
    v_before_prime, v_before_member, v_before_free, v_before_other;
END $$;

-- Compute the target tier from active entitlements for every user.
WITH active_ent AS (
  SELECT user_id, add_on_id
    FROM user_entitlements
    WHERE is_consumed = false
      AND (is_lifetime = true OR (expires_at IS NOT NULL AND expires_at > NOW()))
),
agg AS (
  SELECT
    u.id AS user_id,
    bool_or(ae.add_on_id = 'prime')      AS has_prime,
    bool_or(ae.add_on_id = 'pnp-member') AS has_member
  FROM users u
  LEFT JOIN active_ent ae ON ae.user_id = u.id
  GROUP BY u.id
),
target AS (
  SELECT
    user_id,
    CASE
      WHEN has_prime  THEN 'PRIME'
      WHEN has_member THEN 'member'
      ELSE 'free'
    END AS new_tier
  FROM agg
)
-- tier+subscription_status are coupled by chk_tier_status_consistency:
--   PRIME / member  ⇔ subscription_status = 'active'
--   free            ⇔ subscription_status IN ('free','churned')
-- Update both atomically so the constraint is always satisfied.
UPDATE users u
   SET tier = t.new_tier,
       subscription_status = CASE
         WHEN t.new_tier = 'free' AND u.subscription_status IN ('free','churned') THEN u.subscription_status
         WHEN t.new_tier = 'free' THEN 'churned'
         ELSE 'active'
       END,
       updated_at = NOW()
  FROM target t
 WHERE u.id = t.user_id
   AND u.tier IS DISTINCT FROM 'banned'
   -- Don't downgrade 'creator' to 'free'; creator tier is managed elsewhere.
   AND (t.new_tier <> 'free' OR u.tier IS DISTINCT FROM 'creator')
   -- Skip rows already converged on both fields.
   AND (
     u.tier IS DISTINCT FROM t.new_tier
     OR (t.new_tier IN ('PRIME','member') AND u.subscription_status IS DISTINCT FROM 'active')
     OR (t.new_tier = 'free' AND u.subscription_status NOT IN ('free','churned'))
   );

-- Diagnostic: count after the fix.
DO $$
DECLARE
  v_after_prime  int;
  v_after_member int;
  v_after_free   int;
  v_after_other  int;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE tier = 'PRIME'),
    COUNT(*) FILTER (WHERE tier = 'member'),
    COUNT(*) FILTER (WHERE tier = 'free' OR tier IS NULL),
    COUNT(*) FILTER (WHERE tier NOT IN ('PRIME','member','free') AND tier IS NOT NULL)
  INTO v_after_prime, v_after_member, v_after_free, v_after_other
  FROM users;

  RAISE NOTICE 'Migration 229 — tier distribution AFTER:  PRIME=%  member=%  free/null=%  other=%',
    v_after_prime, v_after_member, v_after_free, v_after_other;
END $$;

COMMIT;

-- Post-migration verification queries (run manually if needed):
--
-- 1. Anyone with active prime but tier != 'PRIME' (should be 0):
--   SELECT u.id, u.username, u.tier
--     FROM users u
--     JOIN user_entitlements ue ON ue.user_id = u.id
--     WHERE ue.add_on_id = 'prime' AND ue.is_consumed = false
--       AND (ue.is_lifetime OR (ue.expires_at IS NOT NULL AND ue.expires_at > NOW()))
--       AND u.tier NOT IN ('PRIME','banned');
--
-- 2. Anyone with tier='PRIME' but no active prime entitlement (should be 0):
--   SELECT u.id, u.username, u.tier
--     FROM users u
--     LEFT JOIN user_entitlements ue
--       ON ue.user_id = u.id AND ue.add_on_id = 'prime'
--       AND ue.is_consumed = false
--       AND (ue.is_lifetime OR (ue.expires_at IS NOT NULL AND ue.expires_at > NOW()))
--     WHERE u.tier = 'PRIME' AND ue.id IS NULL;
