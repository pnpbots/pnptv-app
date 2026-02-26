const logger = require('../../../utils/logger');
const ChatCleanupService = require('../../services/chatCleanupService');

/**
 * Auto-delete commands in groups
 * Deletes command messages immediately and ensures they're deleted
 * Allows all commands to work but keeps group chat clean (SPAM PREVENTION)
 */
const commandAutoDeleteMiddleware = () => {
  return async (ctx, next) => {
    try {
      // Only process in groups (not private chats)
      if (ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup') {
        // Check if this is a command message
        if (ctx.message?.entities) {
          const hasCommand = ctx.message.entities.some(entity => entity.type === 'bot_command');

          if (hasCommand && ctx.message?.message_id) {
            const command = ctx.message.text?.split(' ')[0] || '/command';

            // Try immediate deletion
            try {
              await ctx.deleteMessage();
              logger.info('Command message auto-deleted (spam prevention)', {
                command,
                chatId: ctx.chat.id,
                userId: ctx.from.id,
                messageId: ctx.message.message_id,
              });
            } catch (deleteError) {
              // If immediate deletion fails, schedule it with retry
              logger.debug('Immediate deletion failed, scheduling for retry', {
                command,
                chatId: ctx.chat.id,
                error: deleteError.message,
              });

              // Schedule deletion as fallback (delete after 100ms to allow message to fully propagate)
              ChatCleanupService.scheduleDelete(
                ctx.telegram,
                ctx.chat.id,
                ctx.message.message_id,
                'group-command',
                100
              );
            }
          }
        }
      }

      // Continue to next middleware/handler
      return next();
    } catch (error) {
      logger.error('Error in commandAutoDeleteMiddleware:', error);
      return next();
    }
  };
};

module.exports = commandAutoDeleteMiddleware;
