'use strict';

/**
 * CreatorPayoutService
 *
 * Two responsibilities:
 *  1. runMonthlyPayouts()    — called by cron on 1st of month (00:00 UTC)
 *     Groups all `available` creator_earnings by creator, sends one consolidated
 *     Daimo USDC payout per creator to their creator_wallet_address, then marks
 *     the earnings rows as paid_out.
 *
 *  2. runSubscriptionRenewals() — called by cron daily at 09:00 UTC
 *     Finds active creator_subscriptions expiring within 3 days that have
 *     auto_renew=true, creates a new Daimo payment session for the subscriber,
 *     and on success extends expires_at by 30 days + records new earnings.
 *     On failure the subscription is cancelled and the subscriber is notified.
 *
 * NOTE on Daimo outbound transfers:
 *   The existing createDaimoPayment() in config/daimo.js creates *inbound* sessions
 *   (someone pays the treasury). For payouts the treasury sends USDC to a wallet.
 *   Daimo's transfer endpoint is POST /v1/transfer — adjust DAIMO_TRANSFER_ENDPOINT
 *   env var if their API path differs.
 *   Required env var: DAIMO_API_KEY (same key used for inbound sessions).
 */

const { query } = require('../../config/postgres');
const { cache } = require('../../config/redis');
const logger = require('../../utils/logger');
const NotificationEmitter = require('./notificationEmitter');
const fetch = require('node-fetch');

const DAIMO_API_BASE = 'https://api.daimo.com';
const FETCH_TIMEOUT_MS = 30_000;
const MINIMUM_PAYOUT_USD = 1.00;

// ── Helpers ───────────────────────────────────────────────────────────────────

const fetchWithTimeout = (url, options = {}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timeoutId));
};

/**
 * Send USDC from the treasury to a creator's wallet via Daimo transfer API.
 * Returns { success, transferId, error }.
 *
 * The endpoint used is POST /v1/transfer. Override via DAIMO_TRANSFER_ENDPOINT
 * env var (e.g. "/v1/payouts") if Daimo changes their API path.
 */
