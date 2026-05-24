const { schemas } = require('../../../validation/schemas/payment.schema');
const PaymentService = require('../../../services/paymentService');
const PaymentSecurityService = require('../../../services/paymentSecurityService');
const logger = require('../../../utils/logger');
// Daimo retired — DaimoConfig require removed. handleDaimoWebhook below is a
// tiny 200-OK stub kept only so the routes.js import resolves. The active
// route registration is inline in routes.js with the same retired no-op.
const PaymentWebhookEventModel = require('../../../models/paymentWebhookEventModel');
const PaymentModel = require('../../../models/paymentModel');

const { cache } = require('../../../config/redis');

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));

// In-memory cache for webhook idempotency (prevents duplicate processing within 5 minutes)
// In production, use Redis for this
// const webhookCache = new Map();
// const IDEMPOTENCY_TTL = 5 * 60 * 1000; // 5 minutes

// Cleanup interval to prevent memory leaks - runs every 10 minutes
// if (process.env.NODE_ENV !== 'test') {
//   const cleanupInterval = setInterval(() => {
//     const now = Date.now();
//     for (const [key, timestamp] of webhookCache.entries()) {
//       if (now - timestamp >= IDEMPOTENCY_TTL) {
//         webhookCache.delete(key);
//       }
//     }
//     logger.debug(`Webhook cache cleanup: ${webhookCache.size} entries remaining`);
//   }, 10 * 60 * 1000); // Run every 10 minutes
//   cleanupInterval.unref();
// }

/**
 * Check if webhook was already processed using idempotency key
 * @param {string} idempotencyKey - Unique key for this webhook
 * @returns {boolean} True if already processed
 */
// const isWebhookProcessed = (idempotencyKey) => {
//   if (webhookCache.has(idempotencyKey)) {
//     const timestamp = webhookCache.get(idempotencyKey);
//     if (Date.now() - timestamp < IDEMPOTENCY_TTL) {
//       return true;
//     }
//     // Expired, remove from cache
//     webhookCache.delete(idempotencyKey);
//   }
//   return false;
// };

/**
 * Mark webhook as processed
 * @param {string} idempotencyKey - Unique key for this webhook
 */
// const markWebhookProcessed = (idempotencyKey) => {
//   webhookCache.set(idempotencyKey, Date.now());
// };

/**
 * Send a normalized error response
 * @param {Response} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 */
const sendError = (res, status, code, message) => res.status(status).json({
  success: false,
  code,
  message,
});

/**
 * Sanitize bot username for safe HTML insertion
 * @param {string} username - Raw username
 * @returns {string} Sanitized username
 */
const sanitizeBotUsername = (username) => {
  if (!username) return 'pnplatinotv_bot';
  // Remove any HTML/script characters, keep only alphanumeric and underscore
  return username.replace(/[^a-zA-Z0-9_]/g, '') || 'pnplatinotv_bot';
};

/**
 * Validate ePayco webhook payload
 * @param {Object} payload - Webhook payload
 * @returns {Object} { valid: boolean, error?: string }
 */
const validateEpaycoPayload = (payload) => {
  const normalizedPayload = {
    ...payload,
    x_transaction_state: PaymentService.normalizeEpaycoTransactionState(
      payload?.x_transaction_state,
      payload?.x_cod_transaction_state,
    ) || payload?.x_transaction_state,
    x_currency_code: PaymentService.normalizeEpaycoCurrencyCode(payload?.x_currency_code)
      || payload?.x_currency_code,
  };

  const { error } = schemas.epaycoWebhook.validate(normalizedPayload);
  if (error) {
    return {
      valid: false,
      error: error.details.map((d) => d.message).join(', '),
    };
  }
  return { valid: true, payload: normalizedPayload };
};

