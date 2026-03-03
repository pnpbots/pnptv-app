const PaymentModel = require('../../models/paymentModel');
const PaymentService = require('./paymentService');
const { checkDaimoPaymentStatus } = require('../../config/daimo');
const { query } = require('../../config/postgres');
const { cache } = require('../../config/redis');
const logger = require('../../utils/logger');

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
            const { id: paymentId, epayco_ref: refPayco } = payment;

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
   * Process stuck Daimo payments (older than 10 minutes)
   * Checks Daimo Pay API for completed payments and triggers webhook processing if needed
   * @returns {Promise<Object>} Recovery results
   */
  static async processStuckDaimoPayments() {
    logger.info('Starting Daimo payment recovery process...');

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
      const lockKey = 'payment:daimo:recovery:lock';
      const lockAcquired = await cache.acquireLock(lockKey, 600); // 10 min lock
      if (!lockAcquired) {
        logger.warn('Daimo payment recovery already running, skipping');
        return results;
      }

      try {
        // Query pending Daimo payments with a daimo_payment_id (10min–24hr old)
        const stuckPayments = await query(`
          SELECT id, reference, daimo_payment_id,
                 user_id, plan_id, created_at
          FROM payments
          WHERE status = 'pending'
            AND provider = 'daimo'
            AND daimo_payment_id IS NOT NULL
            AND created_at > NOW() - INTERVAL '24 hours'
            AND created_at < NOW() - INTERVAL '10 minutes'
          ORDER BY created_at ASC
          LIMIT 100
        `);

        const payments = stuckPayments.rows;
        logger.info(`Found ${payments.length} stuck Daimo payments to process`, {
          count: payments.length,
        });

        results.checked = payments.length;

        for (const payment of payments) {
          try {
            const { id: paymentId, daimo_payment_id: daimoPaymentId } = payment;

            logger.info('Processing stuck Daimo payment', {
              paymentId,
              daimoPaymentId,
              createdAt: payment.created_at,
            });

            const statusCheck = await checkDaimoPaymentStatus(daimoPaymentId);

            if (!statusCheck.success) {
              results.errors++;
              logger.error('Failed to check Daimo payment status', {
                paymentId,
                daimoPaymentId,
                error: statusCheck.error,
              });
              continue;
            }

            if (statusCheck.status === 'payment_completed') {
              // Synthesize webhook data and process — inject paymentId from DB row as fallback
              const webhookData = {
                payment: {
                  id: statusCheck.id,
                  status: statusCheck.status,
                  source: statusCheck.source,
                  destination: statusCheck.destination,
                  metadata: {
                    ...statusCheck.metadata,
                    paymentId: statusCheck.metadata?.paymentId || paymentId,
                    userId: statusCheck.metadata?.userId || payment.user_id,
                    planId: statusCheck.metadata?.planId || payment.plan_id,
                  },
                },
                _recovery: true,
              };

              const recoveryResult = await PaymentService.processDaimoWebhook(webhookData);

              if (recoveryResult.success) {
                results.recovered++;
                logger.info('Daimo payment recovered successfully', {
                  paymentId,
                  daimoPaymentId,
                });
              } else {
                results.errors++;
                logger.error('Daimo payment recovery processing failed', {
                  paymentId,
                  daimoPaymentId,
                  error: recoveryResult.error,
                });
              }
            } else if (statusCheck.status === 'payment_bounced' || statusCheck.status === 'payment_failed') {
              await PaymentModel.updateStatus(paymentId, 'failed', {
                daimo_status: statusCheck.status,
                recovered_via_polling: true,
                recovered_at: new Date().toISOString(),
              });
              results.failed++;
              logger.info('Daimo payment marked as failed via recovery', {
                paymentId,
                daimoPaymentId,
                daimoStatus: statusCheck.status,
              });
            } else {
              results.stillPending++;
              logger.info('Daimo payment still pending', {
                paymentId,
                daimoPaymentId,
                daimoStatus: statusCheck.status,
              });
            }
          } catch (error) {
            results.errors++;
            logger.error('Error processing stuck Daimo payment', {
              paymentId: payment.id,
              error: error.message,
            });
          }

          // Rate limit: 100ms between API calls
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        results.endTime = new Date();
        const duration = (results.endTime - results.startTime) / 1000;

        logger.info('Daimo payment recovery process completed', {
          duration: `${duration}s`,
          checked: results.checked,
          recovered: results.recovered,
          stillPending: results.stillPending,
          failed: results.failed,
          errors: results.errors,
        });

        return results;
      } finally {
        await cache.releaseLock(lockKey);
      }
    } catch (error) {
      logger.error('Error in Daimo payment recovery process:', error);
      results.errors++;
      results.endTime = new Date();
      return results;
    }
  }

  /**
   * Clean up abandoned payments (pending for > 24 hours)
   * Marks them as 'abandoned' to prevent indefinite pending status
   * @returns {Promise<Object>} Cleanup results
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
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('abandoned_at', $1::text, 'reason', CASE WHEN provider = 'daimo' THEN 'DAIMO_TIMEOUT' ELSE '3DS_TIMEOUT' END)
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
