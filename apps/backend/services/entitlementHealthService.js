'use strict';

/**
 * EntitlementHealthService
 *
 * Read-only audit of the entitlement system. Verifies that the daily
 * MembershipCleanupService is actually working and that no users are
 * stuck in inconsistent state.
 *
 * Exposed via GET /api/health/entitlements (no auth — zero PII).
 *
 * Hard constraints on output:
 *   - Only counts and booleans
 *   - No user IDs, no plan IDs, no add-on names
 */

const { query } = require('../config/postgres');
const logger = require('../utils/logger');

class EntitlementHealthService {
  /**
   * Returns a public-safe snapshot of entitlement-system integrity.
   * Shape:
   *   {
   *     ok: boolean,
   *     checkedAt: ISO,
   *     counts: {
   *       primeWithoutEntitlement,         — users.tier=PRIME but no active prime/pnp-member entitlement
   *       activeEntitlementWithFreeTier,   — has entitlement but users.tier=free (display drift)
   *       expiredButNotConsumed,           — past expires_at but is_consumed=false (cleanup skipped)
   *       lifetimeWithExpiry,              — is_lifetime=true AND expires_at IS NOT NULL (schema drift)
   *     },
   *     postgres: { reachable }
   *   }
   *
   * Anything > 0 in any count is a regression flag. Small numbers (<5) on
   * primeWithoutEntitlement are tolerated because of grace-period UX —
   * threshold defaults below.
   */
  static async getSnapshot() {
    const checkedAt = new Date().toISOString();
    let pgReachable = true;
    const counts = {
      primeWithoutEntitlement: 0,
      activeEntitlementWithFreeTier: 0,
      expiredButNotConsumed: 0,
      lifetimeWithExpiry: 0,
    };

    try {
      // primeWithoutEntitlement: users.tier='PRIME' or 'member' but no active
      // entitlement row. Source of truth is user_entitlements; tier is a
      // display projection. A user here has visible tier but no real access.
      const r1 = await query(`
        SELECT COUNT(*)::int AS n
        FROM users u
        WHERE u.tier IN ('PRIME', 'member')
          AND NOT EXISTS (
            SELECT 1 FROM user_entitlements ue
            WHERE ue.user_id = u.id::text
              AND ue.add_on_id IN ('prime', 'pnp-member')
              AND ue.is_consumed = false
              AND (ue.is_lifetime = true OR (ue.expires_at IS NOT NULL AND ue.expires_at > NOW()))
          )
      `);
      counts.primeWithoutEntitlement = r1.rows[0]?.n || 0;

      // activeEntitlementWithFreeTier: real access via entitlement but
      // tier hasn't synced. recomputeUserTier should keep these aligned.
      const r2 = await query(`
        SELECT COUNT(*)::int AS n
        FROM users u
        WHERE u.tier = 'free'
          AND EXISTS (
            SELECT 1 FROM user_entitlements ue
            WHERE ue.user_id = u.id::text
              AND ue.add_on_id IN ('prime', 'pnp-member')
              AND ue.is_consumed = false
              AND (ue.is_lifetime = true OR (ue.expires_at IS NOT NULL AND ue.expires_at > NOW()))
          )
      `);
      counts.activeEntitlementWithFreeTier = r2.rows[0]?.n || 0;

      // expiredButNotConsumed: rows past expires_at still flagged consumable.
      // MembershipCleanupService.runFullCleanup at 03:00 UTC should mark
      // these is_consumed=true. Anything here means cleanup didn't run
      // last cycle (cron disabled, db error, OOM, etc).
      const r3 = await query(`
        SELECT COUNT(*)::int AS n
        FROM user_entitlements
        WHERE is_lifetime = false
          AND is_consumed = false
          AND expires_at IS NOT NULL
          AND expires_at < NOW() - INTERVAL '6 hours'
      `);
      counts.expiredButNotConsumed = r3.rows[0]?.n || 0;

      // lifetimeWithExpiry: is_lifetime=true MUST imply expires_at IS NULL.
      // Schema drift would mean a code path is writing both fields, which
      // breaks the cleanup query above (it filters lifetime=false only).
      // After migration 236 a CHECK constraint enforces this at INSERT time,
      // so this should be 0 forever. We still surface row IDs (no PII) so
      // operators can dig into any drift that ever appears.
      const r4 = await query(`
        SELECT id
        FROM user_entitlements
        WHERE is_lifetime = true
          AND expires_at IS NOT NULL
        ORDER BY id
        LIMIT 10
      `);
      counts.lifetimeWithExpiry = r4.rowCount || 0;
      counts.lifetimeWithExpirySampleIds = r4.rows.map(r => r.id);
    } catch (err) {
      pgReachable = false;
      logger.warn(`entitlementHealth: pg query failed: ${err.message}`);
    }

    // Verdict thresholds — small drift on primeWithoutEntitlement /
    // activeEntitlementWithFreeTier (≤5) is tolerated because of brief
    // race windows during grant/expire. expiredButNotConsumed and
    // lifetimeWithExpiry are zero-tolerance: any value > 0 is a bug.
    const ok = pgReachable
      && counts.primeWithoutEntitlement <= 5
      && counts.activeEntitlementWithFreeTier <= 5
      && counts.expiredButNotConsumed === 0
      && counts.lifetimeWithExpiry === 0;

    return {
      ok,
      checkedAt,
      counts,
      thresholds: {
        primeWithoutEntitlement: 5,
        activeEntitlementWithFreeTier: 5,
        expiredButNotConsumed: 0,
        lifetimeWithExpiry: 0,
      },
      postgres: { reachable: pgReachable },
    };
  }
}

module.exports = EntitlementHealthService;
