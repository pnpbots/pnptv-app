-- Migration 236: enforce lifetime/expiry invariant on user_entitlements
--
-- Reason: a 2026-04 audit found 1 row (id=425) with is_lifetime=true AND
-- expires_at IS NOT NULL. Root cause: paymentService.grantEntitlementsForPlan
-- ON CONFLICT clause set is_lifetime=true but never reset expires_at, so a
-- timed→lifetime upgrade kept the stale expiry. The lifetime trigger then
-- locked the row, making the corruption self-sealing.
--
-- The application fix is shipped (paymentService.js sets expires_at=NULL on
-- conflict). This migration:
--   1. Repairs the existing bad row via the documented superadmin bypass
--   2. Adds a CHECK constraint so future drift is rejected at INSERT time
--
-- The CHECK is the long-term defense — it catches the bug class regardless
-- of which code path attempts the bad write.

BEGIN;

-- Step 1: repair the known bad row (id=425). The lifetime trigger blocks
-- expires_at writes on lifetime rows; SET LOCAL gives this transaction the
-- bypass without affecting other sessions.
SET LOCAL pnptv.superadmin_bypass = 'true';

UPDATE user_entitlements
   SET expires_at = NULL, updated_at = NOW()
 WHERE id = 425
   AND is_lifetime = true
   AND expires_at IS NOT NULL;

-- Verify nothing else slipped through. If any rows still violate the
-- invariant the constraint add below will fail loudly — that's intentional.

-- Step 2: add the invariant constraint. Without this, a future buggy code
-- path could recreate the same drift state.
ALTER TABLE user_entitlements
  ADD CONSTRAINT chk_lifetime_no_expiry
  CHECK (NOT (is_lifetime = true AND expires_at IS NOT NULL));

COMMIT;
