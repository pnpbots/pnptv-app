'use strict';

/**
 * CreatorPayoutService
 *
 * Two responsibilities:
 *  1. runMonthlyPayouts()    — called by cron on 1st of month (00:00 UTC)
 *     Groups all `available` creator_earnings by creator and creates ONE BTCPay
 *     Pull Payment per creator (denominated in USD, claimed in DASH). The
 *     creator gets a viewUrl they open to enter their Dash address and pull the
 *     funds. Earnings rows move to status='in_payout' until the BTCPay webhook
 *     confirms claim completion, at which point they are stamped 'paid_out'.
 *
 *  2. runSubscriptionRenewals() — called by cron daily at 09:00 UTC
 *     Finds active creator_subscriptions expiring within 3 days that have
 *     auto_renew=true, creates a new payment for the subscriber, and on
 *     success extends expires_at by 30 days + records new earnings.
 *     On failure the subscription is cancelled and the subscriber is notified.
 *
 * History note:
 *   Pre-cutover, payouts were direct on-chain USDC transfers from a treasury
 *   private key (`sendDirectUSDCTransfer`). That route was removed when all
 *   creators moved to Dash. Creators who still have a legacy 0x EVM address on
 *   file get notified each cycle to enter a Dash address — earnings roll over
 *   in the meantime. The legacy creator_wallet_address column was dropped in migration 123.
 */

const { query } = require('../config/postgres');
const { cache } = require('../config/redis');
const logger = require('../utils/logger');
const NotificationEmitter = require('./notificationEmitter');

