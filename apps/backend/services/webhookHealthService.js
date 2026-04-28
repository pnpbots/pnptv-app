'use strict';

/**
 * WebhookHealthService
 *
 * Read-only audit of ePayco webhook delivery health over the last 7 days.
 * BTCPay coverage is already in PaymentHealthService (pendingDashInvoices).
 *
 * Exposed via GET /api/health/webhooks (no auth — zero PII).
 *
 * Hard constraints on output:
 *   - Counts and percentages only
 *   - No event IDs, no payment IDs, no payloads
 */

const { query } = require('../config/postgres');
const logger = require('../utils/logger');

class WebhookHealthService {
  /**
   * Returns a public-safe snapshot of ePayco webhook health.
   * Shape:
   *   {
   *     ok,
   *     checkedAt,
   *     epayco7d: {
   *       totalEvents,
   *       invalidSignatureCount,
   *       invalidSignaturePct,
   *       acceptedCount,
   *       declinedCount,
   *       reversedCount,
   *       pendingCount,
   *     },
   *     postgres: { reachable }
   *   }
   *
   * SLO: invalidSignaturePct must be <1 — anything above is either an attack
   * or a key-rotation drift. acceptedCount > 0 confirms the pipeline is
   * actually completing transactions (cold pipeline = something else broken).
   */
  static async getSnapshot() {
    const checkedAt = new Date().toISOString();
    let pgReachable = true;
    const epayco7d = {
      totalEvents: 0,
      invalidSignatureCount: 0,
      invalidSignaturePct: 0,
      acceptedCount: 0,
      declinedCount: 0,
      reversedCount: 0,
      pendingCount: 0,
    };

    try {
      const r = await query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE is_valid_signature = false)::int AS invalid_sig,
          COUNT(*) FILTER (WHERE state_code IN ('Aceptada', 'Aprobada', '1'))::int AS accepted,
          COUNT(*) FILTER (WHERE state_code IN ('Rechazada', '6', '4'))::int AS declined,
          COUNT(*) FILTER (WHERE state_code IN ('Reversada', '7'))::int AS reversed,
          COUNT(*) FILTER (WHERE state_code IN ('Pendiente', '3'))::int AS pending
        FROM payment_webhook_events
        WHERE provider = 'epayco'
          AND created_at > NOW() - INTERVAL '7 days'
      `);
      const row = r.rows[0] || {};
      epayco7d.totalEvents = row.total || 0;
      epayco7d.invalidSignatureCount = row.invalid_sig || 0;
      epayco7d.acceptedCount = row.accepted || 0;
      epayco7d.declinedCount = row.declined || 0;
      epayco7d.reversedCount = row.reversed || 0;
      epayco7d.pendingCount = row.pending || 0;
      epayco7d.invalidSignaturePct = epayco7d.totalEvents > 0
        ? Math.round((epayco7d.invalidSignatureCount / epayco7d.totalEvents) * 10000) / 100
        : 0;
    } catch (err) {
      pgReachable = false;
      logger.warn(`webhookHealth: pg query failed: ${err.message}`);
    }

    // SLO checks:
    //   invalidSignaturePct < 1.0 (1%) — attack or key drift above this
    //   pg reachable
    // We do NOT fail on totalEvents=0; a quiet week is normal.
    const ok = pgReachable && epayco7d.invalidSignaturePct < 1.0;

    return {
      ok,
      checkedAt,
      epayco7d,
      thresholds: {
        invalidSignaturePctMax: 1.0,
      },
      postgres: { reachable: pgReachable },
    };
  }
}

module.exports = WebhookHealthService;
