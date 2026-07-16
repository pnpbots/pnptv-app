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
const { CREATOR_REVENUE_RATE, PLATFORM_COMMISSION_RATE, EARNINGS_HOLD_HOURS, EARNINGS_HOLD_HOURS_EFIPAY } = require('../config/monetizationConfig');
const PaymentSecurityService = require('./paymentSecurityService');
function getCallNotificationService() {
  return require('./callNotificationService');
}

const CHECKOUT_DOMAIN = process.env.CHECKOUT_DOMAIN || 'https://pnptv.app';
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://pnptv.app';
const NOWPAYMENTS_URL = process.env.NOWPAYMENTS_ENVIRONMENT === 'sandbox'
  ? 'https://api-sandbox.nowpayments.io/v1'
  : 'https://api.nowpayments.io/v1';

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
async function createCallCheckout(memberId, packageId, provider, email, slotTimes = null, clientNotes = null) {
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

  // Only nowpayments (crypto) is supported for call checkouts.
  if (provider !== 'nowpayments') {
    const err = new Error(`Invalid payment provider: ${provider}. Supported: nowpayments.`);
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

  // Set payment timeout (1-hour window to complete), same as subscription checkout.
  // Without this, the tokenized-charge endpoint returns 400 "expired" immediately.
  PaymentSecurityService.setPaymentTimeout(payment.id, 3600).catch(() => {});

  // 2c. If slot times are provided, lock the slot + create awaiting_payment
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
        clientNotes,
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

  // NowPayments checkout URL is returned by the invoice API; set a placeholder here.
  // The calling route handler replaces this with the actual invoice_url from NowPayments.
  let checkoutUrl = null;

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
      // Credits already granted by an earlier delivery. Re-check the booking in case
      // the first delivery committed credits but crashed before confirming the booking.
      const existingCredit = await client.query(
        `SELECT id FROM call_credits WHERE payment_id = $1 LIMIT 1`,
        [paymentId]
      );
      const existingCreditId = existingCredit.rows[0]?.id;
      const existingBookingId = meta.bookingId || null;
      if (existingBookingId && existingCreditId) {
        await client.query(
          `UPDATE bookings SET status = 'confirmed', credit_id = $2, updated_at = NOW()
           WHERE id = $1 AND payment_id = $3 AND status = 'awaiting_payment'`,
          [existingBookingId, existingCreditId, paymentId]
        );
      }
      await client.query('COMMIT');
      logger.info('[callCheckoutService] onCallPaymentSuccess: duplicate webhook — credits already granted, booking re-confirmed', { paymentId, existingBookingId });
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
    // FIX HIGH-05/HIGH-06: read both camelCase and snake_case keys for resilience.
    let confirmedBookingId = meta.bookingId ?? meta.booking_id ?? null;

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
                duration_minutes, price_cents, currency, client_notes)
             VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,
                     'confirmed','video',$8,$9,'USD',$10::text)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [
              payment.user_id, performerId, packageId, paymentId, credit.id,
              bookingMeta.startTimeUtc, bookingMeta.endTimeUtc,
              pkgForBooking.duration_minutes, priceCents,
              meta.clientNotes ? String(meta.clientNotes).slice(0, 1000) : null,
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

    // Record 70/30 earnings split inside the transaction — failure rolls back the
    // entire payment so creator earnings are never silently lost.
    const pkg = pkgResult.rows[0];
    const grossAmount = parseFloat(pkg.price_usd);
    const amountCreator = Math.round(grossAmount * CREATOR_REVENUE_RATE * 100) / 100;
    const amountPlatform = Math.round(grossAmount * PLATFORM_COMMISSION_RATE * 100) / 100;
    const holdHours = meta.source === 'efipay_easybots' ? EARNINGS_HOLD_HOURS_EFIPAY : EARNINGS_HOLD_HOURS;
    await client.query(
      `INSERT INTO creator_earnings (creator_id, amount_gross, amount_creator, amount_platform, status, available_at, source_payment_id, period_month)
       VALUES ($1, $2, $3, $4, 'holding', NOW() + ($5 || ' hours')::interval, $6, date_trunc('month', CURRENT_DATE))
       ON CONFLICT (source_payment_id) DO NOTHING`,
      [creator_id, grossAmount, amountCreator, amountPlatform, String(holdHours), paymentId || null]
    );
    logger.info('[callCheckoutService] creator earnings recorded (holding)', {
      creatorId: creator_id, grossAmount, amountCreator, amountPlatform,
    });

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
              from: '"PNPtv" <hello@pnptv.app>',
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
  <div class="footer"><p>PNPtv! &middot; <a href="mailto:support@pnptv.app" style="color:inherit;">support@pnptv.app</a></p><p>For help, contact <a href="mailto:support@pnptv.app">support@pnptv.app</a>.</p></div>
</div></body></html>`.trim(),
            }).catch((emailErr) => {
              logger.warn('[callCheckoutService] payment receipt email failed', { to: buyerEmail, error: emailErr.message });
            });
          }
        }
        // Booking-specific notifications + lifecycle setup when a scheduled slot exists
        // Direct call room URL (/call/:creditId) works for both scheduled and NOW flows.
        const callJoinUrl = `${WEB_APP_URL}/call/${encodeURIComponent(String(credit.id))}`;
        // Send booking confirmation emails + Telegram to both parties (always, scheduled or NOW)
        const notifSvc = getCallNotificationService();

        // H-01: fetch client_notes from confirmed booking row for notification context
        let bookingClientNotes = null;
        if (confirmedBookingId) {
          const bookingRow = await query(
            'SELECT client_notes FROM bookings WHERE id = $1 LIMIT 1',
            [confirmedBookingId]
          );
          bookingClientNotes = bookingRow.rows[0]?.client_notes || null;
        }

        const bookingSummary = {
          creator_name: creatorName,
          start_at: meta.startTimeUtc || null,
          duration_minutes: pkg.duration_minutes,
          client_notes: bookingClientNotes,
        };

        // H-03: fetch member display info for creator notification
        const { rows: [memberRow] } = await query(
          'SELECT display_name, username FROM users WHERE id = $1',
          [payment.user_id]
        );
        const memberInfo = { display_name: memberRow?.display_name || memberRow?.username || 'a member' };

        const callInfo = { meetingUrl: callJoinUrl };
        await Promise.allSettled([
          notifSvc.sendBookingConfirmationToMember(payment.user_id, bookingSummary, callInfo),
          notifSvc.sendBookingConfirmationToCreator(creator_id, bookingSummary, memberInfo, callInfo),
        ]);

        if (confirmedBookingId && meta.startTimeUtc) {
          // Schedule in-memory reminders (1h + 15min before)
          try {
            notifSvc.scheduleCallReminders(
              confirmedBookingId,
              creator_id,
              payment.user_id,
              meta.startTimeUtc,
              { meetingUrl: callJoinUrl }
            );
          } catch (reminderErr) {
            logger.warn('[callCheckoutService] failed to schedule call reminders (non-critical)', {
              bookingId: confirmedBookingId, error: reminderErr.message,
            });
          }

          // Create call_sessions row so the lifecycle worker can auto-end overdue calls
          try {
            const CallSessionModel = require('../models/callSessionModel');
            await CallSessionModel.create({
              bookingId: confirmedBookingId,
              roomProvider: 'jitsi',
              roomId: `booking-${credit.id}`,
              roomName: `Private Call - ${safeCreatorName}`,
              maxParticipants: 2,
              recordingDisabled: true,
            });
          } catch (sessionErr) {
            if (sessionErr.code !== '23505') {
              logger.warn('[callCheckoutService] call_sessions row creation failed (non-fatal)', {
                bookingId: confirmedBookingId, error: sessionErr.message,
              });
            }
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
  clientNotes = null,
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
  const safeNotes = clientNotes ? String(clientNotes).slice(0, 1000) : null;

  const insertResult = await client.query(
    `INSERT INTO bookings
       (user_id, performer_id, package_id, payment_id, start_time_utc, end_time_utc,
        status, call_type, duration_minutes, price_cents, currency, client_notes)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz,
             'awaiting_payment', 'video', $7, $8, 'USD', $9::text)
     RETURNING *`,
    [memberId, performerId, packageId, paymentId, startTimeUtc, endTimeUtc, durationMinutes, priceCents, safeNotes]
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
// createCallCheckoutNowPayments — NowPayments (crypto) checkout for a call package
// ---------------------------------------------------------------------------

/**
 * Create a NowPayments hosted invoice for a call package purchase.
 * Locks the slot atomically and creates an awaiting_payment booking row before the invoice.
 *
 * @param {object} opts
 * @param {string} opts.userId        - users.id of the buyer
 * @param {number} opts.packageId     - call_packages.id
 * @param {string} [opts.startTimeUtc] - ISO 8601
 * @param {string} [opts.endTimeUtc]   - ISO 8601
 * @param {string} [opts.payCurrency]  - Optional NowPayments pay_currency (e.g. 'btc', 'btcln')
 * @returns {{ invoiceUrl, paymentId, bookingId, amountUsd, expiresAt, orderId }}
 */
async function createCallCheckoutNowPayments({ userId, packageId, startTimeUtc, endTimeUtc, payCurrency = null, clientNotes = null }) {
  const axios = require('axios');
  const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY || '';
  if (!NOWPAYMENTS_API_KEY) {
    const err = new Error('Crypto payments are not configured');
    err.code = 'NOWPAYMENTS_NOT_CONFIGURED';
    err.status = 503;
    throw err;
  }

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

  // 2. Use full package price
  const amountUsd = parseFloat(pkg.price_usd);

  // 3. Create pending payment record
  const payment = await PaymentModel.create({
    userId,
    planId: null,
    provider: 'nowpayments',
    sku: pkg.sku,
    amount: amountUsd,
    currency: 'USD',
    status: 'pending',
    metadata: {
      type: 'call_package',
      packageId: pkg.id,
      packageSku: pkg.sku,
      creatorId: pkg.creator_id,
      startTimeUtc: startTimeUtc || null,
      endTimeUtc: endTimeUtc || null,
      provider: 'nowpayments',
    },
  });

  // 4. Slot-lock + insert booking row when times are provided
  const pool = getPool();
  const client = await pool.connect();
  let booking;
  try {
    await client.query('BEGIN');
    const performerId = await _getPerformerId(client, pkg.creator_id);
    if (!performerId) {
      throw Object.assign(new Error(`Creator ${pkg.creator_id} has no performer profile`), {
        code: 'PERFORMER_NOT_FOUND', status: 404,
      });
    }
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
        clientNotes,
      });
    }
    await client.query('COMMIT');
  } catch (txErr) {
    await client.query('ROLLBACK');
    await query(`UPDATE payments SET status = 'failed', updated_at = NOW() WHERE id = $1`, [payment.id]).catch(() => {});
    throw txErr;
  } finally {
    client.release();
  }

  // 5. Create NowPayments invoice — outside the booking transaction
  const orderId = `call-${payment.id}`;
  const successUrl = booking?.id
    ? `${WEB_APP_URL}/booking/${booking.id}/confirm?nowpayments=success`
    : `${WEB_APP_URL}/subscribe?nowpayments=success`;

  let invoiceUrl;
  let npPayInfo = {};
  try {
    const ALLOWED_CALL_PAY_CURRENCIES = new Set(['btc', 'btcln', 'eth', 'ltc', 'xmr', 'bch', 'usdt', 'usdttrc20', 'usdtbsc', 'usdc', 'usdcbsc', 'usdcsol', 'dash', 'sol', 'doge']);
    const validCallPayCurrency = (payCurrency && ALLOWED_CALL_PAY_CURRENCIES.has(String(payCurrency).toLowerCase()))
      ? String(payCurrency).toLowerCase() : null;

    const paymentResp = await axios.post(
      `${NOWPAYMENTS_URL}/invoice`,
      {
        price_amount: amountUsd,
        price_currency: 'usd',
        pay_currency: validCallPayCurrency || 'usdcsol',
        order_id: orderId,
        order_description: `${pkg.duration_minutes}-min call — PNPtv`,
        ipn_callback_url: `${WEB_APP_URL}/api/webhooks/nowpayments`,
      },
      { headers: { 'x-api-key': NOWPAYMENTS_API_KEY, 'Content-Type': 'application/json' } }
    );
    const { id: nowpaymentsInvoiceId } = paymentResp.data;
    if (!nowpaymentsInvoiceId) throw new Error('NowPayments returned no invoice id');
    invoiceUrl = `https://nowpayments.io/payment?iid=${nowpaymentsInvoiceId}`;
    npPayInfo = { nowpaymentsInvoiceId: String(nowpaymentsInvoiceId), payCurrency: validCallPayCurrency || 'usdcsol' };
  } catch (invoiceErr) {
    if (booking?.id) {
      await query(`UPDATE bookings SET status = 'expired', updated_at = NOW() WHERE id = $1`, [booking.id]).catch(() => {});
    }
    await query(`UPDATE payments SET status = 'failed', updated_at = NOW() WHERE id = $1`, [payment.id]).catch(() => {});
    logger.error('[callCheckoutService] NowPayments invoice creation failed', {
      paymentId: payment.id, bookingId: booking?.id ?? null,
      error: invoiceErr.response?.data?.message || invoiceErr.message,
    });
    throw Object.assign(new Error('Could not reach NowPayments. Please try again.'), {
      code: 'NOWPAYMENTS_ERROR', status: 502,
    });
  }

  // 6. Register in dash_subscription_orders so the webhook handler can route
  await query(
    `INSERT INTO dash_subscription_orders
       (user_id, plan_id, email, usd_amount, btcpay_invoice_id, status, creator_id, metadata)
     VALUES ($1, 'call_package', NULL, $2, $3, 'pending', $4, $5::jsonb)
     ON CONFLICT (btcpay_invoice_id) DO NOTHING`,
    [
      userId, amountUsd, orderId, pkg.creator_id,
      JSON.stringify({
        resource: 'call_package',
        packageId: pkg.id,
        paymentId: payment.id,
        bookingId: booking?.id ?? null,
        startTimeUtc: startTimeUtc || null,
        endTimeUtc: endTimeUtc || null,
      }),
    ]
  );

  // 7. Stamp orderId + bookingId back onto payment metadata for getBookingPaymentStatus polling
  // FIX HIGH-05/HIGH-06: stamp BOTH booking_id (snake_case) AND bookingId (camelCase) so
  // onCallPaymentSuccess (reads camelCase) and getBookingPaymentStatus (reads snake_case) both work.
  await query(
    `UPDATE payments SET metadata = metadata || $2::jsonb, updated_at = NOW() WHERE id = $1`,
    [payment.id, JSON.stringify({ btcpay_invoice_id: orderId, booking_id: booking?.id ?? null, bookingId: booking?.id ?? null })]
  );

  // NowPayments invoices expire after 30 minutes by default
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  logger.info('[callCheckoutService] NowPayments call checkout created', {
    paymentId: payment.id, bookingId: booking?.id ?? null, orderId, packageId: pkg.id, amountUsd,
  });

  return {
    invoiceUrl,
    paymentId: payment.id,
    bookingId: booking?.id ?? null,
    amountUsd,
    expiresAt,
    orderId,
    ...npPayInfo,
  };
}

