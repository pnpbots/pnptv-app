const epayco = require('epayco-sdk-node');
const logger = require('../utils/logger');

let epaycoClient = null;

/**
 * Initialize ePayco SDK
 * @returns {Object} ePayco client instance
 */
const initializeEpayco = () => {
  try {
    if (epaycoClient) {
      return epaycoClient;
    }

    if (!process.env.EPAYCO_PUBLIC_KEY || !process.env.EPAYCO_PRIVATE_KEY) {
      throw new Error('ePayco credentials not configured. Please set EPAYCO_PUBLIC_KEY and EPAYCO_PRIVATE_KEY');
    }

    const testMode = process.env.EPAYCO_TEST_MODE === 'true';

    // L2: In production, hard-fail if ePayco is left in test mode. A silently
    // test-mode production would accept test cards and record fake transactions,
    // which is catastrophic for financial reconciliation.
    if (process.env.NODE_ENV === 'production' && testMode) {
      throw new Error(
        'ePayco is in TEST mode but NODE_ENV=production. Set EPAYCO_TEST_MODE=false before booting.',
      );
    }

    // H3: Warn if the USD→COP conversion rate is falling back to its hardcoded
    // default. The rate is used to compute the expected webhook amount, so a
    // stale default silently overcharges or undercharges users compared to
    // what the checkout UI displays.
    if (!process.env.EPAYCO_USD_TO_COP) {
      logger.warn('EPAYCO_USD_TO_COP not set — falling back to hardcoded 4000 COP/USD. ' +
        'This value should be refreshed from a live FX source; add EPAYCO_USD_TO_COP to .env.production.');
    }

    // Paper trail for the HMAC header verification path. This fires at boot,
    // not on every webhook, so we can detect misconfiguration during deploy
    // without polluting webhook logs.
    if (process.env.EPAYCO_REQUIRE_HMAC === 'true') {
      logger.info('ePayco webhook signature verification: strict HMAC header mode enabled');
    }

    epaycoClient = epayco({
      apiKey: process.env.EPAYCO_PUBLIC_KEY,
      privateKey: process.env.EPAYCO_PRIVATE_KEY,
      lang: 'ES',
      test: testMode,
    });

    // Nunca loggear claves o datos sensibles
    logger.info('ePayco SDK initialized successfully', {
      test: testMode,
      // No incluir claves ni datos sensibles en logs
    });

    return epaycoClient;
  } catch (error) {
    logger.error('Failed to initialize ePayco SDK:', error);
    throw error;
  }
};

/**
 * Get ePayco client instance
 * @returns {Object} ePayco client
 */
const getEpaycoClient = () => {
  if (!epaycoClient) {
    return initializeEpayco();
  }
  return epaycoClient;
};

module.exports = {
  initializeEpayco,
  getEpaycoClient,
};
