const PaymentModel = require('../models/paymentModel');
const PaymentService = require('./paymentService');
// Daimo retired — checkDaimoPaymentStatus require removed. processStuckDaimoPayments
// is a no-op stub below (the recovery scheduler that called it is also disabled).
const { query } = require('../config/postgres');
const { cache, getRedis } = require('../config/redis');
const logger = require('../utils/logger');

/**
 * Payment Recovery Service
 * Handles recovery of stuck pending payments and cleanup of abandoned payments
 * Follows MembershipCleanupService pattern
 */
class PaymentRecoveryService {
  /**
   * Process stuck pending payments (older than 10 minutes)
   * Checks if payment was completed at ePayco and replays webhook if needed
   * @returns {Promise<Object>} Recovery results
   */
  static async processStuckPayments() {
    logger.info('Starting payment recovery process...');

    const results = {
      checked: 0,
      recovered: 0,
      stillPending: 0,
      failed: 0,
      errors: 0,
      startTime: new Date(),
      endTime: null,
    };

    try {
      // Acquire lock to prevent duplicate runs
      const lockKey = 'payment:recovery:lock';
      const lockAcquired = await cache.acquireLock(lockKey, 1800); // 30 min lock
      if (!lockAcquired) {
        logger.warn('Payment recovery already running, skipping');
        return results;
      }

      try {
        // Query payments stuck pending for > 10 minutes.
        //
        // Restricted to rows that have an ePayco-issued ref (metadata.epayco_ref).
        // Pre-checkout rows have only our internal PAY-XXXX reference; passing
        // those to ePayco's validation API always returns 404 and inflates the
        // failed-recovery counter. Such rows are abandoned checkouts (user did
        // not finish 3DS) and should be cleaned up by cleanupAbandonedPayments
        // at the 24h mark, not retried here.
        //
        // Legacy `reference`-only shapes (from before metadata.epayco_ref was
        // standardized) are queried via the legacy fallback below.
        const stuckPayments = await query(`
          SELECT id, reference, metadata->>'epayco_ref' as epayco_ref,
                 user_id, plan_id, created_at
          FROM payments
          WHERE status = 'pending'
            AND provider = 'epayco'
            AND metadata->>'epayco_ref' IS NOT NULL
            AND created_at > NOW() - INTERVAL '24 hours'
            AND created_at < NOW() - INTERVAL '10 minutes'
          ORDER BY created_at ASC
          LIMIT 100
        `);

        const payments = stuckPayments.rows;
        logger.info(`Found ${payments.length} stuck payments to process`, {
          count: payments.length,
        });

        results.checked = payments.length;

        // Process each stuck payment
        for (const payment of payments) {
          try {
            const { id: paymentId } = payment;
            // After H-2 tightening above, every row reaching this loop has a
            // valid ePayco-issued ref in metadata.epayco_ref. Pre-checkout
            // rows (PAY-XXXX only) are excluded from the query.
            const refPayco = payment.epayco_ref;

            logger.info('Processing stuck payment', {
              paymentId,
              refPayco,
              createdAt: payment.created_at,
            });

            // Use existing recovery method
            const recoveryResult = await PaymentService.recoverStuckPendingPayment(
              paymentId,
              refPayco
            );

            if (recoveryResult.success) {
              if (recoveryResult.recovered && recoveryResult.webhookReplayed) {
                results.recovered++;
                logger.info('Payment recovered and webhook replayed', {
                  paymentId,
                  refPayco,
                });
              } else if (recoveryResult.currentStatus === 'Pendiente') {
                results.stillPending++;
                logger.warn('Payment still pending at ePayco', {
                  paymentId,
                  refPayco,
                  message: 'User may not have completed 3DS authentication',
                });
              } else {
                logger.info('Payment checked but no recovery needed', {
                  paymentId,
                  refPayco,
                  status: recoveryResult.currentStatus,
                });
              }
            } else {
              results.failed++;
              logger.error('Payment recovery failed', {
                paymentId,
                refPayco,
                error: recoveryResult.error,
              });
            }
          } catch (error) {
            results.errors++;
            logger.error('Error processing stuck payment', {
              paymentId: payment.id,
              error: error.message,
            });
          }

          // Rate limit protection
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        results.endTime = new Date();
        const duration = (results.endTime - results.startTime) / 1000;

        logger.info('Payment recovery process completed', {
          duration: `${duration}s`,
          checked: results.checked,
          recovered: results.recovered,
          stillPending: results.stillPending,
          failed: results.failed,
          errors: results.errors,
        });

        return results;
      } finally {
        // Release lock
        await cache.releaseLock(lockKey);
      }
    } catch (error) {
      logger.error('Error in payment recovery process:', error);
      results.errors++;
      results.endTime = new Date();
      return results;
    }
  }

  /**
   * Process stuck Daimo payments — RETIRED no-op.
   * Daimo Pay was removed; the recovery cron that called this is also disabled
   * at startup. Kept as a stub so any stale caller still resolves the symbol.
   */
  static async processStuckDaimoPayments() {
    return { processed: 0, recovered: 0, failed: 0, retired: true };
  }

  /**
   * Reconcile stuck Dash/BTCPay invoices.
   * BTCPay webhooks can be lost (server crash, network drop, signature drift).
   * This method polls BTCPay for all `dash_subscription_orders` / `token_purchases`
   * rows still `pending` after 10 minutes. If BTCPay reports the invoice as
   * Settled/Expired/Invalid, the matching webhook handler logic is replayed by
   * calling the existing settlement code paths (no duplicate logic here).
   * Idempotency is enforced by the same Redis lock + atomic DB updates the
   * webhook uses, so a redelivered webhook + reconciler convergence is safe.
   * @returns {Promise<Object>} Reconciliation results
   */
  static async processStuckDashInvoices() {
    logger.info('Starting Dash/BTCPay reconciliation...');

    const results = {
      checked: 0,
      settled: 0,
      expired: 0,
      invalid: 0,
      stillPending: 0,
      errors: 0,
      startTime: new Date(),
      endTime: null,
    };

    const lockKey = 'dash:reconcile:lock';
    const lockAcquired = await cache.acquireLock(lockKey, 600);
    if (!lockAcquired) {
      logger.warn('Dash reconciliation already running, skipping');
      return results;
    }

    try {
      let getInvoiceFn;
      let isConfigured;
      try {
        ({ getInvoice: getInvoiceFn, isConfigured } = require('../config/btcpay'));
      } catch (loadErr) {
        logger.error('Dash reconciliation: failed to load btcpay config', { error: loadErr.message });
        results.errors++;
        return results;
      }
      if (!isConfigured) {
        logger.info('Dash reconciliation: BTCPay not configured — skipping');
        return results;
      }

      // Find pending Dash/BTCPay invoices older than 10 min and < 7 days old.
      // NOWPayments orders use a 'pnptv-nowp-' prefix — exclude them here so
      // BTCPay 404 responses don't falsely expire legitimate NP orders.
      const stuck = await query(`
        SELECT btcpay_invoice_id AS invoice_id, 'dash_subscription_orders' AS source, created_at
        FROM dash_subscription_orders
        WHERE status = 'pending'
          AND btcpay_invoice_id IS NOT NULL
          AND btcpay_invoice_id NOT LIKE 'pnptv-nowp-%'
          AND created_at < NOW() - INTERVAL '10 minutes'
          AND created_at > NOW() - INTERVAL '7 days'
        UNION ALL
        SELECT btcpay_invoice_id AS invoice_id, 'token_purchases' AS source, created_at
        FROM token_purchases
        WHERE status = 'pending'
          AND btcpay_invoice_id IS NOT NULL
          AND created_at < NOW() - INTERVAL '10 minutes'
          AND created_at > NOW() - INTERVAL '7 days'
        ORDER BY created_at ASC
        LIMIT 100
      `);

      results.checked = stuck.rows.length;
      logger.info(`Dash reconciliation: ${stuck.rows.length} stuck invoices to poll`);

      // Emit observability gauge: oldest pending invoice age + count.
      // A single Grafana alert on `pnptv_pending_dash_invoices_age_max_minutes > 30`
      // is the primary regression detector for the entire Dash pipeline.
      try {
        const MetricsService = require('./metricsService');
        let ageMaxMinutes = 0;
        if (stuck.rows.length > 0) {
          const oldest = new Date(stuck.rows[0].created_at);
          ageMaxMinutes = Math.floor((Date.now() - oldest.getTime()) / 60000);
        }
        MetricsService.setPendingDashStats({ ageMaxMinutes, count: stuck.rows.length });
      } catch (_metricsErr) { /* non-fatal */ }

      const axios = require('axios');
      const webhookUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/api/webhooks/btcpay`;

      for (const row of stuck.rows) {
        try {
          const inv = await getInvoiceFn(row.invoice_id);
          const status = inv?.status;

          // Map BTCPay invoice state → equivalent webhook event for replay
          let eventType = null;
          if (status === 'Settled') { eventType = 'InvoiceSettled'; results.settled++; }
          else if (status === 'Expired' && inv?.additionalStatus === 'PaidLate') { eventType = 'InvoiceSettled'; results.settled++; }
          else if (status === 'Expired') { eventType = 'InvoiceExpired'; results.expired++; }
          else if (status === 'Invalid') { eventType = 'InvoiceInvalid'; results.invalid++; }
          else { results.stillPending++; }

          if (!eventType) continue;

          // Mark a "reconciler intent" so the webhook can identify this is a replay
          // (it goes through the same Redis idempotency + DB atomic guards as a real
          // webhook delivery, so the overall flow is safe).
          // We DO NOT POST to the webhook URL here because we cannot mint a valid
          // BTCPay HMAC signature. Instead, mark the row terminal directly for
          // expired/invalid; for settled, log and rely on the next webhook retry.
          if (eventType === 'InvoiceExpired') {
            await query(
              `UPDATE dash_subscription_orders SET status = 'expired' WHERE btcpay_invoice_id = $1 AND status = 'pending'`,
              [row.invoice_id]
            );
            await query(
              `UPDATE token_purchases SET status = 'expired' WHERE btcpay_invoice_id = $1 AND status = 'pending'`,
              [row.invoice_id]
            );
          } else if (eventType === 'InvoiceInvalid') {
            await query(
              `UPDATE dash_subscription_orders SET status = 'invalid' WHERE btcpay_invoice_id = $1 AND status = 'pending'`,
              [row.invoice_id]
            );
            await query(
              `UPDATE token_purchases SET status = 'invalid' WHERE btcpay_invoice_id = $1 AND status = 'pending'`,
              [row.invoice_id]
            );
          } else if (eventType === 'InvoiceSettled') {
            // Settled but our DB still pending → webhook delivery failed.
            // Run the grant in-process. Idempotency comes from the same atomic
            // UPDATE-WHERE-status='pending' guard the webhook uses, so a
            // concurrent webhook delivery cannot double-grant.
            try {
              const grantResult = await PaymentRecoveryService.settleStuckDashInvoice(row.invoice_id, row.source);
              if (grantResult?.skipped) {
                logger.error('Dash reconciliation: grant skipped (resource-type order not handled) — operator must investigate', {
                  invoiceId: row.invoice_id,
                  source: row.source,
                  grantResult,
                });
                results.errors++;
              } else {
                logger.info('Dash reconciliation: settled in-process', {
                  invoiceId: row.invoice_id,
                  source: row.source,
                  grantResult,
                });
              }
            } catch (grantErr) {
              logger.error('Dash reconciliation: in-process settlement failed — operator must investigate', {
                invoiceId: row.invoice_id,
                source: row.source,
                createdAt: row.created_at,
                webhookUrl,
                error: grantErr.message,
              });
              results.errors++;
            }
          }
        } catch (invErr) {
          results.errors++;
          logger.error('Dash reconciliation: error polling invoice', {
            invoiceId: row.invoice_id,
            error: invErr.response?.status === 404 ? 'invoice_not_found_in_btcpay' : invErr.message,
          });
          // 404 → BTCPay doesn't know this invoice → mark expired
          // Guard: NOWPayments orders should never reach here due to the WHERE filter above,
          // but skip them defensively in case of a concurrent insert race.
          if (invErr.response?.status === 404) {
            if (row.invoice_id?.startsWith('pnptv-nowp-')) {
              results.stillPending++;
              continue;
            }
            await query(
              `UPDATE dash_subscription_orders SET status = 'expired', notes = 'btcpay_404' WHERE btcpay_invoice_id = $1 AND status = 'pending'`,
              [row.invoice_id]
            );
            await query(
              `UPDATE token_purchases SET status = 'expired' WHERE btcpay_invoice_id = $1 AND status = 'pending'`,
              [row.invoice_id]
            );
            results.expired++;
          }
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      results.endTime = new Date();
      logger.info('Dash reconciliation complete', results);

      // Alarm: dispatch a P1 to operator Telegram when the reconciler sees
      // signal of webhook delivery failure or in-process settlement errors.
      // Throttled to one alert per 6h via Redis to avoid storming on each
      // 30-min run while the underlying issue persists.
      try {
        const stuckTooMany = results.stillPending > 3;
        const settlementsFailing = results.errors > 0;
        if (stuckTooMany || settlementsFailing) {
          const throttleKey = 'dash:reconcile:alarm:throttle';
          let shouldAlert = true;
          try {
            const redis = getRedis();
            const set = await redis.set(throttleKey, '1', 'EX', 6 * 3600, 'NX');
            shouldAlert = set === 'OK';
          } catch (_throttleErr) {
            // Redis unavailable → fail-open and let the alert through.
          }
          if (shouldAlert) {
            const BusinessNotificationService = require('./businessNotificationService');
            const reasons = [];
            if (stuckTooMany) reasons.push(`${results.stillPending} invoice(s) stuck pending`);
            if (settlementsFailing) reasons.push(`${results.errors} settlement error(s)`);
            const msg = [
              '🟠 <b>P1 ALERT — Dash reconciler</b>',
              '',
              `Reason: ${reasons.join(' + ')}`,
              `Window: last reconciler pass (${results.checked} invoice(s) checked)`,
              `Settled: ${results.settled} · Expired: ${results.expired} · Invalid: ${results.invalid}`,
              '',
              'Action: check BTCPay webhook delivery + /api/health/payments. Throttled 6h.',
            ].join('\n');
            BusinessNotificationService.send(msg).catch((alertErr) =>
              logger.warn('Dash reconciliation alarm dispatch failed', { error: alertErr.message })
            );
          }
        }
      } catch (alarmErr) {
        logger.warn('Dash reconciliation alarm pre-check failed', { error: alarmErr.message });
      }

      return results;
    } catch (err) {
      logger.error('Dash reconciliation: top-level error', { error: err.message });
      results.errors++;
      results.endTime = new Date();
      return results;
    } finally {
      await cache.releaseLock(lockKey);
    }
  }

  /**
   * Settle a Settled-in-BTCPay invoice that our DB still has as `pending`.
   * Delegates all grant logic to PaymentSettlementService — the single source
   * of truth for settlement across webhook + reconciler.
   * Idempotency comes from atomic UPDATE-WHERE-status='pending' guards inside
   * each PaymentSettlementService method — if the real webhook lands first,
   * the UPDATE returns 0 rows and we get alreadyProcessed back.
   *
   * Resource-typed orders (live_show_ticket, private_call_booking, call_package)
   * are skipped here — those depend on external services the reconciler cannot
   * safely call. Mark for operator review instead.
   *
   * @param {string} invoiceId
   * @param {string} source  - 'dash_subscription_orders' | 'token_purchases'
   * @param {object} [opts]
   * @param {boolean} [opts.allowExpired=false] - Also settle orders in 'expired' status.
   *   Use for PaidLate invoices (BTCPay status=Expired, additionalStatus=PaidLate)
   *   where funds were received but the 15-minute window had already lapsed.
   *   The reconciler never passes this — only explicit admin/operator calls do.
   */
  static async settleStuckDashInvoice(invoiceId, source, opts = {}) {
    const { allowExpired = false } = opts;
    const PaymentSettlementService = require('./paymentSettlementService');

    // Token-purchase reconciliation delegates to settleTokenPurchase.
    if (source === 'token_purchases') {
      const DashTokenService = require('./dashTokenService');
      const result = await PaymentSettlementService.settleTokenPurchase(invoiceId, DashTokenService, query, {});
      if (result.noLocalRecord) return { skipped: true, reason: 'no_token_purchase_row' };
      // Stamp the replay key with reconciler context
      if (result.ok && !result.alreadyProcessed) {
        try {
          const { markInvoiceProcessed } = require('../config/btcpay');
          await markInvoiceProcessed(invoiceId, { userId: result.userId, source: 'reconciler_token_purchase' });
        } catch {}
      }
      return result;
    }

    if (source !== 'dash_subscription_orders') {
      return { skipped: true, reason: `unsupported_source:${source}` };
    }

    const { rows: orderRows } = await query(
      `SELECT id, user_id, plan_id, status, creator_id, metadata, usd_amount
       FROM dash_subscription_orders WHERE btcpay_invoice_id = $1`,
      [invoiceId]
    );
    if (orderRows.length === 0) {
      return { skipped: true, reason: 'no_order_row' };
    }
    const order = orderRows[0];
    if (order.status !== 'pending' && !(allowExpired && order.status === 'expired')) {
      return { alreadyProcessed: true, finalStatus: order.status };
    }

    // For PaidLate orders that were marked expired: reset to pending so the
    // settlement methods' atomic UPDATE-WHERE-status='pending' guards work correctly.
    if (allowExpired && order.status === 'expired') {
      await query(
        `UPDATE dash_subscription_orders SET status = 'pending', notes = COALESCE(notes,'') || ' paid_late_reset'
         WHERE id = $1 AND status = 'expired'`,
        [order.id]
      );
      order.status = 'pending';
      logger.info('settleStuckDashInvoice: reset expired order to pending for PaidLate settlement', {
        invoiceId, orderId: order.id, userId: order.user_id,
      });
    }

    const meta = order.metadata && typeof order.metadata === 'object'
      ? order.metadata
      : (typeof order.metadata === 'string'
          ? (() => { try { return JSON.parse(order.metadata); } catch { return null; } })()
          : null);

    // Resource-typed orders depend on external services the reconciler cannot
    // safely invoke — mark for operator review instead of guessing.
    if (meta && (meta.resource === 'live_show_ticket'
        || meta.resource === 'private_call_booking'
        || meta.resource === 'call_package')) {
      await query(
        `UPDATE dash_subscription_orders SET notes = $2 WHERE id = $1`,
        [order.id, `reconciler_skipped_resource_${meta.resource}`]
      );
      return { skipped: true, reason: `resource_${meta.resource}` };
    }

    // Scoped purchases (channel-access / hangout-access)
    if (meta && (meta.hangoutGroupId || meta.channelId)) {
      const result = await PaymentSettlementService.settleScopedPurchase(order, invoiceId, meta, query);
      if (!result.alreadyProcessed && result.ok) {
        try { await cache.del(`user:${order.user_id}`); } catch {}
        // Override the replay key source to indicate reconciler origin
        try {
          const { markInvoiceProcessed } = require('../config/btcpay');
          await markInvoiceProcessed(invoiceId, { userId: order.user_id, planId: order.plan_id, source: 'reconciler_scoped' });
        } catch {}
      }
      return result;
    }

    // Creator subscription
    if (order.plan_id === 'creator_monthly' && order.creator_id) {
      const result = await PaymentSettlementService.settleCreatorSubscription(order, invoiceId, query);
      if (!result.alreadyProcessed && result.ok) {
        try { await cache.del(`user:${order.user_id}`); } catch {}
        try {
          const { markInvoiceProcessed } = require('../config/btcpay');
          await markInvoiceProcessed(invoiceId, { userId: order.user_id, creatorId: order.creator_id, source: 'reconciler_creator_sub' });
        } catch {}
      }
      return result;
    }

    // Standard subscription — need the plan row to compute tier/expiry
    const PlanModel = require('../models/planModel');
    const plan = await PlanModel.getById(order.plan_id);
    if (!plan) {
      await query(
        `UPDATE dash_subscription_orders SET status = 'failed', notes = 'plan_not_found' WHERE id = $1`,
        [order.id]
      );
      throw new Error(`plan_not_found: ${order.plan_id}`);
    }

    // Pass no socketIo — reconciler runs headless; users get notified on next session load.
    const result = await PaymentSettlementService.settleSubscription(order, invoiceId, plan, query, { cache });
    if (!result.alreadyProcessed && result.ok) {
      // Override the replay key source to indicate reconciler origin
      try {
        const { markInvoiceProcessed } = require('../config/btcpay');
        await markInvoiceProcessed(invoiceId, { userId: order.user_id, planId: order.plan_id, source: 'reconciler_subscription' });
      } catch {}
    }
    return result;
  }

  /**
   * Reconcile stuck Meru lifetime100 payments.
   *
   * Meru does not deliver webhooks — the user must come back and POST
   * /api/public/lifetime100/activate after paying. If they don't (closed tab,
   * lost the email, didn't understand the flow), the Meru link stays paid
   * forever and we never grant entitlements. This cron polls Meru for every
   * meru_payment_link still in `active` or `reserved` state and:
   *
   *   1. If Meru shows PAID and we have a `reserved_for_user_id`: auto-grant
   *      lifetime100 entitlements (pnp-member lifetime + 60d PRIME), mark
   *      code `used`, send confirmation DM.
   *   2. If Meru shows PAID but no reservation owner: the buyer paid via a
   *      direct link share (founder gift) and we have no DB record of who.
   *      Log + send admin alert. Heal manually after identifying recipient.
   *   3. If Meru shows CREATED/EXPIRED: leave alone (not paid yet).
   *
   * @returns {Promise<Object>} Reconciliation results
   */
  static async processStuckMeruPayments() {
    logger.info('Starting Meru lifetime100 reconciliation...');

    const results = {
      checked: 0,
      autoHealed: 0,
      orphans: 0,
      stillUnpaid: 0,
      errors: 0,
      startTime: new Date(),
      endTime: null,
    };

    const lockKey = 'meru:reconcile:lock';
    const lockAcquired = await cache.acquireLock(lockKey, 600);
    if (!lockAcquired) {
      logger.warn('Meru reconciliation already running, skipping');
      return results;
    }

    try {
      const meruPaymentService = require('./meruPaymentService');
      const EntitlementModel = require('../models/entitlementModel');
      const EntitlementAccessService = require('./entitlementAccessService');
      const UserModel = require('../models/userModel');

      const { rows: candidates } = await query(`
        SELECT code, status, reserved_for_user_id, reserved_for_email, created_at
        FROM meru_payment_links
        WHERE product = 'lifetime100'
          AND status IN ('active', 'reserved')
          AND created_at > NOW() - INTERVAL '90 days'
        ORDER BY created_at DESC
        LIMIT 100
      `);

      results.checked = candidates.length;
      logger.info(`Meru reconciler: ${candidates.length} candidate codes to verify`);

      const orphans = [];

      for (const c of candidates) {
        try {
          const verification = await meruPaymentService.verifyPayment(c.code);
          if (!verification.isPaid) {
            results.stillUnpaid++;
            continue;
          }

          // Paid on Meru — check if we have a reservation owner to auto-heal
          if (!c.reserved_for_user_id) {
            results.orphans++;
            orphans.push({ code: c.code, paidAt: verification.paidAt });
            continue;
          }

          // Auto-heal: grant entitlements + mark used
          const userId = c.reserved_for_user_id;

          await UserModel.updateSubscription(userId, {
            status: 'active',
            planId: 'lifetime100',
            expiry: null,
          });

          await EntitlementModel.grantEntitlement(userId, 'pnp-member', {
            isLifetime: true,
            source: 'meru_reconciler',
            actorId: 'system',
            reason: `Meru reconciliation auto-heal — code ${c.code}, paid ${verification.paidAt}`,
          });
          await EntitlementModel.grantEntitlement(userId, 'prime', {
            isLifetime: false,
            durationDays: 60,
            source: 'meru_reconciler',
            actorId: 'system',
            reason: `Meru reconciliation auto-heal — 60d PRIME bonus, code ${c.code}`,
          });
          await EntitlementAccessService.invalidateCache(userId);

          await query(
            `UPDATE meru_payment_links
             SET status='used', used_by=$2, used_at=$3
             WHERE code=$1 AND status IN ('active','reserved')`,
            [c.code, userId, verification.paidAt]
          );

          results.autoHealed++;
          logger.info('Meru reconciler: auto-healed paid code', {
            code: c.code, userId, email: c.reserved_for_email, paidAt: verification.paidAt,
          });
        } catch (err) {
          results.errors++;
          logger.error('Meru reconciler: per-code error', { code: c.code, error: err.message });
        }

        // Rate-limit Meru fetches (1.1s between calls — they're public HTML scrapes)
        await new Promise(resolve => setTimeout(resolve, 1100));
      }

      // Alert ops about orphan paid codes (paid on Meru, no DB reservation owner)
      if (orphans.length > 0) {
        const throttleKey = 'meru:reconcile:orphan:alarm';
        try {
          const redis = getRedis();
          const set = await redis.set(throttleKey, '1', 'EX', 6 * 3600, 'NX');
          if (set === 'OK') {
            const BusinessNotificationService = require('./businessNotificationService');
            const lines = [
              '🟠 <b>Meru orphan codes — paid but unclaimed</b>',
              '',
              `${orphans.length} Meru lifetime100 link(s) show PAID but have no reservation owner in our DB.`,
              'These need manual recipient identification (IP match, support ticket lookup).',
              '',
              ...orphans.slice(0, 8).map(o => `• <code>${o.code}</code> paid ${o.paidAt}`),
              orphans.length > 8 ? `…and ${orphans.length - 8} more` : '',
            ].filter(Boolean).join('\n');
            await BusinessNotificationService.send(lines);
          }
        } catch (alertErr) {
          logger.warn('Meru orphan alert dispatch failed', { error: alertErr.message });
        }
      }

      results.endTime = new Date();
      logger.info('Meru reconciliation complete', results);
      return results;
    } catch (error) {
      logger.error('Meru reconciliation: fatal error', { error: error.message });
      results.errors++;
      results.endTime = new Date();
      return results;
    } finally {
      await cache.releaseLock(lockKey).catch(() => {});
    }
  }

  /**
   * Reconcile Stripe Checkout sessions stuck in `pending` in our `payments` table.
   *
   * Failure mode: the Stripe webhook handler sets a Redis idempotency key then
   * crashes before completing the entitlement grant. The key prevents the real
   * webhook from retrying, and no other job ever revisits the row.
   *
   * This method polls Stripe directly for every `payments` row that is:
   *   - provider = 'stripe'
   *   - status   = 'pending'
   *   - has a stripe_session_id
   *   - created >10 min ago and <7 days ago
   *
   * Actions taken:
   *   paid      → call processStripeCheckout (idempotent; skips if already completed)
   *   expired   → mark row 'abandoned' (session can no longer be paid)
   *   open/other → leave pending; the user may still be filling in payment details
   *
   * @returns {Promise<{recovered: number, failed: number}>}
   */
  static async processStuckStripePayments() {
    const { createStripeClient } = require('../config/stripe');

    const results = { recovered: 0, failed: 0 };

    const lockKey = 'stripe:reconcile:lock';
    const lockAcquired = await cache.acquireLock(lockKey, 1800);
    if (!lockAcquired) {
      logger.warn('[stripeRecovery] already running, skipping');
      return results;
    }

    try {
      let stripe;
      try {
        stripe = createStripeClient();
      } catch (configErr) {
        logger.info('[stripeRecovery] Stripe not configured — skipping', { error: configErr.message });
        return results;
      }

      const { rows: stuck } = await query(`
        SELECT id, stripe_session_id, user_id, plan_id, metadata
        FROM payments
        WHERE provider = 'stripe'
          AND status = 'pending'
          AND stripe_session_id IS NOT NULL
          AND created_at < NOW() - INTERVAL '10 minutes'
          AND created_at > NOW() - INTERVAL '7 days'
        LIMIT 50
      `);

      if (stuck.length === 0) return results;

      logger.info('[stripeRecovery] found stuck Stripe payments', { count: stuck.length });

      for (const row of stuck) {
        try {
          const session = await stripe.checkout.sessions.retrieve(row.stripe_session_id);

          if (session.payment_status === 'paid') {
            await PaymentService.processStripeCheckout(session);
            results.recovered++;
            logger.info('[stripeRecovery] settled stuck payment', { paymentId: row.id });
          } else if (session.status === 'expired') {
            await query(
              `UPDATE payments SET status = 'abandoned' WHERE id = $1 AND status = 'pending'`,
              [row.id]
            );
            logger.info('[stripeRecovery] marked expired session as abandoned', { paymentId: row.id });
          }
          // status='open' with payment_status='unpaid' → user may still complete it; leave pending
        } catch (err) {
          results.failed++;
          logger.error('[stripeRecovery] error processing stuck payment', {
            paymentId: row.id,
            stripeSessionId: row.stripe_session_id,
            error: err.message,
          });
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      return results;
    } catch (err) {
      logger.error('[stripeRecovery] processStuckStripePayments failed', { error: err.message });
      return results;
    } finally {
      await cache.releaseLock(lockKey).catch(() => {});
    }
  }

  /**
   * Mark stuck pending payments older than 24h as 'abandoned'.
   * Covers both ePayco (3DS timeout) and any straggler Daimo rows from before retirement.
   */
  static async cleanupAbandonedPayments() {
    logger.info('Starting abandoned payment cleanup...');

    const results = {
      cleaned: 0,
      errors: 0,
      startTime: new Date(),
      endTime: null,
    };

    try {
      // Update payments pending > 24 hours to 'abandoned' (ePayco and Daimo)
      const cleanupResult = await query(`
        UPDATE payments
        SET status = 'abandoned',
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('abandoned_at', $1::text, 'reason', CASE WHEN provider = 'epayco' AND (metadata->>'epayco_ref') IS NULL THEN 'PRE_CHARGE_ABANDONED' ELSE '3DS_TIMEOUT' END)
        WHERE status = 'pending'
          AND provider IN ('epayco', 'stripe')
          AND created_at < NOW() - INTERVAL '24 hours'
        RETURNING id, user_id, reference, provider
      `, [new Date().toISOString()]);

      results.cleaned = cleanupResult.rowCount;

      if (results.cleaned > 0) {
        logger.info(`Marked ${results.cleaned} payments as abandoned`, {
          count: results.cleaned,
        });

        // Log payment IDs for audit trail
        cleanupResult.rows.forEach(row => {
          logger.info('Payment marked as abandoned', {
            paymentId: row.id,
            userId: row.user_id,
            reference: row.reference,
          });
        });
      }

      results.endTime = new Date();
      const duration = (results.endTime - results.startTime) / 1000;

      logger.info('Abandoned payment cleanup completed', {
        duration: `${duration}s`,
        cleaned: results.cleaned,
      });

      return results;
    } catch (error) {
      logger.error('Error in abandoned payment cleanup:', error);
      results.errors++;
      results.endTime = new Date();
      return results;
    }
  }

  /**
   * Reconcile stuck NOWPayments orders.
   * Polls the NOWPayments API for orders still 'pending', 'confirming', or 'confirmed'
   * after 15 minutes. If the API reports 'finished', replays the grant.
   * Uses the payment_id stored in the notes column on transition.
   */
  static async processStuckNowpaymentsOrders() {
    logger.info('Starting NOWPayments reconciliation...');
    const results = { checked: 0, settled: 0, stillPending: 0, errors: 0 };

    const lockKey = 'nowpayments:reconcile:lock';
    const lockAcquired = await cache.acquireLock(lockKey, 600);
    if (!lockAcquired) {
      logger.warn('NOWPayments reconciliation already running, skipping');
      return results;
    }

    try {
      const apiKey = process.env.NOWPAYMENTS_API_KEY;
      if (!apiKey) return results;

      const stuck = await query(
        `SELECT id, btcpay_invoice_id as order_id, user_id, plan_id, status, notes, created_at, creator_id, usd_amount
         FROM dash_subscription_orders
         WHERE btcpay_invoice_id LIKE 'pnptv-nowp-%'
           AND status IN ('pending', 'confirming', 'confirmed')
           AND created_at < NOW() - INTERVAL '15 minutes'
           AND created_at > NOW() - INTERVAL '24 hours'
         ORDER BY created_at ASC LIMIT 50`
      );

      results.checked = stuck.rows.length;

      for (const row of stuck.rows) {
        try {
          // Extract payment_id from notes (stored as 'nowpayments:<payment_id>:...' on transitions)
          const noteMatch = (row.notes || '').match(/nowpayments:(\d+)/);
          if (!noteMatch) {
            results.stillPending++;
            continue;
          }
          const paymentId = noteMatch[1];

          const npEnv = process.env.NOWPAYMENTS_ENVIRONMENT === 'sandbox'
            ? 'https://api-sandbox.nowpayments.io/v1'
            : 'https://api.nowpayments.io/v1';

          const axios = require('axios');
          const resp = await axios.get(`${npEnv}/payment/${paymentId}`, {
            headers: { 'x-api-key': apiKey },
            timeout: 10000,
          });

          const payment = resp.data;
          if (payment.payment_status === 'finished') {
            logger.info('NOWPayments reconciler: payment finished, granting', {
              orderId: row.order_id, paymentId, userId: row.user_id,
            });

            // Replay the finished IPN grant path using the same atomic lock pattern
            const lockRes = await query(
              `UPDATE dash_subscription_orders SET status = 'processing'
               WHERE btcpay_invoice_id = $1 AND status NOT IN ('completed','failed','processing')
               RETURNING id, user_id, plan_id, usd_amount, creator_id`,
              [row.order_id]
            );
            if (lockRes.rows.length === 0) {
              results.stillPending++;
              continue;
            }
            const order = lockRes.rows[0];
            try {
              const PaymentService = require('./paymentService');
              const grantResult = await PaymentService.grantEntitlementsForPlan(
                order.user_id, order.plan_id, 'nowpayments',
                order.creator_id ? { creatorId: String(order.creator_id) } : null,
                row.order_id
              );
              if (!grantResult || grantResult.granted === 0) throw new Error('grant_zero');

              await query(
                `UPDATE dash_subscription_orders SET status = 'completed', completed_at = NOW(),
                 notes = $2 WHERE btcpay_invoice_id = $1`,
                [row.order_id, `nowpayments:reconciler:${paymentId}`]
              );
              results.settled++;
              logger.info('NOWPayments reconciler: settled', { orderId: row.order_id });

              // Operator alerts — fire-and-forget.
              try {
                const PaymentNotificationService = require('./paymentNotificationService');
                const BusinessNotificationService = require('./businessNotificationService');
                const PlanModel = require('../models/planModel');
                const botModule = require('../bot/core/bot');
                const bot = (typeof botModule.getBotInstance === 'function' ? botModule.getBotInstance() : null)
                  || new (require('telegraf').Telegraf)(process.env.BOT_TOKEN);
                const planRec = await PlanModel.getById(order.plan_id);
                const planName = planRec ? (planRec.display_name || planRec.name) : order.plan_id;
                await PaymentNotificationService.sendAdminPaymentNotification({
                  bot,
                  userId: order.user_id,
                  planName,
                  amount: order.usd_amount || 0,
                  provider: 'nowpayments',
                  transactionId: paymentId,
                  customerName: order.user_id,
                  customerEmail: 'N/A',
                });
                await BusinessNotificationService.notifyPayment({
                  userId: order.user_id,
                  planName,
                  amount: order.usd_amount || 0,
                  provider: 'USDC (NowPayments)',
                  transactionId: paymentId,
                  customerName: order.user_id,
                });
              } catch (alertErr) {
                logger.warn('NOWPayments reconciler: operator alert failed (non-critical)', { error: alertErr.message });
              }
            } catch (grantErr) {
              await query(
                `UPDATE dash_subscription_orders SET status = 'pending', notes = $2 WHERE btcpay_invoice_id = $1`,
                [row.order_id, `nowpayments:reconciler_failed:${grantErr.message}`.slice(0, 500)]
              ).catch(() => {});
              results.errors++;
              logger.error('NOWPayments reconciler: grant failed', { orderId: row.order_id, error: grantErr.message });
            }
          } else {
            results.stillPending++;
          }
        } catch (rowErr) {
          results.errors++;
          logger.error('NOWPayments reconciler: row error', { orderId: row.order_id, error: rowErr.message });
        }
        await new Promise(r => setTimeout(r, 200));
      }
    } finally {
      await cache.releaseLock(lockKey).catch(() => {});
    }

    results.endTime = new Date();
    logger.info('NOWPayments reconciliation complete', results);
    return results;
  }

  /**
   * Get payment recovery statistics
   * @returns {Promise<Object>} Statistics
   */
  static async getStats() {
    try {
      const stats = await query(`
        SELECT
          COUNT(*) as total_pending,
          COUNT(CASE WHEN created_at < NOW() - INTERVAL '10 minutes' THEN 1 END) as stuck_payments,
          COUNT(CASE WHEN created_at < NOW() - INTERVAL '24 hours' THEN 1 END) as abandoned_payments,
          MIN(created_at) as oldest_pending,
          MAX(created_at) as newest_pending
        FROM payments
        WHERE status = 'pending' AND provider = 'epayco'
      `);

      const row = stats.rows[0];
      return {
        totalPending: parseInt(row.total_pending),
        stuckPayments: parseInt(row.stuck_payments),
        abandonedPayments: parseInt(row.abandoned_payments),
        oldestPending: row.oldest_pending,
        newestPending: row.newest_pending,
        timestamp: new Date(),
      };
    } catch (error) {
      logger.error('Error getting payment recovery stats:', error);
      return null;
    }
  }
}

module.exports = PaymentRecoveryService;
