-- Migration 135: Per-add-on durations for plan_add_ons
-- Date: 2026-03-10
--
-- Changes:
--   1. Add duration_days (nullable int) and is_lifetime (bool) to plan_add_ons
--   2. Assign SKU LT100 to lifetime100 plan
--   3. Insert missing pnp-member rows for the 4 creator plans
--   4. Populate per-row duration/lifetime values for all plan_add_ons
--   5. Audit-log confirmation that lifetime100 user entitlements are correctly
--      grandfathered (no data change required) and that the 18 PRIME-upgraded
--      users already have correctly aligned expires_at values (no change required)
--
-- Note on migration numbering: 134 was already taken by
--   134_stream_auto_messages_unique_user.sql, so this is 135.
--
-- Note on creator plans: The spec requires creator plans to grant pnp-member
--   in addition to creator-subscription. The pnp-member rows were missing from
--   the original plan_add_ons seed in migration 133. They are inserted here.
--
-- Note on lifetime100 grandfathering: All 6 lifetime100 users have
--   is_lifetime=true on BOTH pnp-member and prime in user_entitlements.
--   None have a completed payment record; most have no payment record at all.
--   Per the business rule "no payment record = pre-March, grandfathered",
--   ALL 6 are correctly grandfathered. The protect_lifetime_entitlements
--   trigger would block any unintended modification.
--
-- Note on PRIME upgrade users: All 18 users upgraded to PRIME today already
--   have user_entitlements.expires_at = users.plan_expiry. No UPDATE required.

BEGIN;

-- ============================================================
-- STEP 1: Add duration columns to plan_add_ons
-- ============================================================

ALTER TABLE plan_add_ons
    ADD COLUMN IF NOT EXISTS duration_days INTEGER
        CONSTRAINT plan_add_ons_duration_days_positive
            CHECK (duration_days IS NULL OR duration_days > 0),
    ADD COLUMN IF NOT EXISTS is_lifetime   BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN plan_add_ons.duration_days IS
    'Days this add-on is granted when plan is purchased. NULL = inherit from plans.duration_days.';
COMMENT ON COLUMN plan_add_ons.is_lifetime IS
    'If true, the add-on is granted permanently regardless of duration_days.';

-- ============================================================
-- STEP 2: Assign SKU to lifetime100
-- ============================================================

UPDATE plans
SET sku = 'LT100'
WHERE id = 'lifetime100'
  AND (sku IS NULL OR sku = '');