// ---------------------------------------------------------------------------
// createCallCheckoutBtc — BTC+Lightning (BTCPay) checkout for a call package
// ---------------------------------------------------------------------------

/**
 * Create a BTCPay BTC+Lightning invoice for a call package purchase.
 * Mirrors createCallCheckoutNowPayments but routes through BTCPay instead.
 * The same dash_subscription_orders webhook handler processes both.
 *
 * @param {object} opts
 * @param {string} opts.userId        - users.id of the buyer
 * @param {number} opts.packageId     - call_packages.id
 * @param {string} [opts.startTimeUtc] - ISO 8601
 * @param {string} [opts.endTimeUtc]   - ISO 8601
 * @returns {{ invoiceId, checkoutUrl, bookingId, usdAmount, orderId }}
 */
async function createCallCheckoutBtc({ userId, packageId, startTimeUtc, endTimeUtc, clientNotes = null }) {
  const { createInvoice } = require('../config/btcpay');

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

  // 2. Use full package price
  const amountUsd = parseFloat(pkg.price_usd);

  // 3. Create pending payment record
  const payment = await PaymentModel.create({
    userId,
    planId: null,
    provider: 'btc',
    sku: pkg.sku,
    amount: amountUsd,
    currency: 'USD',
    status: 'pending',
    metadata: {
      type: 'call_package',
      packageId: pkg.id,
      packageSku: pkg.sku,
      creatorId: pkg.creator_id,
      startTimeUtc: startTimeUtc || null,
      endTimeUtc: endTimeUtc || null,
      provider: 'btc',
    },
  });

  // 4. Slot-lock + insert booking row when times are provided
  const pool = getPool();
  const client = await pool.connect();
  let booking;
  try {
    await client.query('BEGIN');
    const performerId = await _getPerformerId(client, pkg.creator_id);
    if (!performerId) {
      throw Object.assign(new Error(`Creator ${pkg.creator_id} has no performer profile`), {
        code: 'PERFORMER_NOT_FOUND', status: 404,
      });
    }
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
        clientNotes,
      });
    }
    await client.query('COMMIT');
  } catch (txErr) {
    await client.query('ROLLBACK');
    await query(`UPDATE payments SET status = 'failed', updated_at = NOW() WHERE id = $1`, [payment.id]).catch(() => {});
    throw txErr;
  } finally {
    client.release();
  }

  // 5. Create BTCPay invoice — outside the booking transaction
  const orderId = `call-btc-${payment.id}`;
  const successUrl = booking?.id
    ? `${WEB_APP_URL}/booking/${booking.id}/confirm?btc=success`
    : `${WEB_APP_URL}/subscribe?btc=success`;

  let invoice;
  try {
    invoice = await createInvoice({
      amount: amountUsd,
      currency: 'USD',
      orderId,
      userId,
      planId: 'call_package',
      metadata: {
        type: 'call_package',
        packageId: pkg.id,
        paymentId: payment.id,
        bookingId: booking?.id ?? null,
        startTimeUtc: startTimeUtc || null,
        endTimeUtc: endTimeUtc || null,
      },
      redirectUrl: successUrl,
      paymentMethods: ['BTC-LightningNetwork', 'BTC'],
    });
  } catch (invoiceErr) {
    if (booking?.id) {
      await query(`UPDATE bookings SET status = 'expired', updated_at = NOW() WHERE id = $1`, [booking.id]).catch(() => {});
    }
    await query(`UPDATE payments SET status = 'failed', updated_at = NOW() WHERE id = $1`, [payment.id]).catch(() => {});
    logger.error('[callCheckoutService] BTCPay BTC invoice creation failed', {
      paymentId: payment.id, bookingId: booking?.id ?? null,
      error: invoiceErr.message,
    });
    throw Object.assign(new Error('Could not reach BTCPay. Please try again.'), {
      code: 'BTCPAY_ERROR', status: 502,
    });
  }

  // 6. Register in dash_subscription_orders so the webhook handler can route
  await query(
    `INSERT INTO dash_subscription_orders
       (user_id, plan_id, email, usd_amount, btcpay_invoice_id, status, creator_id, metadata)
     VALUES ($1, 'call_package', NULL, $2, $3, 'pending', $4, $5::jsonb)
     ON CONFLICT (btcpay_invoice_id) DO NOTHING`,
    [
      userId, amountUsd, invoice.invoiceId, pkg.creator_id,
      JSON.stringify({
        resource: 'call_package',
        packageId: pkg.id,
        paymentId: payment.id,
        bookingId: booking?.id ?? null,
        startTimeUtc: startTimeUtc || null,
        endTimeUtc: endTimeUtc || null,
      }),
    ]
  );

  // 7. Stamp orderId + bookingId back onto payment metadata for getBookingPaymentStatus polling
  // FIX HIGH-05/HIGH-06: stamp BOTH keys for cross-consumer compatibility.
  await query(
    `UPDATE payments SET metadata = metadata || $2::jsonb, updated_at = NOW() WHERE id = $1`,
    [payment.id, JSON.stringify({ btcpay_invoice_id: invoice.invoiceId, booking_id: booking?.id ?? null, bookingId: booking?.id ?? null })]
  );

  logger.info('[callCheckoutService] BTC call checkout created', {
    paymentId: payment.id, bookingId: booking?.id ?? null, orderId, packageId: pkg.id, amountUsd,
  });

  return {
    invoiceId: invoice.invoiceId,
    checkoutUrl: invoice.checkoutLink,
    paymentId: payment.id,
    bookingId: booking?.id ?? null,
    usdAmount: amountUsd,
    orderId,
  };
}

