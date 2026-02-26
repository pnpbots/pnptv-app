const cron = require('node-cron');
const logger = require('../../utils/logger');

/**
 * Group Cleanup Service
 * Automatically removes spam messages from groups at 12:00 and 24:00 UTC
 */
class GroupCleanupService {
  constructor(bot) {
    this.bot = bot;
    this.messageTracker = new Map(); // Track messages for cleanup
    this.isEnabled = process.env.ENABLE_GROUP_CLEANUP !== 'false';
  }

  /**
   * Initialize the cleanup service
   */
  initialize() {
    if (!this.isEnabled) {
      logger.info('Group cleanup service is disabled');
      return;
    }

    // Start message tracking
    this.startMessageTracking();

    // Schedule cleanup at 12:00 UTC (noon)
    cron.schedule('0 12 * * *', () => {
      this.performCleanup('12:00 UTC');
    }, {
      timezone: 'UTC',
    });

    // Schedule cleanup at 24:00 UTC (midnight)
    cron.schedule('0 0 * * *', () => {
      this.performCleanup('00:00 UTC');
    }, {
      timezone: 'UTC',
    });

    logger.info('✓ Group cleanup service initialized (runs at 12:00 and 00:00 UTC)');
  }

  /**
   * Start tracking messages in groups
   */
  startMessageTracking() {
    this.bot.on('message', async (ctx, next) => {
      try {
        // Only track group messages
        const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
        if (!isGroup) {
          return next();
        }

        const message = ctx.message;
        const messageId = message.message_id;
        const chatId = ctx.chat.id;

        // Track message with metadata
        const messageData = {
          messageId,
          chatId,
          text: message.text || message.caption || '',
          from: message.from,
          date: new Date(message.date * 1000),
          type: this.getMessageType(message),
        };

        // Check if message should be flagged for cleanup
        if (this.isSpamMessage(messageData)) {
          const key = `${chatId}:${messageId}`;
          this.messageTracker.set(key, messageData);

          logger.info('Message flagged for cleanup', {
            chatId,
            messageId,
            type: messageData.type,
            reason: this.getSpamReason(messageData),
          });
        }

        return next();
      } catch (error) {
        logger.error('Error in message tracking:', error);
        return next();
      }
    });
  }

  /**
   * Get message type
   */
  getMessageType(message) {
    if (message.text?.startsWith('/')) return 'command';
    if (message.photo) return 'photo';
    if (message.video) return 'video';
    if (message.document) return 'document';
    if (message.sticker) return 'sticker';
    if (message.animation) return 'animation';
    return 'text';
  }

