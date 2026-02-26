const logger = require('../../../utils/logger');

const GROUP_ID = process.env.GROUP_ID;
const WALL_OF_FAME_TOPIC_ID = parseInt(process.env.WALL_OF_FAME_TOPIC_ID || '3132', 10);

/**
 * Wall Of Fame Guard
 * Ensures only the bot can post in the Wall of Fame topic.
 */
function wallOfFameGuard() {
  return async (ctx, next) => {
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    if (!isGroup) return next();

    const chatIdStr = ctx.chat?.id?.toString();
    if (GROUP_ID && chatIdStr !== GROUP_ID) return next();

    const threadId = ctx.message?.message_thread_id;
    if (!threadId || Number(threadId) !== WALL_OF_FAME_TOPIC_ID) return next();

    // Allow the bot's own messages (including wallOfFame autoposts)
    if (ctx.from?.is_bot) return next();

    // Delete anything users try to post in the Wall of Fame topic
    try {
      if (ctx.message?.message_id) {
        await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id);
      }
    } catch (error) {
      logger.debug('WallOfFameGuard: could not delete message', { error: error.message });
    }

    return;
  };
}

module.exports = wallOfFameGuard;

