const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const { query } = require('../../config/postgres');
const { cache } = require('../../config/redis');
const PaymentModel = require('../../models/paymentModel');
const SubscriberModel = require('../../models/subscriberModel');
const PlanModel = require('../../models/planModel');
const UserModel = require('../../models/userModel');
let config;
try {
  config = require(path.join(__dirname, '../../../config/payment.config.js'));
} catch (error) {
  // ePayco/Visa Cybersource config not available, service will be disabled
  config = { visaCybersource: {} };
}
const logger = require('../../utils/logger');
const { Telegraf } = require('telegraf');

/**
 * Visa Cybersource Service - Handles recurring payment processing
 * via ePayco tokenization with Visa Cybersource network
 */
class VisaCybersourceService {
  /**
   * Tokenize a card using ePayco
   * @param {Object} params - Card details
   * @returns {Promise<Object>} Token result
   */
  static async tokenizeCard({
    userId,
    cardNumber,
    expMonth,
    expYear,
    cvc,
    cardHolderName,
    email,
  }) {
    try {
      const configData = config.visaCybersource;

      // Call ePayco tokenization API
      const response = await axios.post(
        `${configData.endpoint}/token/card`,
        {
          card: {
            number: cardNumber,
            exp_month: expMonth,
            exp_year: expYear,
            cvc,
            name: cardHolderName,
          },
          email,
          default: true,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${configData.apiKey}`,
          },
          timeout: 30000,
        }
      );

      if (response.data.success && response.data.token) {
        // Store token in database
        await query(
          `INSERT INTO card_tokens (user_id, token, customer_id, card_mask, franchise, expiry_month, expiry_year, card_holder_name, is_default)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
           ON CONFLICT (user_id, token) DO UPDATE SET
             is_default = TRUE,
             updated_at = NOW()`,
          [
            userId,
            response.data.token,
            response.data.customer_id,
            response.data.card.mask,
            response.data.card.franchise,
            expMonth,
            expYear,
            cardHolderName,
          ]
        );

        // Update user with default card token
        await query(
          `UPDATE users SET
             card_token = $2,
             card_token_mask = $3,
             card_franchise = $4,
             updated_at = NOW()
           WHERE id = $1`,
          [userId, response.data.token, response.data.card.mask, response.data.card.franchise]
        );
        await cache.del(`user:${userId}`);

        logger.info('Card tokenized successfully', {
          userId,
          mask: response.data.card.mask,
          franchise: response.data.card.franchise,
        });

        return {
          success: true,
          token: response.data.token,
          customerId: response.data.customer_id,
          cardMask: response.data.card.mask,
          franchise: response.data.card.franchise,
        };
      }

      throw new Error(response.data.error || 'Card tokenization failed');
    } catch (error) {
      logger.error('Error tokenizing card:', {
        error: error.message,
        userId,
      });
      return {
        success: false,
        error: error.response?.data?.message || error.message,
      };
    }
  }

  /**
   * Create a recurring payment subscription
   * @param {Object} params - Subscription parameters
   * @returns {Promise<Object>} Subscription result
   */
  static async createRecurringSubscription({
    userId,
    planId,
    cardToken,
    email,
  }) {
    try {
      // Get plan details — trialDays comes from the plan record, NEVER from client input.
      const plan = await PlanModel.getById(planId);
      if (!plan) {
        throw new Error(`Plan ${planId} not found`);
      }
      // Read trial configuration from the plan record only.
      const trialDays = typeof plan.trialDays === 'number' ? Math.max(0, plan.trialDays) : 0;

      // Get user details
      const user = await UserModel.getById(userId);
      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      // Resolve the card token: use the caller-supplied token first.
      // If none was provided, fetch the user's default token directly from the DB
      // (card_token is intentionally stripped from the UserModel generic object).
      let token = cardToken;
      if (!token) {
        const tokenRow = await query(
          `SELECT card_token FROM users WHERE id = $1`,
          [userId]
        );
        token = tokenRow.rows[0]?.card_token || null;
      }
      if (!token) {
        throw new Error('No card token available. Please add a payment method first.');
      }

      // Calculate billing dates
      const now = new Date();
      const trialEnd = trialDays > 0 ? new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000) : null;
      const periodStart = trialEnd || now;
      const periodEnd = new Date(periodStart);

      // Calculate period end based on billing interval
      const interval = plan.billingInterval || 'month';
      const intervalCount = plan.billingIntervalCount || 1;
      if (interval === 'month') {
        periodEnd.setMonth(periodEnd.getMonth() + intervalCount);
      } else if (interval === 'week') {
        periodEnd.setDate(periodEnd.getDate() + (7 * intervalCount));
      } else if (interval === 'year') {
        periodEnd.setFullYear(periodEnd.getFullYear() + intervalCount);
      }

      const amount = plan.recurringPrice || plan.price;

      // Create subscription record
      const subscriptionResult = await query(
        `INSERT INTO recurring_subscriptions (
          user_id, plan_id, card_token, card_token_mask, card_franchise, customer_id,
          status, amount, currency, billing_interval, billing_interval_count,
          current_period_start, current_period_end, next_billing_date, trial_end,
          metadata, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())
        RETURNING *`,
        [
          userId,
          planId,
          token,
          user.cardTokenMask,
          user.cardFranchise,
          null, // customer_id from ePayco if available
          trialDays > 0 ? 'trialing' : 'active',
          amount,
          'USD',
          interval,
          intervalCount,
          periodStart,
          periodEnd,
          trialDays > 0 ? trialEnd : periodEnd,
          trialEnd,
          JSON.stringify({ planName: plan.name, userEmail: email || user.email }),
        ]
      );

      const subscription = subscriptionResult.rows[0];

      // If no trial, charge immediately
      if (trialDays === 0) {
        const chargeResult = await this._chargeCard({
          token,
          amount,
          description: `PNPtv ${plan.name} - Recurring subscription`,
          subscriptionId: subscription.id,
          userId,
        });

        if (!chargeResult.success) {
          // Mark subscription as failed
          await query(
            `UPDATE recurring_subscriptions SET status = 'past_due', billing_failures = 1, last_billing_attempt = NOW(), updated_at = NOW() WHERE id = $1`,
            [subscription.id]
          );
          throw new Error(`Initial payment failed: ${chargeResult.error}`);
        }

        // Record successful payment
        await query(
          `INSERT INTO recurring_payments (
            subscription_id, user_id, amount, currency, status, provider,
            transaction_id, authorization_code, response_code, response_message,
            period_start, period_end, attempt_number, processed_at, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW(), NOW())`,
          [
            subscription.id,
            userId,
            amount,
            'USD',
            'completed',
            'epayco_cybersource',
            chargeResult.transactionId,
            chargeResult.authorizationCode,
            chargeResult.responseCode,
            chargeResult.message,
            periodStart,
            periodEnd,
            1,
          ]
        );

        // Update subscription with last successful payment
        await query(
          `UPDATE recurring_subscriptions SET last_successful_payment = NOW(), updated_at = NOW() WHERE id = $1`,
          [subscription.id]
        );
      }

      // Update user subscription
      await UserModel.updateSubscription(userId, {
        status: 'active',
        planId,
        expiry: periodEnd,
      });

      // Update user with recurring subscription info
      await query(
        `UPDATE users SET
           auto_renew = TRUE,
           subscription_type = 'recurring',
           recurring_plan_id = $2,
           next_billing_date = $3,
           billing_failures = 0,
           updated_at = NOW()
         WHERE id = $1`,
        [userId, planId, trialDays > 0 ? trialEnd : periodEnd]
      );
      await cache.del(`user:${userId}`);

      // Send confirmation notification
      await this._sendSubscriptionNotification(userId, 'created', {
        planName: plan.name,
        amount,
        periodEnd,
        trialEnd,
      });

      logger.info('Recurring subscription created', {
        userId,
        planId,
        subscriptionId: subscription.id,
        amount,
        trialDays,
      });

      return {
        success: true,
        subscriptionId: subscription.id,
        status: subscription.status,
        currentPeriodEnd: periodEnd,
        trialEnd,
        message: 'Recurring subscription created successfully',
      };
    } catch (error) {
      logger.error('Error creating recurring subscription:', {
        error: error.message,
        userId,
        planId,
      });
      return {
        success: false,
        error: error.message,
        message: 'Failed to create recurring subscription',
      };
    }
  }

  /**
   * Process a scheduled recurring payment
   * @param {string} subscriptionId - Subscription ID
   * @returns {Promise<Object>} Payment result
   */
  static async processRecurringPayment(subscriptionId) {
    try {
      // Get subscription details — card_token is fetched here because it is required for
      // charging, but it is destructured out immediately so it never appears in log objects.
      const subResult = await query(
        `SELECT id, user_id, plan_id, card_token, card_token_mask, card_franchise,
                status, amount, currency, billing_interval, billing_interval_count,
                current_period_start, current_period_end, next_billing_date,
                trial_end, billing_failures, cancel_at_period_end, metadata
         FROM recurring_subscriptions WHERE id = $1`,
        [subscriptionId]
      );

      if (subResult.rows.length === 0) {
        throw new Error(`Subscription ${subscriptionId} not found`);
      }

      // Destructure card_token out so the loggable `subscription` object never contains it.
      const { card_token: subCardToken, ...subscription } = subResult.rows[0];

      if (subscription.status !== 'active' && subscription.status !== 'past_due') {
        logger.info('Subscription not eligible for billing', {
          subscriptionId,
          status: subscription.status,
        });
        return { success: false, error: 'Subscription not eligible for billing' };
      }

      // Check if already billed for this period
      const existingPayment = await query(
        `SELECT id FROM recurring_payments
         WHERE subscription_id = $1 AND period_start = $2 AND status = 'completed'`,
        [subscriptionId, subscription.current_period_start]
      );

      if (existingPayment.rows.length > 0) {
        logger.info('Payment already processed for this period', { subscriptionId });
        return { success: true, alreadyProcessed: true };
      }

      // Calculate new period
      const periodStart = new Date(subscription.current_period_end);
      const periodEnd = new Date(periodStart);
      const interval = subscription.billing_interval || 'month';
      const intervalCount = subscription.billing_interval_count || 1;

      if (interval === 'month') {
        periodEnd.setMonth(periodEnd.getMonth() + intervalCount);
      } else if (interval === 'week') {
        periodEnd.setDate(periodEnd.getDate() + (7 * intervalCount));
      } else if (interval === 'year') {
        periodEnd.setFullYear(periodEnd.getFullYear() + intervalCount);
      }

      // Attempt to charge — use the destructured token, not the sanitized subscription object.
      const chargeResult = await this._chargeCard({
        token: subCardToken,
        amount: parseFloat(subscription.amount),
        description: `PNPtv Recurring subscription - ${subscription.plan_id}`,
        subscriptionId,
        userId: subscription.user_id,
      });

      const attemptNumber = (subscription.billing_failures || 0) + 1;

      // Record payment attempt
      await query(
        `INSERT INTO recurring_payments (
          subscription_id, user_id, amount, currency, status, provider,
          transaction_id, authorization_code, response_code, response_message,
          period_start, period_end, attempt_number, processed_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())`,
        [
          subscriptionId,
          subscription.user_id,
          subscription.amount,
          'USD',
          chargeResult.success ? 'completed' : 'failed',
          'epayco_cybersource',
          chargeResult.transactionId || null,
          chargeResult.authorizationCode || null,
          chargeResult.responseCode || null,
          chargeResult.message || chargeResult.error,
          periodStart,
          periodEnd,
          attemptNumber,
          chargeResult.success ? new Date() : null,
        ]
      );

      if (chargeResult.success) {
        // Update subscription
        await query(
          `UPDATE recurring_subscriptions SET
             status = 'active',
             current_period_start = $2,
             current_period_end = $3,
             next_billing_date = $3,
             billing_failures = 0,
             last_successful_payment = NOW(),
             last_billing_attempt = NOW(),
             updated_at = NOW()
           WHERE id = $1`,
          [subscriptionId, periodStart, periodEnd]
        );

        // Update user subscription expiry
        await UserModel.updateSubscription(subscription.user_id, {
          status: 'active',
          planId: subscription.plan_id,
          expiry: periodEnd,
        });

        // C-04: Grant entitlements for the renewed plan period.
        // Lazy require avoids any future circular dependency risk.
        try {
          const PaymentService = require('./paymentService');
          await PaymentService.grantEntitlementsForPlan(subscription.user_id, subscription.plan_id, 'cybersource_recurring');
        } catch (entitlementErr) {
          logger.error('grantEntitlementsForPlan failed during Cybersource recurring renewal', {
            userId: subscription.user_id,
            planId: subscription.plan_id,
            subscriptionId,
            error: entitlementErr.message,
          });
          // Non-fatal for recurring: subscription period is already active. Log and continue.
          // The next successful billing cycle will re-grant. Monitor closely.
        }

        // Update user billing info
        await query(
          `UPDATE users SET
             next_billing_date = $2,
             billing_failures = 0,
             last_billing_attempt = NOW(),
             updated_at = NOW()
           WHERE id = $1`,
          [subscription.user_id, periodEnd]
        );
        await cache.del(`user:${subscription.user_id}`);

        // Send renewal notification
        await this._sendSubscriptionNotification(subscription.user_id, 'renewed', {
          amount: parseFloat(subscription.amount),
          periodEnd,
        });

        logger.info('Recurring payment processed successfully', {
          subscriptionId,
          userId: subscription.user_id,
          amount: subscription.amount,
          transactionId: chargeResult.transactionId,
        });

        return {
          success: true,
          transactionId: chargeResult.transactionId,
          periodEnd,
        };
      } else {
        // Payment failed
        const newFailures = (subscription.billing_failures || 0) + 1;
        const maxRetries = 3;

        // Calculate next retry (exponential backoff: 1 day, 3 days, 7 days)
        const retryDelays = [1, 3, 7];
        const nextRetry = newFailures < maxRetries
          ? new Date(Date.now() + retryDelays[newFailures - 1] * 24 * 60 * 60 * 1000)
          : null;

        // Update subscription status
        const newStatus = newFailures >= maxRetries ? 'cancelled' : 'past_due';
        await query(
          `UPDATE recurring_subscriptions SET
             status = $2,
             billing_failures = $3,
             last_billing_attempt = NOW(),
             updated_at = NOW()
           WHERE id = $1`,
          [subscriptionId, newStatus, newFailures]
        );

        // Update user billing failures
        await query(
          `UPDATE users SET
             billing_failures = $2,
             last_billing_attempt = NOW(),
             updated_at = NOW()
           WHERE id = $1`,
          [subscription.user_id, newFailures]
        );
        await cache.del(`user:${subscription.user_id}`);

        // Send payment failed notification
        await this._sendSubscriptionNotification(subscription.user_id, 'payment_failed', {
          amount: parseFloat(subscription.amount),
          failureCount: newFailures,
          nextRetry,
          willCancel: newFailures >= maxRetries,
        });

        // If max retries reached, cancel subscription
        if (newFailures >= maxRetries) {
          await this._handleSubscriptionCancelled({
            subscriptionId,
            userId: subscription.user_id,
            reason: 'payment_failures',
          });
        }

        logger.warn('Recurring payment failed', {
          subscriptionId,
          userId: subscription.user_id,
          failureCount: newFailures,
          error: chargeResult.error,
        });

        return {
          success: false,
          error: chargeResult.error,
          failureCount: newFailures,
          nextRetry,
        };
      }
    } catch (error) {
      logger.error('Error processing recurring payment:', {
        error: error.message,
        subscriptionId,
      });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Cancel a recurring subscription
   * @param {string} userId - User ID
   * @param {boolean} immediately - Cancel immediately or at period end
   * @returns {Promise<Object>} Cancellation result
   */
  static async cancelRecurringSubscription(userId, immediately = false) {
    try {
      // Get active subscription — exclude card_token; it is not needed for cancellation.
      const subResult = await query(
        `SELECT id, user_id, plan_id, card_token_mask, card_franchise, status,
                amount, currency, current_period_start, current_period_end,
                next_billing_date, trial_end, billing_failures, cancel_at_period_end
         FROM recurring_subscriptions
         WHERE user_id = $1 AND status IN ('active', 'trialing', 'past_due')
         ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );

      if (subResult.rows.length === 0) {
        return {
          success: false,
          error: 'No active subscription found',
        };
      }

      const subscription = subResult.rows[0];

      if (immediately) {
        // Cancel immediately
        await query(
          `UPDATE recurring_subscriptions SET
             status = 'cancelled',
             canceled_at = NOW(),
             ended_at = NOW(),
             cancellation_reason = 'user_requested',
             updated_at = NOW()
           WHERE id = $1`,
          [subscription.id]
        );

        // Update user
        await query(
          `UPDATE users SET
             auto_renew = FALSE,
             subscription_type = 'one_time',
             recurring_plan_id = NULL,
             next_billing_date = NULL,
             updated_at = NOW()
           WHERE id = $1`,
          [userId]
        );
        // Revoke entitlements for immediate cancellation
        if (subscription.plan_id) {
          try {
            await query(
              `UPDATE user_entitlements SET expires_at = NOW(), updated_at = NOW()
               WHERE user_id = $1 AND source_plan_id = $2 AND is_lifetime = false`,
              [String(userId), subscription.plan_id]
            );
            const EntitlementAccessService = require('./entitlementAccessService');
            await EntitlementAccessService.invalidateCache(String(userId));
            logger.info('Entitlements revoked on immediate Visa subscription cancel', { userId, planId: subscription.plan_id });
          } catch (revokeErr) {
            logger.error('Failed to revoke entitlements on immediate Visa cancel', { userId, error: revokeErr.message });
          }
        }

        await cache.del(`user:${userId}`);

        // Send notification
        await this._sendSubscriptionNotification(userId, 'cancelled', {
          immediately: true,
        });
      } else {
        // Cancel at period end
        await query(
          `UPDATE recurring_subscriptions SET
             cancel_at_period_end = TRUE,
             canceled_at = NOW(),
             cancellation_reason = 'user_requested',
             updated_at = NOW()
           WHERE id = $1`,
          [subscription.id]
        );

        // Update user auto_renew flag
        await query(
          `UPDATE users SET auto_renew = FALSE, updated_at = NOW() WHERE id = $1`,
          [userId]
        );
        await cache.del(`user:${userId}`);

        // Send notification
        await this._sendSubscriptionNotification(userId, 'will_cancel', {
          periodEnd: subscription.current_period_end,
        });
      }

      logger.info('Subscription cancellation requested', {
        userId,
        subscriptionId: subscription.id,
        immediately,
      });

      return {
        success: true,
        cancelAtPeriodEnd: !immediately,
        currentPeriodEnd: subscription.current_period_end,
        message: immediately
          ? 'Subscription cancelled immediately'
          : 'Subscription will be cancelled at end of billing period',
      };
    } catch (error) {
      logger.error('Error cancelling subscription:', {
        error: error.message,
        userId,
      });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Reactivate a cancelled subscription (if still in current period)
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Reactivation result
   */
  static async reactivateSubscription(userId) {
    try {
      // Get subscription that was cancelled but still in period — exclude card_token.
      const subResult = await query(
        `SELECT id, user_id, plan_id, card_token_mask, card_franchise, status,
                amount, currency, current_period_start, current_period_end,
                next_billing_date, trial_end, cancel_at_period_end
         FROM recurring_subscriptions
         WHERE user_id = $1 AND cancel_at_period_end = TRUE AND current_period_end > NOW()
         ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );

      if (subResult.rows.length === 0) {
        return {
          success: false,
          error: 'No subscription available for reactivation',
        };
      }

      const subscription = subResult.rows[0];

      // Reactivate
      await query(
        `UPDATE recurring_subscriptions SET
           cancel_at_period_end = FALSE,
           canceled_at = NULL,
           cancellation_reason = NULL,
           updated_at = NOW()
         WHERE id = $1`,
        [subscription.id]
      );

      // Update user
      await query(
        `UPDATE users SET
           auto_renew = TRUE,
           updated_at = NOW()
         WHERE id = $1`,
        [userId]
      );
      await cache.del(`user:${userId}`);

      // Send notification
      await this._sendSubscriptionNotification(userId, 'reactivated', {
        periodEnd: subscription.current_period_end,
      });

      logger.info('Subscription reactivated', {
        userId,
        subscriptionId: subscription.id,
      });

      return {
        success: true,
        message: 'Subscription reactivated successfully',
        nextBillingDate: subscription.current_period_end,
      };
    } catch (error) {
      logger.error('Error reactivating subscription:', {
        error: error.message,
        userId,
      });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get subscription details for a user
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} Subscription details
   */
  static async getSubscriptionDetails(userId) {
    try {
      const result = await query(
        `SELECT rs.*, p.name as plan_name, p.price as plan_price
         FROM recurring_subscriptions rs
         LEFT JOIN plans p ON rs.plan_id = p.id
         WHERE rs.user_id = $1 AND rs.status IN ('active', 'trialing', 'past_due')
         ORDER BY rs.created_at DESC LIMIT 1`,
        [userId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const sub = result.rows[0];
      return {
        id: sub.id,
        status: sub.status,
        planId: sub.plan_id,
        planName: sub.plan_name,
        amount: parseFloat(sub.amount),
        currency: sub.currency,
        cardMask: sub.card_token_mask,
        cardFranchise: sub.card_franchise,
        currentPeriodStart: sub.current_period_start,
        currentPeriodEnd: sub.current_period_end,
        nextBillingDate: sub.next_billing_date,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        trialEnd: sub.trial_end,
        billingFailures: sub.billing_failures,
        createdAt: sub.created_at,
      };
    } catch (error) {
      logger.error('Error getting subscription details:', {
        error: error.message,
        userId,
      });
      return null;
    }
  }

  /**
   * Process all due recurring payments (called by cron job)
   * @returns {Promise<Object>} Processing summary
   */
  static async processDuePayments() {
    // Distributed lock — prevents concurrent cron runs (e.g. overlapping Docker restarts,
    // dual-scheduler bug) from double-charging subscriptions.
    // TTL of 1800s (30 min) is intentionally generous: the job processes each sub with a
    // 500ms inter-charge delay, so even 1000 subs would finish well inside 30 minutes.
    const lockKey = 'processDuePayments:global';
    const acquired = await cache.acquireLock(lockKey, 1800);
    if (!acquired) {
      logger.warn('processDuePayments: lock not acquired — another instance is running, skipping');
      return { skipped: true };
    }

    try {
      // Get all subscriptions due for billing
      const dueSubscriptions = await query(
        `SELECT id, user_id FROM recurring_subscriptions
         WHERE status IN ('active', 'past_due')
         AND next_billing_date <= NOW()
         AND (cancel_at_period_end = FALSE OR cancel_at_period_end IS NULL)`
      );

      const results = {
        total: dueSubscriptions.rows.length,
        successful: 0,
        failed: 0,
        errors: [],
      };

      for (const sub of dueSubscriptions.rows) {
        try {
          const result = await this.processRecurringPayment(sub.id);
          if (result.success) {
            results.successful++;
          } else {
            results.failed++;
            results.errors.push({
              subscriptionId: sub.id,
              userId: sub.user_id,
              error: result.error,
            });
          }

          // Small delay to prevent rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (err) {
          results.failed++;
          results.errors.push({
            subscriptionId: sub.id,
            userId: sub.user_id,
            error: err.message,
          });
        }
      }

      logger.info('Recurring payments processing completed', results);
      return results;
    } catch (error) {
      logger.error('Error processing due payments:', { error: error.message });
      throw error;
    } finally {
      await cache.releaseLock(lockKey);
    }
  }

  /**
   * Charge a card using ePayco/Visa Cybersource
   * @private
   */
  static async _chargeCard({ token, amount, description, subscriptionId, userId }) {
    try {
      const configData = config.visaCybersource;

      // Call ePayco charge API with tokenized card
      const response = await axios.post(
        `${configData.endpoint}/charge`,
        {
          token,
          amount,
          currency: 'USD',
          description,
          metadata: {
            subscription_id: subscriptionId,
            user_id: userId,
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${configData.apiKey}`,
            'x-merchant-id': configData.merchantId,
          },
          timeout: 60000,
        }
      );

      if (response.data.success) {
        return {
          success: true,
          transactionId: response.data.transaction_id,
          authorizationCode: response.data.authorization_code,
          responseCode: response.data.response_code,
          message: response.data.message || 'Payment successful',
        };
      }

      return {
        success: false,
        error: response.data.error || response.data.message || 'Payment failed',
        responseCode: response.data.response_code,
      };
    } catch (error) {
      logger.error('Error charging card:', {
        error: error.message,
        response: error.response?.data,
      });
      return {
        success: false,
        error: error.response?.data?.message || error.message,
      };
    }
  }

  /**
   * Send subscription notification to user
   * @private
   */
  static async _sendSubscriptionNotification(userId, type, data) {
    try {
      const bot = new Telegraf(process.env.BOT_TOKEN);
      const user = await UserModel.getById(userId);
      const isSpanish = user?.language?.startsWith('es');

      let message;
      const groupId = process.env.PRIME_CHANNEL_ID || '-1002997324714';

      switch (type) {
        case 'created': {
          let inviteLink = 'https://t.me/PNPTV_PRIME';
          try {
            const response = await bot.telegram.createChatInviteLink(groupId, {
              member_limit: 1,
              name: `Recurring ${userId}`,
            });
            inviteLink = response.invite_link;
          } catch (linkError) {
            logger.error('Error creating invite link:', { error: linkError.message });
          }

          const periodEndStr = data.periodEnd?.toLocaleDateString(
            isSpanish ? 'es-ES' : 'en-US',
            { year: 'numeric', month: 'long', day: 'numeric' }
          );

          message = isSpanish
            ? `🎉 *¡Suscripción Recurrente Activada!*

✅ Tu membresía PRIME con renovación automática mensual ha sido activada.

💎 *Plan:* ${data.planName}
💰 *Precio:* $${data.amount?.toFixed(2)} USD/mes
📅 *Próxima renovación:* ${periodEndStr}
🔄 *Auto-renovación:* Activada

👉 Accede al canal exclusivo:
[🔗 Ingresar a PRIME](${inviteLink})

💳 Administra tu suscripción: /subscription

⚠️ _Este enlace es de un solo uso._`
            : `🎉 *Recurring Subscription Activated!*

✅ Your PRIME membership with monthly auto-renewal has been activated.

💎 *Plan:* ${data.planName}
💰 *Price:* $${data.amount?.toFixed(2)} USD/month
📅 *Next renewal:* ${periodEndStr}
🔄 *Auto-renewal:* Enabled

👉 Access the exclusive channel:
[🔗 Join PRIME](${inviteLink})

💳 Manage your subscription: /subscription

⚠️ _This link is for one-time use only._`;
          break;
        }

        case 'renewed': {
          const periodEndStr = data.periodEnd?.toLocaleDateString(
            isSpanish ? 'es-ES' : 'en-US',
            { year: 'numeric', month: 'long', day: 'numeric' }
          );

          message = isSpanish
            ? `✅ *Suscripción Renovada*

Tu membresía PRIME ha sido renovada automáticamente.

💰 *Monto cobrado:* $${data.amount?.toFixed(2)} USD
📅 *Próxima renovación:* ${periodEndStr}

¡Gracias por continuar con nosotros! 🙏`
            : `✅ *Subscription Renewed*

Your PRIME membership has been automatically renewed.

💰 *Amount charged:* $${data.amount?.toFixed(2)} USD
📅 *Next renewal:* ${periodEndStr}

Thank you for staying with us! 🙏`;
          break;
        }

        case 'payment_failed': {
          const nextRetryStr = data.nextRetry?.toLocaleDateString(
            isSpanish ? 'es-ES' : 'en-US',
            { year: 'numeric', month: 'long', day: 'numeric' }
          );

          message = isSpanish
            ? `⚠️ *Pago Fallido*

No pudimos procesar tu pago de $${data.amount?.toFixed(2)} USD.

${data.nextRetry ? `🔄 *Próximo intento:* ${nextRetryStr}` : ''}
${data.willCancel ? '❌ *Tu suscripción será cancelada si el próximo intento falla.*' : ''}

💳 Actualiza tu método de pago: /subscription`
            : `⚠️ *Payment Failed*

We couldn't process your payment of $${data.amount?.toFixed(2)} USD.

${data.nextRetry ? `🔄 *Next attempt:* ${nextRetryStr}` : ''}
${data.willCancel ? '❌ *Your subscription will be cancelled if the next attempt fails.*' : ''}

💳 Update your payment method: /subscription`;
          break;
        }

        case 'cancelled':
          message = isSpanish
            ? `😔 *Suscripción Cancelada*

Tu suscripción recurrente PRIME ha sido cancelada.

Tu acceso PRIME ha terminado. Puedes reactivar en cualquier momento con /subscribe`
            : `😔 *Subscription Cancelled*

Your PRIME recurring subscription has been cancelled.

Your PRIME access has ended. You can reactivate anytime with /subscribe`;
          break;

        case 'will_cancel': {
          const periodEndStr = data.periodEnd?.toLocaleDateString(
            isSpanish ? 'es-ES' : 'en-US',
            { year: 'numeric', month: 'long', day: 'numeric' }
          );

          message = isSpanish
            ? `📋 *Cancelación Programada*

Tu suscripción PRIME se cancelará al final del período actual.

📅 *Acceso hasta:* ${periodEndStr}

¿Cambiaste de opinión? Reactiva con /subscription`
            : `📋 *Cancellation Scheduled*

Your PRIME subscription will be cancelled at the end of the current period.

📅 *Access until:* ${periodEndStr}

Changed your mind? Reactivate with /subscription`;
          break;
        }

        case 'reactivated': {
          const periodEndStr = data.periodEnd?.toLocaleDateString(
            isSpanish ? 'es-ES' : 'en-US',
            { year: 'numeric', month: 'long', day: 'numeric' }
          );

          message = isSpanish
            ? `🎉 *¡Suscripción Reactivada!*

Tu suscripción PRIME ha sido reactivada.

📅 *Próxima renovación:* ${periodEndStr}

¡Gracias por quedarte con nosotros! 🙏`
            : `🎉 *Subscription Reactivated!*

Your PRIME subscription has been reactivated.

📅 *Next renewal:* ${periodEndStr}

Thank you for staying with us! 🙏`;
          break;
        }

        default:
          return;
      }

      await bot.telegram.sendMessage(userId, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: false,
      });

      logger.info('Subscription notification sent', { userId, type });
    } catch (error) {
      if (error.response?.error_code === 403) {
        logger.debug(`Cannot send notification to user ${userId}: User blocked bot`);
      } else {
        logger.error('Error sending subscription notification:', {
          error: error.message,
          userId,
          type,
        });
      }
    }
  }

