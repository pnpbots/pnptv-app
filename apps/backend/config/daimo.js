/**
 * Daimo Pay Configuration
 * Official integration for receiving crypto payments via USDC on Optimism network
 * API: https://api.daimo.com/v1/sessions (Sessions API v1)
 */

const { getAddress } = require('viem');
const crypto = require('crypto');
const fetch = require('node-fetch');
const logger = require('../utils/logger');

// Maximum age for webhook timestamps (replay protection)
const WEBHOOK_TIMESTAMP_TOLERANCE_S = 300; // 5 minutes

// Optimism USDC Token Address (official)
const OPTIMISM_USDC_ADDRESS = '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85';
const OPTIMISM_CHAIN_ID = 10;

// Daimo Pay API base URL
const DAIMO_API_BASE = 'https://api.daimo.com';

// Fetch timeout (20 seconds — Daimo API can be slow under load)
const FETCH_TIMEOUT_MS = 20_000;

/**
 * Create a fetch request with timeout via AbortController
 */
const fetchWithTimeout = (url, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timeout));
};

/**
 * Get Daimo Pay configuration
 * @returns {Object} Daimo configuration
 */
const getDaimoConfig = () => {
  const treasuryAddress = process.env.DAIMO_TREASURY_ADDRESS;
  const refundAddress = process.env.DAIMO_REFUND_ADDRESS;

  if (!treasuryAddress) {
    logger.error('DAIMO_TREASURY_ADDRESS not configured');
    throw new Error('DAIMO_TREASURY_ADDRESS is required for Daimo Pay');
  }

  if (!refundAddress) {
    logger.warn('DAIMO_REFUND_ADDRESS not configured, using treasury address as fallback');
  }

  return {
    chainId: OPTIMISM_CHAIN_ID,
    chainName: 'Optimism',
    token: getAddress(OPTIMISM_USDC_ADDRESS),
    tokenSymbol: 'USDC',
    tokenDecimals: 6,
    treasuryAddress: getAddress(treasuryAddress),
    refundAddress: getAddress(refundAddress || treasuryAddress),
    apiBase: DAIMO_API_BASE,
    webhookSecret: process.env.DAIMO_WEBHOOK_SECRET,
    webhookHmacSecret: process.env.DAIMO_WEBHOOK_HMAC_SECRET || null,
    apiKey: process.env.DAIMO_API_KEY,
  };
};

/**
 * Create a payment session via Daimo Pay v1 Sessions API
 * Uses all available payment methods (Coinbase, Binance, MetaMask, Solana, Tron, etc.)
 * @param {Object} params - Payment parameters
 * @returns {Promise<Object>} { success, paymentUrl, daimoPaymentId, error }
 */
