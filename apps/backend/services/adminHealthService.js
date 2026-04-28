'use strict';

/**
 * AdminHealthService
 *
 * Read-only audit of admin/superadmin role assignments. Surfaces dormant
 * admin accounts (haven't logged in for 30+ days) — those are a security
 * risk if compromised since admin sessions outlive the user's actual
 * involvement with the platform.
 *
 * Exposed via GET /api/health/admins (no auth — zero PII).
 *
 * Hard constraints on output:
 *   - Counts and ages in days only
 *   - Never returns user IDs, emails, names, telegram IDs
 */

const { query } = require('../config/postgres');
const logger = require('../utils/logger');

class AdminHealthService {
  /**
   * Returns a public-safe snapshot of admin-role health.
   * Shape:
   *   {
   *     ok,
   *     checkedAt,
   *     adminCounts: {
   *       totalAdmins,
   *       totalSuperadmins,
   *       dormant30d,            — never logged in OR last_login_at > 30d ago
   *       dormant90d,            — same, 90d threshold (security urgent)
   *       neverLoggedIn,         — last_login_at IS NULL
   *       maxDormancyDays,       — oldest admin's days since last login
   *     },
   *     postgres: { reachable }
   *   }
   */
  static async getSnapshot() {
    const checkedAt = new Date().toISOString();
    let pgReachable = true;
    const adminCounts = {
      totalAdmins: 0,
      totalSuperadmins: 0,
      dormant30d: 0,
      dormant90d: 0,
      neverLoggedIn: 0,
      maxDormancyDays: 0,
    };

    try {
      const r = await query(`
        SELECT
          COUNT(*) FILTER (WHERE role = 'admin')::int AS total_admins,
          COUNT(*) FILTER (WHERE role = 'superadmin')::int AS total_superadmins,
          COUNT(*) FILTER (
            WHERE role IN ('admin', 'superadmin')
              AND (last_login_at IS NULL OR last_login_at < NOW() - INTERVAL '30 days')
          )::int AS dormant_30d,
          COUNT(*) FILTER (
            WHERE role IN ('admin', 'superadmin')
              AND (last_login_at IS NULL OR last_login_at < NOW() - INTERVAL '90 days')
          )::int AS dormant_90d,
          COUNT(*) FILTER (
            WHERE role IN ('admin', 'superadmin') AND last_login_at IS NULL
          )::int AS never_logged_in,
          COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - last_login_at)) / 86400), 0)::int AS max_dormancy_days
        FROM users
        WHERE role IN ('admin', 'superadmin')
      `);
      const row = r.rows[0] || {};
      adminCounts.totalAdmins = row.total_admins || 0;
      adminCounts.totalSuperadmins = row.total_superadmins || 0;
      adminCounts.dormant30d = row.dormant_30d || 0;
      adminCounts.dormant90d = row.dormant_90d || 0;
      adminCounts.neverLoggedIn = row.never_logged_in || 0;
      adminCounts.maxDormancyDays = row.max_dormancy_days || 0;
    } catch (err) {
      pgReachable = false;
      logger.warn(`adminHealth: pg query failed: ${err.message}`);
    }

    // SLO: zero admins dormant 90+ days. 30-day dormancy is informational
    // (some admins legitimately go on vacation). Never-logged-in admins
    // should be 0 — admin role implies active use.
    const ok = pgReachable
      && adminCounts.dormant90d === 0
      && adminCounts.neverLoggedIn === 0;

    return {
      ok,
      checkedAt,
      adminCounts,
      thresholds: {
        dormant90dMax: 0,
        neverLoggedInMax: 0,
      },
      postgres: { reachable: pgReachable },
    };
  }
}

module.exports = AdminHealthService;
