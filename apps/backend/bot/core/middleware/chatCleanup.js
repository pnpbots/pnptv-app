const ChatCleanupService = require('../../services/chatCleanupService');
const logger = require('../../../utils/logger');

/**
 * Chat cleanup middleware
 * Automatically schedules deletion of:
 * 1. Bot messages (replies, notifications)
 * 2. User commands (/command)
 * 3. System messages (joins, leaves, etc.)
 *
 * User regular messages are NOT deleted
 *
 * Also provides immediate cleanup of previous bot messages on new interactions
 *
 * @param {number} delay - Delay in milliseconds (default: 5 minutes)
 * @returns {Function} Middleware function
 */
const chatCleanupMiddleware = (delay = 5 * 60 * 1000) => async (ctx, next) => {
  const chatType = ctx.chat?.type;
  const chatId = ctx.chat?.id;

  try {
    // Delete previous bot messages on new user interaction (for private chats)
    // This keeps the chat clean by removing previous bot responses
    if (chatType === 'private' && chatId) {
      // Delete on new message or callback query
      if (ctx.message || ctx.callbackQuery) {
        try {
          await ChatCleanupService.deleteAllPreviousBotMessages(ctx.telegram, chatId);
          logger.debug('Previous bot messages deleted on new interaction', {
            chatId,
            type: ctx.message ? 'message' : 'callback_query',
          });
        } catch (error) {
          logger.error('Error deleting previous bot messages:', error);
          // Don't block the flow
        }
      }
    }

    // Handle incoming messages (groups and supergroups)
    if ((chatType === 'group' || chatType === 'supergroup') && ctx.message) {
      await handleIncomingMessage(ctx, delay);
    }

    // Continue with the rest of the middleware chain
    await next();

    // Handle outgoing bot messages (all chat types)
    await handleOutgoingMessages(ctx, delay, chatType);
  } catch (error) {
    logger.error('Chat cleanup middleware error:', error);
    // Don't block the message flow
    throw error;
  }
};

/**
 * Handle incoming messages
 * Schedule deletion of commands and system messages
 */
async function handleIncomingMessage(ctx, delay) {
  const { message } = ctx;

  // Check if it's a command
  if (message.text && message.text.startsWith('/')) {
    ChatCleanupService.scheduleCommand(ctx, delay);

    logger.debug('Command scheduled for deletion', {
      chatId: ctx.chat.id,
      messageId: message.message_id,
      command: message.text.split(' ')[0],
    });
    return;
  }

  // Check for system messages
  if (isSystemMessage(message)) {
    ChatCleanupService.scheduleSystemMessage(
      ctx.telegram,
      ctx.chat.id,
      message.message_id,
      delay,
    );

    logger.debug('System message scheduled for deletion', {
      chatId: ctx.chat.id,
      messageId: message.message_id,
      type: getSystemMessageType(message),
    });
  }

  // Regular user messages are NOT scheduled for deletion
}

/**
 * Handle outgoing messages (bot replies)
 * Intercepts ctx.reply, ctx.replyWithMarkdown, etc.
 * - In groups: auto-delete messages after delay unless marked as broadcast
 * - In private chats: track messages for immediate cleanup on next interaction
 */