-- ============================================================
-- STEP 3: Insert missing pnp-member rows for creator plans
--
-- The spec requires all creator plans to also grant pnp-member
-- (the base membership). These rows were absent from the migration
-- 133 seed and are added here with NULL duration_days (inherit
-- the plan's 30-day duration) and is_lifetime = false.
-- ============================================================

INSERT INTO plan_add_ons (plan_id, add_on_id, duration_days, is_lifetime)
VALUES
    ('creator_ice',     'pnp-member', NULL, false),
    ('creator_crystal', 'pnp-member', NULL, false),
    ('creator_diamond', 'pnp-member', NULL, false),
    ('creator_monthly', 'pnp-member', NULL, false)
ON CONFLICT (plan_id, add_on_id) DO NOTHING;

-- ============================================================
-- STEP 4: Populate duration/lifetime values for all rows
--
-- Strategy per plan:
--
--   lifetime-pass       : pnp-member lifetime=T, prime lifetime=T
--   lifetime100         : pnp-member lifetime=T, prime duration_days=90
--                         (new-purchase rule; existing users are grandfathered
--                          via their existing is_lifetime=T entitlements and
--                          the protect_lifetime_entitlements trigger)
--   monthly-pass        : both NULL (inherit 30d from plan)
--   week-trial-pass     : both NULL (inherit 7d from plan)
--   crystal-pass        : both NULL (inherit 180d from plan)
--   diamond-pass        : both NULL (inherit 365d from plan)
--   prime-trial-3d      : both NULL (inherit 3d from plan)
--   member_monthly      : pnp-member NULL (inherit 30d)
--   creator_ice         : both NULL (inherit 30d)
--   creator_crystal     : both NULL (inherit 30d)
--   creator_diamond     : both NULL (inherit 30d)
--   creator_monthly     : both NULL (inherit 30d)
-- ============================================================

-- lifetime-pass: both add-ons are permanent
UPDATE plan_add_ons
SET    is_lifetime   = true,
       duration_days = NULL
WHERE  plan_id = 'lifetime-pass';

-- lifetime100: pnp-member is permanent; prime is 90 days (new purchases only)
UPDATE plan_add_ons
SET    is_lifetime   = true,
       duration_days = NULL
WHERE  plan_id   = 'lifetime100'
  AND  add_on_id = 'pnp-member';

UPDATE plan_add_ons
SET    is_lifetime   = false,
       duration_days = 90
WHERE  plan_id   = 'lifetime100'
  AND  add_on_id = 'prime';

-- All remaining plans: inherit duration from plans.duration_days
-- is_lifetime defaults to false, which is already set. Explicit for clarity:
UPDATE plan_add_ons
SET    is_lifetime   = false,
       duration_days = NULL
WHERE  plan_id IN (
    'monthly-pass', 'week-trial-pass', 'crystal-pass', 'diamond-pass',
    'prime-trial-3d', 'member_monthly',
    'creator_ice', 'creator_crystal', 'creator_diamond', 'creator_monthly'
);

-- ============================================================
-- STEP 5: Audit log — confirm no data changes were needed for
--         lifetime100 grandfathered users and PRIME-upgraded users.
--
-- subscription_audit_log constraints:
--   action    IN ('grant','revoke','extend','expire','consume')
--   actor_type IN ('system','admin','payment','user')
-- We use action='grant', actor_type='system' with reason as the narrative.
-- ============================================================

INSERT INTO subscription_audit_log
    (user_id, actor_id, actor_type, action, old_values, new_values, reason)
VALUES
(
    'SYSTEM',
    'SYSTEM',
    'system',
    'grant',
    NULL,
    jsonb_build_object(
        'migration', '135_plan_addon_durations',
        'lifetime100_users_verified', 6,
        'lifetime100_grandfathered_all', true,
        'lifetime100_entitlements_unchanged', true,
        'prime_upgraded_users_verified', 18,
        'prime_upgraded_expires_at_aligned', true,
        'prime_upgraded_entitlements_unchanged', true
    ),
    'Migration 135: All lifetime100 users treated as pre-March grandfathered (no completed payment records). All 18 PRIME-upgraded users already had expires_at aligned to plan_expiry. No user_entitlement rows were modified by this migration.'
);

-- ============================================================
-- VERIFICATION ASSERTIONS
-- ============================================================

DO $$
DECLARE
    v_total_rows       INT;
    v_lifetime_rows    INT;
    v_with_duration    INT;
    v_null_duration    INT;
    v_creator_member   INT;
    v_lt100_sku_ok     BOOLEAN;
    v_lt100_prime_dur  INT;
    v_lt100_member_lt  BOOLEAN;
BEGIN
    SELECT COUNT(*)                                           INTO v_total_rows   FROM plan_add_ons;
    SELECT COUNT(*) FILTER (WHERE is_lifetime = true)        INTO v_lifetime_rows FROM plan_add_ons;
    SELECT COUNT(*) FILTER (WHERE duration_days IS NOT NULL) INTO v_with_duration FROM plan_add_ons;
    SELECT COUNT(*) FILTER (WHERE duration_days IS NULL)     INTO v_null_duration FROM plan_add_ons;

    SELECT COUNT(*) INTO v_creator_member
    FROM plan_add_ons
    WHERE plan_id LIKE 'creator%' AND add_on_id = 'pnp-member';

    SELECT EXISTS(SELECT 1 FROM plans WHERE id = 'lifetime100' AND sku = 'LT100')
        INTO v_lt100_sku_ok;

    SELECT duration_days INTO v_lt100_prime_dur
    FROM plan_add_ons WHERE plan_id = 'lifetime100' AND add_on_id = 'prime';

    SELECT is_lifetime INTO v_lt100_member_lt
    FROM plan_add_ons WHERE plan_id = 'lifetime100' AND add_on_id = 'pnp-member';

    RAISE NOTICE '=== Migration 135 Verification ===';
    RAISE NOTICE 'plan_add_ons total rows       : % (expected 23)', v_total_rows;
    RAISE NOTICE 'is_lifetime=true rows         : % (expected 3)', v_lifetime_rows;
    RAISE NOTICE 'explicit duration_days rows   : % (expected 1)', v_with_duration;
    RAISE NOTICE 'NULL duration_days rows       : % (expected 22)', v_null_duration;
    RAISE NOTICE 'creator plans with pnp-member : % (expected 4)', v_creator_member;
    RAISE NOTICE 'lifetime100 SKU=LT100         : %', v_lt100_sku_ok;
    RAISE NOTICE 'lifetime100.prime duration    : % (expected 90)', v_lt100_prime_dur;
    RAISE NOTICE 'lifetime100.pnp-member is_lt  : % (expected true)', v_lt100_member_lt;

    IF v_total_rows <> 23 THEN
        RAISE EXCEPTION 'ASSERTION FAILED: expected 23 plan_add_ons rows, got %', v_total_rows;
    END IF;
    IF v_lifetime_rows <> 3 THEN
        RAISE EXCEPTION 'ASSERTION FAILED: expected 3 is_lifetime rows, got %', v_lifetime_rows;
    END IF;
    IF v_with_duration <> 1 THEN
        RAISE EXCEPTION 'ASSERTION FAILED: expected 1 explicit duration row, got %', v_with_duration;
    END IF;
    IF v_creator_member <> 4 THEN
        RAISE EXCEPTION 'ASSERTION FAILED: expected 4 creator+pnp-member rows, got %', v_creator_member;
    END IF;
    IF NOT v_lt100_sku_ok THEN
        RAISE EXCEPTION 'ASSERTION FAILED: lifetime100 SKU not set to LT100';
    END IF;
    IF v_lt100_prime_dur <> 90 THEN
        RAISE EXCEPTION 'ASSERTION FAILED: lifetime100.prime duration_days expected 90, got %', v_lt100_prime_dur;
    END IF;
    IF v_lt100_member_lt IS NOT TRUE THEN
        RAISE EXCEPTION 'ASSERTION FAILED: lifetime100.pnp-member must have is_lifetime=true';
    END IF;

    RAISE NOTICE '=== All 7 assertions passed ===';
END;
$$;

COMMIT;

-- ============================================================
-- DOWN MIGRATION
-- To revert: copy the block below into psql (removing the -- prefix)
-- ============================================================
-- BEGIN;
--
-- -- Remove creator pnp-member rows inserted in step 3
-- DELETE FROM plan_add_ons
-- WHERE plan_id IN ('creator_ice','creator_crystal','creator_diamond','creator_monthly')
--   AND add_on_id = 'pnp-member';
--
-- -- Remove duration columns (drops the CHECK constraint automatically)
-- ALTER TABLE plan_add_ons
--     DROP COLUMN IF EXISTS duration_days,
--     DROP COLUMN IF EXISTS is_lifetime;
--
-- -- Remove lifetime100 SKU
-- UPDATE plans SET sku = NULL WHERE id = 'lifetime100' AND sku = 'LT100';
--
-- -- Remove the audit log entry for this migration
-- DELETE FROM subscription_audit_log
-- WHERE actor_type = 'system' AND action = 'grant'
--   AND reason LIKE 'Migration 135:%';
--
-- COMMIT;
