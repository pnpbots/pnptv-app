const Sentry = require('@sentry/node');
const logger = require('../../../utils/logger');

/**
 * Initialize Sentry for error tracking
 */
const initSentry = () => {
  if (!process.env.SENTRY_DSN) {
    logger.warn('Sentry DSN not configured, skipping initialization');
    return;
  }

  try {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      beforeSend(event, hint) {
        // Filter out sensitive data
        if (event.user) {
          delete event.user.ip_address;
          delete event.user.email;
        }

        // Add custom context
        if (hint.originalException) {
          logger.error('Sentry capturing exception:', hint.originalException);
        }

        return event;
      },
    });

    logger.info('Sentry initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize Sentry:', error);
  }
};

module.exports = { initSentry };
