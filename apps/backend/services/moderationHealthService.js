'use strict';

/**
 * ModerationHealthService
 *
 * Read-only triage snapshot of the moderation queues. Surfaces stuck
 * work that needs human attention so the support team isn't relying on
 * memory or DB spelunking.
 *
 * Exposed via GET /api/health/moderation (no auth — zero PII).
 *
 * Hard constraints on output:
 *   - Only counts and ages in hours
 *   - No reporter / reported user IDs, no place IDs, no descriptions
 */

const { query } = require('../config/postgres');
const logger = require('../utils/logger');

class ModerationHealthService {
  /**
   * Returns a public-safe snapshot of moderation queue health.
   * Shape:
   *   {
   *     ok: boolean,
   *     checkedAt: ISO,
   *     queues: {
   *       userReports:    { pending, oldestAgeHours },
   *       reportAppeals:  { pending, oldestAgeHours },
   *       placeReports:   { unresolved, oldestAgeHours },
   *       modelApplications: { pending, oldestAgeHours },
   *     },
   *     postgres: { reachable }
   *   }
   */
  static async getSnapshot() {
    const checkedAt = new Date().toISOString();
    let pgReachable = true;

    const queues = {
      userReports:       { pending: 0, oldestAgeHours: 0 },
      reportAppeals:     { pending: 0, oldestAgeHours: 0 },
      placeReports:      { unresolved: 0, oldestAgeHours: 0 },
      modelApplications: { pending: 0, oldestAgeHours: 0 },
    };

    try {
      // User-reports-content (status='pending')
      const r1 = await query(`
        SELECT COUNT(*)::int AS n,
               COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600), 0)::int AS oldest_hours
        FROM user_reports
        WHERE status = 'pending'
      `);
      queues.userReports.pending = r1.rows[0]?.n || 0;
      queues.userReports.oldestAgeHours = r1.rows[0]?.oldest_hours || 0;

      // Account-suspension appeals (status='pending')
      const r2 = await query(`
        SELECT COUNT(*)::int AS n,
               COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600), 0)::int AS oldest_hours
        FROM report_appeals
        WHERE status = 'pending'
      `);
      queues.reportAppeals.pending = r2.rows[0]?.n || 0;
      queues.reportAppeals.oldestAgeHours = r2.rows[0]?.oldest_hours || 0;

      // place_reports has no status column — every row is a fresh report
      // that an admin should review. Treat anything older than 7 days as
      // unresolved (most reports are triaged quickly; >7d means stuck).
      const r3 = await query(`
        SELECT COUNT(*)::int AS n,
               COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600), 0)::int AS oldest_hours
        FROM place_reports
        WHERE created_at < NOW() - INTERVAL '24 hours'
      `);
      queues.placeReports.unresolved = r3.rows[0]?.n || 0;
      queues.placeReports.oldestAgeHours = r3.rows[0]?.oldest_hours || 0;

      // Creator/model applications still in pending review
      const r4 = await query(`
        SELECT COUNT(*)::int AS n,
               COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600), 0)::int AS oldest_hours
        FROM model_applications
        WHERE status = 'pending'
      `);
      queues.modelApplications.pending = r4.rows[0]?.n || 0;
      queues.modelApplications.oldestAgeHours = r4.rows[0]?.oldest_hours || 0;
    } catch (err) {
      pgReachable = false;
      logger.warn(`moderationHealth: pg query failed: ${err.message}`);
    }

    // SLO thresholds (operator-facing): warn if oldest item exceeds these.
    //   user reports:      72h response window
    //   appeals:           72h response window
    //   place reports:     7 days (168h)
    //   creator apps:      5 days (120h)
    const thresholds = {
      userReportsHours:       72,
      reportAppealsHours:     72,
      placeReportsHours:      168,
      modelApplicationsHours: 120,
    };

    const ok = pgReachable
      && queues.userReports.oldestAgeHours       <= thresholds.userReportsHours
      && queues.reportAppeals.oldestAgeHours     <= thresholds.reportAppealsHours
      && queues.placeReports.oldestAgeHours      <= thresholds.placeReportsHours
      && queues.modelApplications.oldestAgeHours <= thresholds.modelApplicationsHours;

    return {
      ok,
      checkedAt,
      queues,
      thresholds,
      postgres: { reachable: pgReachable },
    };
  }
}

module.exports = ModerationHealthService;
