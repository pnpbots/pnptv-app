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
const { CREATOR_REVENUE_RATE, PLATFORM_COMMISSION_RATE, EARNINGS_HOLD_HOURS } = require('../config/monetizationConfig');
// Loaded lazily to avoid circular-require on startup
function getBtcpay() {
  return require('../config/btcpay');
}
function getCallNotificationService() {
  return require('./callNotificationService');
}

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
 * @param {string} provider    - reserved, must be 'dash' (use createCallCheckoutDash)
 * @param {string} email       - member email for payment confirmation
 * @param {object|null} slotTimes - optional { startTimeUtc, endTimeUtc } for slot-locked bookings
 * @returns {{ paymentId: string, checkoutUrl: string, amount: number, currency: string, sku: string }}
 */
async function createCallCheckout(memberId, packageId, provider, email, slotTimes = null) {
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

  // Only Dash (BTCPay) and ePayco (card) are supported for call checkouts.
  if (provider !== 'dash' && provider !== 'epayco') {
    const err = new Error(`Invalid payment provider: ${provider}. Supported: epayco, dash.`);
    err.code = 'INVALID_PROVIDER';
    throw err;
  }

  // 2. Create the payment record (plan_id = null, metadata carries package info)
  //    When slotTimes are provided the same atomic slot-lock pattern used by
  //    the Dash path runs, and startTimeUtc/endTimeUtc/bookingId are baked
  //    into metadata so onCallPaymentSuccess confirms the booking and
  //    schedules reminders when the webhook fires.
  const paymentMetadata = {
    type: 'call_package',
    packageId: pkg.id,
    packageSku: pkg.sku,
    creatorId: pkg.creator_id,
    email: email || null,
  };
  if (slotTimes?.startTimeUtc && slotTimes?.endTimeUtc) {
    paymentMetadata.startTimeUtc = slotTimes.startTimeUtc;
    paymentMetadata.endTimeUtc = slotTimes.endTimeUtc;
  }

  const payment = await PaymentModel.create({
    userId: memberId,
    planId: null,
    provider,
    sku: pkg.sku,
    amount: parseFloat(pkg.price_usd),
    currency: 'USD',
    status: 'pending',
    metadata: paymentMetadata,
  });

  // 2b. If slot times are provided, lock the slot + create awaiting_payment
  //     booking row. Same pattern as createCallCheckoutDash so the two
  //     payment providers converge at onCallPaymentSuccess.
  if (slotTimes?.startTimeUtc && slotTimes?.endTimeUtc) {
    const pool = getPool();
    const slotClient = await pool.connect();
    try {
      await slotClient.query('BEGIN');
      const performerId = await _getPerformerId(slotClient, pkg.creator_id);
      if (!performerId) {
        throw Object.assign(new Error(`Creator ${pkg.creator_id} has no performer profile`), {
          code: 'PERFORMER_NOT_FOUND', status: 404,
        });
      }
      const booking = await _lockSlotAndInsertBooking(slotClient, {
        performerId,
        memberId,
        packageId: pkg.id,
        paymentId: payment.id,
        startTimeUtc: slotTimes.startTimeUtc,
        endTimeUtc: slotTimes.endTimeUtc,
        durationMinutes: pkg.duration_minutes,
        priceUsd: pkg.price_usd,
      });
      // Persist booking id into payment metadata so onCallPaymentSuccess
      // flips the right row to 'confirmed' when the webhook lands.
      await slotClient.query(
        `UPDATE payments SET metadata = metadata || $2::jsonb, updated_at = NOW() WHERE id = $1`,
        [payment.id, JSON.stringify({ bookingId: booking.id })]
      );
      await slotClient.query('COMMIT');
      paymentMetadata.bookingId = booking.id;
    } catch (lockErr) {
      await slotClient.query('ROLLBACK');
      // Mark the pending payment as failed so it doesn't orphan.
      await PaymentModel.updateStatus(payment.id, 'failed', {
        error_reason: `slot_lock_failed: ${lockErr.message || 'unknown'}`.slice(0, 500),
      }).catch(() => {});
      throw lockErr;
    } finally {
      slotClient.release();
    }
  }

  // Build the checkout URL based on provider
  let checkoutUrl;
  if (provider === 'epayco') {
    checkoutUrl = `${CHECKOUT_DOMAIN}/payment/${payment.id}`;
  }
  // Dash provider reaches here only via the legacy _createCheckout_retired path;
  // normal Dash flow uses createCallCheckoutDash() which constructs its own BTCPay URL.

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

    // Confirm the bookings row that was pre-created at checkout time (Dash flow).
    // ON CONFLICT: a booking row may not exist when times were not provided — that is OK.
    const bookingMeta = meta.startTimeUtc && meta.endTimeUtc ? meta : null;
    let confirmedBookingId = meta.bookingId || null;

    if (!confirmedBookingId) {
      // No pre-created booking row. Create one now if times are provided.
      if (bookingMeta) {
        const pkgForBooking = pkgResult.rows[0];
        const performerRes = await client.query(
          `SELECT id FROM performers WHERE user_id = $1 LIMIT 1`,
          [creator_id]
        );
        const performerId = performerRes.rows[0]?.id;
        if (performerId) {
          const priceCents = Math.round(parseFloat(pkgForBooking.price_usd) * 100);
          const newBooking = await client.query(
            `INSERT INTO bookings
               (user_id, performer_id, package_id, payment_id, credit_id,
                start_time_utc, end_time_utc, status, call_type,
                duration_minutes, price_cents, currency)
             VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,
                     'confirmed','video',$8,$9,'USD')
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [
              payment.user_id, performerId, packageId, paymentId, credit.id,
              bookingMeta.startTimeUtc, bookingMeta.endTimeUtc,
              pkgForBooking.duration_minutes, priceCents,
            ]
          );
          confirmedBookingId = newBooking.rows[0]?.id || null;
        }
      }
    } else {
      // Dash path: confirm the pre-created booking row and link the credit
      await client.query(
        `UPDATE bookings
         SET status = 'confirmed', credit_id = $2, updated_at = NOW()
         WHERE id = $1 AND payment_id = $3 AND status = 'awaiting_payment'`,
        [confirmedBookingId, credit.id, paymentId]
      );
    }

    // Record 70/30 earnings split inside the transaction so a post-COMMIT crash
    // cannot silently absorb creator earnings with no audit trail.
    try {
      const pkg = pkgResult.rows[0];
      const grossAmount = parseFloat(pkg.price_usd);
      const amountCreator = Math.round(grossAmount * CREATOR_REVENUE_RATE * 100) / 100;
      const amountPlatform = Math.round(grossAmount * PLATFORM_COMMISSION_RATE * 100) / 100;
      await client.query(
        `INSERT INTO creator_earnings (creator_id, amount_gross, amount_creator, amount_platform, status, available_at, source_payment_id, period_month)
         VALUES ($1, $2, $3, $4, 'holding', NOW() + ($5 || ' hours')::interval, $6, date_trunc('month', CURRENT_DATE))
         ON CONFLICT (source_payment_id) DO NOTHING`,
        [creator_id, grossAmount, amountCreator, amountPlatform, String(EARNINGS_HOLD_HOURS), paymentId || null]
      );
      logger.info('[callCheckoutService] creator earnings recorded (holding)', {
        creatorId: creator_id, grossAmount, amountCreator, amountPlatform,
      });
    } catch (earningsErr) {
      logger.warn('[onCallPaymentSuccess] creator_earnings insert failed (non-fatal, call credit still granted)', {
        paymentId, error: earningsErr.message,
      });
    }

    await client.query('COMMIT');

    logger.info('[callCheckoutService] call credits granted after payment', {
      paymentId,
      userId: payment.user_id,
      packageId,
      creditId: credit.id,
      bookingId: confirmedBookingId,
    });

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
        // Schedule call reminders if we have a confirmed booking with time slots
        if (confirmedBookingId && meta.startTimeUtc) {
          try {
            getCallNotificationService().scheduleCallReminders(
              confirmedBookingId,
              creator_id,
              payment.user_id,
              meta.startTimeUtc,
              null
            );
          } catch (reminderErr) {
            logger.warn('[callCheckoutService] failed to schedule call reminders (non-critical)', {
              bookingId: confirmedBookingId, error: reminderErr.message,
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

// ---------------------------------------------------------------------------
// Internal: slot-lock + atomic booking row creation
// ---------------------------------------------------------------------------

/**
 * Open a DB transaction, acquire a row-level lock on overlapping bookings for
 * the performer, then INSERT a new bookings row with status='awaiting_payment'.
 *
 * @param {object} opts
 * @param {object} client         - pg PoolClient already in a transaction
 * @param {string} performerId    - performers.id (UUID)
 * @param {string} memberId       - users.id of the buyer
 * @param {string} startTimeUtc   - ISO 8601 string
 * @param {string} endTimeUtc     - ISO 8601 string
 * @param {string} paymentId      - payments.id (UUID)
 * @param {number} packageId      - call_packages.id
 * @param {number} durationMinutes
 * @param {number} priceUsd
 * @returns {object} Inserted bookings row
 */
async function _lockSlotAndInsertBooking(client, {
  performerId,
  memberId,
  startTimeUtc,
  endTimeUtc,
  paymentId,
  packageId,
  durationMinutes,
  priceUsd,
}) {
  // Acquire row-level lock on any overlapping active bookings.
  // FOR UPDATE blocks concurrent writers from confirming the same slot.
  const overlap = await client.query(
    `SELECT id FROM bookings
     WHERE performer_id = $1
       AND status IN ('held', 'awaiting_payment', 'confirmed')
       AND (start_time_utc, end_time_utc) OVERLAPS ($2::timestamptz, $3::timestamptz)
     FOR UPDATE`,
    [performerId, startTimeUtc, endTimeUtc]
  );
  if (overlap.rows.length > 0) {
    const err = new Error('The requested time slot is no longer available');
    err.code = 'SLOT_TAKEN';
    err.status = 409;
    throw err;
  }

  const priceCents = Math.round(parseFloat(priceUsd) * 100);

  const insertResult = await client.query(
    `INSERT INTO bookings
       (user_id, performer_id, package_id, payment_id, start_time_utc, end_time_utc,
        status, call_type, duration_minutes, price_cents, currency)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz,
             'awaiting_payment', 'video', $7, $8, 'USD')
     RETURNING *`,
    [memberId, performerId, packageId, paymentId, startTimeUtc, endTimeUtc, durationMinutes, priceCents]
  );
  return insertResult.rows[0];
}

/**
 * Resolve the performers.id UUID for a creator's users.id.
 * Returns null if no performer row found.
 * @param {object} client - pg PoolClient
 * @param {string} creatorUserId - users.id
 * @returns {string|null} performers.id UUID
 */
async function _getPerformerId(client, creatorUserId) {
  const res = await client.query(
    `SELECT id FROM performers WHERE user_id = $1 LIMIT 1`,
    [creatorUserId]
  );
  return res.rows[0]?.id || null;
}

// ---------------------------------------------------------------------------
// createCallCheckoutDash — Dash/BTCPay checkout for a call package
// ---------------------------------------------------------------------------

/**
 * Create a BTCPay Dash invoice for a call package purchase.
 * Locks the slot atomically and creates an awaiting_payment booking row
 * before the invoice is issued.
 *
 * @param {object} opts
 * @param {string} opts.userId        - users.id of the buyer
 * @param {number} opts.packageId     - call_packages.id
 * @param {string} opts.startTimeUtc  - ISO 8601
 * @param {string} opts.endTimeUtc    - ISO 8601
 * @returns {{ invoiceId, checkoutUrl, paymentId, amountUsd, expiresAt, bookingId }}
 */
async function createCallCheckoutDash({ userId, packageId, startTimeUtc, endTimeUtc }) {
  // 1. Load package
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

  const amountUsd = Math.round(parseFloat(pkg.price_usd) * 0.95 * 100) / 100;

  // 2. Create a pending payment record so we have a payment UUID before the invoice
  const payment = await PaymentModel.create({
    userId,
    planId: null,
    provider: 'dash',
    sku: pkg.sku,
    amount: amountUsd,
    currency: 'USD',
    status: 'pending',
    metadata: {
      type: 'call_package',
      packageId: pkg.id,
      packageSku: pkg.sku,
      creatorId: pkg.creator_id,
      startTimeUtc,
      endTimeUtc,
      provider: 'dash',
    },
  });

  const pool = getPool();
  const client = await pool.connect();
  let booking;
  try {
    await client.query('BEGIN');

    // 3. Resolve performer row for the creator
    const performerId = await _getPerformerId(client, pkg.creator_id);
    if (!performerId) {
      throw Object.assign(new Error(`Creator ${pkg.creator_id} has no performer profile`), {
        code: 'PERFORMER_NOT_FOUND', status: 404,
      });
    }

    // 4. Slot-lock + insert booking row only when slot times are provided.
    // When null (creator is online / "NOW" flow), the booking is created later
    // in onCallPaymentSuccess after BTCPay confirms.
    if (startTimeUtc && endTimeUtc) {
      booking = await _lockSlotAndInsertBooking(client, {
        performerId,
        memberId: userId,
        startTimeUtc,
        endTimeUtc,
        paymentId: payment.id,
        packageId: pkg.id,
        durationMinutes: pkg.duration_minutes,
        priceUsd: pkg.price_usd,
      });
    }

    await client.query('COMMIT');
  } catch (txErr) {
    await client.query('ROLLBACK');
    // Clean up the pending payment record so it doesn't accumulate as orphaned debt
    await query(
      `UPDATE payments SET status = 'failed', updated_at = NOW() WHERE id = $1`,
      [payment.id]
    ).catch(() => {});
    throw txErr;
  } finally {
    client.release();
  }

  // 5. Create BTCPay invoice — outside the booking transaction so a BTCPay error
  //    doesn't leave a half-committed DB state. On failure, expire the booking.
  const { createInvoice } = getBtcpay();
  let btcpayInvoice;
  try {
    const orderId = `call-${payment.id}`;
    const redirectUrl = booking?.id
      ? `${process.env.WEBAPP_URL || 'https://pnptv.app'}/booking/${booking.id}/confirm`
      : `${process.env.WEBAPP_URL || 'https://pnptv.app'}/subscribe`;

    btcpayInvoice = await createInvoice({
      amount: amountUsd,
      currency: 'USD',
      orderId,
      userId,
      planId: 'call_package',
      metadata: {
        resource: 'call_package',
        packageId: pkg.id,
        paymentId: payment.id,
        bookingId: booking?.id ?? null,
        creatorId: pkg.creator_id,
        startTimeUtc,
        endTimeUtc,
      },
      redirectUrl,
      paymentMethods: ['DASH'],
    });
  } catch (invoiceErr) {
    // Expire the booking so the slot is freed (booking may be null on NOW flow)
    if (booking?.id) {
      await query(
        `UPDATE bookings SET status = 'expired', updated_at = NOW() WHERE id = $1`,
        [booking.id]
      ).catch(() => {});
    }
    await query(
      `UPDATE payments SET status = 'failed', updated_at = NOW() WHERE id = $1`,
      [payment.id]
    ).catch(() => {});
    logger.error('[callCheckoutService] BTCPay invoice creation failed', {
      paymentId: payment.id, bookingId: booking?.id ?? null, error: invoiceErr.message,
    });
    throw invoiceErr;
  }

  // 6. Link BTCPay invoice to the dash_subscription_orders table so the webhook can route
  await query(
    `INSERT INTO dash_subscription_orders
       (user_id, plan_id, email, usd_amount, btcpay_invoice_id, status, creator_id, metadata)
     VALUES ($1, 'call_package', NULL, $2, $3, 'pending', $4, $5::jsonb)
     ON CONFLICT (btcpay_invoice_id) DO NOTHING`,
    [
      userId,
      amountUsd,
      btcpayInvoice.invoiceId,
      pkg.creator_id,
      JSON.stringify({
        resource: 'call_package',
        packageId: pkg.id,
        paymentId: payment.id,
        bookingId: booking?.id ?? null,
        startTimeUtc,
        endTimeUtc,
      }),
    ]
  );

  // 7. Stamp the invoice ID back onto the payment record for cross-reference
  await query(
    `UPDATE payments
     SET metadata = metadata || $2::jsonb, updated_at = NOW()
     WHERE id = $1`,
    [payment.id, JSON.stringify({ btcpay_invoice_id: btcpayInvoice.invoiceId, booking_id: booking?.id ?? null })]
  );

  // BTCPay invoices expire after the store's default window (usually 15 min).
  // We don't receive this from the API, so use a 15-min heuristic.
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  logger.info('[callCheckoutService] Dash checkout created', {
    paymentId: payment.id,
    bookingId: booking?.id ?? null,
    btcpayInvoiceId: btcpayInvoice.invoiceId,
    packageId: pkg.id,
    amountUsd,
  });

  return {
    invoiceId: btcpayInvoice.invoiceId,
    checkoutUrl: btcpayInvoice.checkoutLink,
    paymentId: payment.id,
    bookingId: booking?.id ?? null,
    amountUsd,
    expiresAt,
  };
}

module.exports = {
  createCallCheckout,
  createCallCheckoutDash,
  onCallPaymentSuccess,
  _lockSlotAndInsertBooking,
  _getPerformerId,
};
