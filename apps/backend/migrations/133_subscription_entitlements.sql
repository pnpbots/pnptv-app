-- =============================================================================
-- Migration 133: Modular Subscription Entitlement System
-- Created: 2026-03-10
-- Author:  DBA Agent (Claude)
--
-- Builds: add_ons, plan_add_ons, user_entitlements, subscription_audit_log
-- Triggers: lifetime protection on user_entitlements + users
-- Backfill: derives entitlements from current users + payments state
-- Superadmins: 8599671840 (@SantinoFurioso), 8370209084 (@Pnplatinotv)
-- =============================================================================

BEGIN;

-- ============================================================
-- SECTION 1: add_ons  — catalog of available add-on types
-- ============================================================

CREATE TABLE IF NOT EXISTS add_ons (
    id          TEXT        PRIMARY KEY,
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL,
    add_on_type TEXT        NOT NULL,
    is_active   BOOLEAN     NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT add_ons_type_check CHECK (add_on_type IN ('recurring', 'one-time'))
);

INSERT INTO add_ons (id, name, description, add_on_type, is_active) VALUES
  ('pnp-member',           'PNP Member',             'Base membership — access to the PNPtv platform',                        'recurring', true),
  ('prime',                'PRIME',                   'Full PRIME content access — exclusive videos, live shows, VOD library', 'recurring', true),
  ('creator-subscription', 'Creator Subscription',    'Subscription to a specific creator''s content',                        'recurring', true),
  ('private-calls',        'Private Call Credit',     'One-time use credit for a private video call with a creator',          'one-time',  true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- SECTION 2: plan_add_ons  — what each plan bundles
-- ============================================================

CREATE TABLE IF NOT EXISTS plan_add_ons (
    plan_id    TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    add_on_id  TEXT NOT NULL REFERENCES add_ons(id) ON DELETE CASCADE,

    PRIMARY KEY (plan_id, add_on_id)
);

-- Seed plan→add-on mappings
-- member plans
INSERT INTO plan_add_ons (plan_id, add_on_id) VALUES
  ('member_monthly',   'pnp-member'),
  ('lifetime100',      'pnp-member'),
  ('lifetime100',      'prime')
ON CONFLICT DO NOTHING;

-- PRIME plans (include base membership)
INSERT INTO plan_add_ons (plan_id, add_on_id) VALUES
  ('monthly-pass',     'pnp-member'),
  ('monthly-pass',     'prime'),
  ('week-trial-pass',  'pnp-member'),
  ('week-trial-pass',  'prime'),
  ('crystal-pass',     'pnp-member'),
  ('crystal-pass',     'prime'),
  ('diamond-pass',     'pnp-member'),
  ('diamond-pass',     'prime'),
  ('lifetime-pass',    'pnp-member'),
  ('lifetime-pass',    'prime'),
  ('prime-trial-3d',   'pnp-member'),
  ('prime-trial-3d',   'prime')
ON CONFLICT DO NOTHING;

-- Creator plans
INSERT INTO plan_add_ons (plan_id, add_on_id) VALUES
  ('creator_monthly',  'creator-subscription'),
  ('creator_crystal',  'creator-subscription'),
  ('creator_diamond',  'creator-subscription'),
  ('creator_ice',      'creator-subscription')
ON CONFLICT DO NOTHING;

-- ============================================================
-- SECTION 3: user_entitlements  — per-user access records
-- ============================================================

CREATE TABLE IF NOT EXISTS user_entitlements (
    id                BIGSERIAL   PRIMARY KEY,
    user_id           TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    add_on_id         TEXT        NOT NULL REFERENCES add_ons(id) ON DELETE RESTRICT,
    source_plan_id    TEXT        REFERENCES plans(id) ON DELETE SET NULL,
    source_payment_id TEXT,
    -- For creator-subscription: which creator's content is unlocked
    creator_id        TEXT,
    is_lifetime       BOOLEAN     NOT NULL DEFAULT false,
    -- For one-time add-ons (private-calls): has this credit been used?
    is_consumed       BOOLEAN     NOT NULL DEFAULT false,
    granted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- NULL means never expires (used for lifetime entitlements)
    expires_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A user can only have one active non-creator entitlement per add-on.
    -- Creator subscriptions allow multiple rows (one per creator_id).
    CONSTRAINT uq_user_entitlement_non_creator
        UNIQUE NULLS NOT DISTINCT (user_id, add_on_id, creator_id)
);

-- ============================================================
-- SECTION 4: subscription_audit_log  — immutable change log
-- ============================================================

CREATE TABLE IF NOT EXISTS subscription_audit_log (
    id              BIGSERIAL   PRIMARY KEY,
    user_id         TEXT        NOT NULL,
    actor_id        TEXT        NOT NULL,
    actor_type      TEXT        NOT NULL,
    action          TEXT        NOT NULL,
    entitlement_id  BIGINT,
    old_values      JSONB,
    new_values      JSONB,
    reason          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT sal_actor_type_check CHECK (actor_type IN ('system', 'admin', 'payment', 'user')),
    CONSTRAINT sal_action_check     CHECK (action IN ('grant', 'revoke', 'extend', 'expire', 'consume'))
);

-- ============================================================
-- SECTION 5: Indexes
-- ============================================================

-- user_entitlements — primary lookup by user
CREATE INDEX IF NOT EXISTS idx_ue_user_id
    ON user_entitlements (user_id);

-- user_entitlements — access check: does user have this add-on?
CREATE INDEX IF NOT EXISTS idx_ue_user_add_on
    ON user_entitlements (user_id, add_on_id);

-- user_entitlements — expiry sweep (partial: only rows that actually expire)
CREATE INDEX IF NOT EXISTS idx_ue_expires_at
    ON user_entitlements (expires_at)
    WHERE expires_at IS NOT NULL;

-- user_entitlements — lifetime protection reads (partial)
CREATE INDEX IF NOT EXISTS idx_ue_lifetime
    ON user_entitlements (user_id)
    WHERE is_lifetime = true;

-- subscription_audit_log — primary query pattern
CREATE INDEX IF NOT EXISTS idx_sal_user_created
    ON subscription_audit_log (user_id, created_at DESC);

-- subscription_audit_log — look up by entitlement
CREATE INDEX IF NOT EXISTS idx_sal_entitlement_id
    ON subscription_audit_log (entitlement_id)
    WHERE entitlement_id IS NOT NULL;

-- ============================================================
-- SECTION 6: updated_at auto-maintenance trigger
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ue_updated_at ON user_entitlements;
CREATE TRIGGER trg_ue_updated_at
    BEFORE UPDATE ON user_entitlements
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- SECTION 7: Lifetime protection trigger on user_entitlements
--
-- Blocks any UPDATE or DELETE on a row where is_lifetime = true
-- unless the current session has SET LOCAL pnptv.superadmin_bypass = 'true'.
-- Superadmins: 8599671840, 8370209084
-- ============================================================

CREATE OR REPLACE FUNCTION protect_lifetime_entitlements()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_bypass TEXT;
BEGIN
    -- Check session-level superadmin bypass flag
    BEGIN
        v_bypass := current_setting('pnptv.superadmin_bypass');
    EXCEPTION WHEN undefined_object THEN
        v_bypass := 'false';
    END;

    IF v_bypass = 'true' THEN
        -- Superadmin bypass active; allow the operation
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' AND OLD.is_lifetime = true THEN
        RAISE EXCEPTION
            'Lifetime entitlements cannot be modified. '
            'Row id=%, user_id=%, add_on_id=%. '
            'Requires superadmin bypass.',
            OLD.id, OLD.user_id, OLD.add_on_id;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.is_lifetime = true THEN
        -- Allow updating is_consumed (for tracking), updated_at
        -- Block any structural change to the entitlement itself
        IF NEW.is_lifetime       IS DISTINCT FROM OLD.is_lifetime
        OR NEW.add_on_id         IS DISTINCT FROM OLD.add_on_id
        OR NEW.user_id           IS DISTINCT FROM OLD.user_id
        OR NEW.expires_at        IS DISTINCT FROM OLD.expires_at
        OR NEW.source_plan_id    IS DISTINCT FROM OLD.source_plan_id
        THEN
            RAISE EXCEPTION
                'Lifetime entitlements cannot be modified. '
                'Row id=%, user_id=%, add_on_id=%. '
                'Requires superadmin bypass.',
                OLD.id, OLD.user_id, OLD.add_on_id;
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_lifetime_entitlements ON user_entitlements;
CREATE TRIGGER trg_protect_lifetime_entitlements
    BEFORE UPDATE OR DELETE ON user_entitlements
    FOR EACH ROW EXECUTE FUNCTION protect_lifetime_entitlements();

-- ============================================================
-- SECTION 8: Lifetime protection trigger on users
--
-- Blocks changes to tier, subscription_status, plan_expiry
-- for any user who holds a lifetime entitlement, unless
-- the superadmin bypass is active.
-- The existing trg_protect_lifetime_users trigger is replaced
-- with a stronger version that defers to user_entitlements.
-- ============================================================

CREATE OR REPLACE FUNCTION protect_users_lifetime_fields()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_bypass       TEXT;
    v_has_lifetime BOOLEAN;
BEGIN
    -- Only fire if one of the protected columns is changing
    IF NEW.tier                IS NOT DISTINCT FROM OLD.tier
    AND NEW.subscription_status IS NOT DISTINCT FROM OLD.subscription_status
    AND NEW.plan_expiry         IS NOT DISTINCT FROM OLD.plan_expiry
    THEN
        RETURN NEW;
    END IF;

    -- Check bypass
    BEGIN
        v_bypass := current_setting('pnptv.superadmin_bypass');
    EXCEPTION WHEN undefined_object THEN
        v_bypass := 'false';
    END;

    IF v_bypass = 'true' THEN
        RETURN NEW;
    END IF;

    -- Does this user hold any lifetime entitlement?
    SELECT EXISTS (
        SELECT 1
        FROM user_entitlements
        WHERE user_id = OLD.id
          AND is_lifetime = true
    ) INTO v_has_lifetime;

    IF v_has_lifetime THEN
        RAISE EXCEPTION
            'Cannot modify tier/subscription_status/plan_expiry for user % — '
            'they hold lifetime entitlements. Requires superadmin bypass.',
            OLD.id;
    END IF;

    RETURN NEW;
END;
$$;

-- Replace the old (weak) trigger
DROP TRIGGER IF EXISTS trg_protect_lifetime_users ON users;
CREATE TRIGGER trg_protect_lifetime_users
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION protect_users_lifetime_fields();

-- ============================================================
-- SECTION 9: Backfill user_entitlements from current state
--
-- Strategy (per business rules):
--
--   A. lifetime-pass users (22)
--      → pnp-member  is_lifetime=true, expires_at=NULL
--      → prime        is_lifetime=true, expires_at=NULL
--
--   B. lifetime100 users (6) — all existing ones treated as
--      pre-March 2026 (grandfathered) because no payment records
--      exist with plan_id='lifetime100' that would prove otherwise.
--      → pnp-member  is_lifetime=true, expires_at=NULL
--      → prime        is_lifetime=true, expires_at=NULL
--
--   C. Active PRIME users (non-lifetime): crystal-pass, diamond-pass,
--      monthly-pass, week-trial-pass, creator-ice
--      → pnp-member  is_lifetime=false, expires_at=plan_expiry
--      → prime        is_lifetime=false, expires_at=plan_expiry
--
--   D. Active member users (non-lifetime): member_monthly
--      → pnp-member  is_lifetime=false, expires_at=plan_expiry
--
-- All backfill rows use actor_type='system', action='grant'.
-- ============================================================

-- Temporarily disable the lifetime-entitlement trigger so the backfill
-- INSERT itself is not blocked (the backfill only does INSERTs, not updates,
-- but the protect_users trigger queries user_entitlements — we must insert
-- entitlements before that trigger sees them, so order is correct here).

-- ---- A + B: Lifetime users (both lifetime-pass and lifetime100) ----

INSERT INTO user_entitlements
    (user_id, add_on_id, source_plan_id, is_lifetime, is_consumed, granted_at, expires_at)
SELECT
    u.id,
    'pnp-member'  AS add_on_id,
    u.plan_id     AS source_plan_id,
    true          AS is_lifetime,
    false         AS is_consumed,
    COALESCE(u.created_at::TIMESTAMPTZ, NOW()) AS granted_at,
    NULL          AS expires_at
FROM users u
WHERE u.plan_id IN ('lifetime-pass', 'lifetime100')
ON CONFLICT (user_id, add_on_id, creator_id) DO NOTHING;

INSERT INTO user_entitlements
    (user_id, add_on_id, source_plan_id, is_lifetime, is_consumed, granted_at, expires_at)
SELECT
    u.id,
    'prime'       AS add_on_id,
    u.plan_id     AS source_plan_id,
    true          AS is_lifetime,
    false         AS is_consumed,
    COALESCE(u.created_at::TIMESTAMPTZ, NOW()) AS granted_at,
    NULL          AS expires_at
FROM users u
WHERE u.plan_id IN ('lifetime-pass', 'lifetime100')
ON CONFLICT (user_id, add_on_id, creator_id) DO NOTHING;

-- ---- C: Active PRIME users (non-lifetime) ----
--
-- NOTE: User 8064250056 (WeHoBttmLA) has plan_id='creator-ice' (hyphen) which does
-- NOT exist in the plans table (the plan there uses underscore: 'creator_ice').
-- This is a data inconsistency in users.plan_id. We use LEFT JOIN + COALESCE to
-- catch users whose plan_id is invalid but who have PRIME tier + active status.
-- source_plan_id will be NULL for such users (FK would reject the invalid value).

INSERT INTO user_entitlements
    (user_id, add_on_id, source_plan_id, is_lifetime, is_consumed, granted_at, expires_at)
SELECT
    u.id,
    'pnp-member'                                   AS add_on_id,
    CASE WHEN p.id IS NOT NULL THEN u.plan_id END  AS source_plan_id,  -- NULL if plan not found
    false                                          AS is_lifetime,
    false                                          AS is_consumed,
    COALESCE(u.created_at::TIMESTAMPTZ, NOW())     AS granted_at,
    u.plan_expiry::TIMESTAMPTZ                     AS expires_at
FROM users u
LEFT JOIN plans p ON p.id = u.plan_id
WHERE u.subscription_status = 'active'
  AND (
        (p.is_lifetime = false AND p.tier = 'PRIME')
        -- Catch users with PRIME tier but invalid/orphaned plan_id
        OR (p.id IS NULL AND u.tier = 'PRIME')
      )
ON CONFLICT (user_id, add_on_id, creator_id) DO NOTHING;

INSERT INTO user_entitlements
    (user_id, add_on_id, source_plan_id, is_lifetime, is_consumed, granted_at, expires_at)
SELECT
    u.id,
    'prime'                                        AS add_on_id,
    CASE WHEN p.id IS NOT NULL THEN u.plan_id END  AS source_plan_id,
    false                                          AS is_lifetime,
    false                                          AS is_consumed,
    COALESCE(u.created_at::TIMESTAMPTZ, NOW())     AS granted_at,
    u.plan_expiry::TIMESTAMPTZ                     AS expires_at
FROM users u
LEFT JOIN plans p ON p.id = u.plan_id
WHERE u.subscription_status = 'active'
  AND (
        (p.is_lifetime = false AND p.tier = 'PRIME')
        OR (p.id IS NULL AND u.tier = 'PRIME')
      )
ON CONFLICT (user_id, add_on_id, creator_id) DO NOTHING;

-- ---- D: Active member users (non-lifetime) ----

INSERT INTO user_entitlements
    (user_id, add_on_id, source_plan_id, is_lifetime, is_consumed, granted_at, expires_at)
SELECT
    u.id,
    'pnp-member'  AS add_on_id,
    u.plan_id     AS source_plan_id,
    false         AS is_lifetime,
    false         AS is_consumed,
    COALESCE(u.created_at::TIMESTAMPTZ, NOW()) AS granted_at,
    u.plan_expiry::TIMESTAMPTZ AS expires_at
FROM users u
JOIN plans p ON p.id = u.plan_id
WHERE u.subscription_status = 'active'
  AND p.is_lifetime = false
  AND p.tier = 'member'
ON CONFLICT (user_id, add_on_id, creator_id) DO NOTHING;

-- ============================================================
-- SECTION 10: Seed subscription_audit_log for backfill
-- Records every entitlement granted in the backfill as a
-- system action so we have a full audit trail from day one.
-- ============================================================

INSERT INTO subscription_audit_log
    (user_id, actor_id, actor_type, action, entitlement_id, new_values, reason)
SELECT
    ue.user_id,
    'system'                        AS actor_id,
    'system'                        AS actor_type,
    'grant'                         AS action,
    ue.id                           AS entitlement_id,
    jsonb_build_object(
        'add_on_id',      ue.add_on_id,
        'source_plan_id', ue.source_plan_id,
        'is_lifetime',    ue.is_lifetime,
        'expires_at',     ue.expires_at
    )                               AS new_values,
    'Migration 133 backfill — derived from users.plan_id and payments' AS reason
FROM user_entitlements ue;

COMMIT;

-- ============================================================
-- VERIFICATION QUERIES  (run after migration to confirm)
-- ============================================================

-- 1. add_ons catalog
-- SELECT * FROM add_ons;

-- 2. plan_add_ons mapping
-- SELECT * FROM plan_add_ons ORDER BY plan_id, add_on_id;

-- 3. Entitlement counts by add_on
-- SELECT add_on_id, is_lifetime, COUNT(*) FROM user_entitlements GROUP BY add_on_id, is_lifetime ORDER BY add_on_id, is_lifetime;

-- 4. Lifetime user coverage
-- SELECT u.username, u.plan_id, ue.add_on_id, ue.is_lifetime, ue.expires_at
-- FROM user_entitlements ue JOIN users u ON u.id = ue.user_id
-- WHERE ue.is_lifetime = true ORDER BY u.plan_id, u.username, ue.add_on_id;

-- 5. Audit log count
-- SELECT COUNT(*) FROM subscription_audit_log;
