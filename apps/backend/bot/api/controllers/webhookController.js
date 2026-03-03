const { schemas } = require('../../../validation/schemas/payment.schema');
const PaymentService = require('../../services/paymentService');
const PaymentSecurityService = require('../../services/paymentSecurityService');
const logger = require('../../../utils/logger');
const DaimoConfig = require('../../../config/daimo');
const PaymentWebhookEventModel = require('../../../models/paymentWebhookEventModel');

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

/**
 * Validate Daimo webhook payload
 * Uses the official Daimo Pay webhook structure
 * @param {Object} payload - Webhook payload
 * @returns {Object} { valid: boolean, error?: string, isTestEvent?: boolean }
 */
const validateDaimoPayload = (payload) => {
  // Handle test events from Daimo's /api/webhook/test endpoint
  // Test events have structure: { type, isTestEvent, paymentId, chainId, txHash, payment }
  if (payload && payload.isTestEvent === true) {
    logger.info('Daimo test event received', { type: payload.type, paymentId: payload.paymentId });
    return { valid: true, isTestEvent: true };
  }

  // Normalize: Daimo Pay v2 nests data under `payment` object
  const data = (payload?.payment && typeof payload.payment === 'object')
    ? payload.payment
    : payload;

  // Require basic fields before deeper validation
  const hasTransactionId = Boolean(data?.transaction_id || data?.id);
  const hasStatus = Boolean(data?.status);
  const hasMetadata = Boolean(data?.metadata && typeof data.metadata === 'object');
  if (!hasTransactionId || !hasStatus || !hasMetadata) {
    return { valid: false, error: 'Missing required fields' };
  }

  // Support simplified test-friendly shape (transaction_id, status, metadata)
  if (payload && payload.transaction_id && payload.status && payload.metadata) {
    if (typeof payload.metadata !== 'object' || payload.metadata === null) {
      return { valid: false, error: 'Invalid metadata structure' };
    }
    const { paymentId, userId, planId } = payload.metadata;
    if (!paymentId || !userId || !planId) {
      return { valid: false, error: 'Invalid metadata structure' };
    }
    return { valid: true };
  }

  // Validate using normalized data
  try {
    const result = DaimoConfig.validateWebhookPayload(
      // Pass the nested payment object so validateWebhookPayload sees flat fields
      (payload?.payment && typeof payload.payment === 'object') ? payload.payment : payload
    );
    if (result && typeof result === 'object') {
      if (result.error && result.error.toLowerCase().includes('missing required fields')) {
        return { valid: false, error: 'Missing required fields' };
      }
      const errorMsg = result.error ? result.error.toLowerCase() : '';
      const metadataErrors = ['metadata', 'source', 'destination'];
      const isMetadataError = metadataErrors.some((term) => errorMsg.includes(term));
      if (result.error && isMetadataError) {
        return { valid: false, error: 'Invalid metadata structure' };
      }
      return result;
    }
    return { valid: false, error: 'Invalid metadata structure' };
  } catch (err) {
    if (err && err.message && err.message.toLowerCase().includes('missing required fields')) {
      return { valid: false, error: 'Missing required fields' };
    }
    if (err && err.message) {
      const errMsg = err.message.toLowerCase();
      const metadataErrors = ['metadata', 'source', 'destination'];
      const isMetadataError = metadataErrors.some((term) => errMsg.includes(term));
      if (isMetadataError) {
        return { valid: false, error: 'Invalid metadata structure' };
      }
    }
    return { valid: false, error: 'Invalid metadata structure' };
  }
};

