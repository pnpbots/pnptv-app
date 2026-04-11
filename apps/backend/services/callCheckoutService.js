'use strict';

/**
 * callCheckoutService.js
 * Creates payment intents for call package purchases.
 * On success, grants call credits via callPackageService.grantCallCredits().
 *
 * NOTE: Call packages are NOT plan rows, so we bypass PaymentService.createPayment()
 * (which requires a planId) and insert directly via PaymentModel.create() with
 * plan_id = null and the package SKU stored in metadata.
 */

const { v4: uuidv4 } = require('uuid');
const { query, getPool } = require('../config/postgres');
const PaymentModel = require('../models/paymentModel');
const callPackageService = require('./callPackageService');
const { sendNotificationViaTelegram } = require('./notificationBotDelivery');
const emailService = require('./emailservice');
const logger = require('../utils/logger');

const CHECKOUT_DOMAIN = process.env.CHECKOUT_DOMAIN || 'https://pnptv.app';
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://pnptv.app';

/**
 * Escape user-supplied values before interpolation into HTML templates.
 * Prevents HTML/script injection in email bodies and Telegram HTML messages.
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return String(str);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Create a checkout for a call package.
 *
 * @param {string} memberId    - users.id of the purchasing member
 * @param {number} packageId   - call_packages.id
 * @param {string} provider    - 'epayco' | 'daimo'
 * @param {string} email       - member email for payment confirmation
 * @returns {{ paymentId: string, checkoutUrl: string, amount: number, currency: string, sku: string }}
 */