const createDaimoPayment = async ({
  amount, userId, planId, chatId, paymentId, description,
}) => {
  const config = getDaimoConfig();
  const apiKey = config.apiKey;

  if (!apiKey) {
    logger.error('DAIMO_API_KEY not configured');
    return { success: false, error: 'Daimo API key not configured' };
  }

  const amountUnits = parseFloat(amount).toFixed(2);

  try {
    const requestBody = {
      destination: {
        type: 'evm',
        address: config.treasuryAddress,
        chainId: config.chainId,
        tokenAddress: config.token,
        amountUnits,
      },
      display: {
        title: description || `PNPtv ${planId} Subscription`,
        verb: 'Pay',
      },
      refundAddress: config.refundAddress,
      metadata: {
        userId: userId.toString(),
        chatId: chatId?.toString() || '',
        planId,
        paymentId,
        source: 'pnptv-bot',
      },
    };

    logger.info('Creating Daimo session via v1 API', { paymentId, planId, amountUnits });

    const response = await fetchWithTimeout(`${DAIMO_API_BASE}/v1/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Daimo v1 API error', {
        status: response.status,
        error: errorText,
        paymentId,
      });
      return { success: false, error: `Daimo API error: ${response.status}` };
    }

    const data = await response.json();
    const session = data.session || data;
    const sessionId = session.sessionId || session.id;
    const clientSecret = session.clientSecret;

    if (!sessionId) {
      logger.error('[Daimo] Session created but sessionId absent from API response', {
        paymentId,
        responseKeys: Object.keys(data || {}),
      });
      return { success: false, error: 'Daimo session ID missing from API response' };
    }

    logger.info('Daimo session created', {
      paymentId,
      daimoPaymentId: sessionId,
      hasClientSecret: !!clientSecret,
    });

    return {
      success: true,
      daimoPaymentId: sessionId,
      clientSecret,
      payment: session,
    };
  } catch (error) {
    const isTimeout = error.name === 'AbortError';
    logger.error(isTimeout ? 'Daimo API request timed out' : 'Error creating Daimo session', {
      error: error.message,
      paymentId,
    });
    return { success: false, error: isTimeout ? 'Daimo API request timed out' : error.message };
  }
};

/**
 * Map v1 Sessions API status to legacy status for backward compatibility
 * @param {string} status - Status from Sessions API
 * @returns {string} Legacy-compatible status
 */
const normalizeSessionStatus = (status) => {
  const newToLegacy = {
    requires_payment_method: 'payment_unpaid',
    waiting_payment: 'payment_unpaid',
    processing: 'payment_started',
    succeeded: 'payment_completed',
    bounced: 'payment_bounced',
    expired: 'payment_failed',
  };
  return newToLegacy[status] || status;
};

/**
 * Check session status from Daimo Pay v1 API
 * Uses PUT /v1/sessions/{id}/check with clientSecret (preferred) or
 * falls back to GET /v1/sessions/{id} with API key for pre-migration payments.
 * @param {string} daimoPaymentId - Daimo session ID
 * @param {string|null} clientSecret - Per-session client secret (from payment metadata)
 * @param {string|null} txHash - Optional tx hash hint for faster detection
 * @returns {Promise<Object>} { success, id, status, rawStatus, source, destination, metadata, txHash, error }
 */
const checkDaimoPaymentStatus = async (daimoPaymentId, clientSecret = null, txHash = null) => {
  try {
    let response;

    if (clientSecret) {
      // New API: PUT /v1/sessions/{id}/check with clientSecret in body
      const body = { clientSecret };
      if (txHash) body.txHash = txHash;

      response = await fetchWithTimeout(`${DAIMO_API_BASE}/v1/sessions/${daimoPaymentId}/check`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } else {
      // Fallback for pre-migration payments: GET with API key
      const apiKey = process.env.DAIMO_API_KEY;
      if (!apiKey) {
        return { success: false, error: 'No Daimo API key or clientSecret available' };
      }
      logger.warn('Using API key fallback for Daimo status check (no clientSecret)', { daimoPaymentId });
      response = await fetchWithTimeout(`${DAIMO_API_BASE}/v1/sessions/${daimoPaymentId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Daimo status check error', {
        daimoPaymentId,
        status: response.status,
        error: errorText,
      });
      return { success: false, error: `Daimo API error: ${response.status}` };
    }

    const data = await response.json();
    const session = data.session || data;
    const rawStatus = session.status;
    const deliveryTxHash = session.destination?.delivery?.txHash || null;

    return {
      success: true,
      id: session.sessionId || session.id || daimoPaymentId,
      status: normalizeSessionStatus(rawStatus),
      rawStatus,
      source: session.paymentMethod?.source || session.source || null,
      destination: session.destination || null,
      metadata: session.metadata || null,
      txHash: deliveryTxHash,
    };
  } catch (error) {
    const isTimeout = error.name === 'AbortError';
    logger.error(isTimeout ? 'Daimo status check timed out' : 'Error checking Daimo session status', {
      daimoPaymentId,
      error: error.message,
    });
    return { success: false, error: isTimeout ? 'Daimo API request timed out' : error.message };
  }
};