/**
 * Handle ePayco webhook
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 */
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
        signaturePresent: Boolean(req.body.x_signature),
        provider: 'epayco',
      });
      return sendError(res, 400, 'MISSING_REF_PAYCO', 'x_ref_payco is required');
    }

    // Use ref_payco + transaction state as idempotency key
    // This allows pending -> accepted transitions to be processed
    // x_cod_transaction_state: 1=Accepted, 2=Rejected, 3=Pending, 4=Failed, 5=Cancelled, 6=Reversed, 10=Abandoned
    const stateCode = req.body.x_cod_transaction_state || normalizedState || req.body.x_transaction_state || 'unknown';
    const idempotencyKey = `epayco_${req.body.x_ref_payco}_${stateCode}`;

    const acquired = await cache.acquireLock(idempotencyKey, 60);
    if (!acquired) {
      logger.info('Duplicate ePayco webhook detected (already processed)', {
        refPayco: req.body.x_ref_payco,
        state: normalizedState || req.body.x_transaction_state,
        stateCode: req.body.x_cod_transaction_state,
        idempotencyKey,
        provider: 'epayco',
        signaturePresent: Boolean(req.body.x_signature),
      });
      return res.status(200).json({ success: true, duplicate: true });
    }

    try {
      const paymentId = isUuid(req.body.x_extra3) ? req.body.x_extra3 : null;
      const eventMeta = {
        provider: 'epayco',
        eventId: req.body.x_ref_payco || req.body.x_transaction_id,
        paymentId,
        status: normalizedState || req.body.x_transaction_state,
        stateCode: req.body.x_cod_transaction_state || normalizedState || req.body.x_transaction_state,
        payload: req.body,
      };

      // Verify webhook signature before any processing
      const signatureCheck = verifyEpaycoSignature(req);
      if (!signatureCheck.valid) {
        await PaymentWebhookEventModel.logEvent({
          ...eventMeta,
          isValidSignature: false,
        });
        const status = signatureCheck.reason === 'missing_signature' ? 400 : 401;
        return sendError(res, status, 'INVALID_SIGNATURE', signatureCheck.error);
      }

      await PaymentWebhookEventModel.logEvent({
        ...eventMeta,
        isValidSignature: true,
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
  const hasSignature = Boolean(req.body?.x_signature);

  // Reject immediately if no signature is present — never trust unsigned webhooks
  if (!hasSignature) {
    logger.error('ePayco webhook rejected: missing signature', {
      transactionId: req.body?.x_ref_payco,
    });
    return { valid: false, reason: 'missing_signature', error: 'Missing signature' };
  }

  const signatureResult = PaymentService.verifyEpaycoSignature(req.body);
  const isValid = typeof signatureResult === 'object' && signatureResult !== null
    ? signatureResult.valid !== false
    : Boolean(signatureResult);

  if (!isValid) {
    logger.error('Invalid ePayco webhook signature', {
      transactionId: req.body?.x_ref_payco,
    });
    return { valid: false, reason: 'invalid_signature', error: 'Invalid signature' };
  }

  return { valid: true };
}

/**
 * Handle Daimo webhook
 * Receives payment events from Daimo Pay (Zelle, CashApp, Venmo, Revolut, Wise)
 * Webhook URL: pnptv.app/api/daimo -> /api/webhooks/daimo
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 */
const handleDaimoWebhook = async (req, res) => {
  const DaimoService = require('../../services/daimoService');

  try {
    // Normalize payload: Daimo Pay v2 nests data under `payment` object
    // New format: { type, paymentId, chainId, txHash, payment: { id, status, source, destination, metadata } }
    // Legacy format: { id, status, source, metadata }
    let id, status, source, metadata;
    if (req.body.payment && typeof req.body.payment === 'object') {
      id = req.body.payment.id || req.body.paymentId;
      status = req.body.payment.status || req.body.type;
      source = req.body.payment.source;
      metadata = req.body.payment.metadata;
    } else {
      ({ id, status, source, metadata } = req.body);
    }

    // Use event ID as idempotency key
    const idempotencyKey = `daimo_${id}`;

    const acquired = await cache.acquireLock(idempotencyKey, 60);
    if (!acquired) {
      logger.info('Duplicate Daimo webhook detected (already processed)', {
        eventId: id,
        status,
      });
      return res.status(200).json({ success: true, duplicate: true });
    }

    try {
      const paymentId = isUuid(metadata?.paymentId) ? metadata.paymentId : null;
      const eventMeta = {
        provider: 'daimo',
        eventId: id,
        paymentId,
        status,
        stateCode: req.body?.event || req.body?.type || null,
        payload: req.body,
      };

      logger.info('Daimo Pay webhook received', {
        eventId: id,
        status,
        txHash: source?.txHash,
        userId: metadata?.userId,
        planId: metadata?.planId,
        chain: 'Optimism',
        token: source?.tokenSymbol || 'USDC',
      });

      // Verify webhook authorization
      // Daimo uses Authorization: Basic <token> header for webhook verification
      const authHeader = req.headers['authorization'] || req.headers['x-daimo-signature'];
      const isValidSignature = DaimoService.verifyWebhookSignature(req.body, authHeader);

      if (!isValidSignature) {
        await PaymentWebhookEventModel.logEvent({
          ...eventMeta,
          isValidSignature: false,
        });
        logger.error('Invalid Daimo webhook authorization', {
          eventId: id,
          hasAuthHeader: !!authHeader,
        });
        return res.status(401).json({ success: false, error: 'Invalid signature' });
      }

      await PaymentWebhookEventModel.logEvent({
        ...eventMeta,
        isValidSignature: true,
      });

      // Security: Replay attack detection (30-day Redis retention)
      try {
        const replayKey = `${id}_${status}`;
        const replay = await PaymentSecurityService.checkReplayAttack(replayKey, 'daimo');
        if (replay.isReplay) {
          logger.warn('Daimo replay attack detected', { eventId: id, status });
          return res.status(200).json({ success: true, duplicate: true });
        }
      } catch (err) {
        logger.error('Replay check failed (non-critical)', { error: err.message });
      }

      // Validate payload structure
      const validation = validateDaimoPayload(req.body);
      if (!validation || !validation.valid) {
        const errorMsg = validation?.error || 'Invalid metadata structure';
        logger.warn('Invalid Daimo webhook payload', {
          error: errorMsg,
          receivedFields: Object.keys(req.body),
        });
        return res.status(400).json({ success: false, error: errorMsg });
      }

      // Handle test events - acknowledge without processing
      if (validation.isTestEvent) {
        logger.info('Daimo test event acknowledged', { eventId: id });
        return res.status(200).json({ success: true, testEvent: true });
      }

      // Process webhook with auth header
      const result = await PaymentService.processDaimoWebhook(req.body);

      if (result.success) {
        logger.info('Daimo webhook processed successfully', {
          eventId: id,
          status,
          alreadyProcessed: !!result.alreadyProcessed,
        });
        const responseBody = { success: true };
        if (result.alreadyProcessed) {
          responseBody.alreadyProcessed = true;
        }
        return res.status(200).json(responseBody);
      }

      logger.warn('Daimo webhook processing failed', {
        eventId: id,
        error: result.error || result.message,
      });
      const errorResponse = {
        success: false,
        code: result.code || 'DAIMO_REJECTED',
        message: result.message || result.error || 'Webhook processing failed',
      };
      return res.status(400).json(errorResponse);
    } finally {
      await cache.releaseLock(idempotencyKey);
    }
    } catch (error) {
      logger.error('Error handling Daimo webhook:', {
        error: error.message,
        stack: error.stack,
      });

      // Extract metadata from request body (metadata variable is scoped to try block)
      const errMeta = req.body?.payment?.metadata || req.body?.metadata;
      PaymentSecurityService.logPaymentError({
        paymentId: errMeta?.paymentId,
        userId: errMeta?.userId,
        provider: 'daimo',
        errorCode: 'DAIMO_WEBHOOK_HANDLER_ERROR',
        errorMessage: error.message,
        stackTrace: error.stack,
      }).catch(() => {});

      return res.status(500).json({
        success: false,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
  }
};

/**
 * Handle payment response page (3DS bank redirect callback)
 *
 * ePayco redirects the user's browser here after 3DS bank authentication.
 * Query params may include: ref_payco, x_transaction_state, x_ref_payco, etc.
 * OR a simple ?status=success/failed from our own url_response.
 *
 * Strategy: recover the paymentId from sessionStorage (set before redirect)
 * and redirect back to the checkout page so polling can confirm the payment.
 */
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
    // H8: Restrict frame-ancestors to known ePayco/3DS domains only — not the entire https: scheme
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.epayco.co https://*.payco.co https://*.cardinalcommerce.com");
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

module.exports = {
  handleEpaycoWebhook,
  handleDaimoWebhook,
  handlePaymentResponse,
};
