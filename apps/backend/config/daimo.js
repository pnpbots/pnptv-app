/**
 * Daimo Pay Configuration
 * Official integration for receiving crypto payments via USDC on Optimism network
 * API: https://api.daimo.com/api/payment
 */

const { getAddress } = require('viem');
const fetch = require('node-fetch');
const logger = require('../utils/logger');

// Optimism USDC Token Address (official)
const OPTIMISM_USDC_ADDRESS = '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85';
const OPTIMISM_CHAIN_ID = 10;

// Daimo Pay API base URL (migrated from pay.daimo.com to api.daimo.com)
const DAIMO_API_BASE = 'https://api.daimo.com';

/**
 * Get Daimo Pay configuration
 * @returns {Object} Daimo configuration
 */
const getDaimoConfig = () => {
  const treasuryAddress = process.env.DAIMO_TREASURY_ADDRESS;
  const refundAddress = process.env.DAIMO_REFUND_ADDRESS;
  // Daimo webhooks go to pnptv.app (same domain as bot/checkout)
  const webhookDomain = process.env.BOT_WEBHOOK_DOMAIN || process.env.CHECKOUT_DOMAIN || 'https://pnptv.app';
  const webhookUrl = `${webhookDomain}/api/webhooks/daimo`;

  // Validate critical configuration
  if (!treasuryAddress) {
    // Nunca loggear el valor de la dirección
    logger.error('DAIMO_TREASURY_ADDRESS not configured');
    throw new Error('DAIMO_TREASURY_ADDRESS is required for Daimo Pay');
  }

  if (!refundAddress) {
    // Nunca loggear el valor de la dirección
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

    // Webhook configuration
    webhookUrl,
    webhookSecret: process.env.DAIMO_WEBHOOK_SECRET,

    // API configuration
    apiKey: process.env.DAIMO_API_KEY,

    // App metadata
    appName: 'PNPtv Bot',
    appDescription: 'Premium subscriptions and content access',
    // App icon URL (optional) - defaults to null if not configured
    appIcon: process.env.DAIMO_APP_ICON || null,
  };
};

/**
 * Create payment intent for Daimo Pay
 * @param {Object} params - { amount, userId, planId, chatId }
 * @returns {Object} Payment intent object
 */
const createPaymentIntent = ({
  amount, userId, planId, chatId, description,
}) => {
  const config = getDaimoConfig();

  // Daimo Pay API uses human-readable format (e.g., "14.99")
  const amountInUnits = parseFloat(amount).toFixed(2);

  return {
    // Destination
    toAddress: config.treasuryAddress,
    toChain: config.chainId,
    toToken: config.token,
    toUnits: amountInUnits,

    // Payment description
    intent: description || `PNPtv ${planId} Subscription`,

    // Refund address (if payment fails)
    refundAddress: config.refundAddress,

    // Metadata (will be returned in webhook)
    metadata: {
      userId: userId.toString(),
      chatId: chatId?.toString(),
      planId,
      amount: amount.toString(),
      timestamp: new Date().toISOString(),
    },
  };
};



/**
 * Create a payment using Daimo Pay API (Official method)
 * @param {Object} params - Payment parameters
 * @returns {Promise<Object>} { success, paymentUrl, daimoPaymentId, error }
 */
const createDaimoPayment = async ({
  amount, userId, planId, chatId, paymentId, description,
}) => {
  const config = getDaimoConfig();
  
  if (!config.apiKey) {
    logger.error('DAIMO_API_KEY not configured');
    return { success: false, error: 'Daimo API key not configured' };
  }

  try {
    // Format amount as string with 2 decimals (e.g., "14.99")
    const amountUnits = parseFloat(amount).toFixed(2);
    
    const requestBody = {
      display: {
        intent: description || `PNPtv ${planId} Subscription`,
        preferredChains: [config.chainId],
      },
      destination: {
        destinationAddress: config.treasuryAddress,
        chainId: config.chainId,
        tokenAddress: config.token,
        amountUnits: amountUnits,
      },
      refundAddress: config.refundAddress,
      webhookUrl: config.webhookUrl,
      metadata: {
        userId: userId.toString(),
        chatId: chatId?.toString() || '',
        planId: planId,
        paymentId: paymentId,
        source: 'pnptv-bot',
      },
    };

    logger.info('Creating Daimo payment via API', {
      paymentId,
      planId,
      amountUnits,
    });

    const response = await fetch(`${config.apiBase}/api/payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': config.apiKey,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Daimo API error', {
        status: response.status,
        error: errorText,
        paymentId,
      });
      return { 
        success: false, 
        error: `Daimo API error: ${response.status}`,
      };
    }

    const data = await response.json();

    logger.info('Daimo payment created successfully', {
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
    logger.error('Error creating Daimo payment', {
      error: error.message,
      paymentId,
    });
    return { 
      success: false, 
      error: error.message,
    };
  }
};

/**
 * Check payment status directly from Daimo Pay API
 * @param {string} daimoPaymentId - Daimo payment ID
 * @returns {Promise<Object>} { success, id, status, source, destination, metadata, error }
 */
const checkDaimoPaymentStatus = async (daimoPaymentId) => {
  const apiKey = process.env.DAIMO_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'DAIMO_API_KEY not configured' };
  }

  try {
    const response = await fetch(`${DAIMO_API_BASE}/api/payment/${daimoPaymentId}`, {
      method: 'GET',
      headers: {
        'Api-Key': apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Daimo status check API error', {
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
      source: data.source || null,
      destination: data.destination || null,
      metadata: data.metadata || null,
    };
  } catch (error) {
    logger.error('Error checking Daimo payment status', {
      daimoPaymentId,
      error: error.message,
    });
    return { success: false, error: error.message };
  }
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
    payment_unpaid: 'pending',
    payment_started: 'pending',
    payment_completed: 'success',
    payment_bounced: 'failed',
    payment_failed: 'failed',
    payment_refunded: 'refunded',
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
  createPaymentIntent,
  createDaimoPayment,
  checkDaimoPaymentStatus,
  validateWebhookPayload,
  mapDaimoStatus,
  formatAmountFromUnits,
  DAIMO_API_BASE,
  OPTIMISM_USDC_ADDRESS,
  OPTIMISM_CHAIN_ID,
};
