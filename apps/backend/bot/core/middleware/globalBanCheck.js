const ModerationModel = require('../../../models/moderationModel');
const UserModel = require('../../../models/userModel');
const logger = require('../../../utils/logger');

/**
 * Global ban check middleware
 * Blocks banned users from using the bot entirely
 * Checks both the banned_users table AND the users.tier='banned' column
 * @returns {Function} Middleware function
 */
const globalBanCheck = () => async (ctx, next) => {
  try {
    const userId = ctx.from?.id;

    // Skip if no user ID (system messages, etc.)
    if (!userId) {
      return next();
    }

    // Check tier-based ban first (fast, single row lookup from cache)
    const user = await UserModel.getById(userId);
    const tierBanned = user && user.tier === 'banned';

    // Also check the banned_users table (legacy/moderation bans)
    const isBanned = tierBanned || await ModerationModel.isUserBanned(userId, 'global');

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
