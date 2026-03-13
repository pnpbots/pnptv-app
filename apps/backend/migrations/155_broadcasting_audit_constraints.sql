-- Migration 155: Broadcasting Audit Constraints
-- Work Stream 8 of the broadcasting audit fix plan.
-- Adds three data-integrity constraints identified in the audit.
--
-- SVC-C6: Prevent duplicate promo code redemptions per user
-- SVC-M2: Enforce positive tip amounts on pnp_tips
-- SVC-H7: Enforce one feedback record per user per booking
--
-- NOTE on SVC-C6 table resolution:
--   The audit spec referenced pnp_live_promo_usage(promo_id, user_id), but that table
--   was dropped in migration 116 (2026-03-06) — it was confirmed empty and unreferenced.
--   The surviving promo deduplication tables are:
--     - promo_redemptions: already has UNIQUE(promo_id, user_id) — no action needed.
--     - promo_code_usage: tracks raw code redemptions at payment time; has NO uniqueness
--       constraint. This is the correct target for SVC-C6.
--   The constraint below targets promo_code_usage(code, user_id).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- SVC-C6: Unique promo code usage per user
-- Prevents the same user from redeeming the same promo code more than once
-- at the payment level. PromoModel.claimSpot() has an app-level guard in
-- promo_redemptions, but promo_code_usage (written at payment completion time)
-- had no DB-level enforcement.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_code_usage_code_user
    ON promo_code_usage (code, user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- SVC-M2: Enforce positive tip amounts on pnp_tips
-- Prevents zero-value or negative tip records from being inserted or updated.
-- pnp_tips.amount is NUMERIC(10,2) NOT NULL but has no range constraint.
-- PNPLiveTipsService.createTip() does not validate the amount before INSERT.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'pnp_tips'::regclass
          AND conname   = 'chk_pnp_tips_amount_positive'
    ) THEN
        ALTER TABLE pnp_tips
            ADD CONSTRAINT chk_pnp_tips_amount_positive CHECK (amount > 0);
    END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SVC-H7: One feedback record per user per booking on pnp_feedback
-- booking_id + user_id must be unique. The trigger update_model_rating_on_feedback
-- fires on INSERT OR UPDATE and aggregates ratings; duplicate rows would inflate
-- model ratings without this guard.
-- booking_id is nullable (feedback can exist without a booking context), so the
-- UNIQUE index only deduplicates rows where booking_id IS NOT NULL — rows with
-- NULL booking_id are allowed to be non-unique per standard SQL NULL semantics
-- (each NULL is distinct), which is the correct behaviour here.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_pnp_feedback_booking_user
    ON pnp_feedback (booking_id, user_id)
    WHERE booking_id IS NOT NULL;

COMMIT;
