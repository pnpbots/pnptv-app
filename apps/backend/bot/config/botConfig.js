require('dotenv').config();

const logger = require('../../utils/logger');

/**
 * Bot configuration
 */
const config = {
  // Bot credentials
  botToken: process.env.BOT_TOKEN,
  botUsername: process.env.BOT_USERNAME,

  // Admin configuration
  adminIds: process.env.ADMIN_IDS
    ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim()))
    : [],

  // Server configuration
  port: process.env.PORT || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  webDomain: process.env.WEB_DOMAIN || 'https://pnptv.app',

  // Payment configuration
  payments: {
    epayco: {
      publicKey: process.env.EPAYCO_PUBLIC_KEY,
      privateKey: process.env.EPAYCO_PRIVATE_KEY,
      testMode: process.env.EPAYCO_TEST_MODE === 'true',
    },
    daimoPay: {
      apiKey: process.env.DAIMO_PAY_API_KEY,
      webhookSecret: process.env.DAIMO_PAY_WEBHOOK_SECRET,
    },
  },

  // Sentry configuration
  sentry: {
    dsn: process.env.SENTRY_DSN,
    enabled: !!process.env.SENTRY_DSN,
  },

  // Rate limiting
  rateLimit: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 10,
  },

  // Feature flags
  features: {
    liveStreams: true,

    nearbyUsers: true,
    payments: true,
  },
};

/**
 * Validate required configuration
 * @throws {Error} If required configuration is missing
 * @returns {void}
 */
function validateConfig() {
  const required = ['botToken', 'botUsername'];
  const missing = required.filter(key => !config[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }

  if (config.adminIds.length === 0) {
    logger.warn('⚠️  WARNING: No admin IDs configured. Admin features will be unavailable.');
  }

}

module.exports = {
  config,
  validateConfig,
};
