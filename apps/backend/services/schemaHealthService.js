'use strict';

/**
 * SchemaHealthService
 *
 * Verifies critical schema invariants are still in place. Catches:
 *   - Migrations that got rolled back
 *   - Indexes dropped during a hot-fix and forgotten
 *   - FKs that drifted during table rename
 *   - Constraints relaxed for debugging and never restored
 *
 * Exposed via GET /api/health/schema (no auth — zero PII).
 *
 * Each invariant is a hand-curated rule: a check function and a name. New
 * invariants are added here; existing ones never get removed (drift is
 * what we're watching for).
 */

const { query } = require('../config/postgres');
const logger = require('../utils/logger');

// Each invariant: { name, sql, expectedRowCountMin, description }
// SQL must return rows when the invariant IS in place; failing invariants
// will return zero rows.
const INVARIANTS = [
  {
    name: 'm233_dso_notes_column',
    description: 'dash_subscription_orders.notes column exists',
    sql: `SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='dash_subscription_orders' AND column_name='notes'`,
  },
  {
    name: 'm234_webhook_dedup_index',
    description: 'payment_webhook_events partial unique index for idempotency',
    sql: `SELECT 1 FROM pg_indexes
          WHERE schemaname='public' AND indexname='uq_payment_webhook_events_dedup'`,
  },
  {
    name: 'm235_payments_provider_btcpay',
    description: "payments.provider check constraint allows 'btcpay'",
    sql: `SELECT 1 FROM pg_constraint
          WHERE conrelid='payments'::regclass AND conname='payments_provider_valid'
            AND pg_get_constraintdef(oid) ~ 'btcpay'`,
  },
  {
    name: 'user_entitlements_uq_constraint',
    description: 'user_entitlements has unique constraint on (user_id, add_on_id, creator_id)',
    sql: `SELECT 1 FROM pg_constraint
          WHERE conrelid='user_entitlements'::regclass AND conname='uq_user_entitlement_non_creator'`,
  },
  {
    name: 'user_entitlements_expires_at_index',
    description: 'user_entitlements idx_ue_expires_at index exists for cleanup query performance',
    sql: `SELECT 1 FROM pg_indexes
          WHERE schemaname='public' AND tablename='user_entitlements' AND indexname='idx_ue_expires_at'`,
  },
  {
    name: 'dash_subscription_orders_invoice_unique',
    description: 'dash_subscription_orders.btcpay_invoice_id has unique constraint',
    sql: `SELECT 1 FROM pg_constraint
          WHERE conrelid='dash_subscription_orders'::regclass
            AND conname='dash_subscription_orders_btcpay_invoice_id_key'`,
  },
  {
    name: 'dso_status_constraint_includes_failed',
    description: "dash_subscription_orders.status check constraint includes 'failed'",
    sql: `SELECT 1 FROM pg_constraint
          WHERE conrelid='dash_subscription_orders'::regclass AND conname='chk_dso_status'
            AND pg_get_constraintdef(oid) ~ 'failed'`,
  },
  {
    name: 'creator_earnings_source_payment_id',
    description: 'creator_earnings.source_payment_id column exists for chargeback reversal',
    sql: `SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='creator_earnings' AND column_name='source_payment_id'`,
  },
  {
    name: 'user_entitlements_source_payment_id',
    description: 'user_entitlements.source_payment_id column exists for chargeback revocation scoping',
    sql: `SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='user_entitlements' AND column_name='source_payment_id'`,
  },
  {
    name: 'payments_recovery_indexes',
    description: 'payments table has separate status + provider indexes (recovery cron uses BitmapAnd over both)',
    sql: `SELECT 1 WHERE
          EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='payments' AND indexname='idx_payments_status')
          AND
          EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='payments' AND indexname='idx_payments_provider')`,
  },
];

class SchemaHealthService {
  /**
   * Returns a public-safe snapshot of schema invariants.
   * Shape:
   *   {
   *     ok,
   *     checkedAt,
   *     totalInvariants,
   *     passed,
   *     failed,
   *     invariants: [{name, description, ok}, ...],
   *     postgres: { reachable }
   *   }
   */
  static async getSnapshot() {
    const checkedAt = new Date().toISOString();
    let pgReachable = true;
    const results = [];

    for (const inv of INVARIANTS) {
      try {
        const r = await query(inv.sql);
        results.push({
          name: inv.name,
          description: inv.description,
          ok: r.rowCount > 0,
        });
      } catch (err) {
        pgReachable = false;
        logger.warn(`schemaHealth: invariant ${inv.name} threw: ${err.message}`);
        results.push({ name: inv.name, description: inv.description, ok: false });
      }
    }

    const passed = results.filter(r => r.ok).length;
    const failed = results.length - passed;
    const ok = pgReachable && failed === 0;

    return {
      ok,
      checkedAt,
      totalInvariants: results.length,
      passed,
      failed,
      invariants: results,
      postgres: { reachable: pgReachable },
    };
  }
}

module.exports = SchemaHealthService;
