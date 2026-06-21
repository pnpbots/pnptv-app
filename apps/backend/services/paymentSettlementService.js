'use strict';

/**
 * PaymentSettlementService
 *
 * Single source of truth for all BTCPay/Dash settlement logic.
 * Called by both:
 *   - btcpayWebhookController.js   (real-time webhook delivery)
 *   - paymentRecoveryService.js    (reconciler when webhook delivery fails)
 *
 * Each method follows the same return contract:
 *   { type, ok: true, ...details }          — success
 *   { type, alreadyProcessed: true }        — idempotency hit (order not in 'pending')
 *   { type, error: string, orderId? }       — failure (caller decides HTTP status)
 *
 * All methods accept a `dbQuery` function so the reconciler can pass the
 * shared `query` from config/postgres while tests can inject a mock.
 */

const { createHash } = require('crypto');
const logger = require('../utils/logger');

// Derive a stable UUID from a BTCPay invoiceId so subscribeToCreator's
// deduplication ON CONFLICT (source_payment_id) works correctly on retries.
function invoiceToUUID(invoiceId) {
  const h = createHash('sha256').update(`btcpay:${invoiceId}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-${['8','9','a','b'][parseInt(h[16],16)%4]}${h.slice(17,20)}-${h.slice(20,32)}`;
}

class PaymentSettlementService {
  /**
   * Settle a live-show ticket purchase (resource = 'live_show_ticket').
   *
   * @param {object} order          - Row from dash_subscription_orders
   * @param {string} invoiceId      - BTCPay invoice ID
   * @param {object} orderMetadata  - Parsed order.metadata
   * @param {Function} dbQuery      - pg query function
   * @returns {Promise<object>}
   */
  static async settleLiveShowTicket(order, invoiceId, orderMetadata, dbQuery) {
    const settle = await dbQuery(
      `UPDATE dash_subscription_orders SET status = 'completed', completed_at = NOW()
       WHERE id = $1 AND status = 'pending' RETURNING id`,
      [order.id]
    );
    if (settle.rowCount === 0) {
      return { type: 'live_show_ticket', alreadyProcessed: true };
    }

    try {
      const { handleTicketSettlement } = require('../bot/api/controllers/webappLiveController');
      await handleTicketSettlement(
        order.user_id,
        orderMetadata.slotId,
        'dash',
        parseFloat(order.usd_amount || 0)
      );

      const { markInvoiceProcessed } = require('../config/btcpay');
      await markInvoiceProcessed(invoiceId, {
        userId: order.user_id,
        slotId: orderMetadata.slotId,
        source: 'live_show_ticket',
      });

      logger.info('BTCPay: live show ticket settled', {
        invoiceId,
        userId: order.user_id,
        slotId: orderMetadata.slotId,
      });

      return { type: 'live_show_ticket', ok: true, slotId: orderMetadata.slotId };
    } catch (err) {
      logger.error('BTCPay: live show ticket settlement failed', {
        invoiceId, orderId: order.id, error: err.message,
      });
      await dbQuery(
        `UPDATE dash_subscription_orders SET notes = $2 WHERE id = $1`,
        [order.id, `ticket_settlement_failed: ${err.message}`.slice(0, 500)]
      );
      return { type: 'live_show_ticket', error: 'ticket_settlement_failed', orderId: order.id };
    }
  }

  /**
   * Settle a private-call booking (resource = 'private_call_booking').
   *
   * @param {object} order
   * @param {string} invoiceId
   * @param {object} orderMetadata
   * @param {Function} dbQuery
   * @returns {Promise<object>}
   */
  static async settlePrivateCallBooking(order, invoiceId, orderMetadata, dbQuery) {
    const settle = await dbQuery(
      `UPDATE dash_subscription_orders SET status = 'completed', completed_at = NOW()
       WHERE id = $1 AND status = 'pending' RETURNING id`,
      [order.id]
    );
    if (settle.rowCount === 0) {
      return { type: 'private_call_booking', alreadyProcessed: true };
    }

    try {
      const PrivateCallBookingService = require('./privateCallBookingService');
      const settleResult = await PrivateCallBookingService.handlePaymentComplete(
        orderMetadata.paymentId,
        invoiceId
      );

      if (!settleResult?.success) {
        logger.error('BTCPay: private-call booking settlement failed', {
          invoiceId, paymentId: orderMetadata.paymentId, error: settleResult?.error,
        });
        await dbQuery(
          `UPDATE dash_subscription_orders SET notes = $2 WHERE id = $1`,
          [order.id, `booking_settlement_failed: ${settleResult?.error || 'unknown'}`.slice(0, 500)]
        );
        return { type: 'private_call_booking', error: 'booking_settlement_failed', orderId: order.id };
      }

      const { markInvoiceProcessed } = require('../config/btcpay');
      await markInvoiceProcessed(invoiceId, {
        userId: order.user_id,
        paymentId: orderMetadata.paymentId,
        source: 'private_call_booking',
      });

      logger.info('BTCPay: private-call booking settled', {
        invoiceId,
        userId: order.user_id,
        paymentId: orderMetadata.paymentId,
        bookingId: orderMetadata.bookingId,
      });

      return { type: 'private_call_booking', ok: true, paymentId: orderMetadata.paymentId };
    } catch (err) {
      logger.error('BTCPay: private-call booking settlement error', {
        invoiceId, orderId: order.id, error: err.message,
      });
      await dbQuery(
        `UPDATE dash_subscription_orders SET notes = $2 WHERE id = $1`,
        [order.id, `booking_settlement_error: ${err.message}`.slice(0, 500)]
      );
      return { type: 'private_call_booking', error: 'booking_settlement_error', orderId: order.id };
    }
  }

  /**
   * Settle a call package purchase (resource = 'call_package').
   *
   * @param {object} order
   * @param {string} invoiceId
   * @param {object} orderMetadata
   * @param {Function} dbQuery
   * @returns {Promise<object>}
   */
  static async settleCallPackage(order, invoiceId, orderMetadata, dbQuery) {
    const settle = await dbQuery(
      `UPDATE dash_subscription_orders SET status = 'completed', completed_at = NOW()
       WHERE id = $1 AND status = 'pending' RETURNING id`,
      [order.id]
    );
    if (settle.rowCount === 0) {
      return { type: 'call_package', alreadyProcessed: true };
    }

    try {
      const callCheckoutSvc = require('./callCheckoutService');
      await callCheckoutSvc.onCallPaymentSuccess(orderMetadata.paymentId);

      const { markInvoiceProcessed } = require('../config/btcpay');
      await markInvoiceProcessed(invoiceId, {
        userId: order.user_id,
        paymentId: orderMetadata.paymentId,
        source: 'call_package',
      });

      logger.info('BTCPay: call package settled', {
        invoiceId,
        userId: order.user_id,
        paymentId: orderMetadata.paymentId,
        bookingId: orderMetadata.bookingId,
      });

      return { type: 'call_package', ok: true, paymentId: orderMetadata.paymentId };
    } catch (err) {
      logger.error('BTCPay: call package settlement failed', {
        invoiceId, orderId: order.id, error: err.message,
      });
      await dbQuery(
        `UPDATE dash_subscription_orders SET notes = $2 WHERE id = $1`,
        [order.id, `call_settlement_failed: ${err.message}`.slice(0, 500)]
      );
      return { type: 'call_package', error: 'call_settlement_failed', orderId: order.id };
    }
  }

  /**
   * Settle a scoped resource purchase (hangout-access or channel-access).
   * These carry orderMetadata.hangoutGroupId or orderMetadata.channelId.
   *
   * @param {object} order
   * @param {string} invoiceId
   * @param {object} orderMetadata
   * @param {Function} dbQuery
   * @returns {Promise<object>}
   */
  static async settleScopedPurchase(order, invoiceId, orderMetadata, dbQuery) {
    // Atomic lock: flip to 'processing' so concurrent deliveries are blocked
    const settle = await dbQuery(
      `UPDATE dash_subscription_orders SET status = 'processing'
       WHERE id = $1 AND status = 'pending' RETURNING id`,
      [order.id]
    );
    if (settle.rowCount === 0) {
      return { type: 'scoped_purchase', alreadyProcessed: true };
    }

    try {
      const PaymentService = require('./paymentService');
      const grantResult = await PaymentService.grantEntitlementsForPlan(
        order.user_id,
        order.plan_id,
        'dash',
        orderMetadata,
        invoiceId
      );

      // Mark completed AFTER successful grant
      await dbQuery(
        `UPDATE dash_subscription_orders SET status = 'completed', completed_at = NOW() WHERE id = $1`,
        [order.id]
      );

      const scope = orderMetadata.hangoutGroupId
        ? `hangout:${orderMetadata.hangoutGroupId}`
        : `channel:${orderMetadata.channelId}`;

      logger.info('BTCPay scoped resource purchase granted', {
        invoiceId,
        orderId: order.id,
        planId: order.plan_id,
        scope,
        grantResult,
      });

      const { markInvoiceProcessed } = require('../config/btcpay');
      await markInvoiceProcessed(invoiceId, {
        userId: order.user_id,
        planId: order.plan_id,
        source: 'scoped_purchase',
        scope,
      });

      return { type: 'scoped_purchase', ok: true, grantResult };
    } catch (err) {
      logger.error('BTCPay scoped grant failed — rolling back to pending for retry', {
        invoiceId, orderId: order.id, planId: order.plan_id, error: err.message,
      });
      // Roll back so BTCPay webhook retry can re-attempt the grant
      await dbQuery(
        `UPDATE dash_subscription_orders SET status = 'pending', notes = $2 WHERE id = $1`,
        [order.id, `scoped_grant_failed: ${err.message}`.slice(0, 500)]
      );
      return { type: 'scoped_purchase', error: 'scoped_grant_failed', orderId: order.id };
    }
  }

  /**
   * Settle a creator subscription (plan_id = 'creator_monthly').
   * Routes through CreatorService.subscribeToCreator — handles entitlement +
   * creator_subscriptions row + 70/30 earnings split + sockets.
   * Does NOT mutate users.tier (buying a creator sub must not clobber the
   * buyer's main subscription expiry).
   *
   * Note: the order status flip happens BEFORE the creator subscription call
   * (grant-before-tier ordering, Sprint 0 fix C-3). If creatorService throws,
   * the order is already 'completed' but we return an error so BTCPay retries.
   * The reconciler will see the completed order and skip — operator must investigate.
   * We update notes so they can find it quickly.
   *
   * @param {object} order
   * @param {string} invoiceId
   * @param {Function} dbQuery
   * @returns {Promise<object>}
   */
  static async settleCreatorSubscription(order, invoiceId, dbQuery) {
    const settle = await dbQuery(
      `UPDATE dash_subscription_orders SET status = 'completed', completed_at = NOW()
       WHERE id = $1 AND status = 'pending' RETURNING id`,
      [order.id]
    );
    if (settle.rowCount === 0) {
      logger.info('BTCPay subscription already processed or not pending', { invoiceId, orderId: order.id });
      return { type: 'creator_subscription', alreadyProcessed: true };
    }

    try {
      const CreatorService = require('./creatorService');
      await CreatorService.subscribeToCreator(order.user_id, order.creator_id, invoiceToUUID(invoiceId));

      logger.info('BTCPay: creator subscription activated', {
        userId: order.user_id, creatorId: order.creator_id, invoiceId,
      });

      const { markInvoiceProcessed } = require('../config/btcpay');
      await markInvoiceProcessed(invoiceId, {
        userId: order.user_id,
        creatorId: order.creator_id,
        source: 'creator_subscription',
      });

      return { type: 'creator_subscription', ok: true, creatorId: order.creator_id };
    } catch (err) {
      logger.error('BTCPay creator subscription activation failed — rolling back to pending', {
        error: err.message, userId: order.user_id, creatorId: order.creator_id, invoiceId,
      });
      // Roll back to pending so BTCPay can retry and the user eventually gets access
      await dbQuery(
        `UPDATE dash_subscription_orders SET status = 'pending', completed_at = NULL, notes = $2 WHERE id = $1`,
        [order.id, `creator_sub_failed: ${err.message}`.slice(0, 500)]
      );
      return { type: 'creator_subscription', error: 'creator_subscription_failed', orderId: order.id };
    }
  }

  /**
   * Settle a standard subscription (plan from `plans` table).
   *
   * Order of operations (Sprint 0 fix C-3 — grant-before-tier):
   *   1. Atomic status flip (idempotency guard)
   *   2. grantEntitlementsForPlan — SOURCE OF TRUTH for access
   *   3. users.tier sync (display only, non-fatal)
   *   4. Redis user cache invalidation (non-fatal)
   *   5. Socket emit (non-fatal)
   *   6. Post-purchase notifications (non-fatal)
   *   7. markInvoiceProcessed
   *
   * If step 2 throws, the order is rolled back to 'pending' and we return an
   * error so BTCPay redelivers — the user gets no access until the grant lands.
   *
   * @param {object} order       - Row from dash_subscription_orders
   * @param {string} invoiceId
   * @param {object} plan        - Row from plans table (or synthetic for creator_monthly)
   * @param {Function} dbQuery
   * @param {object} [opts]
   * @param {object} [opts.cache]        - Redis cache for user-cache invalidation
   * @param {object} [opts.socketIo]     - Socket.IO instance for real-time emit
   * @returns {Promise<object>}
   */
  static async settleSubscription(order, invoiceId, plan, dbQuery, opts = {}) {
    const durationDays = plan.duration_days || plan.duration || 30;
    // Lifetime detection: prefer the explicit `is_lifetime` field on the plan
    // row. Fall back to the duration heuristic only for legacy plans where
    // the column may be missing. The 36500-day heuristic alone misclassified
    // the `lifetime100` plan (60-day duration + lifetime add-on) and was a
    // documented trap.
    const isLifetime = plan.is_lifetime === true || durationDays >= 36500;
    const expiryDate = isLifetime ? null : new Date(Date.now() + durationDays * 86400000);
    const newTier = (plan.tier === 'member' || order.plan_id.startsWith('member_')) ? 'member' : 'PRIME';

    // Atomic idempotency guard: only proceed if the order is still in 'pending' state.
    // If another webhook delivery already completed it, rowCount will be 0.
    const settle = await dbQuery(
      `UPDATE dash_subscription_orders SET status = 'completed', completed_at = NOW()
       WHERE id = $1 AND status = 'pending' RETURNING id`,
      [order.id]
    );
    if (settle.rowCount === 0) {
      logger.info('BTCPay subscription already processed or not pending', { invoiceId, orderId: order.id });
      return { type: 'subscription', alreadyProcessed: true };
    }

    // Grant entitlements FIRST — they're the source of truth for access.
    // If the grant fails the user has no actual access, so a 200 here would
    // hide a broken account behind a successful-looking response. Roll back
    // the order to pending and return an error so BTCPay redelivers.
    const MetricsService = require('./metricsService');
    try {
      const PaymentService = require('./paymentService');
      const grantResult = await PaymentService.grantEntitlementsForPlan(
        order.user_id, order.plan_id, 'btcpay', null, invoiceId
      );
      if (!grantResult || grantResult.granted === 0) {
        throw new Error(`grant_returned_zero: ${JSON.stringify(grantResult || {})}`);
      }
      logger.info('BTCPay: entitlements granted', { userId: order.user_id, planId: order.plan_id });
      MetricsService.recordGrantSucceeded('btcpay', order.plan_id);
    } catch (entErr) {
      logger.error('BTCPay: entitlement grant failed — rolling back to pending for retry', {
        userId: order.user_id, planId: order.plan_id, invoiceId, error: entErr.message,
      });
      MetricsService.recordGrantFailed('btcpay', entErr.message?.includes('grant_returned_zero') ? 'grant_returned_zero' : 'grant_threw');
      await dbQuery(
        `UPDATE dash_subscription_orders SET status = 'pending', completed_at = NULL,
             notes = $2 WHERE id = $1`,
        [order.id, `entitlement_grant_failed: ${entErr.message}`.slice(0, 500)]
      );
      return { type: 'subscription', error: 'entitlement_grant_failed', orderId: order.id };
    }

    // Tier/expiry update on users (display only — entitlements above are the
    // real gate). Failure here is non-fatal because access already works via
    // entitlements.
    try {
      await dbQuery(
        `UPDATE users
         SET tier = $2, subscription_status = 'active', plan_id = $3, plan_expiry = $4, updated_at = NOW()
         WHERE id = $1 OR telegram = $1`,
        [order.user_id, newTier, order.plan_id, expiryDate]
      );
      logger.info('BTCPay: subscription activated', { userId: order.user_id, planId: order.plan_id, invoiceId });
    } catch (tierErr) {
      logger.warn('BTCPay: users.tier sync failed (non-fatal — entitlements already granted)', {
        userId: order.user_id, error: tierErr.message,
      });
    }

    // PAY-006: Invalidate Redis user cache after raw SQL tier update.
    if (opts.cache) {
      try {
        await opts.cache.del(`user:${order.user_id}`);
        logger.info('Cleared user cache after BTCPay subscription activation', { userId: order.user_id });
      } catch (cacheErr) {
        logger.warn('Failed to clear user cache after BTCPay activation', { error: cacheErr.message });
      }
    }

    // Socket notification (non-fatal)
    if (opts.socketIo) {
      try {
        opts.socketIo.to(`user:${order.user_id}`).emit('subscription:activated', {
          planId: order.plan_id,
          planName: plan.display_name || plan.name,
          tier: newTier,
          expiryDate,
        });
      } catch (emitErr) {
        logger.warn(`BTCPay sub socket emit failed: ${emitErr.message}`);
      }
    }

    // F-02: Post-purchase notifications for BTCPay users (fire-and-forget)
    try {
      const userData = await dbQuery(
        'SELECT email, language, telegram FROM users WHERE id = $1',
        [order.user_id]
      );
      const u = userData.rows[0];
      if (u) {
        const planName = plan.display_name || plan.name || order.plan_id;
        const language = u.language || 'es';
        if (u.telegram) {
          try {
            const PaymentNotificationService = require('./paymentNotificationService');
            await PaymentNotificationService.sendPaymentConfirmation(order.user_id, {
              planId: order.plan_id,
              planName,
              amount: order.usd_amount || 0,
              currency: 'USD',
              provider: 'btcpay',
              language,
            });
          } catch (dmErr) {
            logger.warn('BTCPay: Telegram DM failed (non-critical)', { userId: order.user_id, error: dmErr.message });
          }
        }
        if (u.email) {
          try {
            const InvoiceService = require('./invoiceservice');
            const EmailService = require('./emailservice');
            const { buffer: invoicePdf } = await InvoiceService.generateInvoice({
              invoiceNumber: invoiceId,
              customerName: u.telegram || order.user_id,
              customerEmail: u.email,
              planName,
              amount: order.usd_amount || 0,
              currency: 'USD',
              paymentDate: new Date(),
              provider: 'Dash/BTCPay',
              language,
            });
            await EmailService.sendInvoiceEmail({
              to: u.email,
              invoicePdf,
              invoiceNumber: invoiceId,
              customerName: u.telegram || order.user_id,
              amount: order.usd_amount || 0,
              currency: 'USD',
              planName,
            });
            const { buffer: guidePdf } = await InvoiceService.generateOnboardingGuide({
              customerName: u.telegram || order.user_id,
              planName,
              language,
            });
            await EmailService.sendWelcomeEmail({
              to: u.email,
              customerName: u.telegram || order.user_id,
              planName,
              onboardingGuidePdf: guidePdf,
              language,
              userUuid: u.id,
              username: u.username,
              loginMethod: u.last_login_method,
            });
            logger.info('BTCPay: invoice + welcome emails sent', { to: u.email, planId: order.plan_id });
          } catch (emailErr) {
            logger.warn('BTCPay: email notification failed (non-critical)', { userId: order.user_id, error: emailErr.message });
          }
        }
      }
    } catch (notifErr) {
      logger.warn('BTCPay post-purchase notification block failed', { error: notifErr.message });
    }

    // Operator alerts — fire-and-forget, non-critical.
    try {
      const PaymentNotificationService = require('./paymentNotificationService');
      const BusinessNotificationService = require('./businessNotificationService');
      const botModule = require('../bot/core/bot');
      const bot = (typeof botModule.getBotInstance === 'function' ? botModule.getBotInstance() : null)
        || new (require('telegraf').Telegraf)(process.env.BOT_TOKEN);
      const planName = plan.display_name || plan.name || order.plan_id;
      await PaymentNotificationService.sendAdminPaymentNotification({
        bot,
        userId: order.user_id,
        planName,
        amount: order.usd_amount || 0,
        provider: 'btcpay',
        transactionId: invoiceId,
        customerName: order.user_id,
        customerEmail: 'N/A',
      });
      await BusinessNotificationService.notifyPayment({
        userId: order.user_id,
        planName,
        amount: order.usd_amount || 0,
        provider: 'Dash (BTCPay)',
        transactionId: invoiceId,
        customerName: order.user_id,
      });
    } catch (alertErr) {
      logger.warn('BTCPay: operator alert failed (non-critical)', { error: alertErr.message });
    }

    // Mark invoice as processed in Redis to prevent replay delivery from re-granting.
    const { markInvoiceProcessed } = require('../config/btcpay');
    await markInvoiceProcessed(invoiceId, {
      userId: order.user_id,
      planId: order.plan_id,
      source: 'subscription',
    });

    return { type: 'subscription', ok: true, planId: order.plan_id, tier: newTier, expiryDate };
  }

  /**
   * Settle a token purchase (fallback path — no dash_subscription_orders row).
   * Delegates idempotency to DashTokenService.creditTokens which uses an
   * ON CONFLICT guard internally.
   *
   * @param {string} invoiceId
   * @param {object} dashTokenSvc   - DashTokenService instance (or mock)
   * @param {Function} dbQuery
   * @param {object} [opts]
   * @param {object} [opts.socketIo]
   * @returns {Promise<object>}
   */
  static async settleTokenPurchase(invoiceId, dashTokenSvc, dbQuery, opts = {}) {
    const purchaseResult = await dbQuery(
      `SELECT user_id, tokens_credited, usd_amount FROM token_purchases
       WHERE btcpay_invoice_id = $1`,
      [invoiceId]
    );

    if (purchaseResult.rows.length === 0) {
      // Return a sentinel — caller should return 200 not 404 (Sprint 0 fix C-4)
      return { type: 'token_purchase', noLocalRecord: true };
    }

    const { user_id: userId, tokens_credited: tokens, usd_amount: usdAmount } = purchaseResult.rows[0];
    const { newBalance, alreadyProcessed } = await dashTokenSvc.creditTokens(
      userId, tokens, invoiceId, { usdAmount }
    );

    if (!alreadyProcessed) {
      logger.info('BTCPay: tokens credited', { userId, tokens, invoiceId, newBalance });

      if (opts.socketIo) {
        try {
          opts.socketIo.to(`user:${userId}`).emit('wallet:updated', { balance: newBalance, credited: tokens });
        } catch (emitErr) {
          logger.warn(`BTCPay wallet socket emit failed: ${emitErr.message}`);
        }
      }

      const { markInvoiceProcessed } = require('../config/btcpay');
      await markInvoiceProcessed(invoiceId, { userId, source: 'token_purchase' });
    }

    return { type: 'token_purchase', ok: true, userId, tokens, newBalance, alreadyProcessed };
  }
}

module.exports = PaymentSettlementService;