const handleEpaycoWebhook = async (req, res) => {
  try {
    const normalizedState = PaymentService.normalizeEpaycoTransactionState(
      req.body?.x_transaction_state,
      req.body?.x_cod_transaction_state,
    );

    // Ensure ref_payco is present to build a stable idempotency key
    if (!req.body.x_ref_payco) {
      logger.warn('ePayco webhook missing ref_payco', {
        transactionId: req.body.x_transaction_id,
        signaturePresent: Boolean(req.body.x_signature || req.headers['x-signature']),
        provider: 'epayco',
      });
      return sendError(res, 400, 'MISSING_REF_PAYCO', 'x_ref_payco is required');
    }

    // Verify webhook signature BEFORE acquiring any Redis locks
    // This prevents unauthenticated requests from consuming lock resources
    const signatureCheck = verifyEpaycoSignature(req);
    if (!signatureCheck.valid) {
      logger.error('ePayco webhook signature rejected', {
        refPayco: req.body.x_ref_payco,
        reason: signatureCheck.reason,
        provider: 'epayco',
      });
      const status = signatureCheck.reason === 'missing_signature' ? 400 : 401;
      return sendError(res, status, 'INVALID_SIGNATURE', signatureCheck.error || 'Invalid signature');
    }

    // Use ref_payco + transaction state as idempotency key
    // This allows pending -> accepted transitions to be processed
    // x_cod_transaction_state: 1=Accepted, 2=Rejected, 3=Pending, 4=Failed, 5=Cancelled, 6=Reversed, 10=Abandoned
    const stateCode = req.body.x_cod_transaction_state || normalizedState || req.body.x_transaction_state || 'unknown';
    const idempotencyKey = `epayco_${req.body.x_ref_payco}_${stateCode}`;

    const acquired = await cache.acquireLock(idempotencyKey, 180);
    if (!acquired) {
      logger.info('Duplicate ePayco webhook detected (already processed)', {
        refPayco: req.body.x_ref_payco,
        state: normalizedState || req.body.x_transaction_state,
        stateCode: req.body.x_cod_transaction_state,
        idempotencyKey,
        provider: 'epayco',
      });
      return res.status(200).json({ success: true, duplicate: true });
    }

    try {
      const paymentId = isUuid(req.body.x_extra3) ? req.body.x_extra3 : null;

      // x_extra3 is often empty — fall back to looking up the payment by x_ref_payco
      // which ePayco reliably populates (x_id_invoice e.g. "PAY-F780D02C" is our own reference)
      let resolvedPaymentId = paymentId;
      if (!resolvedPaymentId && req.body.x_ref_payco) {
        try {
          const found = await PaymentModel.getById(String(req.body.x_ref_payco));
          if (found?.id) resolvedPaymentId = found.id;
        } catch (_) { /* non-fatal */ }
      }

      const eventMeta = {
        provider: 'epayco',
        eventId: req.body.x_ref_payco || req.body.x_transaction_id,
        paymentId: resolvedPaymentId,
        status: normalizedState || req.body.x_transaction_state,
        stateCode: req.body.x_cod_transaction_state || normalizedState || req.body.x_transaction_state,
        payload: req.body,
      };

      // Signature already verified above — log valid event
      await PaymentWebhookEventModel.logEvent({
        ...eventMeta,
        isValidSignature: true,
        signatureMethod: signatureCheck.method,
      });

      // Security: Replay attack detection (30-day Redis retention)
      try {
        const replayKey = `${req.body.x_ref_payco}_${stateCode}`;
        const replay = await PaymentSecurityService.checkReplayAttack(replayKey, 'epayco');
        if (replay.isReplay) {
          logger.warn('ePayco replay attack detected', { refPayco: req.body.x_ref_payco, stateCode });
          return res.status(200).json({ success: true, duplicate: true });
        }
      } catch (err) {
        logger.error('Replay check failed (non-critical)', { error: err.message });
      }

      logger.info('ePayco webhook received', {
        transactionId: req.body.x_ref_payco,
        state: normalizedState || req.body.x_transaction_state,
        idempotencyKey,
        provider: 'epayco',
        signaturePresent: Boolean(req.body.x_signature),
      });

      // Validate payload structure
      const validation = validateEpaycoPayload(req.body);
      if (!validation || !validation.valid) {
        const errorMsg = validation?.error || 'Invalid webhook payload';
        logger.warn('Invalid ePayco webhook payload', { error: errorMsg });
        return sendError(res, 400, 'INVALID_PAYLOAD', errorMsg);
      }

      const result = await PaymentService.processEpaycoWebhook(validation.payload || req.body);

      if (result.success) {
        return res.status(200).json({ success: true });
      }

      logger.warn('ePayco webhook rejected during processing', {
        transactionId: req.body.x_ref_payco,
        error: result.error || result.message,
        idempotencyKey,
        provider: 'epayco',
        signaturePresent: Boolean(req.body.x_signature),
      });
      const rejectionMessage = result.message || result.error || 'Webhook processing failed';
      const rejectionCode = result.code || 'EPAYCO_REJECTED';
      return sendError(res, 400, rejectionCode, rejectionMessage);
    } finally {
      await cache.releaseLock(idempotencyKey);
    }
  } catch (error) {
    logger.error('Error handling ePayco webhook:', error);

    PaymentSecurityService.logPaymentError({
      paymentId: req.body?.x_extra3,
      userId: req.body?.x_extra1,
      provider: 'epayco',
      errorCode: 'EPAYCO_WEBHOOK_HANDLER_ERROR',
      errorMessage: error.message,
      stackTrace: error.stack,
    }).catch(() => {});

    return sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
};

/**
 * Validate and verify ePayco webhook signature before processing
 * @param {Request} req
 * @returns {boolean} True when signature is valid
 */
function verifyEpaycoSignature(req) {
  // Preferred: Check x-signature HTTP header (HMAC SHA256 — newer ePayco format)
  const headerSignature = req.headers['x-signature'];
  if (headerSignature) {
    const hmacResult = PaymentService.verifyEpaycoHmacSignature(req.body, headerSignature);
    if (hmacResult.valid) {
      return { valid: true, method: 'hmac_header' };
    }
    // HMAC header present but verification failed — fail closed, do NOT fall through.
    // Allowing a failed HMAC to downgrade to the weaker body SHA256 check would let an
    // attacker forge requests by presenting any x-signature header value and then crafting
    // a body with a matching x_signature hash.
    logger.error('ePayco x-signature header HMAC verification failed — rejecting request', {
      transactionId: req.body?.x_ref_payco,
    });
    return { valid: false, reason: 'invalid_hmac_header', error: 'Invalid HMAC signature' };
  }

  // Fallback: Check x_signature in body (existing SHA256 hash method)
  // H5: In strict HMAC mode, reject any request that did not supply an x-signature header.
  // Set EPAYCO_REQUIRE_HMAC=true in production once ePayco has been configured to send
  // the x-signature header on every webhook delivery.
  if (process.env.EPAYCO_REQUIRE_HMAC === 'true') {
    logger.error('ePayco webhook rejected: EPAYCO_REQUIRE_HMAC is set but no x-signature header was present', {
      transactionId: req.body?.x_ref_payco,
    });
    return { valid: false, reason: 'hmac_required', error: 'HMAC header required in strict mode' };
  }

  const hasSignature = Boolean(req.body?.x_signature);
  if (!hasSignature) {
    logger.error('ePayco webhook rejected: missing signature', {
      transactionId: req.body?.x_ref_payco,
    });
    return { valid: false, reason: 'missing_signature', error: 'Missing signature' };
  }

  // H5: Log a warning every time the weaker body SHA256 path is used so operators
  // can detect when ePayco switches to sending HMAC headers.
  logger.warn('ePayco webhook verified via body SHA256 (weaker path) — consider enabling EPAYCO_REQUIRE_HMAC', {
    transactionId: req.body?.x_ref_payco,
  });

  const signatureResult = PaymentService.verifyEpaycoSignature(req.body);
  const isValid = typeof signatureResult === 'object' && signatureResult !== null
    ? signatureResult.valid === true
    : Boolean(signatureResult);

  if (!isValid) {
    logger.error('Invalid ePayco webhook signature', {
      transactionId: req.body?.x_ref_payco,
    });
    return { valid: false, reason: 'invalid_signature', error: 'Invalid signature' };
  }

  return { valid: true, method: 'body_sha256' };
}

// handleDaimoWebhook — RETIRED stub (route in routes.js is also no-op).
// Kept here only because module.exports below still references the symbol.
const handleDaimoWebhook = async (_req, res) => res.status(200).json({ ok: true, retired: true });

const handlePaymentResponse = async (req, res) => {
  try {
    const {
      ref_payco, x_ref_payco, x_transaction_state,
      status, x_extra3,
    } = req.query;

    const refPayco = ref_payco || x_ref_payco || null;
    const epaycoState = x_transaction_state || status || null;

    // C3: Validate x_extra3 is a well-formed UUID before using it as paymentId.
    // Rejecting anything that isn't a UUID prevents XSS via injected JS/HTML in the
    // server-side template literal that embeds this value into a <script> block.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const rawExtra3 = x_extra3 || null;
    const paymentIdFromQuery = rawExtra3 && UUID_RE.test(rawExtra3.trim()) ? rawExtra3.trim() : null;

    logger.info('Payment response page hit', {
      refPayco,
      epaycoState,
      paymentIdFromQuery,
      rawExtra3HasValue: !!rawExtra3,
      queryKeys: Object.keys(req.query),
    });

    const botUsername = sanitizeBotUsername(process.env.BOT_USERNAME);
    const botLink = botUsername ? `https://t.me/${botUsername}` : '#';

    // C4: isSuccess variable removed — we must never display a fake success state based on
    // client-controlled URL query parameters. The polling loop is the single source of truth.
    // The page always starts in "verifying" state; showConfirmation/showError are only reached
    // via the /api/payment/:id/status API response.

    // Serve a confirmation page that polls payment status and shows results on-screen
    // Allow 3DS bank redirects to frame/load this page
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Cross-Origin-Embedder-Policy');
    res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
    res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    // Phase 3: Mirror CHECKOUT_CSP wildcards used by /payment/:id. The previous
    // header only set frame-ancestors and let the page fall back to helmet's
    // exact-match list — that list misses ePayco-rotated 3DS sub-hosts (e.g.
    // apiflow-blue.epayco.co), which would silently break the post-3DS landing.
    // H8 frame-ancestors restriction kept (banks + ePayco only, not all of https:).
    const RESPONSE_CSP = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://code.jquery.com https://*.epayco.co https://*.epayco.com https://*.epayco.io https://*.payco.co https://*.cardinalcommerce.com",
      "style-src 'self' 'unsafe-inline' https:",
      "font-src 'self' https: data:",
      "img-src 'self' https: data:",
      "connect-src 'self' https:",
      "frame-src https:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https:",
      "frame-ancestors 'self' https://*.epayco.co https://*.payco.co https://*.cardinalcommerce.com",
    ].join('; ');
    res.setHeader('Content-Security-Policy', RESPONSE_CSP);
    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PNPtv! - Payment Confirmation</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0D0D0F; color: #fff; font-family: 'Segoe UI', system-ui, Arial, sans-serif;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #1C1C1E; border: 1px solid rgba(212,0,122,0.3);
            border-radius: 20px; padding: 40px 32px; max-width: 440px; width: 100%; text-align: center;
            box-shadow: 0 8px 32px rgba(212,0,122,0.1); }
    .logo { font-size: 32px; font-weight: 800; margin-bottom: 4px; }
    .logo span { color: #D4007A; }
    .subtitle { color: #888; font-size: 12px; margin-bottom: 24px; text-transform: uppercase; letter-spacing: 1px; }
    .spinner { width: 48px; height: 48px; border: 3px solid rgba(212,0,122,0.15);
               border-top-color: #D4007A; border-radius: 50%; margin: 0 auto 20px;
               animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .check { width: 64px; height: 64px; margin: 0 auto 20px; display: none; }
    .check svg { width: 100%; height: 100%; }
    .error-icon { width: 64px; height: 64px; margin: 0 auto 20px; display: none; }
    h2 { margin-bottom: 8px; font-size: 22px; font-weight: 700; }
    .msg { color: #aaa; margin-bottom: 24px; font-size: 14px; line-height: 1.5; }
    .details { background: rgba(255,255,255,0.04); border-radius: 12px; padding: 20px;
               margin-bottom: 24px; text-align: left; display: none; }
    .detail-row { display: flex; justify-content: space-between; padding: 8px 0;
                  border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 14px; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { color: #888; }
    .detail-value { color: #fff; font-weight: 600; text-align: right; }
    .detail-value.accent { color: #D4007A; }
    .email-note { background: rgba(212,0,122,0.08); border: 1px solid rgba(212,0,122,0.2);
                  border-radius: 10px; padding: 14px 16px; margin-bottom: 20px; display: none;
                  font-size: 13px; color: #ccc; line-height: 1.4; }
    .email-note strong { color: #D4007A; }
    .btn { display: inline-block; padding: 14px 28px; background: #D4007A; color: #fff;
           text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 15px;
           transition: background 0.2s; }
    .btn:hover { background: #B30066; }
    .btn-secondary { background: transparent; border: 1px solid rgba(255,255,255,0.15);
                     color: #aaa; margin-left: 8px; }
    .btn-secondary:hover { background: rgba(255,255,255,0.05); }
    .actions { display: none; margin-top: 8px; }
    .muted { color: #555; font-size: 11px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">PNPtv<span>!</span></div>
    <div class="subtitle" id="subtitle">Processing payment</div>

    <div class="spinner" id="spinner"></div>

    <div class="check" id="checkIcon">
      <svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="30" stroke="#D4007A" stroke-width="3" fill="rgba(212,0,122,0.1)"/>
      <path d="M20 33l8 8 16-16" stroke="#D4007A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>

    <div class="error-icon" id="errorIcon">
      <svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="30" stroke="#FF4444" stroke-width="3" fill="rgba(255,68,68,0.1)"/>
      <path d="M24 24l16 16M40 24l-16 16" stroke="#FF4444" stroke-width="3" stroke-linecap="round"/></svg>
    </div>

    <h2 id="title">Verifying payment...</h2>
    <p class="msg" id="msg">Please wait while we confirm your transaction.</p>

    <div class="details" id="details">
      <div class="detail-row"><span class="detail-label">Plan</span><span class="detail-value" id="dPlan">-</span></div>
      <div class="detail-row"><span class="detail-label">Amount</span><span class="detail-value accent" id="dAmount">-</span></div>
      <div class="detail-row"><span class="detail-label">Transaction</span><span class="detail-value" id="dTxn">-</span></div>
      <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value" id="dStatus">-</span></div>
    </div>

    <div class="email-note" id="emailNote">
      Your subscription is active! If you provided an email, check your inbox for your invoice and onboarding guide.
    </div>

    <div class="actions" id="actions">
      <a class="btn" href="https://pnptv.app/welcome" id="mainBtn">Go to PNPtv</a>
      <a class="btn btn-secondary" href="${botLink}" id="secondaryBtn" style="margin-top:10px;">Open Telegram Bot</a>
    </div>

    <p class="muted" id="footer"></p>
  </div>
  <script>
    (function() {
      // C3: paymentIdFromQuery is UUID-validated server-side before being embedded here.
      // It is either a valid UUID string or the literal null — no other values are possible.
      var pid = ${paymentIdFromQuery ? `'${paymentIdFromQuery}'` : 'null'};
      try { if (!pid) pid = sessionStorage.getItem('pnptv_3ds_payment_id'); } catch(e) {}

      // C4: isSuccess removed — we never trust client-supplied URL parameters to decide
      // what to display. The polling API response is the sole source of payment truth.
      var attempts = 0;
      var maxAttempts = 40;
      var pollInterval = 3000;

      function showConfirmation(data) {
        document.getElementById('spinner').style.display = 'none';
        document.getElementById('checkIcon').style.display = 'block';
        document.getElementById('subtitle').textContent = 'Payment received';
        document.getElementById('title').textContent = 'We received your payment!';
        // M4: use dynamic plan name — do not hardcode "PRIME subscription"
        document.getElementById('msg').textContent = (data && data.planName)
          ? 'Your ' + data.planName + ' subscription is now active. Check your Telegram for your invite link.'
          : 'Your subscription is now active. Check your Telegram for your invite link.';

        if (data && data.planName) {
          document.getElementById('dPlan').textContent = data.planName;
          document.getElementById('dAmount').textContent = '$' + (parseFloat(data.amount) || 0).toFixed(2) + ' ' + (data.currency || 'USD');
          document.getElementById('dTxn').textContent = (data.transactionId || '-').substring(0, 20);
          document.getElementById('dStatus').innerHTML = '<span style="color:#4CAF50">Completed</span>';
          document.getElementById('details').style.display = 'block';
        }

        document.getElementById('emailNote').style.display = 'block';
        document.getElementById('actions').style.display = 'block';
        document.getElementById('footer').textContent = 'You can close this page safely.';
      }

      function showError(msg) {
        document.getElementById('spinner').style.display = 'none';
        document.getElementById('errorIcon').style.display = 'block';
        document.getElementById('subtitle').textContent = 'Payment issue';
        document.getElementById('title').textContent = 'Payment Not Completed';
        document.getElementById('msg').textContent = msg || 'There was an issue with your payment. Please try again or contact support.';
        document.getElementById('actions').style.display = 'block';
        document.getElementById('mainBtn').textContent = 'Return to PNPtv!';
      }

      function showProcessing() {
        document.getElementById('spinner').style.display = 'none';
        document.getElementById('checkIcon').style.display = 'block';
        document.getElementById('subtitle').textContent = 'Payment received';
        document.getElementById('title').textContent = 'We received your payment!';
        document.getElementById('msg').textContent = 'Your payment was received and is being processed. Your subscription will activate shortly. Check your Telegram for updates.';
        document.getElementById('emailNote').style.display = 'block';
        document.getElementById('actions').style.display = 'block';
        document.getElementById('footer').textContent = 'You can close this page. Check your email for the invoice and guide.';
      }

      function poll() {
        // C4: When pid is absent we always show a neutral message — never a fake success state.
        if (!pid) {
          showError('Could not track your payment. If you completed the payment, your subscription will activate automatically. Please check your Telegram for confirmation.');
          return;
        }
        attempts++;
        fetch('/api/payment/' + encodeURIComponent(pid) + '/status')
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.status === 'completed') {
              showConfirmation(data);
            } else if (data.status === 'failed' || data.status === 'refunded') {
              showError(data.message || 'Your payment was not successful. Please try again.');
            } else if (attempts >= maxAttempts) {
              // C4: On timeout we show the neutral processing message — we cannot claim success
              // without a confirmed status response from the server.
              showProcessing();
            } else {
              setTimeout(poll, pollInterval);
            }
          })
          .catch(function() {
            if (attempts >= maxAttempts) {
              showProcessing();
            } else {
              setTimeout(poll, pollInterval);
            }
          });
      }

      poll();
    })();
  </script>
</body>
</html>`);
  } catch (error) {
    logger.error('Error handling payment response:', error);
    res.status(500).send('Error processing payment response');
  }
};

// ── Stripe Webhook ────────────────────────────────────────────────────────────
// Receives Stripe events. Raw body is required for signature verification;
// the route registers express.raw({ type: 'application/json' }) before this handler.

const stripeService = require('../../../services/stripeService');

/**
 * Notify a user via Telegram that their invoice payment failed.
 * Non-critical — we swallow errors so the webhook still returns 200.
 *
 * @param {string} userId   - PNPtv user UUID from subscription metadata
 * @param {object} invoice  - Stripe Invoice object
 */
async function notifyStripeAdminAlert(text) {
  try {
    const { Telegraf } = require('telegraf');
    let bot;
    try {
      const botModule = require('../../../bot/core/bot');
      bot = typeof botModule?.getBotInstance === 'function' ? botModule.getBotInstance() : null;
    } catch (_) {}
    if (!bot) bot = new Telegraf(process.env.BOT_TOKEN);
    const channelId = process.env.NOTIFICATION_CHANNEL_ID || process.env.ADMIN_ID;
    if (channelId) {
      await bot.telegram.sendMessage(channelId, text, { parse_mode: 'Markdown' });
    }
  } catch (err) {
    logger.warn('[stripeWebhook] Admin alert failed (non-critical)', { error: err.message });
  }
}

async function notifyInvoicePaymentFailed(userId, invoice) {
  try {
    const UserModel = require('../../../models/userModel');
    const user = await UserModel.getById(userId);
    if (!user?.telegram) return;

    const { Telegraf } = require('telegraf');
    let bot;
    try {
      const botModule = require('../../../bot/core/bot');
      bot = typeof botModule?.getBotInstance === 'function' ? botModule.getBotInstance() : null;
    } catch (_) { /* not yet loaded */ }
    if (!bot) bot = new Telegraf(process.env.BOT_TOKEN);

    const amountDue = invoice.amount_due != null ? `$${(invoice.amount_due / 100).toFixed(2)}` : '';
    const escapedAmount = amountDue.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }[c]));
    const message = `⚠️ *PNPtv\\!* — Payment failed\n\nWe could not process your renewal payment${escapedAmount ? ` of ${escapedAmount}` : ''}\\. Please update your payment method to keep your subscription active\\.\n\n[Manage subscription](https://pnptv.app/settings/payments)`;

    await bot.telegram.sendMessage(user.telegram, message, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    logger.warn('[stripeWebhook] Telegram notification for invoice failure failed (non-critical)', {
      userId, error: err.message,
    });
  }
}

const handleStripeWebhook = async (req, res) => {
  const signature = req.headers['stripe-signature'];
  if (!signature) {
    logger.warn('[stripeWebhook] Missing stripe-signature header');
    return res.status(400).json({ error: 'Missing stripe-signature' });
  }

  // req.rawBody is set by the global express.json() verify callback.
  // Hard-fail if it is absent — a fallback buffer would produce a wrong HMAC
  // and let forged webhooks appear valid.
  if (!(req.rawBody instanceof Buffer)) {
    logger.error('[stripeWebhook] req.rawBody is not a Buffer — is express.json verify callback active?');
    return res.status(500).json({ error: 'Webhook body capture misconfigured' });
  }
  const rawBody = req.rawBody;

  let event;
  try {
    event = stripeService.constructWebhookEvent(rawBody, signature);
  } catch (err) {
    logger.error('[stripeWebhook] Signature verification failed', { error: err.message });
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
  }

  logger.info('[stripeWebhook] Event received', { type: event.type, id: event.id });

  // Idempotency guard — check if already processed before touching anything
  const idempotencyKey = `stripe:evt:${event.id}`;
  try {
    const redis = require('../../../config/redis').getRedis();
    const alreadyProcessed = await redis.get(idempotencyKey);
    if (alreadyProcessed) {
      logger.info('[stripeWebhook] Duplicate event, skipping', { eventId: event.id });
      return res.status(200).json({ received: true, duplicate: true });
    }
  } catch (_) {
    // Redis unavailable — DB-level constraints will prevent double-processing
    logger.warn('[stripeWebhook] Redis unavailable for duplicate check — continuing', { eventId: event.id });
  }

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;
        // Only process sessions that are fully paid (mode=payment) or active (mode=subscription)
        if (session.payment_status !== 'paid' && session.status !== 'complete') {
          logger.info('[stripeWebhook] checkout.session.completed but not paid yet — skipping', {
            sessionId: session.id,
            paymentStatus: session.payment_status,
          });
          break;
        }
        const result = await PaymentService.processStripeCheckout(session);
        if (!result.success && !result.skipped) {
          logger.error('[stripeWebhook] processStripeCheckout failed', {
            sessionId: session.id, error: result.error,
          });
        }
        break;
      }

      case 'customer.subscription.updated': {
        // Log only — entitlement grants are handled exclusively by invoice.payment_succeeded.
        // Acting here would double-grant on every status transition (e.g. trialing→active).
        const sub = event.data.object;
        logger.info('[stripeWebhook] customer.subscription.updated', {
          subId: sub.id,
          status: sub.status,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        // If cancel_at_period_end was set, the user already paid for the current period.
        // Use current_period_end as the expiry; otherwise deactivate immediately.
        const periodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000)
          : new Date();
        if (periodEnd > new Date()) {
          await PaymentService.scheduleStripeEntitlementExpiry(sub.id, periodEnd);
        } else {
          await PaymentService.deactivateStripeSubscriptionEntitlements(sub.id);
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        // Only act on renewal invoices (billing_reason = 'subscription_cycle')
        // Initial payment is handled by checkout.session.completed
        if (invoice.billing_reason !== 'subscription_cycle') break;

        const subId = invoice.subscription ? String(invoice.subscription) : null;
        if (!subId) break;

        // Fetch subscription to get our metadata
        try {
          const sub = await stripeService.getSubscription(subId);
          const userId = sub.metadata?.user_id;
          const planId = sub.metadata?.plan_id;
          const creatorId = sub.metadata?.creatorId;
          if (userId && planId) {
            await PaymentService.renewStripeSubscriptionEntitlements(subId, userId, planId, {
              creatorId: creatorId || null,
              invoiceId: invoice.id ? String(invoice.id) : null,
              paymentIntentId: invoice.payment_intent ? String(invoice.payment_intent) : null,
              amountTotal: invoice.amount_paid != null ? invoice.amount_paid / 100 : 0,
              currency: (invoice.currency || 'usd').toUpperCase(),
              metadata: {
                stripe_invoice_id: invoice.id ? String(invoice.id) : null,
                stripe_payment_intent_id: invoice.payment_intent ? String(invoice.payment_intent) : null,
              },
            });
          }
        } catch (fetchErr) {
          logger.error('[stripeWebhook] Failed to fetch subscription for renewal', {
            subId, error: fetchErr.message,
          });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subId = invoice.subscription ? String(invoice.subscription) : null;
        if (!subId) break;

        try {
          const sub = await stripeService.getSubscription(subId);
          const userId = sub.metadata?.user_id;
          if (userId) {
            await notifyInvoicePaymentFailed(userId, invoice);
          }
        } catch (fetchErr) {
          logger.warn('[stripeWebhook] Could not fetch subscription for payment_failed notification', {
            subId, error: fetchErr.message,
          });
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        // If a subscription payment is refunded, revoke access immediately.
        // If a one-time payment is refunded, mark the payments row as refunded.
        const paymentIntentId = charge.payment_intent ? String(charge.payment_intent) : null;
        if (paymentIntentId) {
          try {
            const { query } = require('../../../config/postgres');
            const { rows } = await query(
              `UPDATE payments SET status = 'refunded', updated_at = NOW()
               WHERE provider = 'stripe'
                 AND (reference = $1 OR metadata->>'stripe_payment_intent_id' = $1)
               RETURNING id, user_id, plan_id, stripe_subscription_id`,
              [paymentIntentId]
            );
            if (rows.length > 0) {
              const row = rows[0];
              logger.info('[stripeWebhook] charge.refunded: payment row marked refunded', {
                paymentId: row.id, userId: row.user_id, planId: row.plan_id,
              });
              if (row.stripe_subscription_id) {
                await PaymentService.deactivateStripeSubscriptionEntitlements(row.stripe_subscription_id);
              }
              // Revoke any call credits tied to this payment and cancel confirmed bookings
              try {
                const { rows: creditRows } = await query(
                  `UPDATE call_credits
                   SET status = 'refunded', updated_at = NOW()
                   WHERE payment_id = $1
                     AND status IN ('unused', 'partial')
                   RETURNING id`,
                  [row.id]
                );
                if (creditRows.length > 0) {
                  const creditIds = creditRows.map(c => c.id);
                  logger.info('[stripeWebhook] charge.refunded: call credits revoked', {
                    paymentId: row.id, creditIds,
                  });
                  // Cancel any confirmed bookings linked to those credits
                  const { rows: cancelledBookings } = await query(
                    `UPDATE bookings
                     SET status = 'cancelled',
                         cancel_reason = 'payment_refunded',
                         cancelled_at = NOW(),
                         cancelled_by = 'system',
                         updated_at = NOW()
                     WHERE credit_id = ANY($1::int[])
                       AND status = 'confirmed'
                     RETURNING id`,
                    [creditIds]
                  );
                  if (cancelledBookings.length > 0) {
                    logger.info('[stripeWebhook] charge.refunded: confirmed bookings cancelled', {
                      paymentId: row.id,
                      bookingIds: cancelledBookings.map(b => b.id),
                    });
                  }
                }
              } catch (creditRevokeErr) {
                logger.error('[stripeWebhook] charge.refunded: error revoking call credits', {
                  paymentId: row.id, error: creditRevokeErr.message,
                });
              }
            }
          } catch (refundErr) {
            logger.error('[stripeWebhook] charge.refunded: error updating payment row', {
              paymentIntentId, error: refundErr.message,
            });
          }
        }
        break;
      }

      case 'review.opened': {
        const review = event.data.object;
        logger.warn('[stripeWebhook] Radar review opened', {
          reviewId: review.id,
          chargeId: review.charge,
          paymentIntentId: review.payment_intent,
          reason: review.reason,
          openedReason: review.opened_reason,
        });
        notifyStripeAdminAlert(
          `🚨 *Stripe Radar Review Opened*\nReview: \`${review.id}\`\nReason: ${review.reason || 'unknown'}\nOpened by: ${review.opened_reason || '—'}\nCharge: \`${review.charge || '—'}\``
        ).catch(() => {});
        break;
      }

      case 'review.closed': {
        const review = event.data.object;
        logger.info('[stripeWebhook] Radar review closed', {
          reviewId: review.id,
          chargeId: review.charge,
          closedReason: review.closed_reason,
        });
        if (review.closed_reason === 'refunded_as_fraud' || review.closed_reason === 'refunded') {
          logger.warn('[stripeWebhook] Review closed as fraud — Stripe refunded the charge', {
            reviewId: review.id, chargeId: review.charge,
          });
          notifyStripeAdminAlert(
            `⛔ *Stripe Review: Fraud Confirmed*\nReview: \`${review.id}\`\nCharge: \`${review.charge || '—'}\`\nOutcome: ${review.closed_reason}`
          ).catch(() => {});
        }
        break;
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object;
        logger.error('[stripeWebhook] Chargeback dispute created', {
          disputeId: dispute.id,
          chargeId: dispute.charge,
          amount: dispute.amount / 100,
          currency: dispute.currency,
          reason: dispute.reason,
          status: dispute.status,
        });
        notifyStripeAdminAlert(
          `🚨 *Chargeback Filed*\nDispute: \`${dispute.id}\`\nCharge: \`${dispute.charge}\`\nAmount: $${(dispute.amount / 100).toFixed(2)} ${(dispute.currency || 'usd').toUpperCase()}\nReason: ${dispute.reason}\nDue: respond in Stripe dashboard`
        ).catch(() => {});
        break;
      }

      case 'radar.early_fraud_warning.created': {
        const warning = event.data.object;
        logger.warn('[stripeWebhook] Radar early fraud warning', {
          warningId: warning.id,
          chargeId: warning.charge,
          fraudType: warning.fraud_type,
          actionable: warning.actionable,
        });
        notifyStripeAdminAlert(
          `⚠️ *Stripe Early Fraud Warning*\nWarning: \`${warning.id}\`\nCharge: \`${warning.charge}\`\nType: ${warning.fraud_type}\nActionable: ${warning.actionable}`
        ).catch(() => {});
        break;
      }

      default:
        logger.debug('[stripeWebhook] Unhandled event type', { type: event.type });
    }

    // Mark processed only after the switch completes successfully so that a crash
    // mid-handler does not permanently swallow Stripe retries.
    try {
      const redis = require('../../../config/redis').getRedis();
      await redis.set(idempotencyKey, '1', 'EX', 172800);
    } catch (_) {
      // Non-critical — DB constraints are the authoritative idempotency guard
      logger.warn('[stripeWebhook] Redis mark failed post-processing (non-fatal)', { eventId: event.id });
    }
  } catch (processingErr) {
    logger.error('[stripeWebhook] Error processing event', {
      eventId: event.id,
      type: event.type,
      error: processingErr.message,
      stack: processingErr.stack,
    });
    // Return 500 so Stripe retries — Redis key was NOT written, so the retry will proceed
    return res.status(500).json({ error: 'Event processing failed' });
  }

  return res.status(200).json({ received: true });
};

// ── LiveKit Webhook ───────────────────────────────────────────────────────────
// Receives participant_joined, participant_left, room_finished events from LiveKit.
// Keeps hangout_video_calls.participant_count in sync without relying on manual
// increment/decrement from REST calls (which drift when clients disconnect abruptly).
// LiveKit signs the payload with LIVEKIT_API_SECRET; we verify before acting.

const { WebhookReceiver } = require('livekit-server-sdk');
const { query } = require('../../../config/postgres');

const HANGOUT_ROOM_PREFIX = 'hangout-';

const handleLiveKitWebhook = async (req, res) => {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    logger.error('LiveKit webhook: LIVEKIT_API_KEY or LIVEKIT_API_SECRET not set');
    return res.status(500).end();
  }

  try {
    const receiver = new WebhookReceiver(apiKey, apiSecret);
    // livekit-server-sdk needs the raw body as a string and the Authorization header
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);
    const authHeader = req.headers['authorization'] || '';
    const event = await receiver.receive(rawBody, authHeader);

    const roomName = event.room?.name || '';
    const eventType = event.event;

    logger.info('LiveKit webhook received', { event: eventType, room: roomName });

    // Only act on hangout rooms (named "hangout-{groupId}")
    if (roomName.startsWith(HANGOUT_ROOM_PREFIX)) {
      const groupId = roomName.slice(HANGOUT_ROOM_PREFIX.length);

      if (eventType === 'participant_left') {
        // LiveKit identities now carry a per-mint suffix (e.g. "12345-a1b2c3d4") to support
        // multi-tab usage (B1 fix). Strip the suffix to recover the stable user_id for the
        // DB lookup. Idempotent: left_at IS NULL guard prevents double-stamping.
        const rawIdentity = String(event.participant?.identity || '');
        const userIdRaw = rawIdentity.split('-')[0];
        if (userIdRaw) {
          await query(
            `UPDATE hangout_call_participants
             SET left_at = NOW()
             FROM hangout_video_calls
             WHERE hangout_video_calls.id = hangout_call_participants.call_id
               AND hangout_video_calls.room_name = $1
               AND hangout_call_participants.user_id = $2
               AND hangout_call_participants.left_at IS NULL`,
            [roomName, userIdRaw]
          );
          logger.info('LiveKit participant_left: stamped left_at', { roomName, userIdRaw });
        }
      } else if (eventType === 'participant_joined') {
        // Participant rows and the DB trigger own participant_count. The webhook
        // only observes transport events, which can arrive after REST writes or
        // disconnect races; mutating the counter here causes drift/double-counts.
      } else if (eventType === 'room_finished') {
        // Mark the call ended first, then bulk-stamp any participants still missing left_at.
        // This covers abrupt disconnects that bypassed the /call/leave REST endpoint.
        const { rows: callRows } = await query(
          `UPDATE hangout_video_calls
           SET status = 'ended', ended_at = NOW(), participant_count = 0
           WHERE group_id = $1 AND status = 'active'
           RETURNING id`,
          [groupId]
        );
        if (callRows.length > 0) {
          const callId = callRows[0].id;
          await query(
            `UPDATE hangout_call_participants SET left_at = NOW()
             WHERE call_id = $1 AND left_at IS NULL`,
            [callId]
          );
        }
        logger.info('LiveKit room_finished: hangout call marked ended, participants stamped', { groupId, roomName });
      }
    }

    res.status(200).end();
  } catch (err) {
    logger.error('LiveKit webhook error', { message: err.message });
    // Return 200 so LiveKit doesn't keep retrying; signature failures are logged above
    res.status(200).end();
  }
};

module.exports = {
  handleEpaycoWebhook,
  handleDaimoWebhook,
  handlePaymentResponse,
  handleLiveKitWebhook,
  handleStripeWebhook,
};