/**
 * Validate Daimo webhook payload
 * @param {Object} payload - Webhook payload
 * @returns {Object} { valid: boolean, error?: string }
 */
const validateWebhookPayload = (payload) => {
  const data = (payload?.payment && typeof payload.payment === 'object')
    ? payload.payment
    : payload;

  const requiredFields = ['id', 'status'];
  const missingFields = requiredFields.filter((field) => !data[field]);

  if (missingFields.length > 0) {
    return {
      valid: false,
      error: `Missing required fields: ${missingFields.join(', ')}`,
    };
  }

  if (data.source && (!data.source.payerAddress && !data.source.txHash)) {
    return {
      valid: false,
      error: 'Invalid source structure',
    };
  }

  if (!data.metadata?.userId && !data.metadata?.paymentId) {
    return {
      valid: false,
      error: 'Invalid metadata: userId or paymentId are required',
    };
  }

  return { valid: true };
};

/**
 * Get internal payment status from Daimo status
 * @param {string} daimoStatus - Daimo payment status
 * @returns {string} Internal payment status
 */
const mapDaimoStatus = (daimoStatus) => {
  const statusMap = {
    payment_unpaid: 'pending',
    payment_started: 'pending',
    payment_completed: 'success',
    payment_bounced: 'failed',
    payment_failed: 'failed',
    payment_refunded: 'refunded',
    requires_payment_method: 'pending',
    waiting_payment: 'pending',
    processing: 'pending',
    succeeded: 'success',
    bounced: 'failed',
    expired: 'failed',
  };

  return statusMap[daimoStatus] || 'unknown';
};

/**
 * Format amount from Daimo amountUnits to display value.
 * @param {string} units - Amount (human-readable, e.g., "14.99")
 * @returns {number} Amount in display value (e.g., 14.99)
 */
const formatAmountFromUnits = (units) => parseFloat(units) || 0;

/**
 * Verify Daimo webhook HMAC-SHA256 signature.
 * Header format: Daimo-Signature: t=<timestamp>,v1=<hex-hmac>
 * @param {string} signatureHeader - Value of the Daimo-Signature header
 * @param {Buffer|string} rawBody - Raw request body
 * @param {string} secret - HMAC signing secret from webhook registration
 * @returns {{ valid: boolean, reason?: string }}
 */
const verifyWebhookSignature = (signatureHeader, rawBody, secret) => {
  if (!signatureHeader || !rawBody || !secret) {
    return { valid: false, reason: 'missing_params' };
  }

  try {
    // Parse "t=<timestamp>,v1=<hex>"
    const parts = {};
    for (const segment of signatureHeader.split(',')) {
      const eqIdx = segment.indexOf('=');
      if (eqIdx > 0) {
        parts[segment.slice(0, eqIdx).trim()] = segment.slice(eqIdx + 1).trim();
      }
    }

    const timestamp = parts.t;
    const receivedSig = parts.v1;
    if (!timestamp || !receivedSig) {
      return { valid: false, reason: 'malformed_header' };
    }

    // Replay protection: reject timestamps older than tolerance
    const ts = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    if (isNaN(ts) || Math.abs(now - ts) > WEBHOOK_TIMESTAMP_TOLERANCE_S) {
      logger.warn('Daimo webhook timestamp outside tolerance', { timestamp: ts, now, diff: Math.abs(now - ts) });
      return { valid: false, reason: 'timestamp_expired' };
    }

    // Compute expected HMAC-SHA256 of "${timestamp}.${rawBody}"
    const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    const payload = `${timestamp}.${bodyStr}`;
    const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    // Timing-safe comparison
    const receivedBuf = Buffer.from(receivedSig, 'hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');

    if (receivedBuf.length !== expectedBuf.length) {
      return { valid: false, reason: 'signature_mismatch' };
    }

    const isValid = crypto.timingSafeEqual(receivedBuf, expectedBuf);
    if (!isValid) {
      return { valid: false, reason: 'signature_mismatch' };
    }

    return { valid: true };
  } catch (error) {
    logger.error('Error verifying Daimo webhook HMAC signature', { error: error.message });
    return { valid: false, reason: 'verification_error' };
  }
};

