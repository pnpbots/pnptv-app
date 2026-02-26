const logger = require('../../../utils/logger');

/**
 * Get list of allowed chat IDs from environment variables
 * @returns {Set<string>} Set of allowed chat IDs
 */
const getAllowedChats = () => {
  const allowedChats = new Set();

  // Add all configured channel/group IDs
  const envKeys = [
    'PRIME_CHANNEL_ID',
    'GROUP_ID',
    'SUPPORT_GROUP_ID',
    'VIP_CHANNEL_ID',
    'MAIN_GROUP_ID',
    'CHANNEL_ID',
  ];

  envKeys.forEach((key) => {
    const value = process.env[key];
    if (value) {
      allowedChats.add(value.toString());
    }
  });

  return allowedChats;
};

/**
 * Middleware to restrict bot to allowed chats only
 * Bot will automatically leave unauthorized groups/channels
 * Private chats (DMs) are always allowed
 *
 * @returns {Function} Middleware function
 */
const allowedChatsMiddleware = () => {
  const allowedChats = getAllowedChats();

  logger.info('Allowed chats middleware initialized', {
    allowedChats: Array.from(allowedChats),
  });

  return async (ctx, next) => {
    const chatType = ctx.chat?.type;
    const chatId = ctx.chat?.id?.toString();

    // Always allow private chats (direct messages)
    if (chatType === 'private') {
      return next();
    }

    // Check if this is a group or channel
    if (chatType === 'group' || chatType === 'supergroup' || chatType === 'channel') {
      // Check if chat is in allowed list
      if (!allowedChats.has(chatId)) {
        logger.warn('Bot added to unauthorized chat, leaving...', {
          chatId,
          chatType,
          chatTitle: ctx.chat?.title,
        });

        try {
          // Send a message before leaving (optional)
          if (chatType !== 'channel') {
            await ctx.reply(
              'This bot is not authorized to operate in this group. Leaving...',
            );
          }

          // Leave the chat
          await ctx.leaveChat();

          logger.info('Bot left unauthorized chat', {
            chatId,
            chatTitle: ctx.chat?.title,
          });
        } catch (error) {
          logger.error('Error leaving unauthorized chat:', {
            chatId,
            error: error.message,
          });
        }

        // Don't process any further
        return;
      }
    }

    // Chat is allowed, continue processing
    return next();
  };
};

module.exports = allowedChatsMiddleware;
