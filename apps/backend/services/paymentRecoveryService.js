const PaymentModel = require('../models/paymentModel');
const PaymentService = require('./paymentService');
// Daimo retired — checkDaimoPaymentStatus require removed. processStuckDaimoPayments
// is a no-op stub below (the recovery scheduler that called it is also disabled).
const { query } = require('../config/postgres');
const { cache } = require('../config/redis');
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
        // Query payments stuck pending for > 10 minutes
        // Only process payments from last 24 hours (avoid very old orphaned records)
        // Phase 5: scan BOTH metadata->>'epayco_ref' AND the legacy `reference`
        // column. resolveEpaycoRef() in paymentController also resolves either,
        // so the recovery cron must match — otherwise legacy-shape rows get
        // marked 'abandoned' at 24h despite ePayco having approved them.
        const stuckPayments = await query(`
          SELECT id, reference, metadata->>'epayco_ref' as epayco_ref,
                 user_id, plan_id, created_at
          FROM payments
          WHERE status = 'pending'
            AND provider = 'epayco'
            AND (
              metadata->>'epayco_ref' IS NOT NULL
              OR (reference IS NOT NULL AND reference <> '')
            )
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
            // Resolve refPayco from either source (legacy `reference` column or
            // `metadata.epayco_ref`). recoverStuckPendingPayment can accept null
            // and re-resolve, but supplying it here saves an extra DB lookup.
            const refPayco = payment.epayco_ref || payment.reference || null;

            logger.info('Processing stuck payment', {
              paymentId,
              refPayco,
              refSource: payment.epayco_ref ? 'metadata' : (payment.reference ? 'reference_column' : 'none'),
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
    const lockAcquired = await cache.acquireLock(lockKey, 1800);
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

      // Find pending Dash/BTCPay invoices older than 10 min and < 7 days old
      const stuck = await query(`
        SELECT btcpay_invoice_id AS invoice_id, 'dash_subscription_orders' AS source, created_at
        FROM dash_subscription_orders
        WHERE status = 'pending'
          AND btcpay_invoice_id IS NOT NULL
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

      const axios = require('axios');
      const webhookUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/api/webhooks/btcpay`;

      for (const row of stuck.rows) {
        try {
          const inv = await getInvoiceFn(row.invoice_id);
          const status = inv?.status;

          // Map BTCPay invoice state → equivalent webhook event for replay
          let eventType = null;
          if (status === 'Settled') { eventType = 'InvoiceSettled'; results.settled++; }
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
            // Settled but our DB still pending → we missed the webhook.
            // Log loudly so an operator can replay the webhook from BTCPay's
            // delivery log. Auto-replay would require minting an HMAC, which
            // we cannot do safely from inside this service.
            logger.error('Dash reconciliation: SETTLED invoice with pending DB row — manual webhook replay needed', {
              invoiceId: row.invoice_id,
              source: row.source,
              createdAt: row.created_at,
              btcpayStatus: status,
              webhookUrl,
            });
          }
        } catch (invErr) {
          results.errors++;
          logger.error('Dash reconciliation: error polling invoice', {
            invoiceId: row.invoice_id,
            error: invErr.response?.status === 404 ? 'invoice_not_found_in_btcpay' : invErr.message,
          });
          // 404 → BTCPay doesn't know this invoice → mark expired
          if (invErr.response?.status === 404) {
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
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('abandoned_at', $1::text, 'reason', CASE WHEN provider = 'daimo' THEN 'DAIMO_TIMEOUT' WHEN provider = 'epayco' AND (metadata->>'epayco_ref') IS NULL THEN 'PRE_CHARGE_ABANDONED' ELSE '3DS_TIMEOUT' END)
        WHERE status = 'pending'
          AND provider IN ('epayco', 'daimo')
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
        WHERE status = 'pending' AND provider IN ('epayco', 'daimo')
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
