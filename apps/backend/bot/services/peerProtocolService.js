'use strict';

/**
 * Peer Protocol Service
 *
 * Wraps the Peer Protocol API for fiat off-ramps.
 * Supported providers: Venmo, CashApp, Zelle, PayPal, Wise, Revolut.
 * Routes through Base chain, ~0.8% fee, $1 minimum.
 *
 * Required env vars:
 *   PEER_PROTOCOL_API_URL  — Base URL (e.g. https://api.peerprotocol.xyz)
 *   PEER_PROTOCOL_API_KEY  — API key for authentication
 */

const fetch = require('node-fetch');
const logger = require('../../utils/logger');

const FETCH_TIMEOUT_MS = 30_000;
const MINIMUM_PAYOUT_USD = 1.00;

const fetchWithTimeout = (url, options = {}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timeoutId));
};

/**
 * Send a fiat payout to a creator via Peer Protocol.
 * @param {Object} params
 * @param {number} params.amount     - USD amount to send
 * @param {string} params.provider   - Fiat provider (venmo, cashapp, zelle, paypal, wise, revolut)
 * @param {string} params.recipientHandle - Recipient's handle/email/phone
 * @param {string} params.creatorId  - Creator user ID for logging
 * @returns {Promise<{ success: boolean, sessionId?: string, txHash?: string, error?: string }>}
 */
const sendFiatPayout = async ({ amount, provider, recipientHandle, creatorId }) => {
  const apiUrl = process.env.PEER_PROTOCOL_API_URL;
  const apiKey = process.env.PEER_PROTOCOL_API_KEY;

  if (!apiUrl || !apiKey) {
    return { success: false, error: 'Peer Protocol API not configured (PEER_PROTOCOL_API_URL / PEER_PROTOCOL_API_KEY)' };
  }

  if (amount < MINIMUM_PAYOUT_USD) {
    return { success: false, error: `Amount $${amount} below minimum $${MINIMUM_PAYOUT_USD}` };
  }

  const VALID_PROVIDERS = ['venmo', 'cashapp', 'zelle', 'paypal', 'wise', 'revolut'];
  if (!VALID_PROVIDERS.includes(provider)) {
    return { success: false, error: `Invalid fiat provider: ${provider}` };
  }

  try {
    const response = await fetchWithTimeout(`${apiUrl}/v1/offramp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        amount: parseFloat(amount).toFixed(2),
        currency: 'USD',
        provider,
        recipient: recipientHandle,
        metadata: {
          source: 'pnptv-creator-payout',
          creatorId: String(creatorId),
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Peer Protocol offramp API error', {
        status: response.status,
        error: errorText,
        creatorId,
        provider,
      });
      return { success: false, error: `Peer Protocol API ${response.status}: ${errorText}` };
    }

    const data = await response.json();
    const sessionId = data.sessionId || data.id || null;

    logger.info('Peer Protocol fiat payout initiated', {
      creatorId,
      provider,
      amount,
      recipientHandle,
      sessionId,
    });

    return {
      success: true,
      sessionId,
      txHash: data.txHash || null,
    };
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    logger.error(isTimeout ? 'Peer Protocol request timed out' : 'Peer Protocol request failed', {
      creatorId,
      provider,
      error: err.message,
    });
    return { success: false, error: isTimeout ? 'Peer Protocol API request timed out' : err.message };
  }
};

/**
 * Check the status of a Peer Protocol payout session.
 * @param {string} sessionId - Peer Protocol session ID
 * @returns {Promise<{ success: boolean, status?: string, error?: string }>}
 */
const checkPayoutStatus = async (sessionId) => {
  const apiUrl = process.env.PEER_PROTOCOL_API_URL;
  const apiKey = process.env.PEER_PROTOCOL_API_KEY;

  if (!apiUrl || !apiKey) {
    return { success: false, error: 'Peer Protocol API not configured' };
  }

  try {
    const response = await fetchWithTimeout(`${apiUrl}/v1/offramp/${sessionId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      return { success: false, error: `Status check failed: ${response.status}` };
    }

    const data = await response.json();
    return {
      success: true,
      status: data.status,
      completedAt: data.completedAt || null,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

module.exports = {
  sendFiatPayout,
  checkPayoutStatus,
};
