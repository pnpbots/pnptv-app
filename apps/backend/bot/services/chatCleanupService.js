const logger = require('../../utils/logger');

/**
 * Chat Cleanup Service
 * Automatically deletes bot messages, commands, and system messages after a delay
 * Also provides immediate cleanup of previous bot messages on new interactions
 */
class ChatCleanupService {
  /**
   * Scheduled deletions map
   * Key: timeout ID
   * Value: { chatId, messageId, type, scheduledAt }
   */
  static scheduledDeletions = new Map();

  /**
   * Bot messages tracking by chat
   * Key: chatId
   * Value: Set of message IDs sent by the bot
   */
  static botMessagesByChat = new Map();

  /**
   * Welcome message tracking by user
   * Key: userId
   * Value: true (has received welcome)
   */
  static welcomeMessagesSent = new Map();

  /**
   * Cleanup delay in milliseconds (5 minutes default, 1 minute for temporary messages)
   */
  static CLEANUP_DELAY = 5 * 60 * 1000; // 5 minutes
  static TEMPORARY_DELAY = 60 * 1000; // 1 minute for welcome/menu messages

  /**
   * Maximum number of messages to track per chat (prevent memory leaks)
   */
  static MAX_MESSAGES_PER_CHAT = 50;

  /**
   * Schedule a message for deletion
   * @param {Object} telegram - Telegram bot instance
   * @param {number|string} chatId - Chat ID
   * @param {number} messageId - Message ID
   * @param {string} type - Message type ('bot', 'command', 'system')
   * @param {number} delay - Delay in milliseconds (default: 5 minutes)
   * @returns {number} Timeout ID
   */
  static scheduleDelete(telegram, chatId, messageId, type = 'bot', delay = this.CLEANUP_DELAY) {
    if (!telegram || !chatId || !messageId) {
      logger.warn('Invalid parameters for scheduleDelete', { chatId, messageId, type });
      return null;
    }

    // Save reference to this to ensure context is maintained in callbacks
    const self = this;

    const timeoutId = setTimeout(async () => {
      try {
        await telegram.deleteMessage(chatId, messageId);

        logger.debug('Message deleted successfully', {
          chatId,
          messageId,
          type,
          delay: `${delay / 1000}s`,
        });

        // Remove from scheduled deletions
        if (timeoutId) {
          self.scheduledDeletions.delete(timeoutId);
        }
      } catch (error) {
        // Message might already be deleted or bot doesn't have permission
        if (error.response?.error_code === 400) {
          logger.debug('Message already deleted or not found', { chatId, messageId });
        } else {
          logger.error('Error deleting message:', {
            error: error.message,
            chatId,
            messageId,
            type,
          });
        }

        // Remove from scheduled deletions even if failed
        if (timeoutId) {
          self.scheduledDeletions.delete(timeoutId);
        }
      }
    }, delay);

    // Track scheduled deletion
    this.scheduledDeletions.set(timeoutId, {
      chatId,
      messageId,
      type,
      scheduledAt: new Date(),
      deleteAt: new Date(Date.now() + delay),
    });

    logger.debug('Message scheduled for deletion', {
      chatId,
      messageId,
      type,
      delay: `${delay / 1000}s`,
      scheduledCount: this.scheduledDeletions.size,
    });

    return timeoutId;
  }

  /**
   * Cancel a scheduled deletion
   * @param {number} timeoutId - Timeout ID
   * @returns {boolean} Success status
   */
  static cancelDelete(timeoutId) {
    if (!timeoutId) return false;

    const deletion = this.scheduledDeletions.get(timeoutId);

    if (deletion) {
      clearTimeout(timeoutId);
      this.scheduledDeletions.delete(timeoutId);

      logger.debug('Scheduled deletion cancelled', {
        chatId: deletion.chatId,
        messageId: deletion.messageId,
      });

      return true;
    }

    return false;
  }

  /**
   * Schedule deletion of a bot reply
   * @param {Object} telegram - Telegram bot instance
   * @param {Object} message - Sent message object
   * @param {number} delay - Delay in milliseconds
   * @param {boolean} isBroadcast - If true, don't schedule deletion (for important broadcasts)
   * @param {boolean} isTemporary - If true, use 1-minute delay for temporary messages
   * @returns {number} Timeout ID
   */
  static scheduleBotMessage(telegram, message, delay = this.CLEANUP_DELAY, isBroadcast = false, isTemporary = false) {
    if (!message || !message.chat || !message.message_id) {
      return null;
    }

    // Skip deletion for broadcast messages
    if (isBroadcast) {
      logger.debug('Broadcast message - skipping auto-delete', {
        chatId: message.chat.id,
        messageId: message.message_id,
      });
      return null;
    }

    // Use temporary delay for welcome/menu messages
    if (isTemporary) {
      delay = this.TEMPORARY_DELAY;
    }

    return this.scheduleDelete(
      telegram,
      message.chat.id,
      message.message_id,
      'bot',
      delay,
    );
  }

