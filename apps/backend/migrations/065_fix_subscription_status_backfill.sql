-- ============================================================
-- Migration 065: Fix subscription_status for users who paid
-- but were never activated due to webhook UUID mismatch bug.
--
-- Root cause: The ePayco checkout site (easybots.site) generates
-- its own payment UUID (sent as x_extra3 in the webhook), which
-- differs from the UUID stored in our local `payments` table.
-- processEpaycoWebhook() returned PAYMENT_NOT_FOUND early when
-- the x_extra3 UUID was not found locally, so UserModel.updateSubscription()
-- was never called even when ePayco marked the transaction Aceptada.
--
-- This migration activates subscriptions for users who have
-- a completed payment record but subscription_status != 'active'.
-- It uses the most recent completed payment per user to determine
-- the plan and calculates expiry from the payment date + plan duration.
--
-- UP migration
-- ============================================================

BEGIN;

-- Step 1: Identify affected users and compute correct expiry dates
-- Only activate users whose most recent completed payment's calculated
-- expiry date is still in the future (i.e. subscription period is live).
WITH ranked_payments AS (
  SELECT DISTINCT ON (p.user_id)
    p.user_id,
    p.plan_id,
    p.created_at AS payment_date,
    COALESCE(pl.duration_days, pl.duration, 30) AS duration_days
  FROM payments p
  JOIN plans pl ON pl.id = p.plan_id
  WHERE p.status = 'completed'
  ORDER BY p.user_id, p.created_at DESC
),
users_to_activate AS (
  SELECT
    rp.user_id,
    rp.plan_id,
    rp.payment_date + (rp.duration_days || ' days')::interval AS computed_expiry
  FROM ranked_payments rp
  JOIN users u ON u.id = rp.user_id
  WHERE u.subscription_status NOT IN ('active')
    AND rp.payment_date + (rp.duration_days || ' days')::interval > NOW()
)
-- Step 2: Apply the fix
UPDATE users u
SET
  subscription_status = 'active',
  tier               = 'Prime',
  plan_id            = uta.plan_id,
  plan_expiry        = uta.computed_expiry,
  updated_at         = NOW()
FROM users_to_activate uta
WHERE u.id = uta.user_id;

-- Step 3: Verify what was changed (logged to pg client output)
SELECT
  u.id AS user_id,
  u.first_name,
  u.subscription_status,
  u.tier,
  u.plan_id,
  u.plan_expiry
FROM users u
WHERE u.subscription_status = 'active'
  AND u.updated_at > NOW() - INTERVAL '5 seconds'
ORDER BY u.updated_at DESC;

COMMIT;


-- ============================================================
-- DOWN migration (reverts the backfill — use only in emergency)
-- This cannot perfectly undo because we don't know the prior state.
-- Run only if you are sure and then re-inspect manually.
-- ============================================================
-- BEGIN;
-- UPDATE users
-- SET subscription_status = 'churned',
--     tier = 'Free',
--     plan_expiry = NULL,
--     updated_at = NOW()
-- WHERE id IN (
--   '8223749377',
--   '619b41e5-ade1-459e-b297-f8df3862ea83'
-- );
-- COMMIT;