  /**
   * Check if message is spam
   */
  isSpamMessage(messageData) {
    const text = messageData.text;

    // Skip empty messages
    if (!text || text.trim().length === 0) {
      return false;
    }

    // 1. Commands (except whitelisted ones)
    if (messageData.type === 'command') {
      const command = text.split(' ')[0].toLowerCase();
      const whitelistedCommands = ['/menu', '/start', '/help'];
      const isWhitelisted = whitelistedCommands.some(cmd => command.includes(cmd));

      if (!isWhitelisted) {
        return true; // Flag for cleanup
      }
    }

    // 2. Non-English/Spanish messages
    if (text.length > 10 && !this.isEnglishOrSpanish(text)) {
      return true;
    }

    // 3. Repetitive messages (same user sending same message multiple times)
    // This will be handled by comparing with recent messages

    // 4. URLs in messages (potential spam)
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    const urls = text.match(urlPattern);
    if (urls && urls.length > 2) {
      return true; // More than 2 URLs is likely spam
    }

    // 5. Messages with too many special characters
    const specialCharCount = (text.match(/[!@#$%^&*()_+={}\[\]|\\:;"'<>,.?\/~`]/g) || []).length;
    const specialCharRatio = specialCharCount / text.length;
    if (specialCharRatio > 0.3 && text.length > 20) {
      return true; // More than 30% special characters
    }

    // 6. All caps messages (shouting/spam)
    const upperCaseCount = (text.match(/[A-Z]/g) || []).length;
    const letterCount = (text.match(/[a-zA-Z]/g) || []).length;
    if (letterCount > 10 && upperCaseCount / letterCount > 0.7) {
      return true; // More than 70% uppercase
    }

    return false;
  }

  /**
   * Detect if text is in English or Spanish
   * Simple detection based on common words and patterns
   */
  isEnglishOrSpanish(text) {
    const lowerText = text.toLowerCase();

    // Common English words
    const englishWords = [
      'the', 'is', 'are', 'was', 'were', 'have', 'has', 'do', 'does',
      'will', 'would', 'can', 'could', 'should', 'may', 'might',
      'and', 'or', 'but', 'if', 'when', 'where', 'what', 'how', 'why',
      'this', 'that', 'these', 'those', 'you', 'your', 'we', 'our',
    ];

    // Common Spanish words
    const spanishWords = [
      'el', 'la', 'los', 'las', 'un', 'una', 'es', 'son', 'está', 'están',
      'ser', 'estar', 'haber', 'tener', 'hacer', 'poder', 'ir',
      'y', 'o', 'pero', 'si', 'cuando', 'donde', 'qué', 'cómo', 'por qué',
      'este', 'ese', 'estos', 'esos', 'tú', 'tu', 'nosotros', 'nuestro',
      'que', 'de', 'en', 'a', 'para', 'con', 'por',
    ];

    // Check for English words
    const hasEnglish = englishWords.some(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      return regex.test(lowerText);
    });

    // Check for Spanish words
    const hasSpanish = spanishWords.some(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      return regex.test(lowerText);
    });

    // Check for Spanish-specific characters
    const hasSpanishChars = /[áéíóúñü¿¡]/i.test(text);

    return hasEnglish || hasSpanish || hasSpanishChars;
  }

  /**
   * Get reason why message is flagged as spam
   */
  getSpamReason(messageData) {
    const text = messageData.text;

    if (messageData.type === 'command') {
      return 'unauthorized_command';
    }

    if (!this.isEnglishOrSpanish(text)) {
      return 'non_english_spanish';
    }

    const urlCount = (text.match(/(https?:\/\/[^\s]+)/g) || []).length;
    if (urlCount > 2) {
      return 'excessive_urls';
    }

    const specialCharCount = (text.match(/[!@#$%^&*()_+={}\[\]|\\:;"'<>,.?\/~`]/g) || []).length;
    const specialCharRatio = specialCharCount / text.length;
    if (specialCharRatio > 0.3) {
      return 'excessive_special_chars';
    }

    const upperCaseCount = (text.match(/[A-Z]/g) || []).length;
    const letterCount = (text.match(/[a-zA-Z]/g) || []).length;
    if (letterCount > 10 && upperCaseCount / letterCount > 0.7) {
      return 'all_caps';
    }

    return 'unknown';
  }

  /**
   * Perform cleanup of flagged messages
   */
  async performCleanup(scheduledTime) {
    try {
      logger.info(`Starting scheduled group cleanup at ${scheduledTime}`);

      const now = new Date();
      const cutoffTime = new Date(now.getTime() - 12 * 60 * 60 * 1000); // 12 hours ago

      let deletedCount = 0;
      let failedCount = 0;

      // Iterate through tracked messages
      for (const [key, messageData] of this.messageTracker.entries()) {
        try {
          // Only delete messages older than 12 hours
          if (messageData.date < cutoffTime) {
            await this.bot.telegram.deleteMessage(messageData.chatId, messageData.messageId);
            this.messageTracker.delete(key);
            deletedCount++;

            logger.info('Spam message deleted', {
              chatId: messageData.chatId,
              messageId: messageData.messageId,
              reason: this.getSpamReason(messageData),
              age: Math.round((now - messageData.date) / 1000 / 60 / 60) + 'h',
            });
          }
        } catch (error) {
          // Message might already be deleted or bot might not have permissions
          logger.warn('Failed to delete message', {
            chatId: messageData.chatId,
            messageId: messageData.messageId,
            error: error.message,
          });

          // Remove from tracker anyway
          this.messageTracker.delete(key);
          failedCount++;
        }

        // Add small delay to avoid hitting rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      logger.info(`Group cleanup completed at ${scheduledTime}`, {
        deleted: deletedCount,
        failed: failedCount,
        remaining: this.messageTracker.size,
      });

      // Clean up old tracked messages (older than 48 hours)
      this.cleanupTracker();
    } catch (error) {
      logger.error('Error during group cleanup:', error);
    }
  }

  /**
   * Clean up old tracked messages from memory
   */
  cleanupTracker() {
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 48 hours ago

    for (const [key, messageData] of this.messageTracker.entries()) {
      if (messageData.date < cutoffTime) {
        this.messageTracker.delete(key);
      }
    }

    logger.info('Message tracker cleaned up', {
      remainingTracked: this.messageTracker.size,
    });
  }

  /**
   * Get cleanup statistics
   */
  getStats() {
    return {
      trackedMessages: this.messageTracker.size,
      isEnabled: this.isEnabled,
    };
  }
}

module.exports = GroupCleanupService;
