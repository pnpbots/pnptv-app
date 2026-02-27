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
    const paymentIdFromQuery = x_extra3 || null;

    logger.info('Payment response page hit', {
      refPayco,
      epaycoState,
      paymentIdFromQuery,
      queryKeys: Object.keys(req.query),
    });

    const botUsername = sanitizeBotUsername(process.env.BOT_USERNAME);
    const botLink = botUsername ? `https://t.me/${botUsername}` : '#';

    // Determine if this looks like a success
    const isSuccess = epaycoState === 'Aceptada'
      || epaycoState === 'Aprobada'
      || status === 'success'
      || status === 'approved';

    // Serve a bridge page that:
    // 1. Reads paymentId from sessionStorage (set by checkout before 3DS redirect)
    // 2. Redirects back to /checkout/<paymentId>?poll=1 so polling picks up
    // 3. Falls back to a friendly message with Telegram bot link
    // Allow 3DS bank redirects to frame/load this page
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Cross-Origin-Embedder-Policy');
    res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
    res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https:");
    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PNPtv! - ${isSuccess ? 'Payment Processing' : 'Payment Result'}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #121212; color: #fff; font-family: 'Segoe UI', Arial, sans-serif;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: rgba(30,30,30,0.9); border: 1px solid rgba(212,0,122,0.3);
            border-radius: 16px; padding: 32px; max-width: 420px; width: 100%; text-align: center; }
    h2 { margin-bottom: 12px; }
    p { color: #aaa; margin-bottom: 20px; font-size: 14px; }
    .spinner { width: 40px; height: 40px; border: 3px solid rgba(212,0,122,0.2);
               border-top-color: #D4007A; border-radius: 50%; margin: 0 auto 16px;
               animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .btn { display: inline-block; padding: 12px 24px; background: #D4007A; color: #fff;
           text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 12px; }
    .muted { color: #666; font-size: 12px; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner" id="spinner"></div>
    <h2 id="title">${isSuccess ? 'Verifying payment...' : 'Returning to checkout...'}</h2>
    <p id="msg">Please wait while we confirm your bank authentication.</p>
    <div id="fallback" style="display:none;">
      <a class="btn" href="${botLink}">Open Telegram Bot</a>
      <p class="muted">If you completed bank verification, your subscription will activate automatically.</p>
    </div>
  </div>
  <script>
    (function() {
      // Try to recover paymentId
      var pid = ${paymentIdFromQuery ? `'${paymentIdFromQuery.replace(/'/g, '')}'` : 'null'};
      try {
        if (!pid) pid = sessionStorage.getItem('pnptv_3ds_payment_id');
      } catch(e) {}

      if (pid) {
        // Redirect back to checkout page — it will start polling automatically
        window.location.replace('/checkout/' + encodeURIComponent(pid) + '?poll=1');
      } else {
        // No paymentId — show fallback with bot link
        document.getElementById('spinner').style.display = 'none';
        document.getElementById('title').textContent = '${isSuccess ? 'Payment received!' : 'Bank verification complete'}';
        document.getElementById('msg').textContent = '${isSuccess
    ? 'Your PRIME subscription is being activated. Return to Telegram to enjoy premium features!'
    : 'Your payment is being processed. You can close this page and return to the bot.'}';
        document.getElementById('fallback').style.display = 'block';
      }
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
