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

    epaycoClient = epayco({
      apiKey: process.env.EPAYCO_PUBLIC_KEY,
      privateKey: process.env.EPAYCO_PRIVATE_KEY,
      lang: 'ES',
      test: process.env.EPAYCO_TEST_MODE === 'true',
    });

    // Nunca loggear claves o datos sensibles
    logger.info('ePayco SDK initialized successfully', {
      test: process.env.EPAYCO_TEST_MODE === 'true',
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
