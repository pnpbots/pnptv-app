const Sentry = require('@sentry/node');
const logger = require('../../../utils/logger');
const { t } = require('../../../utils/i18n');

/**
 * Error handling middleware
 * @param {Error} error - Error object
 * @param {Object} ctx - Telegraf context
 */
const errorHandler = async (error, ctx) => {
  try {
    const userId = ctx.from?.id;
    const username = ctx.from?.username;
    const lang = ctx.session?.language || 'en';

    // Log error
    logger.error('Bot error:', {
      error: error.message,
      stack: error.stack,
      userId,
      username,
      update: ctx.update,
    });

    // Send to Sentry with context
    Sentry.captureException(error, {
      user: {
        id: userId,
        username,
      },
      extra: {
        update: ctx.update,
        session: ctx.session,
      },
    });

    // Send user-friendly error message
    const errorMessage = t('error', lang);

    try {
      // Check if this is a Telegram API error (chat not found, bot blocked, etc.)
      if (error.message && (error.message.includes('chat not found') || error.message.includes('Bad Request'))) {
        logger.warn('Telegram API error - chat not available', {
          error: error.message,
          userId: ctx.from?.id,
          chatId: ctx.chat?.id
        });
        // Don't try to send message if chat is not available
        return;
      }

      await ctx.reply(`❌ ${errorMessage}\n\nPlease try again or use /support for assistance.`);
    } catch (replyError) {
      // If we can't send the error message, log it but don't create a cascade of errors
      if (replyError.message && replyError.message.includes('chat not found')) {
        logger.warn('Cannot send error message - chat not found', {
          userId: ctx.from?.id,
          chatId: ctx.chat?.id
        });
      } else {
        logger.error('Failed to send error message to user:', replyError);
      }
    }
  } catch (handlerError) {
    logger.error('Error in error handler:', handlerError);
  }
};

module.exports = errorHandler;
