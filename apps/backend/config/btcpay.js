/**
 * BTCPay Server Configuration & API Client
 * Used for Dash Pay token purchases in PNP Live
 *
 * Required env vars:
 *   BTCPAY_URL           — e.g. https://btcpay.pnptv.app
 *   BTCPAY_API_KEY       — Store-level API key (from BTCPay dashboard)
 *   BTCPAY_STORE_ID      — Store ID from BTCPay dashboard
 *   BTCPAY_WEBHOOK_SECRET — Webhook secret for HMAC validation
 */

const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { cache } = require('./redis');

// Internal URL for server-to-server API calls (not browser-accessible)
const BTCPAY_URL = process.env.BTCPAY_URL || 'http://btcpay-server:23000';
// Public URL used in checkout links shown to users (must be browser-accessible)
const BTCPAY_PUBLIC_URL = process.env.BTCPAY_PUBLIC_URL || 'https://btcpay.pnptv.app';
const BTCPAY_API_KEY = process.env.BTCPAY_API_KEY || '';
const BTCPAY_STORE_ID = process.env.BTCPAY_STORE_ID || '';
const BTCPAY_WEBHOOK_SECRET = process.env.BTCPAY_WEBHOOK_SECRET || '';

const btcpayClient = axios.create({
  baseURL: `${BTCPAY_URL}/api/v1`,
  headers: {
    Authorization: `token ${BTCPAY_API_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

/**
 * Create a Dash invoice in BTCPay Server
 * @param {object} opts
 * @param {number}  opts.usdAmount     — Amount in USD
 * @param {string}  opts.userId        — PNPtv user ID (stored as metadata)
 * @param {string}  opts.orderId       — Unique order reference (idempotency key)
 * @param {string}  [opts.description] — Invoice description
 * @param {string}  [opts.redirectUrl] — URL to redirect after payment
 * @returns {Promise<{success: boolean, invoiceId: string, checkoutUrl: string}>}
 */
async function createDashInvoice({ usdAmount, userId, orderId, description = 'PNP Tokens', redirectUrl }) {
  if (!BTCPAY_API_KEY || !BTCPAY_STORE_ID) {
    throw new Error('BTCPay Server not configured (missing BTCPAY_API_KEY or BTCPAY_STORE_ID)');
  }

  const payload = {
    currency: 'USD',
    amount: usdAmount,
    orderId,
    metadata: {
      userId,
      platform: 'pnptv',
      description,
    },
    checkout: {
      paymentMethods: ['DASH'],
      redirectURL: redirectUrl || `${process.env.WEBAPP_URL || 'https://pnptv.app'}/live`,
      redirectAutomatically: true,
      requiresRefundEmail: false,
    },
    receipt: { enabled: false },
  };

  try {
    const response = await btcpayClient.post(`/stores/${BTCPAY_STORE_ID}/invoices`, payload);
    const invoice = response.data;

    return {
      success: true,
      invoiceId: invoice.id,
      checkoutUrl: `${BTCPAY_PUBLIC_URL}/i/${invoice.id}`,
      status: invoice.status,
    };
  } catch (err) {
    logger.error('BTCPay createDashInvoice failed:', {
      status: err.response?.status,
      data: err.response?.data,
      message: err.message,
    });
    throw err;
  }
}

/**
 * Create a generic invoice in BTCPay Server via the Greenfield API.
 * Stores planId and userId in metadata so the webhook handler can grant
 * entitlements even when no dash_subscription_orders row exists (e.g. invoices
 * initiated outside the legacy Dash flow).
 *
 * @param {object} opts
 * @param {number}  opts.amount       — Amount in the specified currency
 * @param {string}  opts.currency     — ISO currency code, e.g. 'USD'
 * @param {string}  opts.orderId      — Unique order reference (idempotency key)
 * @param {string}  opts.userId       — PNPtv user ID (stored in invoice metadata)
 * @param {string}  opts.planId       — Plan ID to grant entitlements for on settlement
 * @param {object}  [opts.metadata]   — Additional metadata merged into the invoice
 * @param {string}  [opts.redirectUrl]— URL to redirect user after payment
 * @param {string[]} [opts.paymentMethods] — Allowed payment methods (default: ['DASH'])
 * @returns {Promise<{invoiceId: string, checkoutLink: string, status: string}>}
 */
async function createInvoice({ amount, currency = 'USD', orderId, userId, planId, metadata = {}, redirectUrl, paymentMethods = ['DASH'] }) {
  if (!BTCPAY_API_KEY || !BTCPAY_STORE_ID) {
    throw new Error('BTCPay Server not configured (missing BTCPAY_API_KEY or BTCPAY_STORE_ID)');
  }
  if (!amount || amount <= 0) throw new Error('amount must be a positive number');
  if (!orderId) throw new Error('orderId is required');
  if (!userId) throw new Error('userId is required');
  if (!planId) throw new Error('planId is required');

  const payload = {
    currency,
    amount,
    orderId,
    metadata: {
      ...metadata,
      userId,
      planId,
      platform: 'pnptv',
    },
    checkout: {
      paymentMethods,
      redirectURL: redirectUrl || `${process.env.WEBAPP_URL || 'https://pnptv.app'}/subscribe`,
      redirectAutomatically: true,
      requiresRefundEmail: false,
    },
    receipt: { enabled: false },
  };

  try {
    const response = await btcpayClient.post(`/stores/${BTCPAY_STORE_ID}/invoices`, payload);
    const invoice = response.data;
    logger.info('BTCPay createInvoice: invoice created', {
      invoiceId: invoice.id,
      orderId,
      userId,
      planId,
      amount,
      currency,
    });
    return {
      invoiceId: invoice.id,
      checkoutLink: `${BTCPAY_PUBLIC_URL}/i/${invoice.id}`,
      status: invoice.status,
    };
  } catch (err) {
    logger.error('BTCPay createInvoice failed:', {
      status: err.response?.status,
      data: err.response?.data,
      message: err.message,
      orderId,
      userId,
      planId,
    });
    throw err;
  }
}

/**
 * Get invoice details from BTCPay Server
 * @param {string} invoiceId
 * @returns {Promise<object>}
 */
async function getInvoice(invoiceId) {
  try {
    const response = await btcpayClient.get(`/stores/${BTCPAY_STORE_ID}/invoices/${invoiceId}`);
    return response.data;
  } catch (err) {
    logger.error('BTCPay getInvoice failed:', {
      invoiceId,
      status: err.response?.status,
      message: err.message,
    });
    throw err;
  }
}

/**
 * Get available payment methods for an invoice, including crypto addresses and amounts.
 * Returns an array of payment method objects from BTCPay Greenfield API.
 *
 * Each element contains:
 *   - paymentMethod: string  (e.g. 'DASH', 'BTC')
 *   - destination: string    (crypto address)
 *   - amount: string         (exact crypto amount required)
 *   - networkFee: string     (estimated network fee)
 *   - rate: string           (exchange rate at time of invoice creation)
 *   - due: string            (remaining amount due in crypto)
 *   - totalDue: string       (total including network fee)
 *
 * @param {string} invoiceId
 * @returns {Promise<Array<object>>}
 */
async function getInvoicePaymentMethods(invoiceId) {
  if (!BTCPAY_API_KEY || !BTCPAY_STORE_ID) {
    throw new Error('BTCPay Server not configured (missing BTCPAY_API_KEY or BTCPAY_STORE_ID)');
  }
  try {
    const response = await btcpayClient.get(
      `/stores/${BTCPAY_STORE_ID}/invoices/${invoiceId}/payment-methods`
    );
    return response.data;
  } catch (err) {
    logger.error('BTCPay getInvoicePaymentMethods failed:', {
      invoiceId,
      status: err.response?.status,
      message: err.message,
    });
    throw err;
  }
}

/**
 * Check whether an invoice has already been processed (replay protection).
 * Uses Redis with a 48-hour TTL — long enough to outlive all reasonable
 * BTCPay retry windows.
 *
 * @param {string} invoiceId
 * @returns {Promise<boolean>} true if already processed
 */
async function checkInvoiceProcessed(invoiceId) {
  try {
    const key = `btcpay:processed:${invoiceId}`;
    const value = await cache.get(key);
    return value !== null;
  } catch (err) {
    // Redis failure must never block payment processing — log and allow through.
    logger.warn('BTCPay checkInvoiceProcessed: Redis error (allowing through)', {
      invoiceId,
      error: err.message,
    });
    return false;
  }
}

/**
 * Mark an invoice as processed in Redis (replay protection).
 * TTL: 48 hours (172800 seconds).
 *
 * @param {string} invoiceId
 * @param {object} [meta] — Optional metadata stored with the marker (userId, planId, etc.)
 * @returns {Promise<void>}
 */
async function markInvoiceProcessed(invoiceId, meta = {}) {
  try {
    const key = `btcpay:processed:${invoiceId}`;
    await cache.set(key, { processedAt: new Date().toISOString(), ...meta }, 172800);
  } catch (err) {
    // Non-critical — idempotency is also enforced at the DB layer.
    logger.warn('BTCPay markInvoiceProcessed: Redis error (non-critical)', {
      invoiceId,
      error: err.message,
    });
  }
}

/**
 * Validate BTCPay Server webhook HMAC-SHA256 signature
 * Header: BTCPay-Sig: sha256=<hex>
 * @param {string} rawBody   — Raw request body string
 * @param {string} signature — Value of BTCPay-Sig header
 * @returns {boolean}
 */
function validateWebhookSignature(rawBody, signature) {
  if (!BTCPAY_WEBHOOK_SECRET) {
    logger.error('BTCPAY_WEBHOOK_SECRET not set — rejecting webhook');
    return false;
  }
  if (!signature || !signature.startsWith('sha256=')) {
    return false;
  }
  const expected = crypto
    .createHmac('sha256', BTCPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  const provided = signature.slice('sha256='.length);

  const expectedBuf = Buffer.from(expected, 'hex');
  const providedBuf = Buffer.from(provided, 'hex');
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Check whether BTCPay is configured and reachable.
 * Returns { configured: boolean, reachable: boolean, reason?: string }
 */
async function checkBtcpayHealth() {
  const configured = !!(BTCPAY_API_KEY && BTCPAY_STORE_ID);
  if (!configured) return { configured: false, reachable: false, reason: 'not_configured' };
  try {
    await btcpayClient.get(`/stores/${BTCPAY_STORE_ID}`);
    return { configured: true, reachable: true };
  } catch (err) {
    const reason = (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') ? 'unreachable' : 'api_error';
    return { configured: true, reachable: false, reason };
  }
}

module.exports = {
  createDashInvoice,
  createInvoice,
  getInvoice,
  getInvoicePaymentMethods,
  checkInvoiceProcessed,
  markInvoiceProcessed,
  validateWebhookSignature,
  checkBtcpayHealth,
  BTCPAY_WEBHOOK_SECRET,
  get isConfigured() { return !!(BTCPAY_API_KEY && BTCPAY_STORE_ID); },
};
