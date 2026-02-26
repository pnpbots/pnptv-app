const ModerationModel = require('../../../models/moderationModel');
const logger = require('../../../utils/logger');

/**
 * Global ban check middleware
 * Blocks banned users from using the bot entirely
 * @returns {Function} Middleware function
 */
const globalBanCheck = () => async (ctx, next) => {
  try {
    const userId = ctx.from?.id;

    // Skip if no user ID (system messages, etc.)
    if (!userId) {
      return next();
    }

    // Check if user is globally banned
    const isBanned = await ModerationModel.isUserBanned(userId, 'global');

    if (isBanned) {
      logger.info('Blocked banned user from using bot', { userId });

      // Only respond in private chats to avoid spam in groups
      if (ctx.chat?.type === 'private') {
        try {
          await ctx.reply(
            '⛔ **Acceso Denegado**\n\n' +
            'Tu cuenta ha sido suspendida y no puedes usar este bot.\n\n' +
            'Si crees que esto es un error, contacta al soporte.',
            { parse_mode: 'Markdown' }
          );
        } catch (replyError) {
          logger.debug('Could not send ban message to user:', replyError.message);
        }
      }

      // Don't call next() - stop processing for banned users
      return;
    }

    return next();
  } catch (error) {
    logger.error('Error in global ban check middleware:', error);
    // On error, allow through to avoid blocking legitimate users
    return next();
  }
};

module.exports = globalBanCheck;
