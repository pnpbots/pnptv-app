const logger = require('../../../utils/logger');

// FIX 20: Removed dead code: getLinkedChatIds, _linkedChatIds, _linkedCacheTime,
// LINKED_CACHE_TTL, and isAuthorizedChat — none were called by this middleware.
// invalidateLinkedCache is kept because hangoutGroupController.js and bot.js import and call it.

// Invalidate cache signal — callers in hangoutGroupController.js and bot.js call this
// after linking/unlinking a group; the actual cache now lives in groupAdminPanel.js (_authCache).
function invalidateLinkedCache() {
  // No-op: cache invalidation is handled by groupAdminPanel._authCache TTL (5 min).
  // This export is kept for backward compatibility with hangoutGroupController.js and bot.js.
}

/**
 * Group/Channel Security Enforcement Middleware
 * Allows bot in: whitelisted env chats + hangout-linked Telegram groups
 * All other groups/channels: bot stays and waits for /link command
 */
function groupSecurityEnforcementMiddleware() {
  return async (ctx, next) => {
    try {
      const chatType = ctx.chat?.type;
      if (chatType === 'private') return next();
      // Allow all groups/channels — the bot needs to stay so owners can run /link
      return next();
    } catch (error) {
      logger.error('Error in group security enforcement middleware:', error);
      return next();
    }
  };
}

/**
 * Handle my_chat_member updates (when bot is added/removed from groups)
 * Enforces strict control over bot additions
 */
function registerGroupSecurityHandlers(bot) {
  bot.on('my_chat_member', async (ctx) => {
    try {
      const newStatus = ctx.myChatMember?.new_chat_member?.status;
      const chatId = ctx.chat?.id;
      const chatType = ctx.chat?.type;
      const chatTitle = ctx.chat?.title || 'Unknown';
      const chatIdStr = String(chatId);

      logger.info('Bot status changed in chat', { chatId: chatIdStr, chatTitle, chatType, newStatus });

      if (['member', 'administrator'].includes(newStatus) && chatType !== 'private' && chatType !== 'channel') {
        // Don't send /link instructions in the main community group — it's already
        // set up and we don't want to encourage command usage there.
        const mainGroupId = process.env.GROUP_ID;
        if (mainGroupId && chatIdStr === mainGroupId) {
          logger.info('Bot added to main community group, skipping /link welcome', { chatIdStr });
        } else {
          // External group — tell the owner how to link it to a hangout
          try {
            await ctx.reply(
              `👋 Hello! I'm the PNPtv bot.\n\n` +
              `To link this group to a PNPtv hangout, the hangout owner should run:\n` +
              `/link <hangout_id>\n\n` +
              `You can find the hangout ID in the PNPtv webapp.`
            );
          } catch (e) {
            logger.debug('Could not send welcome message', { error: e.message });
          }
        }
      }

      if (newStatus === 'left' || newStatus === 'kicked') {
        logger.info('Bot removed from chat', { chatId: chatIdStr, chatTitle, reason: newStatus });
      }
    } catch (error) {
      logger.error('Error handling my_chat_member update:', error);
    }
  });
}

module.exports = {
  groupSecurityEnforcementMiddleware,
  registerGroupSecurityHandlers,
  invalidateLinkedCache,
};
