const TopicConfigModel = require('../../models/topicConfigModel');
const ModerationService = require('./moderationService');
const logger = require('../../utils/logger');

/**
 * Topic Moderation Service - Business logic for topic-specific moderation
 * Handles anti-spam, anti-flood, and other topic-level moderation features
 */
class TopicModerationService {
  
  /**
   * Check if message violates topic moderation rules
   * @param {Object} message - Telegram message
   * @param {number} topicId - Topic ID
   * @returns {Promise<Object>} { shouldModerate, action, reason, details }
   */
  static async checkTopicModeration(message, topicId) {
    try {
      const config = await TopicConfigModel.getTopicConfig(topicId);
      
      if (!config) {
        return { shouldModerate: false };
      }

      const text = message.text || message.caption || '';
      const userId = message.from.id;

      // Check anti-spam for this topic
      if (config.anti_spam_enabled) {
        const spamCheck = this.checkTopicSpam(text, config);
        if (spamCheck.shouldModerate) {
          return spamCheck;
        }
      }

      // Check anti-flood for this topic
      if (config.anti_flood_enabled) {
        const floodCheck = await this.checkTopicFlood(userId, topicId, config);
        if (floodCheck.shouldModerate) {
          return floodCheck;
        }
      }

      // Check anti-links for this topic
      if (config.anti_links_enabled) {
        const linkCheck = this.checkTopicLinks(text, config);
        if (linkCheck.shouldModerate) {
          return linkCheck;
        }
      }

      return { shouldModerate: false };

    } catch (error) {
      logger.error('Error in topic moderation check:', error);
      return { shouldModerate: false };
    }
  }

  /**
   * Check for spam in topic message
   * @param {string} text - Message text
   * @param {Object} config - Topic configuration
   * @returns {Object} { shouldModerate, action, reason, details }
   */
  static checkTopicSpam(text, config) {
    const { isSpam, reason } = ModerationService.detectSpam(text);
    
    if (isSpam) {
      return {
        shouldModerate: true,
        action: 'warn_and_delete',
        reason: 'spam',
        details: `Spam type: ${reason}`,
      };
    }
    
    return { shouldModerate: false };
  }

  /**
   * Check for flooding in topic
   * @param {number} userId - User ID
   * @param {number} topicId - Topic ID
   * @param {Object} config - Topic configuration
   * @returns {Promise<Object>} { shouldModerate, action, reason, details }
   */
  static async checkTopicFlood(userId, topicId, config) {
    // Use topic-specific flood limits if configured, otherwise use defaults
    const limit = config.max_posts_per_hour || 10;
    const windowSeconds = 3600; // 1 hour window
    
    const { isFlooding, messageCount } = ModerationService.checkFlood(
      userId,
      `${topicId}_${userId}`,
      limit,
      windowSeconds
    );
    
    if (isFlooding) {
      return {
        shouldModerate: true,
        action: 'warn',
        reason: 'flooding',
        details: `${messageCount} messages in ${windowSeconds}s (limit: ${limit})`,
      };
    }
    
    return { shouldModerate: false };
  }

  /**
   * Check for unauthorized links in topic
   * @param {string} text - Message text
   * @param {Object} config - Topic configuration
   * @returns {Object} { shouldModerate, action, reason, details }
   */
  static checkTopicLinks(text, config) {
    const { hasLinks, links } = ModerationService.detectLinks(text);
    
    if (hasLinks) {
      // Check if any link is whitelisted (if allowed domains are configured)
      const hasAllowedLink = links.some((link) => 
        ModerationService.isAllowedDomain(link, config.allowed_domains || [])
      );
      
      if (!hasAllowedLink) {
        return {
          shouldModerate: true,
          action: 'warn_and_delete',
          reason: 'unauthorized_link',
          details: `Links detected: ${links.join(', ')}`,
        };
      }
    }
    
    return { shouldModerate: false };
  }

