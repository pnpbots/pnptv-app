const logger = require('../../utils/logger');

/**
 * Extract the most relevant Telegram message object for reactions
 * @param {Object} ctx - Telegraf context
 * @returns {Object|null} Message payload
 */
function getMessageForReaction(ctx) {
  return ctx?.message
    || ctx?.update?.callback_query?.message
    || ctx?.update?.edited_message
    || null;
}

/**
 * Try to react to a message: prefer ctx.react(), fallback to Telegram API call
 * @param {Object} ctx - Telegraf context
 * @param {string} emoji - Reaction emoji
 */
async function addReaction(ctx, emoji) {
  if (!ctx) return;

  if (typeof ctx.react === 'function') {
    try {
      await ctx.react(emoji);
      return;
    } catch (error) {
      logger.debug('ctx.react failed:', error.message);
    }
  }

  const message = getMessageForReaction(ctx);
  if (!message) {
    logger.debug('No message available for fallback reaction');
    return;
  }

  const chatId = message.chat?.id || ctx.chat?.id;
  const messageId = message.message_id;
  if (!chatId || !messageId) {
    logger.debug('Cannot send fallback reaction; missing chat or message id');
    return;
  }

  if (!ctx.telegram || typeof ctx.telegram.callApi !== 'function') {
    logger.debug('Telegram client not available for fallback reaction');
    return;
  }

  try {
    await ctx.telegram.callApi('sendReaction', {
      chat_id: chatId,
      message_id: messageId,
      emoji,
    });
  } catch (error) {
    logger.debug('Fallback reaction failed:', error.message);
  }
}

module.exports = {
  addReaction,
};