/**
 * Create a BTCPay Dash invoice for a call package purchase.
 * Identical flow to createCallCheckoutBtc but uses the Dash BTCPay store.
 *
 * @param {object} opts
 * @param {string} opts.userId        - users.id of the buyer
 * @param {number} opts.packageId     - call_packages.id
 * @param {string} [opts.startTimeUtc] - ISO 8601
 * @param {string} [opts.endTimeUtc]   - ISO 8601
 * @param {string|null} [opts.clientNotes]
 * @returns {{ invoiceId, checkoutUrl, paymentId, bookingId, usdAmount, orderId }}
 */
async function createCallCheckoutDash({ userId, packageId, startTimeUtc, endTimeUtc, clientNotes = null }) {
  const { createDashInvoice } = require('../config/btcpay');

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

  // 2. Use full package price
  const amountUsd = parseFloat(pkg.price_usd);

  // 3. Create pending payment record
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
      startTimeUtc: startTimeUtc || null,
      endTimeUtc: endTimeUtc || null,
      provider: 'dash',
    },
  });

  // 4. Slot-lock + insert booking row when times are provided
  const pool = getPool();
  const client = await pool.connect();
  let booking;
  try {
    await client.query('BEGIN');
    const performerId = await _getPerformerId(client, pkg.creator_id);
    if (!performerId) {
      throw Object.assign(new Error(`Creator ${pkg.creator_id} has no performer profile`), {
        code: 'PERFORMER_NOT_FOUND', status: 404,
      });
    }
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
        clientNotes,
      });
    }
    await client.query('COMMIT');
  } catch (txErr) {
    await client.query('ROLLBACK');
    await query(`UPDATE payments SET status = 'failed', updated_at = NOW() WHERE id = $1`, [payment.id]).catch(() => {});
    throw txErr;
  } finally {
    client.release();
  }

  // 5. Create BTCPay Dash invoice — outside the booking transaction
  const orderId = `call-dash-${payment.id}`;
  const successUrl = booking?.id
    ? `${WEB_APP_URL}/booking/${booking.id}/confirm?dash=success`
    : `${WEB_APP_URL}/subscribe?dash=success`;

  let invoice;
  try {
    invoice = await createDashInvoice({
      usdAmount: amountUsd,
      userId,
      orderId,
      description: `${pkg.duration_minutes}-min call with creator`,
      redirectUrl: successUrl,
    });
  } catch (invoiceErr) {
    if (booking?.id) {
      await query(`UPDATE bookings SET status = 'expired', updated_at = NOW() WHERE id = $1`, [booking.id]).catch(() => {});
    }
    await query(`UPDATE payments SET status = 'failed', updated_at = NOW() WHERE id = $1`, [payment.id]).catch(() => {});
    logger.error('[callCheckoutService] BTCPay Dash invoice creation failed', {
      paymentId: payment.id, bookingId: booking?.id ?? null,
      error: invoiceErr.message,
    });
    const cfgErr = invoiceErr.message?.includes('not configured') || invoiceErr.code === 'BTCPAY_NOT_CONFIGURED';
    throw Object.assign(
      new Error(cfgErr ? 'Dash payments are not configured' : 'Could not reach BTCPay. Please try again.'),
      { code: cfgErr ? 'BTCPAY_NOT_CONFIGURED' : 'BTCPAY_ERROR', status: cfgErr ? 503 : 502 }
    );
  }

  // 6. Register in dash_subscription_orders so the webhook handler can route
  await query(
    `INSERT INTO dash_subscription_orders
       (user_id, plan_id, email, usd_amount, btcpay_invoice_id, status, creator_id, metadata)
     VALUES ($1, 'call_package', NULL, $2, $3, 'pending', $4, $5::jsonb)
     ON CONFLICT (btcpay_invoice_id) DO NOTHING`,
    [
      userId, amountUsd, invoice.invoiceId, pkg.creator_id,
      JSON.stringify({
        resource: 'call_package',
        packageId: pkg.id,
        paymentId: payment.id,
        bookingId: booking?.id ?? null,
        startTimeUtc: startTimeUtc || null,
        endTimeUtc: endTimeUtc || null,
      }),
    ]
  );

  // 7. Stamp orderId + bookingId back onto payment metadata for getBookingPaymentStatus polling
  // FIX HIGH-05/HIGH-06: stamp BOTH keys for cross-consumer compatibility.
  await query(
    `UPDATE payments SET metadata = metadata || $2::jsonb, updated_at = NOW() WHERE id = $1`,
    [payment.id, JSON.stringify({ btcpay_invoice_id: invoice.invoiceId, booking_id: booking?.id ?? null, bookingId: booking?.id ?? null })]
  );

  logger.info('[callCheckoutService] Dash call checkout created', {
    paymentId: payment.id, bookingId: booking?.id ?? null, orderId, packageId: pkg.id, amountUsd,
  });

  return {
    invoiceId: invoice.invoiceId,
    checkoutUrl: invoice.checkoutLink || invoice.checkoutUrl,
    paymentId: payment.id,
    bookingId: booking?.id ?? null,
    usdAmount: amountUsd,
    orderId,
  };
}