  /**
   * Schedule deletion for a welcome message (1-minute auto-delete)
   * @param {Object} telegram - Telegram bot instance
   * @param {Object} message - Sent message object
   * @returns {number} Timeout ID
   */
  static scheduleWelcomeMessage(telegram, message) {
    return this.scheduleBotMessage(telegram, message, this.TEMPORARY_DELAY, false, true);
  }

  /**
   * Schedule deletion for a menu interaction message (1-minute auto-delete)
   * @param {Object} telegram - Telegram bot instance
   * @param {Object} message - Sent message object
   * @returns {number} Timeout ID
   */
  static scheduleMenuMessage(telegram, message) {
    return this.scheduleBotMessage(telegram, message, this.TEMPORARY_DELAY, false, true);
  }

  /**
   * Schedule deletion of a user command
   * @param {Object} ctx - Telegraf context
   * @param {number} delay - Delay in milliseconds
   * @returns {number} Timeout ID
   */
  static scheduleCommand(ctx, delay = this.CLEANUP_DELAY) {
    if (!ctx.message || !ctx.chat) {
      return null;
    }

    return this.scheduleDelete(
      ctx.telegram,
      ctx.chat.id,
      ctx.message.message_id,
      'command',
      delay,
    );
  }

  /**
   * Schedule deletion of a system message
   * @param {Object} telegram - Telegram bot instance
   * @param {number|string} chatId - Chat ID
   * @param {number} messageId - Message ID
   * @param {number} delay - Delay in milliseconds
   * @returns {number} Timeout ID
   */
  static scheduleSystemMessage(telegram, chatId, messageId, delay = this.CLEANUP_DELAY) {
    return this.scheduleDelete(telegram, chatId, messageId, 'system', delay);
  }

  /**
   * Get statistics about scheduled deletions
   * @returns {Object} Statistics
   */
  static getStats() {
    const now = Date.now();
    const deletions = Array.from(this.scheduledDeletions.values());

    const stats = {
      total: deletions.length,
      byType: {
        bot: deletions.filter((d) => d.type === 'bot').length,
        command: deletions.filter((d) => d.type === 'command').length,
        system: deletions.filter((d) => d.type === 'system').length,
      },
      upcoming: {
        next1min: deletions.filter((d) => d.deleteAt - now < 60000).length,
        next5min: deletions.filter((d) => d.deleteAt - now < 300000).length,
      },
    };

    return stats;
  }

  /**
   * Clear all scheduled deletions
   * @returns {number} Number of deletions cancelled
   */
  static clearAll() {
    const count = this.scheduledDeletions.size;

    for (const timeoutId of this.scheduledDeletions.keys()) {
      clearTimeout(timeoutId);
    }

    this.scheduledDeletions.clear();

    logger.info(`Cleared ${count} scheduled deletions`);
    return count;
  }

  /**
   * Cleanup old scheduled deletions (housekeeping)
   * Removes completed deletions from the map
   */
  static cleanup() {
    const before = this.scheduledDeletions.size;
    const now = Date.now();

    // Remove deletions that should have already happened
    for (const [timeoutId, deletion] of this.scheduledDeletions.entries()) {
      if (deletion.deleteAt < now - 60000) { // 1 minute grace period
        this.scheduledDeletions.delete(timeoutId);
      }
    }

    const after = this.scheduledDeletions.size;

    if (before !== after) {
      logger.debug(`Cleanup: removed ${before - after} old scheduled deletions`);
    }
  }

  /**
   * Track a bot message for potential cleanup
   * @param {number|string} chatId - Chat ID
   * @param {number} messageId - Message ID
   */
  static trackBotMessage(chatId, messageId) {
    if (!chatId || !messageId) {
      return;
    }

    // Get or create message set for this chat
    if (!this.botMessagesByChat.has(chatId)) {
      this.botMessagesByChat.set(chatId, new Set());
    }

    const messageSet = this.botMessagesByChat.get(chatId);
    messageSet.add(messageId);

    // Prevent memory leaks - keep only the most recent messages
    if (messageSet.size > this.MAX_MESSAGES_PER_CHAT) {
      const messagesArray = Array.from(messageSet);
      const toRemove = messagesArray.slice(0, messagesArray.length - this.MAX_MESSAGES_PER_CHAT);
      toRemove.forEach((id) => messageSet.delete(id));

      logger.debug('Trimmed old tracked messages', {
        chatId,
        removed: toRemove.length,
        remaining: messageSet.size,
      });
    }

    logger.debug('Bot message tracked', {
      chatId,
      messageId,
      totalTracked: messageSet.size,
    });
  }

