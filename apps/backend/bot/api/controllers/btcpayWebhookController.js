'use strict';

/**
 * btcpayWebhookController.js
 *
 * Handles POST /api/webhooks/btcpay
 *
 * Responsibilities:
 *   - Validate HMAC-SHA256 signature
 *   - Route pull-payment / payout events
 *   - Route terminal failure events (InvoiceExpired, InvoiceInvalid)
 *   - Route chargeback events (InvoiceMarkedInvalid)
 *   - Route settlement events (InvoiceSettled, InvoicePaymentSettled)
 *     → dispatch by order.metadata.resource to PaymentSettlementService
 *
 * Settlement logic lives entirely in PaymentSettlementService (services layer).
 * This controller is a dispatcher only — no DB mutation here beyond what the
 * payout branches need (those are inlined because they are one-off and don't
 * share logic with any other code path).
 */

const logger = require('../../../utils/logger');
const {
  validateWebhookSignature,
  checkInvoiceProcessed,
  markInvoiceProcessed,
  getInvoice,
} = require('../../../config/btcpay');
const { query: dbQuery } = require('../../../config/postgres');
const { cache } = require('../../../config/redis');
const EntitlementAccessService = require('../../../services/entitlementAccessService');
const DashTokenService = require('../../../services/dashTokenService');
const PNPLiveTipsService = require('../../../services/pnpLiveTipsService');
const PaymentSettlementService = require('../../../services/paymentSettlementService');

/**
 * Parse order.metadata from whatever shape it arrived in (object or JSON string).
 * Returns null on parse error so callers can check truthiness.
 * @param {*} raw
 * @returns {object|null}
 */
function parseMetadata(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return null;
}