const MINIMUM_PAYOUT_USD = 1.00;

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
      // GROUP BY creator_id only — aggregate user fields with MAX so the same
      // creator never splits into multiple aggregate rows when their profile
      // (dash address, email, etc.) changed mid-month. LEFT JOIN so a creator
      // whose users row was removed (e.g. UUID rename via account dedup) still
      // surfaces in the result with NULL contact fields, surfacing as a SKIP
      // rather than silently dropping their earnings.
      const result = await query(`
        SELECT
          ce.creator_id,
          COALESCE(SUM(ce.amount_creator), 0)::numeric  AS total_creator,
          ARRAY_AGG(ce.id)                               AS earning_ids,
          MAX(u.creator_dash_address)                    AS creator_dash_address,
          MAX(u.payout_method)                           AS payout_method,
          MAX(u.fiat_payout_method)                      AS fiat_payout_method,
          MAX(u.fiat_payout_account)                     AS fiat_payout_account,
          MAX(u.email)                                   AS email,
          MAX(u.username)                                AS username,
          MAX(u.first_name)                              AS first_name,
          MAX(u.language)                                AS language
        FROM creator_earnings ce
        LEFT JOIN users u ON u.id = ce.creator_id
        WHERE ce.status  = 'available'
          AND ce.paid_at IS NULL
        GROUP BY ce.creator_id
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
   *
   * Routing order (first match wins):
   *   1. payout_method === 'fiat'  → Peer Protocol fiat off-ramp.
   *   2. creator_dash_address set  → BTCPay Pull Payment in Dash (default crypto path).
   *   3. nothing configured        → skip + notify creator to set Dash address.
   *
   * Migration 123 dropped the legacy creator_wallet_address column entirely —
   * any historical USDC-only creators now fall through to the "skip + notify"
   * branch the same as a brand-new creator who hasn't set up payouts yet.
   *
   * @param {Object} creator - Row from the aggregate query in runMonthlyPayouts
   * @returns {{ skipped: boolean }}
   */
  static async _processCreatorPayout(creator) {
    const {
      creator_id, total_creator, earning_ids,
      creator_dash_address,
      payout_method, fiat_payout_method, fiat_payout_account,
      email, username, first_name,
    } = creator;
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

    const hasFiatMethod = payout_method === 'fiat' && !!fiat_payout_method && !!fiat_payout_account;
    const hasDashAddress = !!creator_dash_address;

    if (!hasFiatMethod && !hasDashAddress) {
      const nudge = `Your payout of $${amountUsd.toFixed(2)} is ready! Add your Dash wallet address in Creator Settings to receive it.`;
      logger.warn('CreatorPayoutService: creator has no valid payout method, skipping', {
        creatorId: creator_id,
      });
      await NotificationEmitter.emit({
        type: 'system',
        category: 'commerce',
        priority: 'high',
        actorId: null,
        targetUserId: creator_id,
        entityType: 'creator',
        entityId: String(creator_id),
        message: nudge,
        metadata: { pendingAmountUsd: amountUsd, earningIds: earning_ids },
      });
      return { skipped: true };
    }

    // ── Route 1: Fiat off-ramp (unchanged) ────────────────────────────────────
    if (hasFiatMethod) {
      let transferResult;
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
      if (!transferResult.success) {
        throw new Error(`Fiat payout transfer failed: ${transferResult.error}`);
      }
      await this._markEarningsPaid(earning_ids, creator_id, {
        method: 'fiat',
        txRef: transferResult.txHash || transferResult.reference || null,
      });
      await NotificationEmitter.emit({
        type: 'payment', category: 'commerce', priority: 'high', actorId: null,
        targetUserId: creator_id, entityType: 'creator', entityId: String(creator_id),
        message: `Your fiat payout of $${amountUsd.toFixed(2)} has been sent to your account.`,
        metadata: { amountUsd, payoutMethod: 'fiat' },
      });
      logger.info('CreatorPayoutService: fiat payout sent', { creatorId: creator_id, amountUsd });
      return { skipped: false };
    }

    // ── Route 2: Dash via BTCPay Pull Payment (default) ──────────────────────
    if (hasDashAddress) {
      const { createPullPayment } = require('../config/btcpay');
      let pullPayment;
      try {
        pullPayment = await createPullPayment({
          amountUsd,
          creatorId: String(creator_id),
          description: `PNPtv payout for ${displayName} — ${new Date().toISOString().slice(0, 7)}`,
          autoApprove: true,
        });
      } catch (btcErr) {
        throw new Error(`BTCPay pull payment creation failed: ${btcErr.message}`);
      }

      // Reserve the earnings: move 'available' → 'in_payout' atomically. A second
      // concurrent cron tick that aggregated the same rows will find them gone
      // and naturally drop them from its batch.
      const { rows: reservedRows } = await query(`
        UPDATE creator_earnings
        SET status = 'in_payout',
            metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
        WHERE id = ANY($2)
          AND status  = 'available'
          AND paid_at IS NULL
        RETURNING id
      `, [
        JSON.stringify({ pullPaymentId: pullPayment.pullPaymentId }),
        earning_ids,
      ]);

      if (reservedRows.length === 0) {
        // Concurrent run reserved them first — release the BTCPay pull payment.
        logger.warn('CreatorPayoutService: earnings already reserved by concurrent run, archiving pull payment', {
          creatorId: creator_id, pullPaymentId: pullPayment.pullPaymentId,
        });
        try { await require('../config/btcpay').archivePullPayment(pullPayment.pullPaymentId); }
        catch (_) { /* best-effort */ }
        return { skipped: true };
      }

      const reservedIds = reservedRows.map((r) => r.id);
      const { rows: payoutRows } = await query(`
        INSERT INTO creator_payouts (creator_id, amount_usd, method, btcpay_pull_payment_id, view_url, status, earning_ids)
        VALUES ($1, $2, 'dash_btcpay', $3, $4, 'pending', $5)
        RETURNING id
      `, [creator_id, amountUsd, pullPayment.pullPaymentId, pullPayment.viewUrl, reservedIds]);
      const payoutId = payoutRows[0].id;

      // Email the creator the claim link (best-effort — the in-app notification
      // below is the authoritative channel).
      if (email) {
        try {
          const emailService = require('./emailservice');
          if (emailService.isEmailSafe && emailService.isEmailSafe(email)) {
            const html = `
              <h2>Your PNPtv payout is ready to claim</h2>
              <p>Hi ${displayName}, your payout of <strong>$${amountUsd.toFixed(2)} USD</strong> in Dash is ready.</p>
              <p><a href="${pullPayment.viewUrl}" style="display:inline-block;background:#008DE4;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Claim your Dash payout</a></p>
              <p style="font-size:12px;color:#666">Open the link, paste your Dash wallet address, and the funds will be sent on-chain. The amount in Dash is calculated at claim time using the live USD/DASH rate.</p>
            `;
            emailService.send({
              to: email,
              subject: `[PNPtv] Your payout of $${amountUsd.toFixed(2)} is ready to claim`,
              html,
            }).catch((mailErr) => logger.warn('Payout claim email failed (non-fatal)', { creatorId: creator_id, error: mailErr.message }));
          }
        } catch (mailRequireErr) {
          logger.warn('Could not load emailService for payout email', { error: mailRequireErr.message });
        }
      }

      await NotificationEmitter.emit({
        type: 'payment', category: 'commerce', priority: 'high', actorId: null,
        targetUserId: creator_id, entityType: 'creator', entityId: String(creator_id),
        message: `Your payout of $${amountUsd.toFixed(2)} (Dash) is ready to claim. Open the link in your email or your creator dashboard.`,
        metadata: { amountUsd, payoutId, payoutMethod: 'dash_btcpay', viewUrl: pullPayment.viewUrl },
      });

      logger.info('CreatorPayoutService: Dash pull payment created', {
        creatorId: creator_id, displayName, amountUsd,
        pullPaymentId: pullPayment.pullPaymentId,
        earningsCount: reservedIds.length,
      });
      return { skipped: false };
    }

    // Unreachable — the early guard above returns when neither fiat nor Dash is set.
    // Kept as a defensive throw so a future routing change can't silently no-op.
    throw new Error('CreatorPayoutService: no payout route matched (this should be unreachable)');
  }

  /**
   * Atomic payout-stamp helper used by the immediately-settled paths (fiat,
   * legacy USDC sweep). Returns the rows actually flipped so the caller can
   * detect a no-op caused by a concurrent run.
   *
   * @param {string[]} earningIds
   * @param {string} creatorId
   * @param {{method:string, txRef:string|null, payoutId?:string}} extra
   */
  static async _markEarningsPaid(earningIds, creatorId, extra) {
    const { rows } = await query(`
      UPDATE creator_earnings
      SET status = 'paid_out',
          paid_at = NOW(),
          metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
      WHERE id = ANY($2)
        AND status IN ('available', 'in_payout')
        AND paid_at IS NULL
      RETURNING amount_creator
    `, [
      JSON.stringify({
        txHash: extra.txRef || null,
        payoutMethod: extra.method,
        payoutId: extra.payoutId || null,
      }),
      earningIds,
    ]);

    if (rows.length === 0) {
      logger.warn('CreatorPayoutService: earnings already settled by concurrent run', {
        creatorId, txRef: extra.txRef,
      });
    }
    return rows;
  }

  /**
   * Settle a Dash pull payment when BTCPay reports the claim is complete.
   * Called by the BTCPay webhook handler.
   *
   * @param {string} pullPaymentId
   * @param {object} [meta] - optional payment metadata for audit
   */
  static async settleDashPullPayment(pullPaymentId, meta = {}) {
    const { rows } = await query(
      `SELECT id, creator_id, amount_usd, earning_ids, status FROM creator_payouts WHERE btcpay_pull_payment_id = $1`,
      [pullPaymentId]
    );
    if (rows.length === 0) {
      logger.warn('settleDashPullPayment: no creator_payouts row for pullPaymentId', { pullPaymentId });
      return { settled: false, reason: 'not_found' };
    }
    const payout = rows[0];

    if (payout.status === 'completed') {
      logger.info('settleDashPullPayment: payout already completed (idempotent)', { pullPaymentId });
      return { settled: false, reason: 'already_settled' };
    }

    // Atomic flip — only one webhook delivery wins.
    const { rowCount } = await query(
      `UPDATE creator_payouts
       SET status = 'completed', completed_at = NOW(), notes = COALESCE(notes, '') || $2
       WHERE id = $1 AND status IN ('pending', 'claimed')`,
      [payout.id, meta?.txHash ? ` tx:${meta.txHash}` : '']
    );
    if (rowCount === 0) {
      logger.info('settleDashPullPayment: lost the race, another delivery completed it first', { pullPaymentId });
      return { settled: false, reason: 'race_lost' };
    }

    await this._markEarningsPaid(payout.earning_ids, payout.creator_id, {
      method: 'dash_btcpay',
      txRef: meta?.txHash || null,
      payoutId: payout.id,
    });

    await NotificationEmitter.emit({
      type: 'payment', category: 'commerce', priority: 'high', actorId: null,
      targetUserId: payout.creator_id, entityType: 'creator', entityId: String(payout.creator_id),
      message: `Your Dash payout of $${parseFloat(payout.amount_usd).toFixed(2)} has been confirmed on-chain.`,
      metadata: { amountUsd: parseFloat(payout.amount_usd), payoutId: payout.id, payoutMethod: 'dash_btcpay' },
    });

    logger.info('settleDashPullPayment: completed', {
      pullPaymentId, creatorId: payout.creator_id, amountUsd: payout.amount_usd,
    });
    return { settled: true };
  }

  // ── Subscription Renewals ──────────────────────────────────────────────────

  /**
   * Run daily subscription renewal for creator subscriptions expiring within 3 days.
   * Called by cron daily at 09:00 UTC. Only processes subscriptions with auto_renew = true.
   *
   * Strategy: create a Dash invoice via BTCPay for each renewal. ePayco cards cannot
   * be auto-charged without a stored vault token, and Daimo is retired, so Dash is
   * now the universal renewal path. The subscription's expires_at is NOT extended
   * optimistically — extension happens only when the BTCPay webhook fires
   * `InvoiceSettled` for a `dash_subscription_orders` row whose plan_id is
   * `creator_monthly`, at which point CreatorService.subscribeToCreator() runs.
   * Duplicate earnings are avoided by the per-(creator_id, subscription_id, period_month)
   * natural key pattern already in use.
   */
  static async runSubscriptionRenewals() {
    logger.info('CreatorPayoutService: starting subscription renewal run');

    let subs;
    try {
      const result = await query(`
        SELECT
          cs.id                 AS subscription_id,
          cs.creator_id,
          cs.subscriber_id,
          cs.price_usd,
          cs.expires_at,
          cs.payment_id         AS original_payment_id,
          cs.renewal_payment_id,
          sub.username          AS subscriber_username,
          sub.first_name        AS subscriber_first_name,
          cr.username           AS creator_username,
          cr.first_name         AS creator_first_name
        FROM creator_subscriptions cs
        JOIN users sub ON sub.id = cs.subscriber_id
        JOIN users cr  ON cr.id  = cs.creator_id
        -- Skip if a pending renewal invoice is already in-flight for this subscription.
        -- Checked via LEFT JOIN so subscriptions without a renewal_payment_id still pass.
        LEFT JOIN payments rp ON rp.id = cs.renewal_payment_id
        WHERE cs.status     = 'active'
          AND cs.auto_renew = true
          AND cs.expires_at <= NOW() + INTERVAL '3 days'
          AND cs.expires_at >  NOW()
          AND (cs.renewal_payment_id IS NULL OR rp.status NOT IN ('pending'))
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
    let priceUsd = parseFloat(price_usd);

    // Lazy-require to avoid circular dependency issues at module load time
    const PaymentModel = require('../models/paymentModel');
    const { createDashInvoice } = require('../config/btcpay');
    const { query: dbQuery } = require('../config/postgres');

    // price_usd can be NULL when the subscription was originally created without
    // recording the price (legacy path). Fall back to the creator's current price.
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
      logger.warn('CreatorPayoutService: price_usd missing on subscription, falling back to creator_price_usd', {
        subscriptionId: subscription_id, price_usd,
      });
      const fallback = await dbQuery(
        'SELECT creator_price_usd FROM users WHERE id = $1',
        [String(creator_id)]
      );
      priceUsd = parseFloat(fallback.rows[0]?.creator_price_usd);
      if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
        logger.error('CreatorPayoutService: cannot determine renewal price, skipping', { subscriptionId: subscription_id });
        NotificationEmitter.emit({
          type: 'subscription_renewal_failed',
          category: 'commerce',
          priority: 'high',
          targetUserId: String(subscriber_id),
          message: `Your subscription to ${creatorName} could not be renewed because the price could not be determined. Please contact support.`,
        }).catch(() => {});
        return { renewed: false };
      }
    }

    let newPaymentId;
    let checkoutUrl;

    try {
      // Insert a new payment record for this renewal
      const newPayment = await PaymentModel.create({
        userId: String(subscriber_id),
        planId: 'creator_monthly',
        provider: 'dash',
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

      // Create a Dash invoice (BTCPay hosted checkout) for the subscriber to settle.
      // The webhook handler at /api/webhooks/btcpay routes this through
      // CreatorService.subscribeToCreator() once paid (recognised by the
      // creator_monthly + creator_id metadata thread).
      const webAppUrl = process.env.WEB_APP_URL || 'https://pnptv.app';
      const orderId = `renewal-${newPaymentId}`;
      const invoice = await createDashInvoice({
        usdAmount: priceUsd,
        userId: String(subscriber_id),
        orderId,
        description: `${creatorName} — Creator Subscription Renewal`,
        redirectUrl: `${webAppUrl}/profile/${creator_id}`,
      });

      if (!invoice.success) {
        throw new Error(invoice.error || 'Dash invoice creation failed');
      }

      // Persist the dash_subscription_orders row so the BTCPay webhook can
      // settle the renewal exactly the same way it settles a fresh creator sub.
      await dbQuery(
        `INSERT INTO dash_subscription_orders (user_id, plan_id, email, usd_amount, btcpay_invoice_id, status, creator_id)
         VALUES ($1, 'creator_monthly', NULL, $2, $3, 'pending', $4)
         ON CONFLICT (btcpay_invoice_id) DO NOTHING`,
        [String(subscriber_id), priceUsd, invoice.invoiceId, String(creator_id)]
      );

      checkoutUrl = invoice.checkoutUrl;

      await PaymentModel.updateStatus(newPaymentId, 'pending', {
        paymentUrl: checkoutUrl,
        provider: 'dash',
        btcpayInvoiceId: invoice.invoiceId,
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
    // the BTCPay webhook confirms the Dash invoice settles (via the InvoiceSettled
    // → creator_monthly branch in routes.js, which calls CreatorService.subscribeToCreator).
    // Extending before payment would give free access if user never pays.
    // Store the renewal payment ID so the webhook handler can find the subscription.
    await query(`
      UPDATE creator_subscriptions
      SET
        renewal_payment_id = $1
      WHERE id    = $2
        AND status = 'active'
    `, [newPaymentId, subscription_id]);

    // Notify subscriber with the BTCPay/Dash checkout link so they complete the renewal
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

    // Email fallback for subscribers who have no Telegram connection
    try {
      const { query: dbQuery } = require('../config/postgres');
      const emailService = require('./emailservice');
      const subRow = await dbQuery(`SELECT email FROM users WHERE id = $1`, [String(subscriber_id)]);
      const subscriberEmail = subRow.rows[0]?.email;
      if (subscriberEmail && emailService.transporters?.pnptv) {
        await emailService.transporters.pnptv.sendMail({
          from: '"PNPtv" <support@pnptv.app>',
          to: subscriberEmail,
          subject: `Renueva tu suscripción a ${creatorName} en PNPtv`,
          html: `<p>Tu suscripción a <strong>${creatorName}</strong> vence pronto.</p>
                 <p><a href="${checkoutUrl}" style="color:#D4007A;font-weight:bold;">Haz clic aquí para renovar</a></p>
                 <p style="color:#888;font-size:12px;">Si ya renovaste, ignora este mensaje.</p>`,
        });
      }
    } catch (emailErr) {
      logger.warn('CreatorPayoutService: renewal email failed (non-fatal)', {
        subscriberId: subscriber_id, error: emailErr.message,
      });
    }

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

  // ── Scoped Subscription Renewals (paid channels & paid hangouts) ─────────────

  /**
   * Run daily renewal reminders for paid channel-access and hangout-access
   * entitlements expiring within the next 3 days. Sends multi-channel reminders
   * (in-app notification + push + Telegram bot DM via NotificationEmitter, plus
   * email via EmailService) — does NOT create any invoice. The user follows the
   * reminder link back to the channel/hangout and re-purchases through the
   * existing /api/webapp/{channels,hangouts}/:id/purchase flow when they're ready.
   *
   * Triggered by CHANNEL_HANGOUT_RENEWAL_CRON (default: '15 9 * * *').
   */
  static async runScopedSubscriptionRenewals() {
    logger.info('CreatorPayoutService: starting scoped (channel/hangout) renewal reminders');

    let entitlements;
    try {
      const result = await query(`
        SELECT
          ue.id            AS entitlement_id,
          ue.user_id,
          ue.add_on_id,
          ue.creator_id    AS scope_id,
          ue.expires_at,
          u.email          AS user_email,
          u.language       AS user_language,
          u.first_name     AS subscriber_first_name,
          u.username       AS subscriber_username
        FROM user_entitlements ue
        JOIN users u ON u.id = ue.user_id
        WHERE ue.add_on_id IN ('channel-access', 'hangout-access')
          AND ue.is_consumed = false
          AND ue.is_lifetime = false
          AND ue.auto_renew  = true
          AND ue.expires_at IS NOT NULL
          AND ue.expires_at <= NOW() + INTERVAL '3 days'
          AND ue.expires_at >  NOW()
        ORDER BY ue.expires_at ASC
      `);
      entitlements = result.rows;
    } catch (err) {
      logger.error('CreatorPayoutService: failed to fetch scoped renewal batch', { error: err.message });
      return { success: false, error: err.message };
    }

    if (entitlements.length === 0) {
      logger.info('CreatorPayoutService: no scoped subscriptions due for renewal reminder');
      return { success: true, processed: 0, reminded: 0, failed: 0 };
    }

    logger.info(`CreatorPayoutService: sending renewal reminders for ${entitlements.length} scoped subscription(s)`);

    let reminded = 0;
    let failed = 0;

    for (const ent of entitlements) {
      try {
        const result = await this._sendScopedRenewalReminder(ent);
        if (result.reminded) reminded++;
        else failed++;
      } catch (err) {
        failed++;
        logger.error('CreatorPayoutService: unhandled error during scoped renewal reminder', {
          entitlementId: ent.entitlement_id,
          error: err.message,
        });
      }
    }

    logger.info('CreatorPayoutService: scoped renewal reminders complete', {
      processed: entitlements.length, reminded, failed,
    });
    return { success: true, processed: entitlements.length, reminded, failed };
  }

  /**
   * Send a renewal reminder for a single channel-access or hangout-access
   * entitlement. Multi-channel: in-app + push + Telegram bot DM (via
   * NotificationEmitter, which respects the user's notification preferences)
   * plus email (if the user has one). No payment record is created — the user
   * re-purchases through the existing flow when they choose to.
   */
  static async _sendScopedRenewalReminder(ent) {
    const { entitlement_id, user_id, add_on_id, scope_id, expires_at, user_email, user_language } = ent;
    const webAppUrl = process.env.WEB_APP_URL || 'https://pnptv.app';

    // Look up the resource so we know it's still active + for the deep link / current price
    let priceUsd, resourceName, scopeMetadata, deepLink, kindLabel;
    try {
      if (add_on_id === 'channel-access') {
        const { rows } = await query(
          `SELECT id, name, price_usd, hangout_group_id, access_type
             FROM creator_channels WHERE id = $1 AND is_active = true LIMIT 1`,
          [scope_id]
        );
        if (!rows.length || rows[0].access_type !== 'paid' || Number(rows[0].price_usd) <= 0) {
          logger.warn('Scoped renewal reminder skipped — channel no longer paid/active', {
            entitlementId: entitlement_id, channelId: scope_id,
          });
          // Auto-disable renewal so we stop reminding
          await query(`UPDATE user_entitlements SET auto_renew = false WHERE id = $1`, [entitlement_id]);
          return { reminded: false };
        }
        const ch = rows[0];
        priceUsd = Number(ch.price_usd);
        resourceName = ch.name;
        scopeMetadata = { channelId: ch.id, hangoutGroupId: ch.hangout_group_id, channelName: ch.name };
        deepLink = `${webAppUrl}/channels/${ch.id}`;
        kindLabel = 'channel';
      } else {
        const { rows } = await query(
          `SELECT id, name, price_usd, is_paid
             FROM hangout_groups WHERE id = $1 LIMIT 1`,
          [scope_id]
        );
        if (!rows.length || !rows[0].is_paid || Number(rows[0].price_usd) <= 0) {
          logger.warn('Scoped renewal reminder skipped — hangout no longer paid/active', {
            entitlementId: entitlement_id, hangoutId: scope_id,
          });
          await query(`UPDATE user_entitlements SET auto_renew = false WHERE id = $1`, [entitlement_id]);
          return { reminded: false };
        }
        const hg = rows[0];
        priceUsd = Number(hg.price_usd);
        resourceName = hg.name;
        scopeMetadata = { hangoutGroupId: hg.id, hangoutName: hg.name };
        deepLink = `${webAppUrl}/chat/${hg.id}`;
        kindLabel = 'hangout';
      }
    } catch (lookupErr) {
      logger.error('Scoped renewal reminder: resource lookup failed', {
        entitlementId: entitlement_id, error: lookupErr.message,
      });
      return { reminded: false };
    }

    const daysLeft = Math.max(0, Math.ceil((new Date(expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    const lang = (user_language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
    const expiresLabel = new Date(expires_at).toUTCString();

    // 1. In-app + push + Telegram bot — handled by NotificationEmitter respecting per-channel prefs
    try {
      const messageEn = `Your ${kindLabel} subscription to "${resourceName}" expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Tap to renew for $${priceUsd.toFixed(2)}.`;
      const messageEs = `Tu suscripción al ${kindLabel === 'channel' ? 'canal' : 'hangout'} "${resourceName}" vence en ${daysLeft} día${daysLeft === 1 ? '' : 's'}. Toca para renovar por $${priceUsd.toFixed(2)}.`;
      await NotificationEmitter.emit({
        type: 'payment',
        category: 'commerce',
        priority: 'high',
        actorId: null,
        targetUserId: user_id,
        entityType: kindLabel,
        entityId: String(scope_id),
        message: lang === 'es' ? messageEs : messageEn,
        metadata: { ...scopeMetadata, priceUsd, daysLeft, deepLink, expiresAt: expires_at },
      });
    } catch (notifyErr) {
      logger.warn('Scoped renewal reminder: in-app/push/bot notify failed (non-fatal)', {
        entitlementId: entitlement_id, error: notifyErr.message,
      });
    }

    // 2. Email — if the user has one
    if (user_email) {
      try {
        const EmailService = require('./emailService');
        const subject = lang === 'es'
          ? `Tu suscripción a "${resourceName}" vence en ${daysLeft} día${daysLeft === 1 ? '' : 's'}`
          : `Your "${resourceName}" subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
        const html = lang === 'es'
          ? `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px">
              <h2 style="color:#D4007A">Renueva tu suscripción</h2>
              <p>Tu suscripción al ${kindLabel === 'channel' ? 'canal' : 'hangout'} <strong>${resourceName}</strong> vence el ${expiresLabel} (en ${daysLeft} día${daysLeft === 1 ? '' : 's'}).</p>
              <p>Renueva ahora por <strong>$${priceUsd.toFixed(2)}</strong> para mantener tu acceso.</p>
              <p style="margin:24px 0"><a href="${deepLink}" style="background:#D4007A;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Renovar acceso</a></p>
              <p style="color:#888;font-size:12px">Puedes cancelar la renovación automática en cualquier momento desde tu cuenta.</p>
            </div>`
          : `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px">
              <h2 style="color:#D4007A">Renew your subscription</h2>
              <p>Your ${kindLabel} subscription to <strong>${resourceName}</strong> expires on ${expiresLabel} (in ${daysLeft} day${daysLeft === 1 ? '' : 's'}).</p>
              <p>Renew now for <strong>$${priceUsd.toFixed(2)}</strong> to keep your access.</p>
              <p style="margin:24px 0"><a href="${deepLink}" style="background:#D4007A;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Renew access</a></p>
              <p style="color:#888;font-size:12px">You can cancel auto-renewal anytime from your account.</p>
            </div>`;
        await EmailService.send({ to: user_email, subject, html });
      } catch (emailErr) {
        logger.warn('Scoped renewal reminder: email failed (non-fatal)', {
          entitlementId: entitlement_id, error: emailErr.message,
        });
      }
    }

    logger.info('CreatorPayoutService: scoped renewal reminder sent', {
      entitlementId: entitlement_id, userId: user_id, addOnId: add_on_id, scopeId: scope_id,
      daysLeft, hasEmail: !!user_email,
    });
    return { reminded: true };
  }
}

module.exports = CreatorPayoutService;
