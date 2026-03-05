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

const BTCPAY_URL = process.env.BTCPAY_URL || 'http://btcpay-server:23000';
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
      redirectURL: redirectUrl || `${process.env.WEBAPP_URL || 'https://app.pnptv.app'}/live`,
      redirectAutomatically: true,
      requiresRefundEmail: false,
    },
    receipt: { enabled: false },
  };

  const response = await btcpayClient.post(`/stores/${BTCPAY_STORE_ID}/invoices`, payload);
  const invoice = response.data;

  return {
    success: true,
    invoiceId: invoice.id,
    checkoutUrl: `${BTCPAY_URL}/i/${invoice.id}`,
    status: invoice.status,
  };
}

/**
 * Get invoice details from BTCPay Server
 * @param {string} invoiceId
 * @returns {Promise<object>}
 */
async function getInvoice(invoiceId) {
  const response = await btcpayClient.get(`/stores/${BTCPAY_STORE_ID}/invoices/${invoiceId}`);
  return response.data;
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

module.exports = {
  createDashInvoice,
  getInvoice,
  validateWebhookSignature,
  BTCPAY_WEBHOOK_SECRET,
};