async function createCallCheckout(memberId, packageId, provider, email) {
  // 1. Load and validate the package
  const pkgResult = await query(
    'SELECT * FROM call_packages WHERE id = $1 AND is_active = true',
    [packageId]
  );
  const pkg = pkgResult.rows[0];
  if (!pkg) {
    const err = new Error(`Call package ${packageId} not found or inactive`);
    err.code = 'PACKAGE_NOT_FOUND';
    throw err;
  }

  if (!['epayco', 'daimo'].includes(provider)) {
    const err = new Error(`Invalid payment provider: ${provider}`);
    err.code = 'INVALID_PROVIDER';
    throw err;
  }

  // 2. Create the payment record (plan_id = null, metadata carries package info)
  const payment = await PaymentModel.create({
    userId: memberId,
    planId: null,
    provider,
    sku: pkg.sku,
    amount: parseFloat(pkg.price_usd),
    currency: 'USD',
    status: 'pending',
    metadata: {
      type: 'call_package',
      packageId: pkg.id,
      packageSku: pkg.sku,
      creatorId: pkg.creator_id,
      email: email || null,
    },
  });

  // 3. Persist metadata and build checkout URL
  let checkoutUrl;
  if (provider === 'epayco') {
    // ePayco tokenized checkout page — same pattern as subscription payments
    checkoutUrl = `${CHECKOUT_DOMAIN}/payment/${payment.id}`;

    const usdToCopRate = parseFloat(process.env.EPAYCO_USD_TO_COP || '4000');
    const expectedCOP = String(Math.round(parseFloat(pkg.price_usd) * usdToCopRate));

    await query(
      `UPDATE payments
       SET metadata = metadata || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [
        payment.id,
        JSON.stringify({
          payment_url: checkoutUrl,
          expected_epayco_amount: expectedCOP,
          expected_epayco_currency: 'COP',
        }),
      ]
    );
  } else if (provider === 'daimo') {
    // Daimo: direct to React checkout page with Daimo SDK modal
    checkoutUrl = `${WEB_APP_URL}/checkout/${payment.id}`;

    try {
      const DaimoConfig = require('../config/daimo');
      const daimoResult = await DaimoConfig.createDaimoPayment({
        amount: parseFloat(pkg.price_usd),
        userId: memberId,
        planId: pkg.sku,
        paymentId: payment.id,
        description: `${pkg.title || 'Call Package'} — PNPtv`,
      });

      if (daimoResult.success && daimoResult.daimoPaymentId) {
        await query(
          `UPDATE payments
           SET daimo_payment_id = $2,
               metadata = metadata || $3::jsonb,
               updated_at = NOW()
           WHERE id = $1`,
          [
            payment.id,
            daimoResult.daimoPaymentId,
            JSON.stringify({
              payment_url: checkoutUrl,
              daimo_payment_id: daimoResult.daimoPaymentId,
              daimoSessionId: daimoResult.daimoPaymentId,
              daimoClientSecret: daimoResult.clientSecret || null,
              daimo_client_secret: daimoResult.clientSecret || null,
            }),
          ]
        );
      } else {
        logger.warn('[callCheckoutService] Daimo payment creation returned unsuccessful', {
          paymentId: payment.id,
          error: daimoResult.error,
        });
        // Don't fail the checkout — the checkout page will handle missing Daimo id
      }
    } catch (daimoErr) {
      // Non-fatal: log and continue — the checkout page retries or shows an error
      logger.error('[callCheckoutService] Daimo API error', {
        paymentId: payment.id,
        error: daimoErr.message,
      });
    }
  }

  logger.info('[callCheckoutService] checkout created', {
    paymentId: payment.id,
    packageId: pkg.id,
    sku: pkg.sku,
    provider,
    amount: pkg.price_usd,
  });

  return {
    paymentId: payment.id,
    checkoutUrl,
    amount: parseFloat(pkg.price_usd),
    currency: 'USD',
    sku: pkg.sku,
  };
}

/**
 * Called by the payment webhook after a successful payment for a call package.
 * Grants call_credits to the member.
 *
 * @param {string} paymentId - UUID of the payments row
 */
async function onCallPaymentSuccess(paymentId) {
  // 1. Load payment record
  const payResult = await query(
    `SELECT id, user_id, metadata, status FROM payments WHERE id = $1`,
    [paymentId]
  );
  const payment = payResult.rows[0];
  if (!payment) {
    logger.warn('[callCheckoutService] onCallPaymentSuccess: payment not found', { paymentId });
    return;
  }

  // 2. Ensure this is a call package payment and hasn't already been granted
  const meta = payment.metadata || {};
  if (meta.type !== 'call_package') {
    logger.warn('[callCheckoutService] onCallPaymentSuccess: payment is not a call_package', { paymentId, type: meta.type });
    return;
  }

  const packageId = meta.packageId;
  if (!packageId) {
    logger.error('[callCheckoutService] onCallPaymentSuccess: missing packageId in payment metadata', { paymentId });
    return;
  }

  // HIGH-05: Grant call credits + update payment status in single transaction.
  // Idempotency is enforced via ON CONFLICT (payment_id) DO NOTHING inside the
  // transaction so there is no SELECT-then-INSERT race window.
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Grant call credits within transaction — ON CONFLICT handles duplicate webhooks atomically
    const pkgResult = await client.query('SELECT * FROM call_packages WHERE id = $1', [packageId]);
    if (!pkgResult.rows[0]) throw new Error(`Package ${packageId} not found`);
    const { creator_id, quantity } = pkgResult.rows[0];

    const creditResult = await client.query(
      `INSERT INTO call_credits
         (member_id, creator_id, package_id, quantity_total, payment_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (payment_id) DO NOTHING
       RETURNING *`,
      [payment.user_id, creator_id, packageId, quantity, paymentId]
    );

    if (creditResult.rows.length === 0) {
      // Duplicate webhook — credits already granted; commit nothing and return success
      await client.query('ROLLBACK');
      logger.info('[callCheckoutService] onCallPaymentSuccess: duplicate webhook — credits already granted, skipping', { paymentId });
      return;
    }

    const credit = creditResult.rows[0];

    // Update payment status to completed
    await client.query(
      `UPDATE payments SET status = 'completed', updated_at = NOW() WHERE id = $1 AND status = 'pending'`,
      [paymentId]
    );

    await client.query('COMMIT');

    logger.info('[callCheckoutService] call credits granted after payment', {
      paymentId,
      userId: payment.user_id,
      packageId,
      creditId: credit.id,
    });

    // Record 70/30 earnings split for the creator
    try {
      const pkg = pkgResult.rows[0];
      const grossAmount = parseFloat(pkg.price_usd);
      const amountCreator = Math.round(grossAmount * 0.70 * 100) / 100;
      const amountPlatform = Math.round(grossAmount * 0.30 * 100) / 100;
      await query(
        `INSERT INTO creator_earnings (creator_id, amount_gross, amount_creator, amount_platform, status, period_month)
         VALUES ($1, $2, $3, $4, 'available', date_trunc('month', CURRENT_DATE))`,
        [creator_id, grossAmount, amountCreator, amountPlatform]
      );
      logger.info('[callCheckoutService] creator earnings recorded', {
        creatorId: creator_id, grossAmount, amountCreator, amountPlatform,
      });
    } catch (earningsErr) {
      logger.warn('[callCheckoutService] failed to record creator earnings (non-critical)', { error: earningsErr.message });
    }

    // ── Post-payment notifications (fire-and-forget) ─────────────────────
    // Notify buyer + creator that credits have been granted.
    (async () => {
      try {
        const pkg = pkgResult.rows[0];
        const buyerEmail = meta.email;

        // Fetch creator info for notification context
        const creatorResult = await query(
          'SELECT username, display_name FROM users WHERE id = $1',
          [creator_id]
        );
        const creator = creatorResult.rows[0] || {};
        const creatorName = creator.display_name || creator.username || 'a creator';
        const safeCreatorName = escapeHtml(creatorName);

        // Telegram notification to buyer
        const buyerMsg = `Payment confirmed! You now have <b>${quantity}</b> × ${pkg.duration_minutes}-min call credit(s) with <b>${safeCreatorName}</b>.\n\nGo to their profile to book your call.`;
        await sendNotificationViaTelegram(payment.user_id, {
          type: 'payment',
          message: buyerMsg,
          entityType: 'call_credit',
          entityId: credit.id,
        }).catch(() => {});

        // Telegram notification to creator
        const creatorMsg = `Someone just purchased <b>${quantity}</b> × ${pkg.duration_minutes}-min call package! Check your dashboard for upcoming bookings.`;
        await sendNotificationViaTelegram(creator_id, {
          type: 'payment',
          message: creatorMsg,
          entityType: 'call_credit',
          entityId: credit.id,
        }).catch(() => {});

        // Email receipt to buyer
        if (buyerEmail) {
          const transporter = emailService.transporters.pnptv || emailService.transporters.easybots;
          if (transporter) {
            await transporter.sendMail({
              from: '"PNPtv" <noreply@pnptv.app>',
              to: buyerEmail,
              subject: 'Payment Confirmed — Call Credits Ready! — PNPtv',
              html: `
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background: #f4f4f4; margin: 0; padding: 0; }
  .container { max-width: 600px; margin: 20px auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
  .header { text-align: center; padding-bottom: 20px; border-bottom: 3px solid #667eea; }
  .header h1 { color: #667eea; margin: 0; font-size: 28px; }
  .badge { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 16px 20px; border-radius: 8px; text-align: center; margin: 20px 0; }
  .badge h2 { margin: 0; font-size: 20px; }
  .details { background: #f8f9fa; padding: 16px 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #667eea; }
  .details p { margin: 8px 0; }
  .btn { display: inline-block; padding: 12px 28px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 6px; font-weight: bold; }
  .footer { text-align: center; padding-top: 20px; border-top: 1px solid #ddd; color: #999; font-size: 12px; }
</style></head><body>
<div class="container">
  <div class="header"><h1>PNPtv!</h1><p>Payment Receipt</p></div>
  <div class="badge"><h2>Payment Confirmed</h2></div>
  <p>Hi there,</p>
  <p>Your payment has been processed successfully. Your call credits are ready to use!</p>
  <div class="details">
    <p><strong>Creator:</strong> ${safeCreatorName}</p>
    <p><strong>Package:</strong> ${escapeHtml(String(pkg.duration_minutes))} min × ${escapeHtml(String(quantity))} call(s)</p>
    <p><strong>Amount:</strong> $${escapeHtml(parseFloat(pkg.price_usd).toFixed(2))} USD</p>
    <p><strong>SKU:</strong> ${escapeHtml(pkg.sku || '')}</p>
  </div>
  <p>Visit the creator's profile and click <strong>Book a Call</strong> to schedule your session.</p>
  <div style="text-align:center;margin:20px 0;"><a href="${process.env.APP_PUBLIC_URL || 'https://pnptv.app'}" class="btn">Open PNPtv</a></div>
  <div class="footer"><p>PNPtv | noreply@pnptv.app</p><p>This is an automated message. Please do not reply.</p></div>
</div></body></html>`.trim(),
            }).catch((emailErr) => {
              logger.warn('[callCheckoutService] payment receipt email failed', { to: buyerEmail, error: emailErr.message });
            });
          }
        }
      } catch (notifErr) {
        logger.warn('[callCheckoutService] post-payment notification error (non-fatal)', {
          paymentId, error: notifErr.message,
        });
      }
    })();
  } catch (txErr) {
    await client.query('ROLLBACK');
    logger.error('[callCheckoutService] onCallPaymentSuccess transaction failed', {
      paymentId,
      error: txErr.message,
    });
    throw txErr;
  } finally {
    client.release();
  }
}

module.exports = { createCallCheckout, onCallPaymentSuccess };
