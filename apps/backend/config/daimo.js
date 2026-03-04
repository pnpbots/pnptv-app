/**
 * Daimo Pay Configuration
 * Official integration for receiving crypto payments via USDC on Optimism network
 * API: https://pay.daimo.com/v1/sessions (Sessions API v1)
 */

const { getAddress } = require('viem');
const fetch = require('node-fetch');
const logger = require('../utils/logger');

// Optimism USDC Token Address (official)
const OPTIMISM_USDC_ADDRESS = '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85';
const OPTIMISM_CHAIN_ID = 10;

// Daimo Pay API base URLs
const DAIMO_API_BASE = 'https://pay.daimo.com';
const DAIMO_LEGACY_API_BASE = 'https://api.daimo.com';

/**
 * Get Daimo Pay configuration
 * @returns {Object} Daimo configuration
 */
const getDaimoConfig = () => {
  const treasuryAddress = process.env.DAIMO_TREASURY_ADDRESS;
  const refundAddress = process.env.DAIMO_REFUND_ADDRESS;

  // Validate critical configuration
  if (!treasuryAddress) {
    logger.error('DAIMO_TREASURY_ADDRESS not configured');
    throw new Error('DAIMO_TREASURY_ADDRESS is required for Daimo Pay');
  }

  if (!refundAddress) {
    logger.warn('DAIMO_REFUND_ADDRESS not configured, using treasury address as fallback');
  }

  return {
    // Network configuration
    chainId: OPTIMISM_CHAIN_ID,
    chainName: 'Optimism',

    // Token configuration (USDC on Optimism)
    token: getAddress(OPTIMISM_USDC_ADDRESS),
    tokenSymbol: 'USDC',
    tokenDecimals: 6,

    // Addresses
    treasuryAddress: getAddress(treasuryAddress),
    refundAddress: getAddress(refundAddress || treasuryAddress),

    // API base URL
    apiBase: DAIMO_API_BASE,

    // Webhook secret (for verifying legacy webhooks from in-flight payments)
    webhookSecret: process.env.DAIMO_WEBHOOK_SECRET,

    // API configuration
    apiKey: process.env.DAIMO_API_KEY,

    // App metadata
    appName: 'PNPtv Bot',
    appDescription: 'Premium subscriptions and content access',
    appIcon: process.env.DAIMO_APP_ICON || null,
  };
};

/**
 * Create a payment session using Daimo Pay Sessions API v1
 * @param {Object} params - Payment parameters
 * @returns {Promise<Object>} { success, paymentUrl, daimoPaymentId, error }
 */
