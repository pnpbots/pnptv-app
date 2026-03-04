/**
 * Daimo Pay Configuration
 * Official integration for receiving crypto payments via USDC on Optimism network
 * API: https://api.daimo.com/v1/sessions (Sessions API v1)
 */

const { getAddress } = require('viem');
const fetch = require('node-fetch');
const logger = require('../utils/logger');

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
    const checkoutUrl = `https://daimo.com/checkout?id=${sessionId}`;

    logger.info('Daimo session created', {
      paymentId,
      daimoPaymentId: sessionId,
      url: checkoutUrl,
    });

    return {
      success: true,
      paymentUrl: checkoutUrl,
      daimoPaymentId: sessionId,
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
 * @param {string} daimoPaymentId - Daimo session ID
 * @returns {Promise<Object>} { success, id, status, rawStatus, source, destination, metadata, error }
 */
const checkDaimoPaymentStatus = async (daimoPaymentId) => {
  const apiKey = process.env.DAIMO_API_KEY;

  if (!apiKey) {
    return { success: false, error: 'No Daimo API key configured' };
  }

  try {
    const response = await fetchWithTimeout(`${DAIMO_API_BASE}/v1/sessions/${daimoPaymentId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      // Fallback: try legacy endpoint for old payment IDs created before migration
      const legacyResponse = await fetchWithTimeout(`${DAIMO_API_BASE}/api/payment/${daimoPaymentId}`, {
        method: 'GET',
        headers: { 'Api-Key': apiKey },
      });

      if (!legacyResponse.ok) {
        const errorText = await legacyResponse.text();
        logger.error('Daimo status check error (both v1 and legacy failed)', {
          daimoPaymentId,
          v1Status: response.status,
          legacyStatus: legacyResponse.status,
          error: errorText,
        });
        return { success: false, error: `Daimo API error: ${legacyResponse.status}` };
      }

      const legacyData = await legacyResponse.json();
      return {
        success: true,
        id: legacyData.id,
        status: normalizeSessionStatus(legacyData.status),
        rawStatus: legacyData.status,
        source: legacyData.source || null,
        destination: legacyData.destination || null,
        metadata: legacyData.metadata || null,
      };
    }

    const data = await response.json();
    const session = data.session || data;
    const rawStatus = session.status;

    return {
      success: true,
      id: session.sessionId || session.id || daimoPaymentId,
      status: normalizeSessionStatus(rawStatus),
      rawStatus,
      source: session.source || session.paymentMethod?.source || null,
      destination: session.destination || null,
      metadata: session.metadata || null,
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

module.exports = {
  getDaimoConfig,
  createDaimoPayment,
  checkDaimoPaymentStatus,
  normalizeSessionStatus,
  validateWebhookPayload,
  mapDaimoStatus,
  formatAmountFromUnits,
  DAIMO_API_BASE,
  OPTIMISM_USDC_ADDRESS,
  OPTIMISM_CHAIN_ID,
};