async function handleOutgoingMessages(ctx, delay, chatType) {
  // Store original reply methods
  const originalReply = ctx.reply;
  const originalReplyWithMarkdown = ctx.replyWithMarkdown;
  const originalReplyWithHTML = ctx.replyWithHTML;
  const originalReplyWithPhoto = ctx.replyWithPhoto;
  const originalReplyWithDocument = ctx.replyWithDocument;
  const originalReplyWithVideo = ctx.replyWithVideo;
  const originalReplyWithAnimation = ctx.replyWithAnimation;
  const originalReplyWithAudio = ctx.replyWithAudio;
  const originalReplyWithSticker = ctx.replyWithSticker;
  const originalReplyWithVoice = ctx.replyWithVoice;
  const originalReplyWithVideoNote = ctx.replyWithVideoNote;
  const originalReplyWithLocation = ctx.replyWithLocation;
  const originalEditMessageText = ctx.editMessageText;

  /**
   * Helper to wrap reply methods
   * Checks if message has broadcast flag in extra options
   */
  const wrapReplyMethod = (originalMethod, methodName) => async function (...args) {
    const sentMessage = await originalMethod.apply(this, args);

    if (sentMessage) {
      const chatId = ctx.chat?.id;
      const messageId = sentMessage.message_id;

      // Check if last argument has broadcast flag
      const lastArg = args[args.length - 1];
      const isBroadcast = lastArg && typeof lastArg === 'object' && lastArg.broadcast === true;

      // In private chats, track messages for immediate cleanup
      if (chatType === 'private' && chatId && messageId) {
        ChatCleanupService.trackBotMessage(chatId, messageId);
        logger.debug(`Bot message tracked (${methodName})`, {
          chatId,
          messageId,
        });
      }

      // In groups, schedule for delayed deletion
      if (chatType === 'group' || chatType === 'supergroup') {
        ChatCleanupService.scheduleBotMessage(ctx.telegram, sentMessage, delay, isBroadcast);
        logger.debug(`Bot message scheduled for deletion (${methodName})`, {
          chatId,
          messageId,
          isBroadcast,
        });
      }
    }

    return sentMessage;
  };

  /**
   * Special wrapper for editMessageText
   * Also tracks edited messages in private chats
   */
  const wrapEditMethod = (originalMethod) => async function (...args) {
    const result = await originalMethod.apply(this, args);

    // Track edited messages in private chats
    if (chatType === 'private' && result && result.message_id) {
      const chatId = ctx.chat?.id;
      if (chatId) {
        ChatCleanupService.trackBotMessage(chatId, result.message_id);
        logger.debug('Edited message tracked', {
          chatId,
          messageId: result.message_id,
        });
      }
    }

    return result;
  };

  // Wrap all reply methods
  ctx.reply = wrapReplyMethod(originalReply, 'reply');
  ctx.replyWithMarkdown = wrapReplyMethod(originalReplyWithMarkdown, 'replyWithMarkdown');
  ctx.replyWithHTML = wrapReplyMethod(originalReplyWithHTML, 'replyWithHTML');
  ctx.replyWithPhoto = wrapReplyMethod(originalReplyWithPhoto, 'replyWithPhoto');
  ctx.replyWithDocument = wrapReplyMethod(originalReplyWithDocument, 'replyWithDocument');
  ctx.replyWithVideo = wrapReplyMethod(originalReplyWithVideo, 'replyWithVideo');
  ctx.replyWithAnimation = wrapReplyMethod(originalReplyWithAnimation, 'replyWithAnimation');
  ctx.replyWithAudio = wrapReplyMethod(originalReplyWithAudio, 'replyWithAudio');
  ctx.replyWithSticker = wrapReplyMethod(originalReplyWithSticker, 'replyWithSticker');
  ctx.replyWithVoice = wrapReplyMethod(originalReplyWithVoice, 'replyWithVoice');
  ctx.replyWithVideoNote = wrapReplyMethod(originalReplyWithVideoNote, 'replyWithVideoNote');
  ctx.replyWithLocation = wrapReplyMethod(originalReplyWithLocation, 'replyWithLocation');
  ctx.editMessageText = wrapEditMethod(originalEditMessageText);
}

/**
 * Check if a message is a system message
 * @param {Object} message - Telegram message
 * @returns {boolean} Is system message
 */
function isSystemMessage(message) {
  return !!(
    message.new_chat_members
    || message.left_chat_member
    || message.new_chat_title
    || message.new_chat_photo
    || message.delete_chat_photo
    || message.group_chat_created
    || message.supergroup_chat_created
    || message.channel_chat_created
    || message.migrate_to_chat_id
    || message.migrate_from_chat_id
    || message.pinned_message
    || message.invoice
    || message.successful_payment
    || message.connected_website
    || message.passport_data
    || message.proximity_alert_triggered
    || message.forum_topic_created
    || message.forum_topic_edited
    || message.forum_topic_closed
    || message.forum_topic_reopened
    || message.video_chat_scheduled
    || message.video_chat_started
    || message.video_chat_ended
    || message.video_chat_participants_invited
  );
}

/**
 * Get system message type
 * @param {Object} message - Telegram message
 * @returns {string} System message type
 */
function getSystemMessageType(message) {
  if (message.new_chat_members) return 'new_members';
  if (message.left_chat_member) return 'left_member';
  if (message.new_chat_title) return 'new_title';
  if (message.new_chat_photo) return 'new_photo';
  if (message.delete_chat_photo) return 'delete_photo';
  if (message.group_chat_created) return 'group_created';
  if (message.supergroup_chat_created) return 'supergroup_created';
  if (message.pinned_message) return 'pinned_message';
  if (message.video_chat_started) return 'video_chat_started';
  if (message.video_chat_ended) return 'video_chat_ended';
  return 'unknown';
}

module.exports = chatCleanupMiddleware;