  /**
   * Apply moderation action to message
   * @param {Object} ctx - Telegraf context
   * @param {Object} moderationResult - Result from checkTopicModeration
   * @param {number} topicId - Topic ID
   */
  static async applyModerationAction(ctx, moderationResult, topicId) {
    if (!moderationResult.shouldModerate) {
      return false;
    }

    try {
      const messageId = ctx.message.message_id;
      const userId = ctx.from.id;
      const chatId = ctx.chat.id;

      // Delete the message
      try {
        await ctx.deleteMessage();
        logger.info('Deleted message for moderation violation', {
          userId,
          topicId,
          reason: moderationResult.reason,
          action: moderationResult.action
        });
      } catch (error) {
        logger.debug('Could not delete message:', error.message);
      }

      // Track violation
      await TopicConfigModel.trackViolation(userId, topicId, moderationResult.reason);

      // Send warning message
      const violationCount = await TopicConfigModel.getViolationCount(userId, topicId);
      const warningMessage = this.getWarningMessage(
        moderationResult.reason,
        moderationResult.details,
        violationCount
      );

      const sentMessage = await ctx.reply(warningMessage, {
        reply_to_message_id: messageId,
      });

      // Auto-delete warning after delay
      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(chatId, sentMessage.message_id);
        } catch (error) {
          logger.debug('Could not delete warning:', error.message);
        }
      }, 10000); // 10 seconds

      return true;

    } catch (error) {
      logger.error('Error applying moderation action:', error);
      return false;
    }
  }

  /**
   * Get warning message for violation
   * @param {string} reason - Violation reason
   * @param {string} details - Violation details
   * @param {number} violationCount - User's violation count
   * @returns {string} Warning message
   */
  static getWarningMessage(reason, details, violationCount) {
    const reasonMessages = {
      spam: '🚫 **Spam Detected**',
      flooding: '⏳ **Slow Down**',
      unauthorized_link: '🔗 **Links Not Allowed**',
    };

    const detailMessages = {
      spam: `Your message was flagged as spam (${details}).`,
      flooding: `You're sending too many messages (${details}).`,
      unauthorized_link: `Links are not allowed in this topic (${details}).`,
    };

    const warningMessage = reasonMessages[reason] || '⚠️ **Violation Detected**';
    const detailMessage = detailMessages[reason] || details;

    return `${warningMessage}

${detailMessage}

This is violation #${violationCount} in the last 24 hours. Repeated violations may result in further action.`;
  }

  /**
   * Get topic moderation status
   * @param {number} topicId - Topic ID
   * @returns {Promise<Object>} Moderation status
   */
  static async getTopicModerationStatus(topicId) {
    try {
      const config = await TopicConfigModel.getTopicConfig(topicId);
      
      if (!config) {
        return {
          configured: false,
          anti_spam_enabled: false,
          anti_flood_enabled: false,
          anti_links_enabled: false,
        };
      }

      return {
        configured: true,
        anti_spam_enabled: config.anti_spam_enabled,
        anti_flood_enabled: config.anti_flood_enabled,
        anti_links_enabled: config.anti_links_enabled,
        max_posts_per_hour: config.max_posts_per_hour,
        allowed_domains: config.allowed_domains,
      };

    } catch (error) {
      logger.error('Error getting topic moderation status:', error);
      return {
        configured: false,
        anti_spam_enabled: false,
        anti_flood_enabled: false,
        anti_links_enabled: false,
      };
    }
  }

  /**
   * Update topic moderation settings
   * @param {number} topicId - Topic ID
   * @param {Object} settings - Settings to update
   * @returns {Promise<boolean>} Success
   */
  static async updateTopicModerationSettings(topicId, settings) {
    try {
      const currentConfig = await TopicConfigModel.getTopicConfig(topicId) || {
        topic_id: topicId,
        topic_name: `Topic ${topicId}`,
      };

      const updatedConfig = {
        ...currentConfig,
        anti_spam_enabled: settings.anti_spam_enabled !== undefined 
          ? settings.anti_spam_enabled 
          : currentConfig.anti_spam_enabled,
        anti_flood_enabled: settings.anti_flood_enabled !== undefined 
          ? settings.anti_flood_enabled 
          : currentConfig.anti_flood_enabled,
        anti_links_enabled: settings.anti_links_enabled !== undefined 
          ? settings.anti_links_enabled 
          : currentConfig.anti_links_enabled,
        max_posts_per_hour: settings.max_posts_per_hour !== undefined 
          ? settings.max_posts_per_hour 
          : currentConfig.max_posts_per_hour,
        allowed_domains: settings.allowed_domains !== undefined 
          ? settings.allowed_domains 
          : currentConfig.allowed_domains,
      };

      await TopicConfigModel.saveTopicConfig(updatedConfig);
      
      logger.info('Updated topic moderation settings', {
        topicId,
        settings: {
          anti_spam_enabled: updatedConfig.anti_spam_enabled,
          anti_flood_enabled: updatedConfig.anti_flood_enabled,
          anti_links_enabled: updatedConfig.anti_links_enabled,
        }
      });

      return true;

    } catch (error) {
      logger.error('Error updating topic moderation settings:', error);
      return false;
    }
  }
}

module.exports = TopicModerationService;