const logger = require('../../../utils/logger');
const ChatCleanupService = require('../../services/chatCleanupService');
const PermissionService = require('../../services/permissionService');

const GROUP_ID = process.env.GROUP_ID;
const NOTIFICATIONS_TOPIC_ID = process.env.NOTIFICATIONS_TOPIC_ID || '10682';
const AUTO_DELETE_DELAY = 5 * 60 * 1000; // 5 minutes

/**
 * Command Redirection Middleware
 * Redirects bot commands to the Notifications topic in groups
 */
function commandRedirectionMiddleware() {
  return async (ctx, next) => {
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    const chatIdStr = ctx.chat?.id?.toString();

    // Only apply to configured group
    if (!isGroup || (GROUP_ID && chatIdStr !== GROUP_ID)) {
      return next();
    }

    const messageText = ctx.message?.text || '';
    const isCommand = messageText.startsWith('/');
    const currentTopicId = ctx.message?.message_thread_id;
    const commandRaw = messageText.split(' ')[0]?.toLowerCase();
    const command = commandRaw ? commandRaw.split('@')[0] : '';

    // Skip menu command - allow it to work anywhere
    if (command === '/menu') {
      return next();
    }
    // Allow /admin anywhere for admins
    if (command === '/admin') {
      const isAdmin = await PermissionService.isAdmin(ctx.from?.id);
      if (isAdmin) return next();
    }

    // If it's a command and NOT already in the notifications topic
    if (isCommand && currentTopicId && currentTopicId.toString() !== NOTIFICATIONS_TOPIC_ID) {
      const userLang = ctx.from?.language_code || 'en';
      const isSpanish = userLang.startsWith('es');

      const redirectMessage = isSpanish
        ? '💬 Los comandos del bot se procesan en el tema **Notifications** →'
        : '💬 Bot commands are processed in the **Notifications** topic →';

      // Send redirect notice
      try {
        const sentMessage = await ctx.reply(redirectMessage, {
          parse_mode: 'Markdown',
          reply_to_message_id: ctx.message.message_id,
        });

        // Auto-delete redirect notice after 30 seconds
        setTimeout(async () => {
          try {
            await ctx.telegram.deleteMessage(ctx.chat.id, sentMessage.message_id);
          } catch (error) {
            logger.debug('Could not delete redirect notice:', error.message);
          }
        }, 30000);

        logger.info('Command redirected to notifications topic', {
          userId: ctx.from?.id,
          chatId: ctx.chat.id,
          fromTopic: currentTopicId,
          toTopic: NOTIFICATIONS_TOPIC_ID,
          command: messageText.split(' ')[0],
        });

        // Don't process the command in the wrong topic
        return;
      } catch (error) {
        logger.error('Error sending command redirect notice:', error);
      }
    }

    return next();
  };
}

/**
 * Auto-delete middleware for notifications topic
 * Deletes messages in the notifications topic after 5 minutes
 */
function notificationsAutoDelete() {
  return async (ctx, next) => {
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    const chatIdStr = ctx.chat?.id?.toString();
    const currentTopicId = ctx.message?.message_thread_id?.toString();

    // Only apply to configured group and notifications topic
    if (!isGroup || (GROUP_ID && chatIdStr !== GROUP_ID)) {
      return next();
    }

    // Check if in notifications topic
    if (currentTopicId === NOTIFICATIONS_TOPIC_ID) {
      // Store original reply for this context
      const originalReply = ctx.reply.bind(ctx);

      // Override ctx.reply to auto-delete messages in notifications topic
      ctx.reply = async (text, extra = {}) => {
        const message = await originalReply(text, extra);

        // Schedule deletion after 5 minutes
        if (message) {
          ChatCleanupService.scheduleDelete(
            ctx.telegram,
            ctx.chat.id,
            message.message_id,
            'notifications-topic-auto-delete',
            AUTO_DELETE_DELAY
          );

          logger.debug('Message in notifications topic scheduled for auto-delete', {
            chatId: ctx.chat.id,
            messageId: message.message_id,
            topicId: NOTIFICATIONS_TOPIC_ID,
            deleteIn: '5 minutes',
          });
        }

        return message;
      };
    }

    return next();
  };
}

module.exports = {
  commandRedirectionMiddleware,
  notificationsAutoDelete
};