  /**
   * Delete all previous bot messages in a chat
   * @param {Object} telegram - Telegram bot instance
   * @param {number|string} chatId - Chat ID
   * @param {number} keepMessageId - Optional message ID to keep (e.g., the current message)
   * @returns {Promise<number>} Number of messages deleted
   */
  static async deleteAllPreviousBotMessages(telegram, chatId, keepMessageId = null) {
    if (!telegram || !chatId) {
      return 0;
    }

    const messageSet = this.botMessagesByChat.get(chatId);
    if (!messageSet || messageSet.size === 0) {
      logger.debug('No previous bot messages to delete', { chatId });
      return 0;
    }

    const messagesToDelete = Array.from(messageSet).filter((id) => id !== keepMessageId);
    let deletedCount = 0;
    const failedDeletes = [];

    // Delete messages sequentially to avoid rate limiting
    for (const messageId of messagesToDelete) {
      try {
        await telegram.deleteMessage(chatId, messageId);
        messageSet.delete(messageId);
        deletedCount++;

        logger.debug('Previous bot message deleted', {
          chatId,
          messageId,
        });

        // Small delay to avoid hitting Telegram rate limits
        await new Promise((resolve) => { setTimeout(resolve, 50); });
      } catch (error) {
        // Message might already be deleted or too old
        if (error.response?.error_code === 400) {
          // Remove from tracking since it's already gone
          messageSet.delete(messageId);
          logger.debug('Message already deleted or not found', { chatId, messageId });
        } else {
          logger.debug('Error deleting previous bot message', {
            chatId,
            messageId,
            error: error.message,
          });
          failedDeletes.push(messageId);
        }
      }
    }

    // Clean up empty sets
    if (messageSet.size === 0 || (messageSet.size === 1 && keepMessageId && messageSet.has(keepMessageId))) {
      this.botMessagesByChat.delete(chatId);
    }

    logger.info('Previous bot messages cleanup completed', {
      chatId,
      deleted: deletedCount,
      failed: failedDeletes.length,
      remaining: messageSet?.size || 0,
    });

    return deletedCount;
  }

  /**
   * Clear all tracked bot messages for a chat
   * @param {number|string} chatId - Chat ID
   */
  static clearTrackedMessages(chatId) {
    if (!chatId) {
      return;
    }

    const deleted = this.botMessagesByChat.delete(chatId);
    if (deleted) {
      logger.debug('Cleared all tracked messages for chat', { chatId });
    }
  }

  /**
   * Check if user has already received welcome message
   * @param {number|string} userId - User ID
   * @returns {boolean} Has received welcome
   */
  static hasReceivedWelcome(userId) {
    return this.welcomeMessagesSent.has(userId);
  }

  /**
   * Mark user as having received welcome message
   * @param {number|string} userId - User ID
   */
  static markWelcomeSent(userId) {
    this.welcomeMessagesSent.set(userId, true);
    this._cleanupWelcomeCache();
  }

  /**
   * Atomically check and mark welcome sent (prevents race condition)
   * Returns true if this is the first call for this user, false if already marked
   * @param {number|string} userId - User ID
   * @returns {boolean} True if successfully marked as first, false if already sent
   */
  static tryMarkWelcomeSent(userId) {
    if (this.welcomeMessagesSent.has(userId)) {
      return false; // Already sent
    }
    this.welcomeMessagesSent.set(userId, true);
    this._cleanupWelcomeCache();
    return true; // Successfully marked as first
  }

  /**
   * Internal cleanup for welcome cache
   */
  static _cleanupWelcomeCache() {
    // Cleanup old entries periodically
    if (this.welcomeMessagesSent.size > 1000) {
      // Keep only the most recent 1000 entries
      const users = Array.from(this.welcomeMessagesSent.keys());
      const toRemove = users.slice(0, users.length - 1000);
      toRemove.forEach((id) => this.welcomeMessagesSent.delete(id));
    }
  }

  /**
   * Get statistics about tracked bot messages
   * @returns {Object} Statistics
   */
  static getTrackedMessagesStats() {
    const stats = {
      totalChats: this.botMessagesByChat.size,
      totalMessages: 0,
      byChat: {},
    };

    for (const [chatId, messageSet] of this.botMessagesByChat.entries()) {
      stats.totalMessages += messageSet.size;
      stats.byChat[chatId] = messageSet.size;
    }

    return stats;
  }

  /**
   * Get welcome message statistics
   * @returns {Object} Statistics
   */
  static getWelcomeStats() {
    return {
      totalUsersWelcomed: this.welcomeMessagesSent.size,
    };
  }
}

// Run cleanup every 10 minutes
setInterval(() => {
  ChatCleanupService.cleanup();
}, 10 * 60 * 1000);

module.exports = ChatCleanupService;
