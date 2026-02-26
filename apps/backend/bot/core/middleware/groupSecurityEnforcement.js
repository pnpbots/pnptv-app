const logger = require('../../../utils/logger');

/**
 * Group/Channel Security Enforcement Middleware
 * Prevents bot from being added to unauthorized groups/channels
 * Only allows bot in whitelisted chats defined in .env
 */
function groupSecurityEnforcementMiddleware() {
  return async (ctx, next) => {
    try {
      const chatId = ctx.chat?.id;
      const chatType = ctx.chat?.type;
      const chatTitle = ctx.chat?.title || ctx.chat?.first_name || 'Unknown';

      // Get authorized chat IDs from environment
      const primeChannelId = process.env.PRIME_CHANNEL_ID;
      const groupId = process.env.GROUP_ID;
      const supportGroupId = process.env.SUPPORT_GROUP_ID;

      const authorizedChats = [
        primeChannelId,
        groupId,
        supportGroupId,
      ].filter(Boolean).map(id => String(id));

      const chatIdStr = String(chatId);

      // Private chats are always allowed
      if (chatType === 'private') {
        return next();
      }

      // Check if chat is authorized
      if (!authorizedChats.includes(chatIdStr)) {
        logger.warn('🚨 Unauthorized group/channel access attempt', {
          chatId: chatIdStr,
          chatType,
          chatTitle,
          userId: ctx.from?.id,
          username: ctx.from?.username,
        });

        // Leave unauthorized group/channel immediately
        try {
          await ctx.telegram.leaveChat(chatId);
          logger.info('Bot left unauthorized chat', {
            chatId: chatIdStr,
            chatTitle,
          });
        } catch (error) {
          // Ignore "chat not found" errors - bot is already removed
          if (error.response?.error_code === 400 &&
              (error.response?.description?.includes('chat not found') ||
               error.response?.description?.includes('not a member'))) {
            logger.debug('Bot already removed from chat', { chatId: chatIdStr });
          } else {
            logger.error('Error leaving unauthorized chat:', {
              chatId: chatIdStr,
              error: error.message,
              description: error.response?.description
            });
          }
        }

        return; // Stop processing
      }

      // Chat is authorized, proceed normally
      logger.debug('Authorized chat access', {
        chatId: chatIdStr,
        chatTitle,
        chatType,
      });

      return next();
    } catch (error) {
      logger.error('Error in group security enforcement middleware:', error);
      return next(); // Don't block on error, but log it
    }
  };
}

/**
 * Handle my_chat_member updates (when bot is added/removed from groups)
 * Enforces strict control over bot additions
 */
