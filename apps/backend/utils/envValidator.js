// Load environment variables first
require('dotenv-safe').config({ allowEmptyValues: true });

const logger = require('./logger');

/**
 * Environment Variable Validator
 * Ensures all required environment variables are set
 */

const REQUIRED_ENV_VARS = [
  'BOT_TOKEN',
  'BOT_USERNAME',
  'REDIS_HOST',
  'REDIS_PORT',
];

const OPTIONAL_ENV_VARS = [
  'BOT_WEBHOOK_DOMAIN',
  'BOT_WEBHOOK_PATH',
  'PORT',
  'NODE_ENV',
  'REDIS_PASSWORD',
  'REDIS_DB',
  'REDIS_TTL',
  'EPAYCO_PUBLIC_KEY',
  'EPAYCO_PRIVATE_KEY',
  'EPAYCO_P_CUST_ID',
  'EPAYCO_P_KEY',
  'EPAYCO_TEST_MODE',
  'DAIMO_API_KEY',
  'DAIMO_WEBHOOK_SECRET',
  'SENTRY_DSN',
  'OPENAI_API_KEY',
];

const ENV_VAR_GROUPS = {
  payment_epayco: ['EPAYCO_PUBLIC_KEY', 'EPAYCO_PRIVATE_KEY'],
  payment_daimo: ['DAIMO_API_KEY', 'DAIMO_WEBHOOK_SECRET'],
  monitoring: ['SENTRY_DSN'],
  ai: ['OPENAI_API_KEY'],
};

/**
 * Validate environment variables
 * @param {boolean} [strict=true] - If true, throw error on missing required vars
 * @returns {{valid: boolean, missing: string[], warnings: string[], configured: string[]}} Validation result
 */
function validateEnv(strict = true) {
  const missing = [];
  const warnings = [];
  const configured = [];

  // Check required variables
  REQUIRED_ENV_VARS.forEach((varName) => {
    if (!process.env[varName]) {
      missing.push(varName);
    } else {
      configured.push(varName);
    }
  });

  // Check optional variable groups
  Object.entries(ENV_VAR_GROUPS).forEach(([groupName, vars]) => {
    const groupConfigured = vars.filter((v) => process.env[v]);
    const groupMissing = vars.filter((v) => !process.env[v]);

    if (groupConfigured.length > 0 && groupMissing.length > 0) {
      warnings.push(`Partial configuration for ${groupName}: missing ${groupMissing.join(', ')}`);
    }
  });

  // Log results
  if (missing.length > 0) {
    const errorMsg = `Missing required environment variables: ${missing.join(', ')}`;
    logger.error(errorMsg);
    if (strict) {
      throw new Error(errorMsg);
    }
  }

  if (warnings.length > 0) {
    warnings.forEach((warning) => logger.warn(warning));
  }

  logger.info('Environment validation complete', {
    required: REQUIRED_ENV_VARS.length,
    configured: configured.length,
    missing: missing.length,
    warnings: warnings.length,
  });

  return {
    valid: missing.length === 0,
    missing,
    warnings,
    configured,
  };
}

/**
 * Get environment variable with validation
 * @param {string} key - Environment variable name
 * @param {string|null} [defaultValue=null] - Default value if not set
 * @param {boolean} [required=false] - If true, throw error if not set
 * @returns {string|null} Environment variable value or default
 */
function getEnv(key, defaultValue = null, required = false) {
  const value = process.env[key];

  if (!value) {
    if (required) {
      throw new Error(`Required environment variable ${key} is not set`);
    }
    return defaultValue;
  }

  return value;
}

/**
 * Check if a feature is enabled based on environment variables
 * @param {string} feature - Feature name (epayco, daimo, sentry, openai)
 * @returns {boolean} True if feature is configured
 */
function isFeatureEnabled(feature) {
  const featureMap = {
    epayco: ENV_VAR_GROUPS.payment_epayco,
    daimo: ENV_VAR_GROUPS.payment_daimo,
    sentry: ENV_VAR_GROUPS.monitoring,
    openai: ENV_VAR_GROUPS.ai,
  };

  const requiredVars = featureMap[feature];
  if (!requiredVars) {
    return false;
  }

  return requiredVars.every((varName) => process.env[varName]);
}

/**
 * Print environment configuration summary
 * @returns {void}
 */
function printEnvSummary() {
  console.log('\n=== Environment Configuration ===');
  console.log(`Node Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Bot Username: ${process.env.BOT_USERNAME || 'NOT SET'}`);
  console.log(`Webhook Mode: ${process.env.BOT_WEBHOOK_DOMAIN ? 'Yes' : 'No (polling)'}`);
  console.log(`Redis: ${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`);
  console.log('\nFeature Configuration:');
  console.log(`  - ePayco Payments: ${isFeatureEnabled('epayco') ? '✓' : '✗'}`);
  console.log(`  - Daimo Payments: ${isFeatureEnabled('daimo') ? '✓' : '✗'}`);
  console.log(`  - Sentry Monitoring: ${isFeatureEnabled('sentry') ? '✓' : '✗'}`);
  console.log(`  - OpenAI Integration: ${isFeatureEnabled('openai') ? '✓' : '✗'}`);
  console.log('================================\n');
}

module.exports = {
  validateEnv,
  getEnv,
  isFeatureEnabled,
  printEnvSummary,
  REQUIRED_ENV_VARS,
  OPTIONAL_ENV_VARS,
};
