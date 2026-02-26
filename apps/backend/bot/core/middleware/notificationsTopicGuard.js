const logger = require('../../../utils/logger');
const PermissionService = require('../../services/permissionService');

const GROUP_ID = process.env.GROUP_ID || '-1003291737499';
const NOTIFICATIONS_TOPIC_ID = parseInt(process.env.NOTIFICATIONS_TOPIC_ID || '10682', 10);

/**
 * Notifications Topic Guard
 * Ensures only the bot (and env admins) can post in the notifications topic.
 */
function notificationsTopicGuard() {
  return async (ctx, next) => {
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    if (!isGroup) return next();

    const chatIdStr = ctx.chat?.id?.toString();
    if (GROUP_ID && chatIdStr !== String(GROUP_ID)) return next();

    const threadId = ctx.message?.message_thread_id;
    if (!threadId || Number(threadId) !== NOTIFICATIONS_TOPIC_ID) return next();

    // Allow the bot's own messages
    if (ctx.from?.is_bot) return next();

    const userId = ctx.from?.id;
    const isAllowedAdmin = userId && (
      PermissionService.isEnvSuperAdmin(userId) ||
      PermissionService.isEnvAdmin(userId)
    );
    if (isAllowedAdmin) return next();

    // Delete anything users try to post in the notifications topic
    try {
      if (ctx.message?.message_id) {
        await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id);
      }
    } catch (error) {
      logger.debug('NotificationsTopicGuard: could not delete message', { error: error.message });
    }

    return;
  };
}

module.exports = notificationsTopicGuard;

