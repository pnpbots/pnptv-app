'use strict';

/**
 * PaymentHealthService
 *
 * Read-only public health snapshot for the payment pipeline. Exposed via
 * GET /api/health/payments (no auth — zero PII surfaces from this service).
 *
 * Purpose: let an external/remote auditor verify production state without
 * VPS or DB credentials. Everything returned is structural — booleans,
 * counts, ISO timestamps. Never user data, transaction amounts, refs, etc.
 *
 * Hard constraints on output:
 *   - No invoice IDs, no payment IDs, no user IDs
 *   - No amounts, currencies, plan names
 *   - Only: schema check booleans, counts, ages in minutes, ISO timestamps
 */

const { query } = require('../config/postgres');
const { cache } = require('../config/redis');
const logger = require('../utils/logger');

const BOOT_CHECK_REDIS_KEY = 'pnptv:health:btcpay_boot_check';
const BOOT_CHECK_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

class PaymentHealthService {
  /**
   * Called by bot.js after verifyWebhookRegistration runs at startup.
   * Persists a small marker so the health endpoint can confirm the boot-check
   * actually fired — and how recently.
   */
  static async recordBootCheckResult({ ok, expectedUrl, autoConfigured = false, reason = null }) {
    try {
      const payload = JSON.stringify({
        ok: !!ok,
        urlExpected: !!expectedUrl,
        autoConfigured: !!autoConfigured,
        reason: reason || null,
        recordedAt: new Date().toISOString(),
      });
      const redis = cache.getClient ? cache.getClient() : null;
      if (redis && typeof redis.setex === 'function') {
        await redis.setex(BOOT_CHECK_REDIS_KEY, BOOT_CHECK_TTL_SECONDS, payload);
      } else if (cache.set) {
        await cache.set(BOOT_CHECK_REDIS_KEY, payload, BOOT_CHECK_TTL_SECONDS);
      }
    } catch (err) {
      logger.warn(`PaymentHealthService.recordBootCheckResult failed: ${err.message}`);
    }
  }

  /**
   * Returns a public-safe snapshot of payment-pipeline health.
   * Shape:
   *   {
   *     ok: boolean,             — true if every check passed
   *     checkedAt: ISO,
   *     migrations: { m233_dso_notes_column, m234_webhook_dedup_index, m235_payments_provider_btcpay },
   *     pendingDash: { count, maxAgeMinutes },
   *     bootCheck: { recordedAt, ok, autoConfigured, ageMinutes },
   *     postgres: { reachable },
   *     redis: { reachable }
   *   }
   */
  static async getSnapshot() {
    const checkedAt = new Date().toISOString();

    // ── Migration 233: notes column on dash_subscription_orders ─────────
    let m233 = false;
    try {
      const r = await query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'dash_subscription_orders'
           AND column_name = 'notes'`
      );
      m233 = r.rowCount > 0;
    } catch { m233 = false; }

    // ── Migration 234: payment_webhook_events partial unique index ──────
    let m234 = false;
    try {
      const r = await query(
        `SELECT 1 FROM pg_indexes
         WHERE schemaname = 'public'
           AND tablename = 'payment_webhook_events'
           AND indexname = 'uq_payment_webhook_events_dedup'`
      );
      m234 = r.rowCount > 0;
    } catch { m234 = false; }

    // ── Migration 235: payments.provider allows btcpay/dash ─────────────
    // Inspect the check constraint definition for the literal 'btcpay'.
    let m235 = false;
    try {
      const r = await query(
        `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint
         WHERE conrelid = 'payments'::regclass
           AND conname = 'payments_provider_valid'`
      );
      m235 = r.rowCount > 0 && /btcpay/.test(r.rows[0]?.def || '');
    } catch { m235 = false; }

    // ── Pending Dash invoice count + max age (>10min, <30 days) ─────────
    let pendingCount = 0;
    let pendingMaxAgeMinutes = 0;
    let pgReachable = true;
    try {
      const r = await query(
        `SELECT COUNT(*)::int AS count,
                COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - created_at)) / 60), 0)::int AS max_age_min
         FROM dash_subscription_orders
         WHERE status = 'pending'
           AND btcpay_invoice_id IS NOT NULL
           AND created_at < NOW() - INTERVAL '10 minutes'
           AND created_at > NOW() - INTERVAL '30 days'`
      );
      pendingCount = r.rows[0]?.count || 0;
      pendingMaxAgeMinutes = r.rows[0]?.max_age_min || 0;
    } catch (err) {
      pgReachable = false;
      logger.warn(`paymentHealth: pg query failed: ${err.message}`);
    }

    // ── Boot-check marker from Redis ────────────────────────────────────
    let bootCheck = { ok: false, recordedAt: null, autoConfigured: false, ageMinutes: null, reason: 'no_marker' };
    let redisReachable = true;
    try {
      const raw = await cache.get(BOOT_CHECK_REDIS_KEY);
      if (raw) {
        try {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          const ageMinutes = parsed.recordedAt
            ? Math.floor((Date.now() - new Date(parsed.recordedAt).getTime()) / 60000)
            : null;
          bootCheck = {
            ok: !!parsed.ok,
            recordedAt: parsed.recordedAt,
            autoConfigured: !!parsed.autoConfigured,
            ageMinutes,
            reason: parsed.reason || null,
          };
        } catch (parseErr) {
          bootCheck.reason = `parse_error:${parseErr.message}`;
        }
      }
    } catch (err) {
      redisReachable = false;
      logger.warn(`paymentHealth: redis get failed: ${err.message}`);
    }

    // Aggregate verdict — every structural fix in place + nothing stuck pending too long.
    const ok = m233 && m234 && m235
      && pendingMaxAgeMinutes < 30
      && bootCheck.ok === true
      && pgReachable
      && redisReachable;

    return {
      ok,
      checkedAt,
      migrations: {
        m233_dso_notes_column: m233,
        m234_webhook_dedup_index: m234,
        m235_payments_provider_btcpay: m235,
      },
      pendingDash: {
        count: pendingCount,
        maxAgeMinutes: pendingMaxAgeMinutes,
      },
      bootCheck,
      postgres: { reachable: pgReachable },
      redis: { reachable: redisReachable },
    };
  }
}

module.exports = PaymentHealthService;