const sendDaimoTransfer = async ({ toAddress, amountUsd, creatorId, note }) => {
  const apiKey = process.env.DAIMO_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'DAIMO_API_KEY not configured' };
  }

  const transferPath = process.env.DAIMO_TRANSFER_ENDPOINT || '/v1/transfer';
  // amountUnits is a human-readable decimal string (e.g. "14.00")
  const amountUnits = parseFloat(amountUsd).toFixed(2);

  const body = {
    toAddress,
    // USDC on Optimism
    tokenAddress: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    chainId: 10,
    amountUnits,
    note: note || 'PNPtv creator payout',
    metadata: {
      creatorId: String(creatorId),
      source: 'pnptv-creator-payout',
    },
  };

  try {
    const response = await fetchWithTimeout(`${DAIMO_API_BASE}${transferPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Daimo transfer API error', { status: response.status, error: errorText, creatorId });
      return { success: false, error: `Daimo transfer API ${response.status}: ${errorText}` };
    }

    const data = await response.json();
    const transfer = data.transfer || data;
    const transferId = transfer.transferId || transfer.id || null;

    logger.info('Daimo transfer initiated', { creatorId, toAddress, amountUnits, transferId });
    return { success: true, transferId };
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    logger.error(isTimeout ? 'Daimo transfer request timed out' : 'Daimo transfer request failed', {
      creatorId,
      error: err.message,
    });
    return { success: false, error: isTimeout ? 'Daimo transfer request timed out' : err.message };
  }
};

// ── CreatorPayoutService ──────────────────────────────────────────────────────

class CreatorPayoutService {
  /**
   * Run monthly payouts for all creators with available earnings >= $1.00.
   * Called by cron on the 1st of every month at 00:00 UTC.
   *
   * Idempotent: `status = 'available' AND paid_at IS NULL` ensures rows that
   * were already paid in a previous run are never double-paid.
   */
  static async runMonthlyPayouts() {
    logger.info('CreatorPayoutService: starting monthly payout run');

    // Aggregate available earnings by creator; only those meeting the minimum threshold
    let rows;
    try {
      const result = await query(`
        SELECT
          ce.creator_id,
          COALESCE(SUM(ce.amount_creator), 0)::numeric  AS total_creator,
          ARRAY_AGG(ce.id)                               AS earning_ids,
          u.creator_wallet_address,
          u.username,
          u.first_name
        FROM creator_earnings ce
        JOIN users u ON u.id = ce.creator_id
        WHERE ce.status  = 'available'
          AND ce.paid_at IS NULL
        GROUP BY ce.creator_id, u.creator_wallet_address, u.username, u.first_name
        HAVING COALESCE(SUM(ce.amount_creator), 0) >= $1
      `, [MINIMUM_PAYOUT_USD]);
      rows = result.rows;
    } catch (err) {
      logger.error('CreatorPayoutService: failed to fetch payout batch', { error: err.message });
      return { success: false, error: err.message };
    }

    if (rows.length === 0) {
      logger.info('CreatorPayoutService: no creators with payable earnings this month');
      return { success: true, processed: 0, paid: 0, skipped: 0, failed: 0 };
    }

    logger.info(`CreatorPayoutService: ${rows.length} creator(s) eligible for payout`);

    let paid = 0;
    let skipped = 0;
    let failed = 0;

    for (const creator of rows) {
      try {
        const result = await this._processCreatorPayout(creator);
        if (result.skipped) {
          skipped++;
        } else {
          paid++;
        }
      } catch (err) {
        // Error isolation — one failure must not abort the batch
        failed++;
        logger.error('CreatorPayoutService: payout failed for creator', {
          creatorId: creator.creator_id,
          error: err.message,
        });
      }
    }

    logger.info('CreatorPayoutService: monthly payout run complete', {
      eligible: rows.length,
      paid,
      skipped,
      failed,
    });

    return { success: true, processed: rows.length, paid, skipped, failed };
  }

  /**
   * Process a single creator's payout.
   * @param {Object} creator - Row from the aggregate query in runMonthlyPayouts
   * @returns {{ skipped: boolean }}
   */
  static async _processCreatorPayout(creator) {
    const { creator_id, total_creator, earning_ids, creator_wallet_address, username, first_name } = creator;
    const displayName = username || first_name || String(creator_id);
    const amountUsd = parseFloat(total_creator);

    // Acquire a per-creator Redis lock to prevent concurrent payout runs (e.g. two overlapping
    // cron triggers or an admin-triggered run racing with the scheduled run) from double-paying.
    const payoutLockKey = `payout_lock:${creator_id}`;
    const lockAcquired = await cache.acquireLock(payoutLockKey, 120).catch(() => false);
    if (!lockAcquired) {
      logger.warn('CreatorPayoutService: payout skipped — lock already held for creator', { creatorId: creator_id });
      return { skipped: true };
    }

    // Creators without a wallet address are skipped — earnings roll over
    if (!creator_wallet_address) {
      logger.warn('CreatorPayoutService: creator has no wallet address, skipping', { creatorId: creator_id });

      await NotificationEmitter.emit({
        type: 'system',
        category: 'commerce',
        priority: 'high',
        actorId: null,
        targetUserId: creator_id,
        entityType: 'creator',
        entityId: String(creator_id),
        message: `Your payout of $${amountUsd.toFixed(2)} USDC is ready! Add your wallet address in Creator Settings to receive it.`,
        metadata: { pendingAmountUsd: amountUsd, earningIds: earning_ids },
      });

      return { skipped: true };
    }

    // Send Daimo outbound transfer
    const month = new Date().toISOString().slice(0, 7); // e.g. "2026-03"
    const note = `PNPtv payout ${month} — $${amountUsd.toFixed(2)} USDC`;

    const transferResult = await sendDaimoTransfer({
      toAddress: creator_wallet_address,
      amountUsd,
      creatorId: creator_id,
      note,
    });

    if (!transferResult.success) {
      throw new Error(`Daimo transfer failed: ${transferResult.error}`);
    }

    // Mark earnings as paid_out with an atomic UPDATE...RETURNING.
    // The WHERE guard (status='available' AND paid_at IS NULL) acts as a second fence against
    // double-payment: if a concurrent run already paid these rows the UPDATE matches 0 rows
    // and we treat it as a skipped (no-op) condition to avoid double-crediting.
    const { rows: paidRows } = await query(`
      UPDATE creator_earnings
      SET
        status   = 'paid_out',
        paid_at  = NOW(),
        metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
      WHERE id = ANY($2)
        AND status  = 'available'
        AND paid_at IS NULL
      RETURNING amount_creator
    `, [
      JSON.stringify({ daimo_transfer_id: transferResult.transferId }),
      earning_ids,
    ]);

    if (paidRows.length === 0) {
      // All rows were already paid by a concurrent run — skip notification to avoid confusion.
      logger.warn('CreatorPayoutService: earnings already marked paid by concurrent run, skipping', {
        creatorId: creator_id,
        transferId: transferResult.transferId,
      });
      return { skipped: true };
    }

    // Notify creator
    await NotificationEmitter.emit({
      type: 'payment',
      category: 'commerce',
      priority: 'high',
      actorId: null,
      targetUserId: creator_id,
      entityType: 'creator',
      entityId: String(creator_id),
      message: `Your payout of $${amountUsd.toFixed(2)} USDC has been sent to your wallet!`,
      metadata: {
        amountUsd,
        daimo_transfer_id: transferResult.transferId,
        walletAddress: creator_wallet_address,
      },
    });

    logger.info('CreatorPayoutService: payout sent', {
      creatorId: creator_id,
      displayName,
      amountUsd,
      transferId: transferResult.transferId,
      earningsCount: earning_ids.length,
    });

    return { skipped: false };
  }

  // ── Subscription Renewals ──────────────────────────────────────────────────

  /**
   * Run daily subscription renewal for creator subscriptions expiring within 3 days.
   * Called by cron daily at 09:00 UTC. Only processes subscriptions with auto_renew = true.
   *
   * Strategy: always attempt Daimo (creates a checkout link). ePayco cards cannot be
   * auto-charged without a stored vault token, so Daimo is the universal renewal path.
   * The subscription's expires_at is extended optimistically at session creation time;
   * the actual payment confirmation arrives via the existing Daimo webhook handler
   * which calls CreatorService.subscribeToCreator() to record earnings again if needed.
   * Duplicate earnings are avoided by the per-(creator_id, subscription_id, period_month)
   * natural key pattern already in use.
   */
  static async runSubscriptionRenewals() {
    logger.info('CreatorPayoutService: starting subscription renewal run');

    let subs;
    try {
      const result = await query(`
        SELECT
          cs.id              AS subscription_id,
          cs.creator_id,
          cs.subscriber_id,
          cs.price_usd,
          cs.expires_at,
          cs.payment_id      AS original_payment_id,
          sub.username       AS subscriber_username,
          sub.first_name     AS subscriber_first_name,
          cr.username        AS creator_username,
          cr.first_name      AS creator_first_name
        FROM creator_subscriptions cs
        JOIN users sub ON sub.id = cs.subscriber_id
        JOIN users cr  ON cr.id  = cs.creator_id
        WHERE cs.status     = 'active'
          AND cs.auto_renew = true
          AND cs.expires_at <= NOW() + INTERVAL '3 days'
          AND cs.expires_at >  NOW()
        ORDER BY cs.expires_at ASC
      `);
      subs = result.rows;
    } catch (err) {
      logger.error('CreatorPayoutService: failed to fetch renewal batch', { error: err.message });
      return { success: false, error: err.message };
    }

    if (subs.length === 0) {
      logger.info('CreatorPayoutService: no subscriptions due for renewal');
      return { success: true, processed: 0, renewed: 0, cancelled: 0, failed: 0 };
    }

    logger.info(`CreatorPayoutService: ${subs.length} subscription(s) due for renewal`);

    let renewed = 0;
    let cancelled = 0;
    let failed = 0;

    for (const sub of subs) {
      try {
        const result = await this._processRenewal(sub);
        if (result.renewed) {
          renewed++;
        } else {
          cancelled++;
        }
      } catch (err) {
        failed++;
        logger.error('CreatorPayoutService: unhandled error during renewal', {
          subscriptionId: sub.subscription_id,
          error: err.message,
        });
      }
    }

    logger.info('CreatorPayoutService: renewal run complete', {
      processed: subs.length,
      renewed,
      cancelled,
      failed,
    });

    return { success: true, processed: subs.length, renewed, cancelled, failed };
  }

  /**
   * Process renewal for a single creator subscription.
   * @param {Object} sub - Row from the renewal query in runSubscriptionRenewals
   * @returns {{ renewed: boolean }}
   */
  static async _processRenewal(sub) {
    const {
      subscription_id,
      creator_id,
      subscriber_id,
      price_usd,
      original_payment_id,
      creator_username,
      creator_first_name,
    } = sub;

    const creatorName = creator_username || creator_first_name || String(creator_id);
    const priceUsd = parseFloat(price_usd);

    // Lazy-require to avoid circular dependency issues at module load time
    const PaymentModel = require('../../models/paymentModel');
    const { createDaimoPayment } = require('../../config/daimo');

    let newPaymentId;
    let checkoutUrl;

    try {
      // Insert a new payment record for this renewal
      const newPayment = await PaymentModel.create({
        userId: String(subscriber_id),
        planId: 'creator_monthly',
        provider: 'daimo',
        amount: priceUsd,
        currency: 'USD',
        status: 'pending',
        metadata: {
          creatorId: String(creator_id),
          originalSubscriptionId: String(subscription_id),
          originalPaymentId: original_payment_id || null,
          renewalFor: sub.expires_at,
          source: 'auto_renewal',
        },
      });

      newPaymentId = newPayment.id;

      // Create Daimo inbound session (subscriber pays treasury)
      const daimoResult = await createDaimoPayment({
        amount: priceUsd,
        userId: subscriber_id,
        planId: 'creator_monthly',
        chatId: null,
        paymentId: newPaymentId,
        description: `${creatorName} Creator Subscription Renewal`,
      });

      if (!daimoResult.success) {
        throw new Error(daimoResult.error || 'Daimo session creation failed');
      }

      const webAppUrl = process.env.WEB_APP_URL || 'https://app.pnptv.app';
      checkoutUrl = `${webAppUrl}/checkout/${newPaymentId}`;

      await PaymentModel.updateStatus(newPaymentId, 'pending', {
        paymentUrl: checkoutUrl,
        provider: 'daimo',
        daimo_payment_id: daimoResult.daimoPaymentId,
        daimoSessionId: daimoResult.daimoPaymentId,
        daimoClientSecret: daimoResult.clientSecret || null,
        daimo_client_secret: daimoResult.clientSecret,
      });
    } catch (err) {
      // Payment creation failed — cancel subscription and notify subscriber
      logger.error('CreatorPayoutService: renewal payment creation failed, cancelling subscription', {
        subscriptionId: subscription_id,
        subscriberId: subscriber_id,
        creatorId: creator_id,
        error: err.message,
      });

      await this._cancelAndNotify({
        subscription_id,
        subscriber_id,
        creator_id,
        creatorName,
        reason: err.message,
      });

      return { renewed: false };
    }

    // NOTE: Do NOT extend expires_at here. The subscription is extended only after
    // the Daimo webhook confirms the payment (via processDaimoWebhook → creator_monthly
    // branch). Extending before payment would give free access if user never pays.
    // Store the renewal payment ID so the webhook handler can find the subscription.
    await query(`
      UPDATE creator_subscriptions
      SET
        renewal_payment_id = $1
      WHERE id    = $2
        AND status = 'active'
    `, [newPaymentId, subscription_id]);

    // Notify subscriber with the checkout link so they complete the Daimo payment
    await NotificationEmitter.emit({
      type: 'payment',
      category: 'commerce',
      priority: 'high',
      actorId: null,
      targetUserId: subscriber_id,
      entityType: 'creator_subscription',
      entityId: String(subscription_id),
      message: `Your subscription to ${creatorName} renews soon. Complete payment to keep access.`,
      metadata: {
        creatorId: String(creator_id),
        creatorName,
        priceUsd,
        checkoutUrl,
        paymentId: newPaymentId,
      },
    });

    logger.info('CreatorPayoutService: renewal payment created', {
      subscriptionId: subscription_id,
      subscriberId: subscriber_id,
      creatorId: creator_id,
      newPaymentId,
      checkoutUrl,
    });

    return { renewed: true };
  }

  /**
   * Cancel a subscription and emit a cancellation notification to the subscriber.
   * Non-fatal: errors are logged but not re-thrown.
   */
  static async _cancelAndNotify({ subscription_id, subscriber_id, creator_id, creatorName, reason }) {
    try {
      await query(`
        UPDATE creator_subscriptions
        SET
          status       = 'cancelled',
          cancelled_at = NOW(),
          auto_renew   = false
        WHERE id     = $1
          AND status = 'active'
      `, [subscription_id]);

      // Decrement subscriber count on creator
      await query(`
        UPDATE users
        SET creator_subscriber_count = GREATEST(0, creator_subscriber_count - 1)
        WHERE id = $1
      `, [creator_id]);

      await NotificationEmitter.emit({
        type: 'system',
        category: 'commerce',
        priority: 'high',
        actorId: null,
        targetUserId: subscriber_id,
        entityType: 'creator_subscription',
        entityId: String(subscription_id),
        message: `Your subscription to ${creatorName} could not be renewed and has been cancelled.`,
        metadata: {
          creatorId: String(creator_id),
          creatorName,
          reason,
        },
      });

      logger.info('CreatorPayoutService: subscription cancelled due to renewal failure', {
        subscriptionId: subscription_id,
        subscriberId: subscriber_id,
        creatorId: creator_id,
        reason,
      });
    } catch (err) {
      logger.error('CreatorPayoutService: failed to cancel subscription', {
        subscriptionId: subscription_id,
        error: err.message,
      });
    }
  }
}

module.exports = CreatorPayoutService;
