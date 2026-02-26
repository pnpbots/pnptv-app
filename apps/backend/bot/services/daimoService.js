const { optimismUSDC } = require('@daimo/pay-common');
const { getAddress } = require('viem');
const crypto = require('crypto');
const { SUPPORTED_PAYMENT_APPS } = require('../../config/daimo');
const logger = require('../../utils/logger');

/**
 * Daimo Pay Service
 * Handles payment generation and processing with Daimo Pay
 * - Network: Optimism (low fees, fast finality)
 * - Token: USDC (stablecoin 1:1 with USD)
 * - Payment Apps: CashApp, Venmo, Zelle, Wise, Revolut, MercadoPago, Coinbase, Binance, MiniPay
 */
class DaimoService {
  constructor() {
    // Configuration
    this.treasuryAddress = process.env.DAIMO_TREASURY_ADDRESS;
    this.refundAddress = process.env.DAIMO_REFUND_ADDRESS;
    this.webhookSecret = process.env.DAIMO_WEBHOOK_SECRET;
    this.apiKey = process.env.DAIMO_API_KEY;

    // Supported payment apps (prioritized in UI)
    this.supportedPaymentApps = [...SUPPORTED_PAYMENT_APPS];

    // Optimism USDC configuration
    this.chain = {
      id: optimismUSDC.chainId, // 10 = Optimism
      name: 'Optimism',
      token: getAddress(optimismUSDC.token),
      tokenSymbol: 'USDC',
    };

    logger.info('Daimo Service initialized', {
      chain: this.chain.name,
      chainId: this.chain.id,
      token: this.chain.tokenSymbol,
      supportedApps: this.supportedPaymentApps,
    });
  }



  /**
   * Verify webhook authorization from Daimo
   * Daimo uses Authorization: Basic <token> header for webhook verification
   * @param {Object} payload - Webhook payload (unused but kept for API compatibility)
   * @param {string} authHeader - Authorization header value (can be from x-daimo-signature or Authorization)
   * @returns {boolean} True if authorization is valid
   */
  verifyWebhookSignature(payload, authHeader) {
    try {
      if (!this.webhookSecret) {
        logger.warn('Daimo webhook secret not configured, skipping authorization verification');
        return true; // Allow in development, but log warning
      }

      if (!authHeader) {
        logger.error('Missing Daimo webhook authorization');
        return false;
      }

      // Daimo sends Authorization: Basic <token>
      // Extract token if it has "Basic " prefix
      let receivedToken = authHeader;
      if (authHeader.startsWith('Basic ')) {
        receivedToken = authHeader.substring(6);
      }

      // Compare tokens using timing-safe comparison
      const expectedToken = this.webhookSecret;

      try {
        const isValid = crypto.timingSafeEqual(
          Buffer.from(receivedToken),
          Buffer.from(expectedToken)
        );

        if (!isValid) {
          logger.error('Invalid Daimo webhook authorization token', {
            receivedLength: receivedToken.length,
            expectedLength: expectedToken.length,
          });
        }

        return isValid;
      } catch (bufferError) {
        // If buffer lengths don't match, timingSafeEqual throws
        logger.error('Daimo webhook token length mismatch', {
          receivedLength: receivedToken.length,
          expectedLength: expectedToken.length,
        });
        return false;
      }
    } catch (error) {
      logger.error('Error verifying Daimo webhook authorization:', error);
      return false;
    }
  }

  /**
   * Parse and validate Daimo webhook event
   * @param {Object} event - Webhook event data
   * @returns {Object} Parsed event data
   */
  parseWebhookEvent(event) {
    try {
      // Normalize: Daimo Pay v2 nests data under `payment` object
      let normalizedEvent;
      if (event.payment && typeof event.payment === 'object') {
        normalizedEvent = {
          id: event.payment.id || event.paymentId,
          status: event.payment.status || event.type,
          source: event.payment.source,
          destination: event.payment.destination,
          metadata: event.payment.metadata,
        };
      } else {
        normalizedEvent = event;
      }

      const {
        id,
        status,
        source,
        destination,
        metadata,
      } = normalizedEvent;

      // Validate required fields
      if (!id || !status) {
        throw new Error('Invalid webhook event: missing id or status');
      }

      // Parse source (payment details)
      const paymentDetails = {
        eventId: id,
        status,
        payerAddress: source?.payerAddress,
        txHash: source?.txHash,
        chainId: source?.chainId,
        amountUnits: source?.amountUnits,
        tokenSymbol: source?.tokenSymbol,
      };

      // Parse destination
      const destinationDetails = {
        toAddress: destination?.toAddress,
        toChain: destination?.toChain,
        toToken: destination?.toToken,
      };

      // Parse metadata (our custom data)
      const customMetadata = {
        userId: metadata?.userId,
        chatId: metadata?.chatId,
        planId: metadata?.planId,
        paymentId: metadata?.paymentId,
      };

      logger.info('Daimo webhook event parsed', {
        eventId: id,
        status,
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
   * Convert USDC units to USD amount
   * @param {string} usdcUnits - USDC units (6 decimals)
   * @returns {number} USD amount
   */
  convertUSDCToUSD(usdcUnits) {
    try {
      const units = parseFloat(usdcUnits);
      return units / 1000000; // USDC has 6 decimals
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
      payment_unpaid: 'Pendiente',
      payment_started: 'Iniciado',
      payment_completed: 'Completado',
      payment_bounced: 'Rechazado/Devuelto',
      payment_refunded: 'Reembolsado',
    };

    return statusMap[status] || status;
  }

  /**
   * Check if Daimo is properly configured
   * @returns {boolean} True if configured
   */
  isConfigured() {
    const isConfigured = !!(
      this.treasuryAddress &&
      this.refundAddress &&
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