/**
 * Main BTCPay webhook handler.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleBtcpayWebhook(req, res) {
  const MetricsService = require('../../../services/metricsService');
  const signature = req.headers['btcpay-sig'];
  // Require rawBody captured by express.json verify callback — fallback silently breaks HMAC
  if (!req.rawBody) {
    logger.error('BTCPay webhook rejected: rawBody missing — express.json verify callback not firing', { ip: req.ip });
    MetricsService.recordWebhookFailed('btcpay', 'raw_body_missing');
    return res.status(400).json({ success: false, error: 'Raw body unavailable' });
  }
  const rawBody = req.rawBody.toString('utf8');

  if (!validateWebhookSignature(rawBody, signature)) {
    logger.warn('BTCPay webhook rejected: invalid signature', { ip: req.ip });
    MetricsService.recordWebhookFailed('btcpay', 'invalid_signature');
    return res.status(401).json({ success: false, error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    MetricsService.recordWebhookFailed('btcpay', 'invalid_json');
    return res.status(400).json({ success: false, error: 'Invalid JSON' });
  }
  MetricsService.recordWebhookReceived('btcpay', event.type);

  // ── Pull-Payment / Payout events (creator outbound payouts in Dash) ──────
  if (event.type === 'PayoutCompleted' || event.type === 'PayoutCancelled') {
    const pullPaymentId = event.pullPaymentId;
    if (!pullPaymentId) {
      logger.warn('BTCPay payout webhook missing pullPaymentId', { type: event.type, payoutId: event.payoutId });
      return res.status(400).json({ success: false, error: 'Missing pullPaymentId' });
    }
    try {
      const CreatorPayoutService = require('../../../services/creatorPayoutService');
      if (event.type === 'PayoutCompleted') {
        const result = await CreatorPayoutService.settleDashPullPayment(pullPaymentId, {
          txHash: event.proofOfPayment?.txId || event.txId || null,
          payoutId: event.payoutId || null,
        });
        return res.json({ success: true, type: 'payout_completed', ...result });
      }
      // PayoutCancelled: release the earnings back to 'available'
      const { rows } = await dbQuery(
        `UPDATE creator_payouts SET status = 'cancelled', notes = COALESCE(notes,'') || ' cancelled_via_webhook'
         WHERE btcpay_pull_payment_id = $1 AND status IN ('pending', 'claimed')
         RETURNING earning_ids, creator_id`,
        [pullPaymentId]
      );
      if (rows[0]?.earning_ids) {
        await dbQuery(
          `UPDATE creator_earnings SET status = 'available'
           WHERE id = ANY($1) AND status = 'in_payout'`,
          [rows[0].earning_ids]
        );
        logger.info('BTCPay PayoutCancelled: released earnings back to available', {
          pullPaymentId, creatorId: rows[0].creator_id, earningCount: rows[0].earning_ids.length,
        });
      }
      return res.json({ success: true, type: 'payout_cancelled' });
    } catch (payoutErr) {
      logger.error('BTCPay payout webhook handler error', {
        type: event.type, pullPaymentId, error: payoutErr.message,
      });
      return res.status(500).json({ success: false, error: 'payout_handler_error' });
    }
  }

  // Other pull-payment lifecycle events we don't act on (audit-log only).
  if (event.type && event.type.startsWith('Payout')) {
    logger.info('BTCPay payout lifecycle event (no-op)', {
      type: event.type, pullPaymentId: event.pullPaymentId, payoutId: event.payoutId,
    });
    return res.json({ success: true, ignored: true, reason: 'payout_lifecycle' });
  }

  const invoiceId = event.invoiceId;
  if (!invoiceId) return res.status(400).json({ success: false, error: 'Missing invoiceId' });

  // ── Handle terminal failure states ───────────────────────────────────────
  if (event.type === 'InvoiceExpired' || event.type === 'InvoiceInvalid') {
    const terminalStatus = event.type === 'InvoiceExpired' ? 'expired' : 'invalid';

    const [subUpd, purchUpd] = await Promise.all([
      dbQuery(
        `UPDATE dash_subscription_orders SET status = $2 WHERE btcpay_invoice_id = $1 AND status = 'pending'`,
        [invoiceId, terminalStatus]
      ),
      dbQuery(
        `UPDATE token_purchases SET status = $2 WHERE btcpay_invoice_id = $1 AND status = 'pending'`,
        [invoiceId, terminalStatus]
      ),
    ]);

    // Expire any awaiting_payment booking rows linked to this invoice
    try {
      const expiredOrders = await dbQuery(
        `SELECT metadata FROM dash_subscription_orders
         WHERE btcpay_invoice_id = $1
           AND metadata->>'resource' IN ('call_package', 'private_call_booking')`,
        [invoiceId]
      );
      for (const expiredOrder of expiredOrders.rows) {
        const meta = parseMetadata(expiredOrder.metadata);
        if (meta?.paymentId) {
          if (meta.resource === 'private_call_booking') {
            await dbQuery(
              `UPDATE booking_payments SET status = 'expired' WHERE id = $1 AND status IN ('created','pending')`,
              [meta.paymentId]
            );
            if (meta.bookingId) {
              await dbQuery(
                `UPDATE bookings SET status = 'expired', updated_at = NOW()
                 WHERE id = $1 AND status = 'awaiting_payment'`,
                [meta.bookingId]
              );
            }
          } else {
            await dbQuery(
              `UPDATE bookings SET status = 'expired', updated_at = NOW()
               WHERE payment_id = $1 AND status = 'awaiting_payment'`,
              [meta.paymentId]
            );
          }
          logger.info('BTCPay: expired call booking on invoice expiry', {
            invoiceId, paymentId: meta.paymentId, resource: meta.resource,
          });
        }
      }
    } catch (expireBookingErr) {
      logger.warn('BTCPay: failed to expire call booking on invoice expiry (non-critical)', {
        invoiceId, error: expireBookingErr.message,
      });
    }

    const affected = (subUpd.rowCount || 0) + (purchUpd.rowCount || 0);
    logger.info(`BTCPay webhook: ${event.type}`, { invoiceId, rowsUpdated: affected });
    return res.json({ success: true, type: terminalStatus, rowsUpdated: affected });
  }

  // ── Fix 1.4: InvoiceMarkedInvalid (chargeback) ───────────────────────────
  // Revoke entitlements for any completed subscription order and reverse
  // token-purchase credits. Source-scoped to THIS invoice only (Sprint 0 C-1).
  if (event.type === 'InvoiceMarkedInvalid') {
    const markedResult = await dbQuery(
      `UPDATE dash_subscription_orders SET status = 'invalid', notes = 'invoice_marked_invalid'
       WHERE btcpay_invoice_id = $1 AND status IN ('pending', 'completed')
       RETURNING id, user_id, plan_id, status AS old_status`,
      [invoiceId]
    );

    const tokenInvalidRes = await dbQuery(
      `UPDATE token_purchases SET status = 'invalid'
       WHERE btcpay_invoice_id = $1 AND status IN ('pending', 'paid')
       RETURNING user_id, tokens_credited, status AS old_status`,
      [invoiceId]
    );
    for (const row of tokenInvalidRes.rows) {
      if (row.old_status === 'paid' && row.tokens_credited > 0) {
        try {
          await dbQuery(
            `UPDATE user_token_wallets
               SET balance_tokens = GREATEST(balance_tokens - $1, 0), updated_at = NOW()
               WHERE user_id = $2`,
            [row.tokens_credited, row.user_id]
          );
          logger.info('BTCPay InvoiceMarkedInvalid: token wallet debited', {
            userId: row.user_id, tokensReversed: row.tokens_credited, invoiceId,
          });
        } catch (debitErr) {
          logger.error('BTCPay InvoiceMarkedInvalid: token wallet debit failed', {
            userId: row.user_id, error: debitErr.message,
          });
        }
      }
    }

    // Void any creator_earnings sourced from this invoice
    try {
      const voidEarn = await dbQuery(
        `UPDATE creator_earnings SET status = 'void'
         WHERE source_payment_id = $1 AND status IN ('holding', 'available')
         RETURNING id, creator_id, amount_creator`,
        [invoiceId]
      );
      if (voidEarn.rowCount > 0) {
        logger.info('BTCPay InvoiceMarkedInvalid: creator_earnings voided', {
          invoiceId, count: voidEarn.rowCount,
        });
      }
    } catch (voidErr) {
      logger.warn('BTCPay InvoiceMarkedInvalid: creator_earnings void failed (non-critical)', { error: voidErr.message });
    }

    if (markedResult.rows.length > 0) {
      const { user_id: invalidUserId, plan_id: invalidPlanId } = markedResult.rows[0];

      // Revoke ONLY the entitlements sourced from THIS specific invoice.
      // source_payment_id is populated by grantEntitlementsForPlan with the
      // BTCPay invoice id. Filtering by source_plan_id alone would also nuke
      // any valid renewal the user has on the same plan — this incident
      // scope must stay narrow.
      let revokedCount = 0;
      try {
        const revokeRes = await dbQuery(
          `DELETE FROM user_entitlements
           WHERE user_id = $1 AND source_payment_id = $2 AND is_lifetime = false`,
          [invalidUserId, invoiceId]
        );
        revokedCount = revokeRes.rowCount || 0;
        logger.info('BTCPay InvoiceMarkedInvalid: entitlements revoked', {
          userId: invalidUserId, planId: invalidPlanId, invoiceId, revokedCount,
        });
      } catch (revokeEntErr) {
        logger.error('BTCPay InvoiceMarkedInvalid: entitlement revocation failed', {
          userId: invalidUserId, planId: invalidPlanId, error: revokeEntErr.message,
        });
      }

      // Invalidate entitlement cache
      try {
        await EntitlementAccessService.invalidateCache(invalidUserId);
      } catch (cacheErr) {
        logger.warn('BTCPay InvoiceMarkedInvalid: cache invalidation failed', { error: cacheErr.message });
      }

      // Only downgrade tier if the user has NO remaining active entitlements.
      // A user with a valid renewal on the same plan must keep their tier.
      try {
        const remaining = await dbQuery(
          `SELECT 1 FROM user_entitlements
           WHERE user_id = $1
             AND add_on_id IN ('prime', 'pnp-member')
             AND (is_lifetime = true OR (expires_at IS NOT NULL AND expires_at > NOW()))
             AND is_consumed = false
           LIMIT 1`,
          [invalidUserId]
        );
        if (remaining.rowCount === 0) {
          await dbQuery(
            `UPDATE users SET tier = 'free', subscription_status = 'churned', plan_id = NULL, plan_expiry = NOW(), updated_at = NOW()
             WHERE id = $1 OR telegram = $1`,
            [invalidUserId]
          );
          logger.info('BTCPay InvoiceMarkedInvalid: user tier downgraded (no remaining entitlements)', { userId: invalidUserId });
        } else {
          logger.info('BTCPay InvoiceMarkedInvalid: user retains active entitlements — tier preserved', { userId: invalidUserId });
        }
      } catch (tierErr) {
        logger.error('BTCPay InvoiceMarkedInvalid: tier downgrade check failed', { userId: invalidUserId, error: tierErr.message });
      }
    } else if (tokenInvalidRes.rowCount === 0) {
      logger.info('BTCPay InvoiceMarkedInvalid: no order or purchase found — no action taken', { invoiceId });
    }

    return res.json({
      success: true,
      type: 'marked_invalid',
      ordersUpdated: markedResult.rowCount || 0,
      tokenPurchasesUpdated: tokenInvalidRes.rowCount || 0,
    });
  }

  // ── Settlement events ─────────────────────────────────────────────────────
  // InvoicePaymentSettled fires per crypto payment received; InvoiceSettled fires when
  // the invoice reaches the Settled state. We handle both but gate entitlement grants on
  // confirmed Settled status so partial payments cannot trigger access grants.
  const isSettledEvent = event.type === 'InvoiceSettled';
  const isPaymentSettledEvent = event.type === 'InvoicePaymentSettled';

  if (!isSettledEvent && !isPaymentSettledEvent) {
    return res.json({ success: true, ignored: true });
  }

  // For InvoicePaymentSettled: verify the invoice is fully settled via API before granting.
  if (isPaymentSettledEvent) {
    try {
      const invoiceDetails = await getInvoice(invoiceId);
      if (invoiceDetails.status !== 'Settled') {
        logger.info('BTCPay InvoicePaymentSettled: invoice not yet fully settled — skipping entitlement grant', {
          invoiceId,
          invoiceStatus: invoiceDetails.status,
          paymentMethod: event.paymentMethod,
        });
        return res.json({ success: true, ignored: true, reason: 'not_yet_settled' });
      }
      logger.info('BTCPay InvoicePaymentSettled: invoice confirmed Settled — proceeding with grant', {
        invoiceId,
        paymentMethod: event.paymentMethod,
      });
    } catch (paymentSettledCheckErr) {
      // If BTCPay API is unreachable, do not grant — wait for InvoiceSettled
      logger.warn('BTCPay InvoicePaymentSettled: could not verify invoice status — skipping (will retry on InvoiceSettled)', {
        invoiceId,
        error: paymentSettledCheckErr.message,
      });
      return res.json({ success: true, ignored: true, reason: 'api_unreachable' });
    }
  }

  // Replay protection: check if this exact invoice has already been fully processed.
  const alreadyProcessedReplay = await checkInvoiceProcessed(invoiceId);
  if (alreadyProcessedReplay) {
    logger.info('BTCPay webhook: invoice already processed (replay protection)', {
      invoiceId,
      eventType: event.type,
    });
    return res.json({ success: true, duplicate: true });
  }

  // Idempotency: acquire a Redis lock to prevent duplicate delivery race conditions.
  const settleLock = await cache.acquireLock(`btcpay:settled:${invoiceId}`, 120).catch(() => false);
  if (!settleLock) {
    logger.info('BTCPay settlement duplicate delivery blocked', { invoiceId, eventType: event.type });
    return res.json({ success: true, duplicate: true });
  }

  try {
    // Fix 1.1: Verify paid amount against invoice before granting access.
    if (isSettledEvent) {
      try {
        const invoiceDetails = await getInvoice(invoiceId);
        const actualPaid = parseFloat(invoiceDetails.paidAmount ?? invoiceDetails.amount ?? '0');
        const expectedAmount = parseFloat(invoiceDetails.amount ?? '0');
        if (actualPaid > 0 && expectedAmount > 0 && actualPaid < expectedAmount - 0.01) {
          logger.error('BTCPay InvoiceSettled: underpayment detected — aborting entitlement grant', {
            invoiceId,
            expectedAmount,
            actualPaid,
            shortfall: expectedAmount - actualPaid,
          });
          return res.status(200).json({ success: false, error: 'underpayment', invoiceId });
        }
      } catch (invoiceCheckErr) {
        // Log but do NOT block — if BTCPay API is unreachable we still trust the webhook signature
        logger.warn('BTCPay InvoiceSettled: could not fetch invoice for amount verification (proceeding)', {
          invoiceId, error: invoiceCheckErr.message,
        });
      }
    }

    // Get the socket.IO instance for real-time notifications (non-fatal if missing)
    let socketIo = null;
    try {
      const socketSingleton = require('../../../services/socketSingleton');
      socketIo = socketSingleton.get ? socketSingleton.get() : socketSingleton;
    } catch {}

    // --- 1. Check if this is a subscription order (legacy Dash flow) ---
    const subResult = await dbQuery(
      `SELECT id, user_id, plan_id, status, creator_id, metadata, usd_amount FROM dash_subscription_orders
       WHERE btcpay_invoice_id = $1`,
      [invoiceId]
    );

    if (subResult.rows.length > 0) {
      const order = subResult.rows[0];
      const orderMetadata = parseMetadata(order.metadata);

      // ── Live show ticket purchase ──────────────────────────────────────────
      if (orderMetadata?.resource === 'live_show_ticket' && orderMetadata?.slotId) {
        const result = await PaymentSettlementService.settleLiveShowTicket(order, invoiceId, orderMetadata, dbQuery);
        if (result.alreadyProcessed) return res.json({ success: true, alreadyProcessed: true });
        if (result.error) return res.status(500).json({ success: false, error: result.error, invoiceId });
        return res.json({ success: true, type: result.type, slotId: result.slotId });
      }

      // ── Private-call booking ───────────────────────────────────────────────
      if (orderMetadata?.resource === 'private_call_booking' && orderMetadata?.paymentId) {
        const result = await PaymentSettlementService.settlePrivateCallBooking(order, invoiceId, orderMetadata, dbQuery);
        if (result.alreadyProcessed) return res.json({ success: true, alreadyProcessed: true });
        if (result.error) return res.status(500).json({ success: false, error: result.error, invoiceId });
        return res.json({ success: true, type: result.type, paymentId: result.paymentId });
      }

      // ── Call package purchase ──────────────────────────────────────────────
      if (orderMetadata?.resource === 'call_package' && orderMetadata?.paymentId) {
        const result = await PaymentSettlementService.settleCallPackage(order, invoiceId, orderMetadata, dbQuery);
        if (result.alreadyProcessed) return res.json({ success: true, alreadyProcessed: true });
        if (result.error) return res.status(500).json({ success: false, error: result.error, invoiceId });
        return res.json({ success: true, type: result.type, paymentId: result.paymentId });
      }

      // ── Scoped resource purchase (hangout-access / channel-access) ─────────
      if (orderMetadata && (orderMetadata.hangoutGroupId || orderMetadata.channelId)) {
        const result = await PaymentSettlementService.settleScopedPurchase(order, invoiceId, orderMetadata, dbQuery);
        if (result.alreadyProcessed) return res.json({ success: true, alreadyProcessed: true });
        if (result.error) return res.status(500).json({ success: false, error: result.error, invoiceId });
        return res.json({ success: true, scopedPurchase: true, grantResult: result.grantResult });
      }

      // ── Creator subscription ───────────────────────────────────────────────
      if (order.plan_id === 'creator_monthly' && order.creator_id) {
        const result = await PaymentSettlementService.settleCreatorSubscription(order, invoiceId, dbQuery);
        if (result.alreadyProcessed) return res.json({ success: true, alreadyProcessed: true });
        if (result.error) return res.status(500).json({ success: false, error: result.error, invoiceId });
        return res.json({ success: true, creatorSubscription: true, creatorId: result.creatorId });
      }

      // ── Standard subscription ──────────────────────────────────────────────
      let plan;
      const PlanModel = require('../../../models/planModel');
      plan = await PlanModel.getById(order.plan_id);
      if (!plan) {
        logger.error('BTCPay: plan not found for settled invoice', { invoiceId, planId: order.plan_id });
        await dbQuery(
          `UPDATE dash_subscription_orders SET status = 'failed', notes = 'plan_not_found' WHERE id = $1`,
          [order.id]
        );
        return res.status(200).json({ success: false, error: 'plan_not_found', invoiceId });
      }

      const result = await PaymentSettlementService.settleSubscription(order, invoiceId, plan, dbQuery, {
        cache,
        socketIo,
      });
      if (result.alreadyProcessed) return res.json({ success: true, alreadyProcessed: true });
      if (result.error) return res.status(500).json({ success: false, error: result.error, invoiceId });
      return res.json({ success: true, type: result.type, planId: result.planId });
    }

    // --- 2. Metadata fallback: invoice created via createInvoice (Greenfield API) ---
    const metaUserId = event.metadata?.userId || null;
    const metaPlanId = event.metadata?.planId || null;

    if (metaUserId && metaPlanId) {
      logger.info('BTCPay settlement: processing via invoice metadata (Greenfield flow)', {
        invoiceId,
        eventType: event.type,
        userId: metaUserId,
        planId: metaPlanId,
        amount: event.amount,
        currency: event.currency,
      });

      const PlanModelGf = require('../../../models/planModel');
      const metaPlan = await PlanModelGf.getById(metaPlanId);
      if (!metaPlan) {
        logger.error('BTCPay metadata flow: plan not found — entitlements NOT granted', {
          invoiceId,
          planId: metaPlanId,
          userId: metaUserId,
        });
        return res.status(200).json({ success: false, error: 'plan_not_found', invoiceId });
      }

      const metaPlanPrice = parseFloat(metaPlan.price || metaPlan.usd_amount || '0');
      const metaPaidAmount = parseFloat(event.amount || '0');
      if (metaPlanPrice > 0 && metaPaidAmount > 0 && metaPaidAmount < metaPlanPrice - 0.01) {
        logger.error('BTCPay metadata flow: underpayment — refusing entitlement grant', {
          invoiceId,
          planId: metaPlanId,
          userId: metaUserId,
          planPrice: metaPlanPrice,
          paidAmount: metaPaidAmount,
          shortfall: metaPlanPrice - metaPaidAmount,
        });
        return res.status(200).json({ success: false, error: 'underpayment', invoiceId });
      }

      // For the Greenfield flow we don't have a DB order row — use grantEntitlementsForPlan
      // directly (idempotent via ON CONFLICT in grantEntitlementsForPlan).
      let metaGrantResult;
      try {
        const PaymentServiceGf = require('../../../services/paymentService');
        metaGrantResult = await PaymentServiceGf.grantEntitlementsForPlan(metaUserId, metaPlanId, 'btcpay', null, invoiceId);
        logger.info('BTCPay metadata flow: entitlements granted', {
          invoiceId,
          userId: metaUserId,
          planId: metaPlanId,
          granted: metaGrantResult.granted,
          errors: metaGrantResult.errors,
          amount: event.amount,
          currency: event.currency,
        });

        if (metaGrantResult.granted === 0 && metaGrantResult.warning !== 'NO_PLAN_ADDONS') {
          logger.error('BTCPay metadata flow: grantEntitlementsForPlan returned zero grants', {
            invoiceId, userId: metaUserId, planId: metaPlanId,
          });
          return res.status(500).json({ success: false, error: 'entitlement_grant_zero', invoiceId });
        }
      } catch (metaEntErr) {
        logger.error('BTCPay metadata flow: entitlement grant threw unexpectedly', {
          invoiceId,
          userId: metaUserId,
          planId: metaPlanId,
          error: metaEntErr.message,
        });
        return res.status(500).json({ success: false, error: 'entitlement_grant_failed', invoiceId });
      }

      // Sync users.tier for admin display (non-critical).
      try {
        const metaDurationDays = metaPlan.duration_days || 30;
        const metaIsLifetime = metaDurationDays >= 36500;
        const metaExpiryDate = metaIsLifetime ? null : new Date(Date.now() + metaDurationDays * 86400000);
        const metaNewTier = (metaPlan.tier === 'member' || metaPlanId.startsWith('member_')) ? 'member' : 'PRIME';
        await dbQuery(
          `UPDATE users
           SET tier = $2, subscription_status = 'active', plan_id = $3, plan_expiry = $4, updated_at = NOW()
           WHERE id = $1 OR telegram = $1`,
          [metaUserId, metaNewTier, metaPlanId, metaExpiryDate]
        );
      } catch (metaTierErr) {
        logger.warn('BTCPay metadata flow: tier sync failed (non-critical)', {
          userId: metaUserId,
          planId: metaPlanId,
          error: metaTierErr.message,
        });
      }

      // Invalidate user Redis cache (non-critical).
      cache.del(`user:${metaUserId}`).catch(() => {});

      // Socket notification (non-critical).
      if (socketIo) {
        try {
          socketIo.to(`user:${metaUserId}`).emit('subscription:activated', {
            planId: metaPlanId,
            planName: metaPlan.display_name || metaPlan.name,
            invoiceId,
          });
        } catch (metaEmitErr) {
          logger.warn(`BTCPay metadata flow socket emit failed: ${metaEmitErr.message}`);
        }
      }

      await markInvoiceProcessed(invoiceId, { userId: metaUserId, planId: metaPlanId, source: 'metadata' });
      return res.json({ success: true, type: 'metadata_subscription', planId: metaPlanId, invoiceId });
    }

    // --- 3a. Check if this is a Dash tip invoice ---
    if (event.metadata?.type === 'tip' && event.metadata?.tipId) {
      const tipId = event.metadata.tipId;
      const tipUserId = event.metadata.userId;
      const tipPerformerId = event.metadata.performerId;

      try {
        await PNPLiveTipsService.confirmTipPayment(tipId, invoiceId);
        logger.info('BTCPay: Dash tip confirmed', { tipId, invoiceId, userId: tipUserId, performerId: tipPerformerId });

        const tipInfo = await PNPLiveTipsService.getTipById(tipId);
        if (socketIo && tipInfo) {
          const tipPayload = {
            id: tipInfo.id,
            amount: parseFloat(tipInfo.amount),
            username: tipInfo.user_username || 'Anonymous',
            performerName: tipInfo.model_name || 'Performer',
            message: tipInfo.message || '',
            createdAt: tipInfo.created_at,
            paymentMethod: 'dash',
          };
          socketIo.to(`live:${tipPerformerId}`).emit('live:tip', tipPayload);
        }
      } catch (tipErr) {
        logger.error('BTCPay: Dash tip confirmation failed', { tipId, invoiceId, error: tipErr.message });
      }

      await markInvoiceProcessed(invoiceId, { tipId, userId: tipUserId, source: 'dash_tip' });
      return res.json({ success: true, type: 'dash_tip', tipId });
    }

    // --- 3. Fall through to token purchase ---
    const result = await PaymentSettlementService.settleTokenPurchase(invoiceId, DashTokenService, dbQuery, { socketIo });

    if (result.noLocalRecord) {
      // Return 200 (not 404) so BTCPay does NOT treat this as a permanent
      // failure and stop retrying. A missing local row may be a timing race
      // (token_purchases INSERT lost or still in flight) — letting BTCPay
      // redeliver gives the row time to appear, and the reconciler will pick
      // it up if not. Returning 4xx here lost real money during the Apr-2026
      // incident: paid invoices that arrived before the local INSERT landed
      // were permanently abandoned.
      logger.warn('BTCPay webhook: unknown invoice — no subscription order, no metadata planId, no token purchase (returning 200 to allow retry)', {
        invoiceId,
        eventType: event.type,
        metadataKeys: Object.keys(event.metadata || {}),
      });
      return res.json({ success: false, ignored: true, reason: 'no_local_record_yet', invoiceId });
    }

    return res.json({ success: true, alreadyProcessed: result.alreadyProcessed });

  } finally {
    await cache.releaseLock(`btcpay:settled:${invoiceId}`);
  }
}

module.exports = { handleBtcpayWebhook };
