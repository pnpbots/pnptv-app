'use strict';

/**
 * lifetime-grant.test.js
 *
 * Regression tests for the lifetime entitlement upgrade path.
 *
 * Background: a 2026-04-28 audit found 1 row with `is_lifetime=true AND
 * expires_at IS NOT NULL` — a schema invariant violation. Root cause: the
 * lifetime branch of `grantEntitlementsForPlan` set `is_lifetime=true` on
 * conflict but did not reset `expires_at`. A user upgrading from a timed
 * to lifetime entitlement kept their stale expiry.
 *
 * These tests verify:
 *   1. Both INSERT VALUES and ON CONFLICT DO UPDATE clauses set expires_at
 *      to NULL on the lifetime branch.
 *   2. The cascade block (prime→pnp-member) does the same.
 *   3. The chargeback (InvoiceMarkedInvalid) DELETE preserves lifetime rows
 *      via the `AND is_lifetime = false` filter.
 *
 * Run with: jest apps/backend/tests/lifetime-grant.test.js
 */

const fs = require('fs');
const path = require('path');

describe('Lifetime grant invariant — code-level regression', () => {
  const paymentServicePath = path.join(__dirname, '..', 'services', 'paymentService.js');
  const settlementServicePath = path.join(__dirname, '..', 'services', 'paymentSettlementService.js');
  const controllerPath = path.join(__dirname, '..', 'bot', 'api', 'controllers', 'btcpayWebhookController.js');
  const creatorServicePath = path.join(__dirname, '..', 'services', 'creatorService.js');
  const migrationPath = path.join(__dirname, '..', 'migrations', '236_user_entitlements_lifetime_invariant.sql');

  let paymentServiceSrc;
  let settlementServiceSrc;
  let controllerSrc;
  let creatorServiceSrc;
  let migrationSrc;

  beforeAll(() => {
    paymentServiceSrc = fs.readFileSync(paymentServicePath, 'utf8');
    settlementServiceSrc = fs.readFileSync(settlementServicePath, 'utf8');
    controllerSrc = fs.readFileSync(controllerPath, 'utf8');
    creatorServiceSrc = fs.readFileSync(creatorServicePath, 'utf8');
    migrationSrc = fs.readFileSync(migrationPath, 'utf8');
  });

  describe('paymentService.grantEntitlementsForPlan — lifetime branch', () => {
    test('INSERT VALUES clause explicitly sets expires_at = NULL', () => {
      // The lifetime INSERT must declare expires_at as NULL in VALUES, not
      // rely on a column default. Otherwise a future schema change to the
      // default would silently violate the invariant.
      const lifetimeInsertRegex = /INSERT INTO user_entitlements[^;]*?is_lifetime, expires_at[^;]*?VALUES[^;]*?true, NULL/;
      expect(paymentServiceSrc).toMatch(lifetimeInsertRegex);
    });

    test('ON CONFLICT DO UPDATE explicitly resets expires_at = NULL on the lifetime branch', () => {
      // This was the original bug: ON CONFLICT only set is_lifetime=true,
      // leaving stale expires_at on a row being upgraded from timed to
      // lifetime. The fix must include `expires_at = NULL` in DO UPDATE SET.
      const onConflictRegex = /ON CONFLICT \(user_id, add_on_id, creator_id\)\s+DO UPDATE SET is_lifetime = true, expires_at = NULL/;
      expect(paymentServiceSrc).toMatch(onConflictRegex);
    });

    test('cascade pnp-member grant also enforces expires_at = NULL on lifetime upgrades', () => {
      // The prime→pnp-member cascade had the same bug — separate INSERT block
      // with its own ON CONFLICT. Verify both VALUES and DO UPDATE include
      // `expires_at = NULL` on the lifetime path.
      const cascadeInsertRegex = /INSERT INTO user_entitlements[^;]*?'pnp-member', true, NULL/;
      expect(paymentServiceSrc).toMatch(cascadeInsertRegex);

      const cascadeUpdateRegex = /DO UPDATE SET is_lifetime = true, expires_at = NULL, is_consumed = false/;
      expect(paymentServiceSrc).toMatch(cascadeUpdateRegex);
    });
  });

  describe('paymentSettlementService.settleSubscription — lifetime detection', () => {
    test('uses plan.is_lifetime field, not just duration heuristic', () => {
      // The previous detection (`durationDays >= 36500`) misclassified
      // `lifetime100` (60-day duration + lifetime add-on). Fix reads the
      // plan.is_lifetime field directly, with the duration heuristic only
      // as a legacy fallback.
      expect(settlementServiceSrc).toMatch(/plan\.is_lifetime === true/);
      // The legacy fallback should remain for old plans missing the column.
      expect(settlementServiceSrc).toMatch(/durationDays >= 36500/);
    });
  });

  describe('btcpayWebhookController — chargeback scoping', () => {
    test('InvoiceMarkedInvalid DELETE preserves lifetime entitlements', () => {
      // The chargeback handler must NOT revoke lifetime rows — they are
      // protected by the DB trigger and (defense in depth) the SQL filter.
      // A bug here would auto-revoke lifetime access on chargeback.
      const chargebackRegex = /DELETE FROM user_entitlements\s+WHERE user_id = \$1 AND source_payment_id = \$2 AND is_lifetime = false/;
      expect(controllerSrc).toMatch(chargebackRegex);
    });

    test('chargeback revocation scopes by source_payment_id (not source_plan_id)', () => {
      // The Sprint 0 fix: scope revocation to the SPECIFIC invoice, not the
      // whole plan family. Otherwise a chargeback nukes valid renewals.
      // The DELETE statement above (covered by previous test) already pins
      // the correct scoping. Here we just defend against any legacy DELETE
      // by source_plan_id sneaking back in.
      const badRevoke = /DELETE FROM user_entitlements\s+WHERE user_id = \$1 AND source_plan_id =/;
      expect(controllerSrc).not.toMatch(badRevoke);
    });
  });

  describe('creatorService._grantCreatorMembership — routes through canonical path', () => {
    test('uses EntitlementModel.grantEntitlement instead of raw INSERT', () => {
      // After the L-6 refactor the creator membership grant must delegate
      // to the canonical EntitlementModel so future invariants apply uniformly.
      expect(creatorServiceSrc).toMatch(/EntitlementModel\.grantEntitlement/);
      // No raw INSERT INTO user_entitlements should remain in the function body.
      const fnMatch = creatorServiceSrc.match(/_grantCreatorMembership\([^)]*\)\s*\{[\s\S]+?\n  \}/);
      expect(fnMatch).toBeTruthy();
      expect(fnMatch[0]).not.toMatch(/INSERT INTO user_entitlements/);
    });
  });

  describe('Migration 236 — DB-level invariant', () => {
    test('adds CHECK constraint preventing is_lifetime=true AND expires_at IS NOT NULL', () => {
      expect(migrationSrc).toMatch(/CHECK \(NOT \(is_lifetime = true AND expires_at IS NOT NULL\)\)/);
      expect(migrationSrc).toMatch(/CONSTRAINT chk_lifetime_no_expiry/);
    });

    test('repairs the known historical drift row (id=425) before adding constraint', () => {
      // The constraint would fail to add if the bad row still exists, so the
      // migration must repair the row first (within the same transaction).
      const repairRegex = /UPDATE user_entitlements\s+SET expires_at = NULL[^;]*WHERE id = 425/;
      expect(migrationSrc).toMatch(repairRegex);
      // Repair must use superadmin_bypass since the trigger blocks lifetime modifications.
      expect(migrationSrc).toMatch(/SET LOCAL pnptv\.superadmin_bypass = 'true'/);
      // BEGIN/COMMIT wrapping ensures atomicity
      expect(migrationSrc).toMatch(/^BEGIN;/m);
      expect(migrationSrc).toMatch(/^COMMIT;/m);
    });
  });
});
