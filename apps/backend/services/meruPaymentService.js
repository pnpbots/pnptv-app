const axios = require('axios');
const logger = require('../utils/logger');

/**
 * MeruPaymentService - Verifies Meru payments via HTTP fetch
 * Checks page content for paid/expired patterns without needing a headless browser
 */
class MeruPaymentService {
  constructor() {
    // Simple rate limiting: track recent verifications per code
    this._recentChecks = new Map(); // code -> timestamp
    this.RATE_LIMIT_MS = 10000; // 10 seconds between checks for same code
  }

  /**
   * Verifies if a Meru payment link has been paid
   * @param {string} meruCode - The link code (e.g. "abc123xyz")
   * @param {string} userLanguage - User language ('es' or 'en')
   * @returns {Promise<{isPaid: boolean, message: string}>}
   */
  async verifyPayment(meruCode, userLanguage = 'es') {
    // Rate limiting: prevent rapid repeated checks for same code
    const lastCheck = this._recentChecks.get(meruCode);
    if (lastCheck && Date.now() - lastCheck < this.RATE_LIMIT_MS) {
      logger.warn(`Rate limited: Meru code ${meruCode} checked too recently`);
      return {
        isPaid: false,
        message: 'Please wait a few seconds before checking again',
      };
    }
    this._recentChecks.set(meruCode, Date.now());

    // Clean up old entries periodically
    if (this._recentChecks.size > 100) {
      const cutoff = Date.now() - this.RATE_LIMIT_MS;
      for (const [code, ts] of this._recentChecks) {
        if (ts < cutoff) this._recentChecks.delete(code);
      }
    }

    try {
      const meruUrl = `https://pay.getmeru.com/${meruCode}`;
      logger.info(`Verifying Meru payment link: ${meruUrl}`);

      const response = await axios.get(meruUrl, {
        timeout: 15000,
        headers: {
          'Accept-Language': userLanguage === 'en'
            ? 'en-US,en;q=0.9,es;q=0.8'
            : 'es-ES,es;q=0.9,en;q=0.8',
          'User-Agent': 'Mozilla/5.0 (compatible; PNPtv/2.0)',
        },
        maxRedirects: 5,
      });

      const pageContent = typeof response.data === 'string' ? response.data : '';

      logger.info(`Meru page loaded for code ${meruCode}`, {
        contentLength: pageContent.length,
        status: response.status,
      });

      // Detect if already paid — check both languages
      const paidPatterns = [
        'El enlace de pago ha caducado o ya ha sido pagado',
        'El link de pago ha caducado',
        'ya ha sido pagado',
        'Payment link expired or already paid',
        'payment link has expired',
        'already paid',
        'expired',
      ];

      const isPaid = paidPatterns.some(
        (pattern) => pageContent.toLowerCase().includes(pattern.toLowerCase())
      );

      logger.info(`Payment verification for ${meruCode}: isPaid=${isPaid}`);

      return {
        isPaid,
        message: isPaid
          ? 'Payment link already used or expired'
          : 'Payment link is still active',
      };
    } catch (error) {
      logger.error(`Error verifying Meru payment for ${meruCode}:`, error.message);
      return {
        isPaid: false,
        message: `Error checking payment: ${error.message}`,
      };
    }
  }
}

// Singleton
const meruPaymentService = new MeruPaymentService();

module.exports = meruPaymentService;
