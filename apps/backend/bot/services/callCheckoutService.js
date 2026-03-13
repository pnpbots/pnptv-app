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
const { query } = require('../../config/postgres');
const PaymentModel = require('../../models/paymentModel');
const callPackageService = require('./callPackageService');
const logger = require('../../utils/logger');

const CHECKOUT_DOMAIN = process.env.CHECKOUT_DOMAIN || 'https://pnptv.app';
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://app.pnptv.app';

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
      const DaimoConfig = require('../../config/daimo');
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
           SET metadata = metadata || $2::jsonb,
               updated_at = NOW()
           WHERE id = $1`,
          [
            payment.id,
            JSON.stringify({
              payment_url: checkoutUrl,
              daimo_payment_id: daimoResult.daimoPaymentId,
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

  // Idempotency guard: check if credits were already granted for this payment
  const existingCredits = await query(
    'SELECT id FROM call_credits WHERE payment_id = $1',
    [paymentId]
  );
  if (existingCredits.rows.length > 0) {
    logger.info('[callCheckoutService] onCallPaymentSuccess: credits already granted, skipping', {
      paymentId,
      creditId: existingCredits.rows[0].id,
    });
    return;
  }

  // 3. Grant call credits
  const credit = await callPackageService.grantCallCredits(payment.user_id, packageId, paymentId);

  logger.info('[callCheckoutService] call credits granted after payment', {
    paymentId,
    userId: payment.user_id,
    packageId,
    creditId: credit.id,
  });
}

module.exports = { createCallCheckout, onCallPaymentSuccess };