/**
 * Detect the webhook payload format version.
 * - 'v3': New envelope format { id, type, createdAt, data: { session } }
 * - 'v2': Nested format { payment: { id, status, source, metadata } }
 * - 'legacy': Flat format { id, status, source, metadata }
 * @param {Object} payload - Webhook payload
 * @returns {'v3'|'v2'|'legacy'}
 */
const detectDaimoPayloadFormat = (payload) => {
  if (payload?.data?.session && typeof payload.data.session === 'object') return 'v3';
  if (payload?.payment && typeof payload.payment === 'object') return 'v2';
  return 'legacy';
};

/**
 * Normalize any Daimo webhook payload format into a consistent shape.
 * @param {Object} payload - Raw webhook payload (v3, v2, or legacy)
 * @returns {Object} Normalized: { format, eventId, sessionId, status, eventType, source, destination, metadata, isTestEvent }
 */
const normalizeDaimoPayload = (payload) => {
  const format = detectDaimoPayloadFormat(payload);

  if (format === 'v3') {
    const session = payload.data.session;
    const eventTypeToStatus = {
      'session.succeeded': 'payment_completed',
      'session.bounced': 'payment_bounced',
      'session.processing': 'payment_started',
    };
    const status = eventTypeToStatus[payload.type] || normalizeSessionStatus(session.status) || session.status;
    return {
      format,
      eventId: payload.id,
      sessionId: session.sessionId || session.id,
      status,
      eventType: payload.type,
      source: {
        payerAddress: session.paymentMethod?.source?.payerAddress || null,
        txHash: session.destination?.delivery?.txHash || session.paymentMethod?.source?.txHash || null,
        amountUnits: session.paymentMethod?.source?.sentUnits || session.destination?.amountUnits || null,
        chainId: session.paymentMethod?.source?.chainId || null,
        tokenSymbol: session.paymentMethod?.source?.tokenSymbol || 'USDC',
      },
      destination: session.destination || null,
      metadata: session.metadata || null,
      isTestEvent: payload.isTestEvent === true,
    };
  }

  if (format === 'v2') {
    const p = payload.payment;
    return {
      format,
      eventId: p.id || payload.paymentId,
      sessionId: p.id,
      status: p.status,
      eventType: payload.type || null,
      source: {
        payerAddress: p.source?.payerAddress || null,
        txHash: p.source?.txHash || null,
        amountUnits: p.source?.amountUnits || null,
        chainId: p.source?.chainId || null,
        tokenSymbol: p.source?.tokenSymbol || 'USDC',
      },
      destination: p.destination || null,
      metadata: p.metadata || null,
      isTestEvent: payload.isTestEvent === true,
    };
  }

  // Legacy flat format
  return {
    format,
    eventId: payload.id,
    sessionId: payload.id,
    status: payload.status,
    eventType: null,
    source: {
      payerAddress: payload.source?.payerAddress || null,
      txHash: payload.source?.txHash || null,
      amountUnits: payload.source?.amountUnits || null,
      chainId: payload.source?.chainId || null,
      tokenSymbol: payload.source?.tokenSymbol || 'USDC',
    },
    destination: payload.destination || null,
    metadata: payload.metadata || null,
    isTestEvent: payload.isTestEvent === true,
  };
};

module.exports = {
  getDaimoConfig,
  createDaimoPayment,
  checkDaimoPaymentStatus,
  normalizeSessionStatus,
  validateWebhookPayload,
  mapDaimoStatus,
  formatAmountFromUnits,
  verifyWebhookSignature,
  detectDaimoPayloadFormat,
  normalizeDaimoPayload,
  DAIMO_API_BASE,
  OPTIMISM_USDC_ADDRESS,
  OPTIMISM_CHAIN_ID,
  WEBHOOK_TIMESTAMP_TOLERANCE_S,
};