  /**
   * Handle subscription cancellation due to payment failures
   * @private
   */
  static async _handleSubscriptionCancelled({ subscriptionId, userId, reason }) {
    try {
      // Look up plan_id for entitlement revocation
      const subRow = await query(
        `SELECT plan_id FROM recurring_subscriptions WHERE id = $1`,
        [subscriptionId]
      );
      const planId = subRow.rows[0]?.plan_id || null;

      await query(
        `UPDATE recurring_subscriptions SET
           status = 'cancelled',
           canceled_at = NOW(),
           ended_at = NOW(),
           cancellation_reason = $2,
           updated_at = NOW()
         WHERE id = $1`,
        [subscriptionId, reason]
      );

      await query(
        `UPDATE users SET
           auto_renew = FALSE,
           subscription_type = 'one_time',
           recurring_plan_id = NULL,
           next_billing_date = NULL,
           updated_at = NOW()
         WHERE id = $1`,
        [userId]
      );

      // Revoke entitlements granted by this plan
      if (planId) {
        try {
          await query(
            `UPDATE user_entitlements SET expires_at = NOW(), updated_at = NOW()
             WHERE user_id = $1 AND source_plan_id = $2 AND is_lifetime = false`,
            [String(userId), planId]
          );
          const EntitlementAccessService = require('./entitlementAccessService');
          await EntitlementAccessService.invalidateCache(String(userId));
          logger.info('Entitlements revoked on Visa subscription cancellation', { userId, planId, subscriptionId });
        } catch (revokeErr) {
          logger.error('Failed to revoke entitlements on Visa cancellation', { userId, planId, error: revokeErr.message });
        }
      }

      await cache.del(`user:${userId}`);

      await this._sendSubscriptionNotification(userId, 'cancelled', {});

      logger.info('Subscription cancelled due to payment failures', {
        subscriptionId,
        userId,
        reason,
      });
    } catch (error) {
      logger.error('Error handling subscription cancellation:', {
        error: error.message,
        subscriptionId,
      });
    }
  }

