const { getAddress } = require('viem');
const crypto = require('crypto');
const { DAIMO_API_BASE, OPTIMISM_USDC_ADDRESS, OPTIMISM_CHAIN_ID } = require('../config/daimo');
const logger = require('../utils/logger');

/**
 * Daimo Pay Service — RETIRED (kept for in-flight settlement + creator payouts)
 *
 * No new Daimo sessions are created (all checkout surfaces moved to Dash via
 * BTCPay). This file remains imported by:
 *   - apps/backend/bot/api/controllers/webhookController.js  (settlement of any
 *     straggler webhook + refund flows)
 *   - apps/backend/services/creatorPayoutService.js          (USDC outbound to
 *     creators — pending business decision to switch to Dash or pause)
 *
 * Do not extend. New crypto integrations should target the BTCPay/Dash stack.
 */
class DaimoService {
  constructor() {
    // Configuration
    this.treasuryAddress = process.env.DAIMO_TREASURY_ADDRESS;
    this.refundAddress = process.env.DAIMO_REFUND_ADDRESS;
    this.webhookSecret = process.env.DAIMO_WEBHOOK_SECRET;
    this.webhookHmacSecret = process.env.DAIMO_WEBHOOK_HMAC_SECRET;
    this.apiKey = process.env.DAIMO_API_KEY;

    // API base URL
    this.apiBase = DAIMO_API_BASE;

    // Optimism USDC configuration (hardcoded, no @daimo/pay-common dependency)
    this.chain = {
      id: OPTIMISM_CHAIN_ID, // 10 = Optimism
      name: 'Optimism',
      token: getAddress(OPTIMISM_USDC_ADDRESS),
      tokenSymbol: 'USDC',
    };

    logger.info('Daimo Service initialized', {
      chain: this.chain.name,
      chainId: this.chain.id,
      token: this.chain.tokenSymbol,
      apiBase: this.apiBase,
    });
  }



  /**
   * Verify webhook signature from Daimo.
   * Supports two modes:
   * 1. HMAC-SHA256 via Daimo-Signature header (new API — preferred)
   * 2. Bearer token via Authorization header (legacy — deprecated)
   *
   * @param {string} signatureOrAuthHeader - Daimo-Signature header (HMAC) or Authorization header (legacy)
   * @param {Buffer|string|null} rawBody - Raw request body (required for HMAC, unused for legacy)
   * @returns {boolean} True if authorization is valid
   */
  verifyWebhookSignature(signatureOrAuthHeader, rawBody) {
    const DaimoConfig = require('../config/daimo');

    try {
      // Path 1: HMAC-SHA256 (new API) — uses Daimo-Signature header
      // Read fresh from env to avoid stale singleton after hot-reload
      const hmacSecret = process.env.DAIMO_WEBHOOK_HMAC_SECRET || this.webhookHmacSecret;
      if (hmacSecret && signatureOrAuthHeader && signatureOrAuthHeader.includes('t=') && signatureOrAuthHeader.includes('v1=')) {
        const result = DaimoConfig.verifyWebhookSignature(signatureOrAuthHeader, rawBody, hmacSecret);
        if (!result.valid) {
          logger.error('Daimo HMAC webhook verification failed', { reason: result.reason });
        }
        return result.valid;
      }

      // Path 2: Legacy Bearer token — deprecated
      if (this.webhookSecret && signatureOrAuthHeader) {
        logger.warn('Using deprecated Bearer token Daimo webhook verification — migrate to HMAC-SHA256');

        let receivedToken = signatureOrAuthHeader;
        if (signatureOrAuthHeader.startsWith('Basic ')) {
          receivedToken = signatureOrAuthHeader.substring(6);
        } else if (signatureOrAuthHeader.startsWith('Bearer ')) {
          receivedToken = signatureOrAuthHeader.substring(7);
        }

        const normalize = (t) => t.startsWith('0x') ? t.slice(2) : t;
        const normalizedReceived = normalize(receivedToken);
        const normalizedExpected = normalize(this.webhookSecret);

        try {
          const receivedBuf = Buffer.from(normalizedReceived, 'utf8');
          const expectedBuf = Buffer.from(normalizedExpected, 'utf8');
          return crypto.timingSafeEqual(receivedBuf, expectedBuf);
        } catch {
          logger.error('Daimo webhook token length mismatch');
          return false;
        }
      }

      logger.warn('Daimo webhook secret not configured — cannot verify');
      return false;
    } catch (error) {
      logger.error('Error verifying Daimo webhook authorization:', error);
      return false;
    }
  }

