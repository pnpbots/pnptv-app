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

const { query } = require('../config/postgres');
const { cache } = require('../config/redis');
const logger = require('../utils/logger');
const NotificationEmitter = require('./notificationEmitter');
const { createWalletClient, http, parseUnits, encodeFunctionData } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { optimism, base, arbitrum, polygon, mainnet } = require('viem/chains');
const { SUPPORTED_CHAINS } = require('../config/daimo');

const MINIMUM_PAYOUT_USD = 1.00;

// Map chain IDs to viem chain objects
const VIEM_CHAINS = {
  10: optimism,
  8453: base,
  42161: arbitrum,
  137: polygon,
  1: mainnet,
};

// ERC20 transfer ABI fragment
const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
];

/**
 * Send USDC directly from treasury wallet to a creator's address via on-chain ERC20 transfer.
 * Replaces the non-existent Daimo /v1/transfer endpoint.
 * @returns {{ success: boolean, txHash?: string, error?: string }}
 */
const sendDirectUSDCTransfer = async ({ toAddress, amountUsd, creatorId, chainId = 10 }) => {
  const privateKey = process.env.TREASURY_PRIVATE_KEY;
  if (!privateKey) {
    return { success: false, error: 'TREASURY_PRIVATE_KEY not configured' };
  }

  const chainInfo = SUPPORTED_CHAINS[chainId];
  if (!chainInfo) {
    return { success: false, error: `Unsupported chain ID: ${chainId}` };
  }

  const viemChain = VIEM_CHAINS[chainId];
  if (!viemChain) {
    return { success: false, error: `No viem chain config for chain ID: ${chainId}` };
  }

  try {
    const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
    const client = createWalletClient({
      account,
      chain: viemChain,
      transport: http(),
    });

    // USDC has 6 decimals
    const amountUnits = parseUnits(parseFloat(amountUsd).toFixed(2), 6);

    const txHash = await client.writeContract({
      address: chainInfo.usdc,
      abi: ERC20_TRANSFER_ABI,
      functionName: 'transfer',
      args: [toAddress, amountUnits],
    });

    logger.info('Direct USDC transfer sent', { creatorId, toAddress, amountUsd, chainId, txHash });
    return { success: true, txHash };
  } catch (err) {
    logger.error('Direct USDC transfer failed', {
      creatorId,
      toAddress,
      chainId,
      error: err.message,
    });
    return { success: false, error: err.message };
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
          u.creator_payout_chain_id,
          u.payout_method,
          u.fiat_payout_method,
          u.fiat_payout_account,
          u.username,
          u.first_name
        FROM creator_earnings ce
        JOIN users u ON u.id = ce.creator_id
        WHERE ce.status  = 'available'
          AND ce.paid_at IS NULL
        GROUP BY ce.creator_id, u.creator_wallet_address, u.creator_payout_chain_id,
                 u.payout_method, u.fiat_payout_method, u.fiat_payout_account,
                 u.username, u.first_name
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
    const { creator_id, total_creator, earning_ids, creator_wallet_address, creator_payout_chain_id, payout_method, fiat_payout_method, fiat_payout_account, username, first_name } = creator;
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

    // Creators with no payout method configured are skipped — earnings roll over
    const hasCryptoWallet = !!creator_wallet_address;
    const hasFiatMethod = payout_method === 'fiat' && !!fiat_payout_method && !!fiat_payout_account;
    if (!hasCryptoWallet && !hasFiatMethod) {
      logger.warn('CreatorPayoutService: creator has no valid payout method, skipping', { creatorId: creator_id });

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

    // Route payout by method: crypto (direct USDC transfer) or fiat (Peer Protocol)
    let transferResult;
    const month = new Date().toISOString().slice(0, 7); // e.g. "2026-03"

    if (payout_method === 'fiat' && fiat_payout_method && fiat_payout_account) {
      // Fiat off-ramp via Peer Protocol
      try {
        const peerProtocolService = require('./peerProtocolService');
        transferResult = await peerProtocolService.sendFiatPayout({
          amount: amountUsd,
          provider: fiat_payout_method,
          recipientHandle: fiat_payout_account,
          creatorId: creator_id,
        });
      } catch (fiatErr) {
        throw new Error(`Fiat payout failed: ${fiatErr.message}`);
      }
    } else if (creator_wallet_address) {
      // Direct on-chain USDC transfer
      transferResult = await sendDirectUSDCTransfer({
        toAddress: creator_wallet_address,
        amountUsd,
        creatorId: creator_id,
        chainId: creator_payout_chain_id || 10,
      });
    } else {
      // No payout method configured — skip
      logger.warn('CreatorPayoutService: creator has no valid payout method, skipping', { creatorId: creator_id });
      return { skipped: true };
    }

    if (!transferResult.success) {
      throw new Error(`Payout transfer failed: ${transferResult.error}`);
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
      JSON.stringify({ txHash: transferResult.txHash || null, payoutMethod: payout_method || 'crypto' }),
      earning_ids,
    ]);

    if (paidRows.length === 0) {
      // All rows were already paid by a concurrent run — skip notification to avoid confusion.
      logger.warn('CreatorPayoutService: earnings already marked paid by concurrent run, skipping', {
        creatorId: creator_id,
        txHash: transferResult.txHash || null,
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
        txHash: transferResult.txHash || null,
        payoutMethod: payout_method || 'crypto',
        walletAddress: creator_wallet_address,
      },
    });

    logger.info('CreatorPayoutService: payout sent', {
      creatorId: creator_id,
      displayName,
      amountUsd,
      txHash: transferResult.txHash || null,
      payoutMethod: payout_method || 'crypto',
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
    const PaymentModel = require('../models/paymentModel');
    const { createDaimoPayment } = require('../config/daimo');

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

      const webAppUrl = process.env.WEB_APP_URL || 'https://pnptv.app';
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