  /**
   * Handle Visa Cybersource webhook notifications
   * @param {Object} webhookData - Parsed webhook payload (req.body)
   * @param {string} signature - Webhook signature for verification
   * @param {Buffer|string|null} rawBody - Raw request body bytes for HMAC computation
   * @returns {Promise<Object>} Webhook processing result
   */
  static async handleWebhook(webhookData, signature, rawBody = null) {
    // Idempotency lock — prevent duplicate processing of the same event.
    // A missing eventId is treated as an error (not a lock bypass) — accepting events
    // without a stable identity would allow replay attacks with no deduplication.
    const eventId = webhookData?.id || webhookData?.eventId;
    if (!eventId) {
      logger.warn('Cybersource webhook: missing event id, rejecting', {
        eventType: webhookData?.eventType,
      });
      return { success: false, error: 'Missing event id', statusCode: 400 };
    }
    const lockKey = `cybersource_webhook:${eventId}`;
    const acquired = await cache.acquireLock(lockKey, 120);
    if (!acquired) {
      logger.warn('Cybersource webhook already being processed, skipping', { eventId });
      return { success: true, alreadyProcessed: true };
    }

    try {
      // Verify webhook signature using raw body to avoid JSON serialization differences
      const isValid = this._verifyWebhookSignature(webhookData, signature, rawBody);
      if (!isValid) {
        throw new Error('Invalid webhook signature');
      }

      const eventType = webhookData.eventType;

      const genuinelyUnimplementedEvents = [
        'payment.failed',
      ];

      if (genuinelyUnimplementedEvents.includes(eventType)) {
        logger.warn('Cybersource webhook event not yet implemented', { eventType });
        return {
          success: false,
          error: 'Cybersource webhook processing not yet implemented',
          statusCode: 503,
        };
      }

      switch (eventType) {
        case 'payment.success': {
          // Acknowledge webhook even on internal errors — Cybersource will stop sending
          // future events if we return non-200. All errors are caught and logged below.
          try {
            const { userId, planId, amount, currency, subscriptionId } = webhookData.data || {};
            if (userId && planId) {
              const PaymentService = require('./paymentService');
              await PaymentService.grantEntitlementsForPlan(userId, planId, 'cybersource_payment');
              logger.info('Cybersource payment.success: entitlements granted', {
                eventId, userId, planId, amount, currency, subscriptionId,
              });
            } else {
              logger.warn('Cybersource payment.success: missing userId or planId, skipping entitlement grant', {
                eventId, dataKeys: Object.keys(webhookData.data || {}),
              });
            }
          } catch (err) {
            logger.error('Cybersource payment.success: error processing entitlements (webhook still acknowledged)', {
              eventId, error: err.message,
            });
          }
          return { success: true };
        }

        case 'subscription.created': {
          try {
            const { userId, planId, subscriptionId, periodEnd } = webhookData.data || {};
            if (!userId || !planId) {
              logger.warn('Cybersource subscription.created: missing userId or planId', {
                eventId, dataKeys: Object.keys(webhookData.data || {}),
              });
              return { success: true };
            }
            if (subscriptionId) {
              await query(
                `UPDATE recurring_subscriptions SET status = 'active', updated_at = NOW()
                 WHERE id = $1 AND status != 'cancelled'`,
                [subscriptionId]
              );
            }
            const PaymentService = require('./paymentService');
            await PaymentService.grantEntitlementsForPlan(userId, planId, 'cybersource_subscription');
            logger.info('Cybersource subscription.created: entitlements granted', {
              eventId, userId, planId, subscriptionId, periodEnd,
            });
          } catch (err) {
            logger.error('Cybersource subscription.created: error processing (webhook still acknowledged)', {
              eventId, error: err.message,
            });
          }
          return { success: true };
        }

        case 'subscription.updated': {
          try {
            const { userId, planId, subscriptionId, newPeriodEnd } = webhookData.data || {};
            if (!userId || !planId) {
              logger.warn('Cybersource subscription.updated: missing userId or planId', {
                eventId, dataKeys: Object.keys(webhookData.data || {}),
              });
              return { success: true };
            }
            const PaymentService = require('./paymentService');
            await PaymentService.grantEntitlementsForPlan(userId, planId, 'cybersource_subscription_update');
            logger.info('Cybersource subscription.updated: entitlements extended', {
              eventId, userId, planId, subscriptionId, newPeriodEnd,
            });
          } catch (err) {
            logger.error('Cybersource subscription.updated: error processing (webhook still acknowledged)', {
              eventId, error: err.message,
            });
          }
          return { success: true };
        }

        case 'subscription.cancelled': {
          // Validate required fields before acting on unvalidated webhook payload.
          const { subscriptionId, userId: webhookUserId } = webhookData.data || {};
          if (!subscriptionId || !webhookUserId) {
            logger.warn('Cybersource webhook subscription.cancelled: missing subscriptionId or userId', {
              eventId,
              dataKeys: Object.keys(webhookData.data || {}),
            });
            return { success: false, error: 'Missing subscriptionId or userId in webhook payload', statusCode: 400 };
          }
          // Ownership check: verify the subscription actually belongs to the userId in the payload.
          const ownerCheck = await query(
            `SELECT id FROM recurring_subscriptions WHERE id = $1 AND user_id = $2`,
            [subscriptionId, webhookUserId]
          );
          if (ownerCheck.rows.length === 0) {
            logger.warn('Cybersource webhook subscription.cancelled: ownership mismatch or subscription not found', {
              subscriptionId,
              webhookUserId,
            });
            return { success: false, error: 'Subscription not found or ownership mismatch', statusCode: 403 };
          }
          return await this._handleSubscriptionCancelled({
            subscriptionId,
            userId: webhookUserId,
            reason: webhookData.data.reason || 'webhook',
          });
        }
        default:
          logger.warn('Unhandled Visa Cybersource webhook event:', { eventType });
          return { success: true, message: 'Event type not handled' };
      }
    } catch (error) {
      logger.error('Error processing Visa Cybersource webhook:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to process webhook',
      };
    } finally {
      // eventId is guaranteed non-null here (we returned early above if it was missing).
      await cache.releaseLock(lockKey);
    }
  }

