const TopicModerationService = require('../../services/topicModerationService');
const logger = require('../../../utils/logger');

/**
 * Topic Moderation Middleware
 * Checks messages in topics for spam, flood, and other violations
 */
function topicModerationMiddleware() {
  return async (ctx, next) => {
    try {
      // Only process messages in groups with topics (forums)
      if (!ctx.message || ctx.chat?.type === 'private') {
        return next();
      }

      // Get topic ID (message_thread_id)
      const topicId = ctx.message.message_thread_id;

      // If not in a topic, skip moderation
      if (!topicId) {
        return next();
      }

      // Check if topic has moderation enabled
      const moderationResult = await TopicModerationService.checkTopicModeration(ctx.message, topicId);

      if (moderationResult.shouldModerate) {
        // Apply moderation action
        const success = await TopicModerationService.applyModerationAction(ctx, moderationResult, topicId);
        
        if (success) {
          logger.info('Topic moderation applied', {
            topicId,
            userId: ctx.from.id,
            reason: moderationResult.reason,
          });
          
          // Don't proceed with the original message (it was deleted)
          return;
        }
      }

      // Continue with normal processing
      return next();

    } catch (error) {
      logger.error('Error in topic moderation middleware:', error);
      // Continue on error to avoid breaking the bot
      return next();
    }
  };
}

module.exports = topicModerationMiddleware;