const createDaimoPayment = async ({
  amount, userId, planId, chatId, paymentId, description,
}) => {
  const config = getDaimoConfig();
  // Prefer DAIMO_SECRET_KEY (new Sessions API), fall back to DAIMO_API_KEY (legacy)
  const secretKey = process.env.DAIMO_SECRET_KEY;
  const legacyKey = config.apiKey;

  if (!secretKey && !legacyKey) {
    logger.error('Neither DAIMO_SECRET_KEY nor DAIMO_API_KEY configured');
    return { success: false, error: 'Daimo API key not configured' };
  }

  const amountUnits = parseFloat(amount).toFixed(2);
  const webhookDomain = process.env.BOT_WEBHOOK_DOMAIN || process.env.CHECKOUT_DOMAIN || 'https://pnptv.app';

  // Try new Sessions API first (if secret key is available)
  if (secretKey) {
    try {
      const requestBody = {
        display: {
          title: description || `PNPtv ${planId} Subscription`,
          verb: 'pay',
        },
        destination: {
          type: 'evm',
          address: config.treasuryAddress,
          chainId: config.chainId,
          tokenAddress: config.token,
          amountUnits,
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

      const response = await fetch(`${DAIMO_API_BASE}/v1/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${secretKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        const data = await response.json();
        const sessionId = data.session?.sessionId || data.sessionId;
        const checkoutUrl = `https://daimo.com/checkout?id=${sessionId}`;

        logger.info('Daimo session created successfully', {
          paymentId,
          daimoPaymentId: sessionId,
          url: checkoutUrl,
        });

        return {
          success: true,
          paymentUrl: checkoutUrl,
          daimoPaymentId: sessionId,
          payment: data.session,
        };
      }

      const errorText = await response.text();
      logger.warn('Daimo v1 API failed, will try legacy API', {
        status: response.status,
        error: errorText,
        paymentId,
      });
    } catch (error) {
      logger.warn('Daimo v1 API error, will try legacy API', {
        error: error.message,
        paymentId,
      });
    }
  }

  // Fallback to legacy API (api.daimo.com/api/payment)
  if (legacyKey) {
    try {
      const requestBody = {
        display: {
          intent: description || `PNPtv ${planId} Subscription`,
          preferredChains: [config.chainId],
        },
        destination: {
          destinationAddress: config.treasuryAddress,
          chainId: config.chainId,
          tokenAddress: config.token,
          amountUnits,
        },
        refundAddress: config.refundAddress,
        webhookUrl: `${webhookDomain}/api/webhooks/daimo`,
        metadata: {
          userId: userId.toString(),
          chatId: chatId?.toString() || '',
          planId,
          paymentId,
          source: 'pnptv-bot',
        },
      };

      logger.info('Creating Daimo payment via legacy API', { paymentId, planId, amountUnits });

      const response = await fetch(`${DAIMO_LEGACY_API_BASE}/api/payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Api-Key': legacyKey,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Daimo legacy API error', {
          status: response.status,
          error: errorText,
          paymentId,
        });
        return { success: false, error: `Daimo API error: ${response.status}` };
      }

      const data = await response.json();

      logger.info('Daimo payment created via legacy API', {
        paymentId,
        daimoPaymentId: data.id,
        url: data.url,
      });

      return {
        success: true,
        paymentUrl: data.url,
        daimoPaymentId: data.id,
        payment: data.payment,
      };
    } catch (error) {
      logger.error('Error creating Daimo payment (legacy)', {
        error: error.message,
        paymentId,
      });
      return { success: false, error: error.message };
    }
  }

  return { success: false, error: 'No valid Daimo API key available' };
};

/**
 * Check payment status directly from Daimo Pay API
 * @param {string} daimoPaymentId - Daimo payment ID
 * @returns {Promise<Object>} { success, id, status, source, destination, metadata, error }
 */
/**
 * Map new Sessions API status to legacy status for backward compatibility
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
  // If it's already a legacy status, return as-is
  return newToLegacy[status] || status;
};

/**
 * Check payment status from Daimo Pay API
 * Tries new Sessions API first (if DAIMO_SECRET_KEY set), falls back to legacy
 * @param {string} daimoPaymentId - Daimo session/payment ID
 * @returns {Promise<Object>} { success, id, status, source, destination, metadata, error }
 */
const checkDaimoPaymentStatus = async (daimoPaymentId) => {
  const secretKey = process.env.DAIMO_SECRET_KEY;
  const legacyKey = process.env.DAIMO_API_KEY;

  if (!secretKey && !legacyKey) {
    return { success: false, error: 'No Daimo API key configured' };
  }

  // Try new Sessions API first
  if (secretKey) {
    try {
      const response = await fetch(`${DAIMO_API_BASE}/v1/sessions/${daimoPaymentId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${secretKey}` },
      });

      if (response.ok) {
        const data = await response.json();
        const session = data.session || data;
        const rawStatus = session.status || data.status;
        const legacyStatus = normalizeSessionStatus(rawStatus);

        return {
          success: true,
          id: session.sessionId || session.id || daimoPaymentId,
          status: legacyStatus,
          rawStatus,
          source: session.source || data.source || null,
          destination: session.destination || data.destination || null,
          metadata: session.metadata || data.metadata || null,
        };
      }
    } catch (err) {
      logger.warn('Daimo v1 status check failed, trying legacy', { daimoPaymentId, error: err.message });
    }
  }

  // Fallback to legacy API
  if (legacyKey) {
    try {
      const response = await fetch(`${DAIMO_LEGACY_API_BASE}/api/payment/${daimoPaymentId}`, {
        method: 'GET',
        headers: { 'Api-Key': legacyKey },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Daimo legacy status check error', {
          daimoPaymentId,
          status: response.status,
          error: errorText,
        });
        return { success: false, error: `Daimo API error: ${response.status}` };
      }

      const data = await response.json();
      return {
        success: true,
        id: data.id,
        status: data.status,
        rawStatus: data.status,
        source: data.source || null,
        destination: data.destination || null,
        metadata: data.metadata || null,
      };
    } catch (error) {
      logger.error('Error checking Daimo payment status (legacy)', {
        daimoPaymentId,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }

  return { success: false, error: 'No valid Daimo API key available' };
};

/**
 * Validate Daimo webhook payload
 * @param {Object} payload - Webhook payload
 * @returns {Object} { valid: boolean, error?: string }
 */
const validateWebhookPayload = (payload) => {
  // Normalize: Daimo Pay v2 nests data under `payment` object
  // New format: { type, paymentId, payment: { id, status, source, destination, metadata } }
  // Legacy format: { id, status, source, destination, metadata }
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

  // Source may be null for payment_unpaid events
  if (data.source && (!data.source.payerAddress && !data.source.txHash)) {
    return {
      valid: false,
      error: 'Invalid source structure',
    };
  }

  // Validate metadata (required for processing)
  if (!data.metadata?.userId && !data.metadata?.paymentId) {
    return {
      valid: false,
      error: 'Invalid metadata: userId or paymentId are required',
    };
  }

  return { valid: true };
};

/**
 * Get payment status from Daimo status
 * @param {string} daimoStatus - Daimo payment status
 * @returns {string} Internal payment status
 */
const mapDaimoStatus = (daimoStatus) => {
  const statusMap = {
    // Legacy statuses
    payment_unpaid: 'pending',
    payment_started: 'pending',
    payment_completed: 'success',
    payment_bounced: 'failed',
    payment_failed: 'failed',
    payment_refunded: 'refunded',
    // New Sessions API statuses
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
 * Daimo Pay uses human-readable format via formatUnits() — already a decimal string.
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
  DAIMO_LEGACY_API_BASE,
  OPTIMISM_USDC_ADDRESS,
  OPTIMISM_CHAIN_ID,
};