  /**
   * Parse and validate Daimo webhook event.
   * Supports v3 envelope, v2 nested, and legacy flat formats via normalizeDaimoPayload.
   * @param {Object} event - Webhook event data
   * @returns {Object} Parsed event data
   */
  parseWebhookEvent(event) {
    try {
      const DaimoConfig = require('../config/daimo');
      const normalized = DaimoConfig.normalizeDaimoPayload(event);

      if (!normalized.eventId || !normalized.status) {
        throw new Error('Invalid webhook event: missing id or status');
      }

      const paymentDetails = {
        eventId: normalized.eventId,
        status: normalized.status,
        payerAddress: normalized.source?.payerAddress,
        txHash: normalized.source?.txHash,
        chainId: normalized.source?.chainId,
        amountUnits: normalized.source?.amountUnits,
        tokenSymbol: normalized.source?.tokenSymbol,
      };

      const destinationDetails = {
        toAddress: normalized.destination?.address || normalized.destination?.toAddress,
        toChain: normalized.destination?.chainId || normalized.destination?.toChain,
        toToken: normalized.destination?.tokenAddress || normalized.destination?.toToken,
      };

      const customMetadata = {
        userId: normalized.metadata?.userId,
        chatId: normalized.metadata?.chatId,
        planId: normalized.metadata?.planId,
        paymentId: normalized.metadata?.paymentId,
      };

      logger.info('Daimo webhook event parsed', {
        eventId: normalized.eventId,
        format: normalized.format,
        status: normalized.status,
        paymentId: customMetadata.paymentId,
      });

      return {
        ...paymentDetails,
        ...destinationDetails,
        metadata: customMetadata,
      };
    } catch (error) {
      logger.error('Error parsing Daimo webhook event:', {
        error: error.message,
        event,
      });
      throw error;
    }
  }

  /**
   * Convert Daimo amountUnits to USD amount.
   * Daimo Pay API returns amountUnits in human-readable format (e.g., "14.99")
   * via viem's formatUnits() — NOT in smallest token units.
   * @param {string} amountUnits - USDC amount from Daimo (human-readable, e.g., "14.99")
   * @returns {number} USD amount
   */
  convertUSDCToUSD(amountUnits) {
    try {
      const value = parseFloat(amountUnits);
      if (isNaN(value) || value < 0) return 0;
      // amountUnits is already human-readable via Daimo's formatUnits()
      return value;
    } catch (error) {
      logger.error('Error converting USDC to USD:', error);
      return 0;
    }
  }

  /**
   * Get payment status description
   * @param {string} status - Daimo payment status
   * @returns {string} Human-readable status
   */
  getStatusDescription(status) {
    const statusMap = {
      // Legacy statuses
      payment_unpaid: 'Pendiente',
      payment_started: 'Iniciado',
      payment_completed: 'Completado',
      payment_bounced: 'Rechazado/Devuelto',
      payment_refunded: 'Reembolsado',
      // New Sessions API statuses
      requires_payment_method: 'Pendiente',
      waiting_payment: 'Esperando Pago',
      processing: 'Procesando',
      succeeded: 'Completado',
      bounced: 'Rechazado/Devuelto',
      expired: 'Expirado',
    };

    return statusMap[status] || status;
  }

  /**
   * Check if Daimo is properly configured
   * @returns {boolean} True if configured
   */
  isConfigured() {
    // refundAddress is optional — getDaimoConfig() falls back to treasury
    const isConfigured = !!(
      this.treasuryAddress &&
      this.apiKey
    );

    if (!isConfigured) {
      logger.warn('Daimo not fully configured', {
        hasTreasury: !!this.treasuryAddress,
        hasRefund: !!this.refundAddress,
        hasApiKey: !!this.apiKey,
      });
    }

    return isConfigured;
  }
}

// Export singleton instance
module.exports = new DaimoService();
