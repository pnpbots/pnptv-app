const logger = require('../utils/logger');
const https = require('https');

/**
 * MeruPaymentService - Verifies Meru payments via __NEXT_DATA__ JSON parsing
 * Meru is a Next.js SPA that embeds payment state in server-rendered props.
 * We parse the JSON to check status === 'PAID' and paidAt !== null.
 */
class MeruPaymentService {
  constructor() {
    this._recentChecks = new Map();
    this.RATE_LIMIT_MS = 10000;
  }

  /**
   * Fetch page HTML via native https (no axios dependency needed)
   */
  _fetchPage(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; PNPtv/2.0)',
        },
        timeout: 15000,
      }, (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this._fetchPage(res.headers.location).then(resolve).catch(reject);
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    });
  }

  /**
   * Verifies if a Meru payment link has been paid by parsing __NEXT_DATA__ props
   * @param {string} meruCode - The link code (e.g. "abc123xyz")
   * @param {string} userLanguage - User language ('es' or 'en') — unused now but kept for API compat
   * @returns {Promise<{isPaid: boolean, message: string, meruStatus?: string, paidAt?: string}>}
   */
  async verifyPayment(meruCode, userLanguage = 'es') {
    const lastCheck = this._recentChecks.get(meruCode);
    if (lastCheck && Date.now() - lastCheck < this.RATE_LIMIT_MS) {
      logger.warn(`Rate limited: Meru code ${meruCode} checked too recently`);
      return { isPaid: false, message: 'Please wait a few seconds before checking again' };
    }
    this._recentChecks.set(meruCode, Date.now());

    if (this._recentChecks.size > 100) {
      const cutoff = Date.now() - this.RATE_LIMIT_MS;
      for (const [code, ts] of this._recentChecks) {
        if (ts < cutoff) this._recentChecks.delete(code);
      }
    }

    try {
      const meruUrl = `https://pay.getmeru.com/${meruCode}`;
      logger.info(`Verifying Meru payment link: ${meruUrl}`);

      const { statusCode, body } = await this._fetchPage(meruUrl);

      logger.info(`Meru page loaded for code ${meruCode}`, {
        contentLength: body.length,
        status: statusCode,
      });

      // Extract __NEXT_DATA__ JSON from the page
      const nextDataMatch = body.match(/__NEXT_DATA__[^>]*>(.*?)<\/script>/s);
      if (!nextDataMatch) {
        logger.error(`Could not find __NEXT_DATA__ in Meru page for ${meruCode}`);
        return { isPaid: false, message: 'Could not parse Meru page — __NEXT_DATA__ not found' };
      }

      let nextData;
      try {
        nextData = JSON.parse(nextDataMatch[1]);
      } catch (parseErr) {
        logger.error(`Failed to parse __NEXT_DATA__ JSON for ${meruCode}:`, parseErr.message);
        return { isPaid: false, message: 'Could not parse Meru page data' };
      }

      const paymentLink = nextData?.props?.pageProps?.paymentLink;
      if (!paymentLink) {
        logger.warn(`No paymentLink in __NEXT_DATA__ for ${meruCode} — link may not exist`);
        return { isPaid: false, message: 'Payment link not found on Meru' };
      }

      const meruStatus = paymentLink.status; // "CREATED", "PAID", "EXPIRED", etc.
      const paidAt = paymentLink.paidAt;
      const isPaid = meruStatus === 'PAID' && paidAt !== null;

      logger.info(`Meru payment verification for ${meruCode}`, {
        meruStatus,
        paidAt,
        isPaid,
      });

      return {
        isPaid,
        message: isPaid
          ? `Payment confirmed (paid at ${paidAt})`
          : `Payment not completed (status: ${meruStatus})`,
        meruStatus,
        paidAt,
      };
    } catch (error) {
      logger.error(`Error verifying Meru payment for ${meruCode}:`, error.message);
      return { isPaid: false, message: `Error checking payment: ${error.message}` };
    }
  }
}

// Singleton
const meruPaymentService = new MeruPaymentService();

module.exports = meruPaymentService;