function registerGroupSecurityHandlers(bot) {
  // Get authorized chat IDs from environment
  const primeChannelId = process.env.PRIME_CHANNEL_ID;
  const groupId = process.env.GROUP_ID;
  const supportGroupId = process.env.SUPPORT_GROUP_ID;

  const authorizedChats = [
    primeChannelId,
    groupId,
    supportGroupId,
  ].filter(Boolean).map(id => String(id));

  /**
   * Handle my_chat_member updates - bot added/removed from group
   */
  bot.on('my_chat_member', async (ctx) => {
    try {
      const newStatus = ctx.myChatMember?.new_chat_member?.status;
      const oldStatus = ctx.myChatMember?.old_chat_member?.status;
      const chatId = ctx.chat?.id;
      const chatType = ctx.chat?.type;
      const chatTitle = ctx.chat?.title || 'Unknown';
      const chatIdStr = String(chatId);

      logger.info('Bot status changed in chat', {
        chatId: chatIdStr,
        chatTitle,
        chatType,
        oldStatus,
        newStatus,
      });

      // If bot was added to a group/channel
      if (['member', 'administrator'].includes(newStatus)) {
        // Skip check for private chats
        if (chatType === 'private') {
          logger.debug('Bot added to private chat (allowed)');
          return;
        }

        // Check if chat is authorized
        if (!authorizedChats.includes(chatIdStr)) {
          logger.error('🚨 Bot added to UNAUTHORIZED chat - LEAVING IMMEDIATELY', {
            chatId: chatIdStr,
            chatTitle,
            chatType,
            authorizedChats,
          });

          try {
            // Try to notify in the chat before leaving
            try {
              await ctx.reply(
                '❌ Security Policy Violation\n\n' +
                'This bot can only be added to authorized groups and channels.\n' +
                'Adding it to other chats is not permitted.\n\n' +
                'Bot is leaving this chat now.'
              );
            } catch (e) {
              // Message send failed, that's ok - we're leaving anyway
            }

            // Leave the unauthorized chat
            await ctx.telegram.leaveChat(chatId);
            logger.info('✅ Bot left unauthorized chat', {
              chatId: chatIdStr,
              chatTitle,
            });
          } catch (error) {
            // Ignore "chat not found" errors - bot is already removed
            if (error.response?.error_code === 400 &&
                (error.response?.description?.includes('chat not found') ||
                 error.response?.description?.includes('not a member'))) {
              logger.debug('Bot already removed from chat', { chatId: chatIdStr });
            } else {
              logger.error('Error leaving unauthorized chat:', {
                chatId: chatIdStr,
                error: error.message,
                description: error.response?.description
              });
            }
          }

          return;
        }

        // Chat is authorized
        logger.info('✅ Bot added to authorized chat', {
          chatId: chatIdStr,
          chatTitle,
          chatType,
        });

        // Send welcome message in authorized chats
        try {
          const welcomeMsg =
            `✅ Bot security verification passed\n\n` +
            `Chat: ${chatTitle}\n` +
            `Type: ${chatType}\n` +
            `Status: Authorized & Active`;

          await ctx.reply(welcomeMsg, {
            parse_mode: 'Markdown',
          });

          // Log successful addition
          logger.info('✅ Welcome message sent to authorized chat', {
            chatId: chatIdStr,
            chatTitle,
          });
        } catch (error) {
          logger.error('Error sending welcome message:', error);
        }
      }

      // If bot was removed from a group
      if (newStatus === 'left' || newStatus === 'kicked') {
        logger.info('Bot removed from chat', {
          chatId: chatIdStr,
          chatTitle,
          reason: newStatus,
        });
      }
    } catch (error) {
      logger.error('Error handling my_chat_member update:', error);
    }
  });

  /**
   * Handle group_chat_created - bot added to new group
   */
  bot.on('group_chat_created', async (ctx) => {
    const chatId = ctx.chat?.id;
    const chatTitle = ctx.chat?.title || 'New Group';
    const chatIdStr = String(chatId);

    logger.warn('🚨 Bot added to NEW GROUP - checking authorization', {
      chatId: chatIdStr,
      chatTitle,
    });

    if (!authorizedChats.includes(chatIdStr)) {
      logger.error('🚨 Group not authorized - LEAVING', {
        chatId: chatIdStr,
        chatTitle,
      });

      try {
        await ctx.telegram.leaveChat(chatId);
        logger.info('✅ Bot left unauthorized new group', {
          chatId: chatIdStr,
          chatTitle,
        });
      } catch (error) {
        // Ignore "chat not found" errors - bot is already removed
        if (error.response?.error_code === 400 &&
            (error.response?.description?.includes('chat not found') ||
             error.response?.description?.includes('not a member'))) {
          logger.debug('Bot already removed from group', { chatId: chatIdStr });
        } else {
          logger.error('Error leaving unauthorized group:', {
            chatId: chatIdStr,
            error: error.message
          });
        }
      }
    }
  });

  /**
   * Handle supergroup_chat_created - bot added to new supergroup
   */
  bot.on('supergroup_chat_created', async (ctx) => {
    const chatId = ctx.chat?.id;
    const chatTitle = ctx.chat?.title || 'New Supergroup';
    const chatIdStr = String(chatId);

    logger.warn('🚨 Bot added to NEW SUPERGROUP - checking authorization', {
      chatId: chatIdStr,
      chatTitle,
    });

    if (!authorizedChats.includes(chatIdStr)) {
      logger.error('🚨 Supergroup not authorized - LEAVING', {
        chatId: chatIdStr,
        chatTitle,
      });

      try {
        await ctx.telegram.leaveChat(chatId);
        logger.info('✅ Bot left unauthorized new supergroup', {
          chatId: chatIdStr,
          chatTitle,
        });
      } catch (error) {
        // Ignore "chat not found" errors - bot is already removed
        if (error.response?.error_code === 400 &&
            (error.response?.description?.includes('chat not found') ||
             error.response?.description?.includes('not a member'))) {
          logger.debug('Bot already removed from supergroup', { chatId: chatIdStr });
        } else {
          logger.error('Error leaving unauthorized supergroup:', {
            chatId: chatIdStr,
            error: error.message
          });
        }
      }
    }
  });

  /**
   * Handle channel_chat_created - bot added to new channel
   */
  bot.on('channel_chat_created', async (ctx) => {
    const chatId = ctx.chat?.id;
    const chatTitle = ctx.chat?.title || 'New Channel';
    const chatIdStr = String(chatId);

    logger.warn('🚨 Bot added to NEW CHANNEL - checking authorization', {
      chatId: chatIdStr,
      chatTitle,
    });

    if (!authorizedChats.includes(chatIdStr)) {
      logger.error('🚨 Channel not authorized - LEAVING', {
        chatId: chatIdStr,
        chatTitle,
      });

      try {
        await ctx.telegram.leaveChat(chatId);
        logger.info('✅ Bot left unauthorized new channel', {
          chatId: chatIdStr,
          chatTitle,
        });
      } catch (error) {
        // Ignore "chat not found" errors - bot is already removed
        if (error.response?.error_code === 400 &&
            (error.response?.description?.includes('chat not found') ||
             error.response?.description?.includes('not a member'))) {
          logger.debug('Bot already removed from channel', { chatId: chatIdStr });
        } else {
          logger.error('Error leaving unauthorized channel:', {
            chatId: chatIdStr,
            error: error.message
          });
        }
      }
    }
  });
}

module.exports = {
  groupSecurityEnforcementMiddleware,
  registerGroupSecurityHandlers,
};