/**
 * Expire bookings stuck in 'awaiting_payment' for more than 2 hours.
 * Called by the cron every hour. Frees calendar slots that were locked
 * by an ePayco or BTCPay checkout the user abandoned without paying.
 * Also marks the associated payment rows as 'abandoned' so they are
 * excluded from payment-recovery retries.
 *
 * @returns {{ expired: number, errors: number }}
 */
// ---------------------------------------------------------------------------
// createCallCheckoutTokens — instant token-based booking (no payment gateway)
// ---------------------------------------------------------------------------

/**
 * Book a call package immediately by debiting tokens from the member's wallet.
 * 1 token = $1 USD. Grants call_credits + creates a confirmed booking in one transaction.
 *
 * @param {object} opts
 * @param {string} opts.memberId    - users.id of the buyer
 * @param {number} opts.packageId   - call_packages.id
 * @param {string} [opts.clientNotes]
 * @returns {{ creditId: number, bookingId: string|null, newBalance: number }}
 */
async function createCallCheckoutTokens({ memberId, packageId, clientNotes = null }) {
  const pkgResult = await query(
    'SELECT * FROM call_packages WHERE id = $1 AND is_active = true',
    [packageId]
  );
  const pkg = pkgResult.rows[0];
  if (!pkg) {
    throw Object.assign(new Error(`Package ${packageId} not found or inactive`), { code: 'PACKAGE_NOT_FOUND', status: 404 });
  }

  const tokenCost = Math.round(parseFloat(pkg.price_usd)); // 1 token = $1 USD

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Atomically debit tokens — fails cleanly if balance is insufficient
    const debitResult = await client.query(
      `UPDATE user_token_wallets
       SET balance_tokens = balance_tokens - $2, updated_at = NOW()
       WHERE user_id = $1 AND balance_tokens >= $2
       RETURNING balance_tokens`,
      [memberId, tokenCost]
    );
    if (debitResult.rows.length === 0) {
      const err = new Error('Insufficient token balance');
      err.code = 'INSUFFICIENT_TOKENS';
      err.status = 402;
      throw err;
    }
    const newBalance = debitResult.rows[0].balance_tokens;

    // Synthetic payment record (status=completed, provider=tokens)
    // Use separate params for id and reference to avoid 42P08 type-inference conflict
    // (id is uuid, reference is varchar — same $N used for both confuses Postgres).
    const syntheticPaymentId = uuidv4();
    await client.query(
      `INSERT INTO payments (id, reference, user_id, plan_id, provider, amount, currency, status, metadata, created_at, updated_at)
       VALUES ($1::uuid, $2::varchar, $3, NULL, 'manual', $4, 'USD', 'completed', $5::jsonb, NOW(), NOW())`,
      [syntheticPaymentId, syntheticPaymentId, memberId, tokenCost, JSON.stringify({
        type: 'call_package',
        packageId: pkg.id,
        tokenCost,
        clientNotes: clientNotes || null,
      })]
    );

    // Grant call_credits
    const creditResult = await client.query(
      `INSERT INTO call_credits
         (member_id, creator_id, package_id, quantity_total, payment_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (payment_id) DO NOTHING
       RETURNING *`,
      [memberId, pkg.creator_id, pkg.id, pkg.quantity, syntheticPaymentId]
    );
    const credit = creditResult.rows[0];

    // No slot time provided: skip booking row creation. The call_credits grant
    // is sufficient — user schedules the slot via BookingConfirmation (/booking/:creditId).
    const bookingId = null;

    // Record 70/30 earnings split (token path — 24-hour hold)
    const grossAmount = parseFloat(pkg.price_usd);
    const amountCreator = Math.round(grossAmount * CREATOR_REVENUE_RATE * 100) / 100;
    const amountPlatform = Math.round(grossAmount * PLATFORM_COMMISSION_RATE * 100) / 100;
    await client.query(
      `INSERT INTO creator_earnings (creator_id, amount_gross, amount_creator, amount_platform, status, available_at, source_payment_id, period_month)
       VALUES ($1, $2, $3, $4, 'holding', NOW() + ($5 || ' hours')::interval, $6, date_trunc('month', CURRENT_DATE))
       ON CONFLICT (source_payment_id) DO NOTHING`,
      [pkg.creator_id, grossAmount, amountCreator, amountPlatform, String(EARNINGS_HOLD_HOURS), syntheticPaymentId]
    );

    await client.query('COMMIT');

    logger.info('[callCheckoutService] token call checkout completed', {
      memberId, packageId, tokenCost, newBalance, creditId: credit?.id, bookingId,
    });

    // Invalidate wallet cache (best-effort, outside transaction)
    try {
      const { cache } = require('../config/redis');
      await cache.del(`wallet:${memberId}`);
    } catch (_) {}

    // Notify creator (fire-and-forget)
    (async () => {
      try {
        const creatorInfo = await query('SELECT username, display_name FROM users WHERE id = $1', [pkg.creator_id]);
        const memberInfo = await query('SELECT username, display_name FROM users WHERE id = $1', [memberId]);
        const creator = creatorInfo.rows[0];
        const member = memberInfo.rows[0];
        if (creator) {
          await sendNotificationViaTelegram(pkg.creator_id, {
            type: 'call_booking',
            title: '📞 New Call Booking (Tokens)',
            body: `@${member?.username || memberId} booked a ${pkg.duration_minutes}-min call using ${tokenCost} tokens.`,
          }).catch(() => {});
        }
      } catch (_) {}
    })();

    return { creditId: credit?.id, bookingId, newBalance };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function expireAbandonedBookings() {
  let expired = 0;
  let errors = 0;
  try {
    const result = await query(
      `UPDATE bookings
       SET status = 'expired', updated_at = NOW()
       WHERE status = 'awaiting_payment'
         AND created_at < NOW() - INTERVAL '2 hours'
       RETURNING id, payment_id`,
    );
    expired = result.rows.length;

    if (expired > 0) {
      const paymentIds = result.rows
        .map((r) => r.payment_id)
        .filter(Boolean);
      if (paymentIds.length > 0) {
        // Mark the associated payment rows abandoned so payment-recovery
        // crons do not keep polling ePayco for these known-abandoned refs.
        await query(
          `UPDATE payments
           SET status = 'abandoned', updated_at = NOW()
           WHERE id = ANY($1::uuid[])
             AND status = 'pending'`,
          [paymentIds],
        );
      }
      // M-09: cancel pending booking_notifications for each expired booking
      for (const row of result.rows) {
        await query(
          `UPDATE booking_notifications SET status = 'cancelled' WHERE booking_id = $1 AND status = 'pending'`,
          [row.id]
        ).catch(() => {});
      }

      logger.info('[callCheckoutService] expireAbandonedBookings: expired stuck bookings', {
        count: expired,
        paymentIds,
      });
    }
  } catch (err) {
    errors++;
    logger.error('[callCheckoutService] expireAbandonedBookings failed', { error: err.message });
  }
  return { expired, errors };
}

module.exports = {
  createCallCheckout,
  createCallCheckoutNowPayments,
  createCallCheckoutBtc,
  createCallCheckoutDash,
  createCallCheckoutTokens,
  onCallPaymentSuccess,
  expireAbandonedBookings,
  _lockSlotAndInsertBooking,
  _getPerformerId,
};