  /**
   * Verify webhook signature
   * Uses rawBody when available to ensure byte-exact HMAC matching.
   * JSON.stringify(data) is NOT equivalent to the original request body because key
   * ordering and whitespace differ between implementations, producing a different HMAC.
   * @private
   * @param {Object} data - Parsed payload (only used as fallback when rawBody absent)
   * @param {string} signature - Expected HMAC hex digest from request header
   * @param {Buffer|string|null} rawBody - Raw request bytes captured before JSON parsing
   */
  static _verifyWebhookSignature(data, signature, rawBody = null) {
    const configData = config.visaCybersource;
    if (!configData.webhookSecret) {
      // P11: never fail open — if no secret is configured, reject all requests
      return false;
    }

    try {
      const hmac = crypto.createHmac('sha256', configData.webhookSecret);
      // Prefer raw body bytes for HMAC to avoid JSON serialization differences.
      // Fall back to JSON.stringify only when rawBody was not captured (non-webhook paths).
      const bodyToSign = rawBody != null
        ? (Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody))
        : Buffer.from(JSON.stringify(data));
      const computedSignature = hmac.update(bodyToSign).digest('hex');
      return crypto.timingSafeEqual(
        Buffer.from(computedSignature),
        Buffer.from(signature || '')
      );
    } catch {
      return false;
    }
  }

  /**
   * Webhook event handlers
   * @private
   */
  // C2: these handlers are stubs pending full implementation.
  // handleWebhook() intercepts all calls to these and returns 503 before reaching them.
  static async _handlePaymentSuccess(data) {
    logger.warn('_handlePaymentSuccess is not implemented', { data });
    return { success: false, error: 'Not implemented' };
  }

  static async _handlePaymentFailed(data) {
    logger.warn('_handlePaymentFailed is not implemented', { data });
    return { success: false, error: 'Not implemented' };
  }

  static async _handleSubscriptionCreated(data) {
    logger.warn('_handleSubscriptionCreated is not implemented', { data });
    return { success: false, error: 'Not implemented' };
  }

  static async _handleSubscriptionUpdated(data) {
    logger.warn('_handleSubscriptionUpdated is not implemented', { data });
    return { success: false, error: 'Not implemented' };
  }
}

module.exports = VisaCybersourceService;
