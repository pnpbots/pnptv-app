const ModerationModel = require('../../models/moderationModel');
const logger = require('../../utils/logger');
const MODERATION_CONFIG = require('../../config/moderationConfig');

/**
 * Moderation Service - Business logic for moderation operations
 */
class ModerationService {
  /**
   * Link detection patterns
   */
  static LINK_PATTERNS = [
    // URLs with protocol
    /https?:\/\/[^\s]+/gi,
    // URLs without protocol
    /(?:www\.)[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[^\s]*/gi,
    // Common domains without www
    /(?:^|\s)([a-zA-Z0-9-]+\.(?:com|net|org|io|co|tv|me|gg|xyz|app|dev|tech)(?:\/[^\s]*)?)/gi,
    // Short URLs
    /(?:bit\.ly|t\.me|tinyurl\.com|goo\.gl|ow\.ly|buff\.ly)\/[^\s]+/gi,
    // Telegram links
    /(?:@[a-zA-Z0-9_]{5,}|t\.me\/[a-zA-Z0-9_]+)/gi,
  ];

  /**
   * Spam detection patterns
   */
  static SPAM_PATTERNS = [
    // Excessive caps (more than 70% uppercase)
    /^(?=.*[A-Z].*[A-Z].*[A-Z].*[A-Z].*[A-Z].*[A-Z].*[A-Z])/,
    // Excessive emojis (more than 10)
    /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/gu,
    // Repeated characters (more than 5 times)
    /(.)\1{5,}/,
    // Excessive exclamation/question marks
    /[!?]{4,}/,
  ];

  /**
   * Default profanity list (expandable)
   */
  static DEFAULT_PROFANITY = [
    // Add common profanity here - keeping it minimal for now
    'spam', 'scam', 'fake',
  ];

  /**
   * Flood tracking (in-memory for now, should use Redis in production)
   */
  static messageTracker = new Map();

  // ==================== CONTENT DETECTION ====================

  /**
   * Detect links in text
   * @param {string} text - Message text
   * @returns {Object} { hasLinks, links[] }
   */
  static detectLinks(text) {
    if (!text) return { hasLinks: false, links: [] };

    const links = [];

    for (const pattern of this.LINK_PATTERNS) {
      const matches = text.match(pattern);
      if (matches) {
        links.push(...matches);
      }
    }

    return {
      hasLinks: links.length > 0,
      links: [...new Set(links)], // Remove duplicates
    };
  }

  /**
   * Check if domain is whitelisted
   * @param {string} url - URL to check
   * @param {Array} allowedDomains - Whitelisted domains
   * @returns {boolean} Is allowed
   */
  static isAllowedDomain(url, allowedDomains = []) {
    if (!allowedDomains || allowedDomains.length === 0) {
      return false;
    }

    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      const domain = urlObj.hostname.replace('www.', '');

      return allowedDomains.some((allowed) => domain.includes(allowed));
    } catch {
      return false;
    }
  }

  /**
   * Detect spam in text
   * @param {string} text - Message text
   * @returns {Object} { isSpam, reason }
   */
  static detectSpam(text) {
    if (!text) return { isSpam: false, reason: null };

    // Check excessive caps
    const uppercaseCount = (text.match(/[A-Z]/g) || []).length;
    const totalLetters = (text.match(/[a-zA-Z]/g) || []).length;
    if (totalLetters > 10 && (uppercaseCount / totalLetters) > 0.7) {
      return { isSpam: true, reason: 'excessive_caps' };
    }

    // Check excessive emojis
    const emojiMatches = text.match(/(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/gu) || [];
    if (emojiMatches.length > 10) {
      return { isSpam: true, reason: 'excessive_emojis' };
    }

    // Check repeated characters
    if (/(.)\1{5,}/.test(text)) {
      return { isSpam: true, reason: 'repeated_characters' };
    }

    // Check excessive punctuation
    if (/[!?]{4,}/.test(text)) {
      return { isSpam: true, reason: 'excessive_punctuation' };
    }

    return { isSpam: false, reason: null };
  }

  /**
   * Detect profanity in text
   * @param {string} text - Message text
   * @param {Array} customWords - Custom banned words
   * @returns {Object} { hasProfanity, words[] }
   */
  static detectProfanity(text, customWords = []) {
    if (!text) return { hasProfanity: false, words: [] };

    const allBannedWords = [...this.DEFAULT_PROFANITY, ...customWords];
    const lowerText = text.toLowerCase();
    const foundWords = [];

    for (const word of allBannedWords) {
      if (lowerText.includes(word.toLowerCase())) {
        foundWords.push(word);
      }
    }

    return {
      hasProfanity: foundWords.length > 0,
      words: foundWords,
    };
  }

  /**
   * Check for flood (too many messages in short time)
   * @param {number|string} userId - User ID
   * @param {number|string} groupId - Group ID
   * @param {number} limit - Max messages
   * @param {number} windowSeconds - Time window in seconds
   * @returns {Object} { isFlooding, messageCount }
   */
  static checkFlood(userId, groupId, limit = 5, windowSeconds = 10) {
    const key = `${groupId}_${userId}`;
    const now = Date.now();
    const windowMs = windowSeconds * 1000;

    if (!this.messageTracker.has(key)) {
      this.messageTracker.set(key, []);
    }

    const messages = this.messageTracker.get(key);

    // Remove old messages outside the window
    const recentMessages = messages.filter((timestamp) => now - timestamp < windowMs);

    // Add current message
    recentMessages.push(now);
    this.messageTracker.set(key, recentMessages);

    // Clean up old entries periodically
    if (this.messageTracker.size > 1000) {
      this.cleanupMessageTracker();
    }

    return {
      isFlooding: recentMessages.length > limit,
      messageCount: recentMessages.length,
    };
  }

  /**
   * Cleanup message tracker
   */
  static cleanupMessageTracker() {
    const now = Date.now();
    const maxAge = 60000; // 1 minute

    for (const [key, messages] of this.messageTracker.entries()) {
      const recentMessages = messages.filter((timestamp) => now - timestamp < maxAge);

      if (recentMessages.length === 0) {
        this.messageTracker.delete(key);
      } else {
        this.messageTracker.set(key, recentMessages);
      }
    }

    logger.debug(`Message tracker cleaned up. Size: ${this.messageTracker.size}`);
  }

  // ==================== MODERATION ACTIONS ====================

  /**
   * Process message and check if it should be moderated
   * @param {Object} message - Telegram message
   * @param {number|string} groupId - Group ID
   * @returns {Promise<Object>} { shouldModerate, action, reason, details }
   */
  static async processMessage(message, groupId) {
    try {
      const settings = await ModerationModel.getGroupSettings(groupId);
      const text = message.text || message.caption || '';
      const userId = message.from.id;

      // Check if user is banned
      const isBanned = await ModerationModel.isUserBanned(userId, groupId);
      if (isBanned) {
        return {
          shouldModerate: true,
          action: 'delete',
          reason: 'user_banned',
          details: 'User is banned from this group',
        };
      }

      // Anti-Links check
      if (settings.antiLinksEnabled) {
        const { hasLinks, links } = this.detectLinks(text);

        if (hasLinks) {
          // Check if any link is whitelisted
          const hasAllowedLink = links.some((link) => this.isAllowedDomain(link, settings.allowedDomains));

          if (!hasAllowedLink) {
            return {
              shouldModerate: true,
              action: 'warn_and_delete',
              reason: 'unauthorized_link',
              details: `Links detected: ${links.join(', ')}`,
            };
          }
        }
      }

      // Anti-Spam check
      if (settings.antiSpamEnabled) {
        const { isSpam, reason } = this.detectSpam(text);

        if (isSpam) {
          return {
            shouldModerate: true,
            action: 'warn_and_delete',
            reason: 'spam',
            details: `Spam type: ${reason}`,
          };
        }
      }

      // Anti-Flood check
      if (settings.antiFloodEnabled) {
        const { isFlooding, messageCount } = this.checkFlood(
          userId,
          groupId,
          settings.floodLimit,
          settings.floodWindow,
        );

        if (isFlooding) {
          return {
            shouldModerate: true,
            action: 'warn',
            reason: 'flooding',
            details: `${messageCount} messages in ${settings.floodWindow}s`,
          };
        }
      }

      // Profanity check
      if (settings.profanityFilterEnabled) {
        const { hasProfanity, words } = this.detectProfanity(text, settings.bannedWords);

        if (hasProfanity) {
          return {
            shouldModerate: true,
            action: 'warn_and_delete',
            reason: 'profanity',
            details: `Banned words: ${words.join(', ')}`,
          };
        }
      }

      return {
        shouldModerate: false,
        action: null,
        reason: null,
        details: null,
      };
    } catch (error) {
      logger.error('Error processing message for moderation:', error);
      return {
        shouldModerate: false,
        action: null,
        reason: null,
        details: 'Error processing message',
      };
    }
  }

  /**
   * Add warning to user and check if should ban
   * @param {number|string} userId - User ID
   * @param {number|string} groupId - Group ID
   * @param {string} reason - Warning reason
   * @param {string} details - Additional details
   * @returns {Promise<Object>} { shouldBan, warningCount, maxWarnings }
   */
  static async addWarning(userId, groupId, reason, details = '') {
    try {
      const settings = await ModerationModel.getGroupSettings(groupId);
      const warnings = await ModerationModel.addWarning(userId, groupId, reason, details);

      // Log the warning
      await ModerationModel.addLog({
        action: 'warning_added',
        userId,
        groupId,
        reason,
        details,
        moderatorId: 'system',
      });

      const shouldBan = warnings.totalWarnings >= settings.maxWarnings;

      return {
        shouldBan,
        warningCount: warnings.totalWarnings,
        maxWarnings: settings.maxWarnings,
      };
    } catch (error) {
      logger.error('Error adding warning:', error);
      throw error;
    }
  }

  /**
   * Ban user from group
   * @param {number|string} userId - User ID
   * @param {number|string} groupId - Group ID
   * @param {string} reason - Ban reason
   * @param {number|string} bannedBy - Admin user ID (or 'system')
   * @returns {Promise<boolean>} Success status
   */
  static async banUser(userId, groupId, reason, bannedBy = 'system') {
    try {
      await ModerationModel.banUser(userId, groupId, reason, bannedBy);

      // Log the ban
      await ModerationModel.addLog({
        action: 'user_banned',
        userId,
        groupId,
        reason,
        details: `Banned by: ${bannedBy}`,
        moderatorId: bannedBy,
      });

      logger.info('User banned from group', { userId, groupId, reason, bannedBy });
      return true;
    } catch (error) {
      logger.error('Error banning user:', error);
      return false;
    }
  }

  /**
   * Unban user from group
   * @param {number|string} userId - User ID
   * @param {number|string} groupId - Group ID
   * @param {number|string} unbannedBy - Admin user ID
   * @returns {Promise<boolean>} Success status
   */
  static async unbanUser(userId, groupId, unbannedBy) {
    try {
      const success = await ModerationModel.unbanUser(userId, groupId);

      if (success) {
        // Log the unban
        await ModerationModel.addLog({
          action: 'user_unbanned',
          userId,
          groupId,
          reason: 'Manual unban',
          details: `Unbanned by: ${unbannedBy}`,
          moderatorId: unbannedBy,
        });

        logger.info('User unbanned from group', { userId, groupId, unbannedBy });
      }

      return success;
    } catch (error) {
      logger.error('Error unbanning user:', error);
      return false;
    }
  }

  /**
   * Get user warnings
   * @param {number|string} userId - User ID
   * @param {number|string} groupId - Group ID
   * @returns {Promise<Object|null>} Warnings data
   */
  static async getUserWarnings(userId, groupId) {
    try {
      return await ModerationModel.getUserWarnings(userId, groupId);
    } catch (error) {
      logger.error('Error getting user warnings:', error);
      return null;
    }
  }

  /**
   * Clear user warnings
   * @param {number|string} userId - User ID
   * @param {number|string} groupId - Group ID
   * @param {number|string} clearedBy - Admin user ID
   * @returns {Promise<boolean>} Success status
   */
  static async clearWarnings(userId, groupId, clearedBy) {
    try {
      const success = await ModerationModel.clearWarnings(userId, groupId);

      if (success) {
        await ModerationModel.addLog({
          action: 'warnings_cleared',
          userId,
          groupId,
          reason: 'Manual clear',
          details: `Cleared by: ${clearedBy}`,
          moderatorId: clearedBy,
        });

        logger.info('User warnings cleared', { userId, groupId, clearedBy });
      }

      return success;
    } catch (error) {
      logger.error('Error clearing warnings:', error);
      return false;
    }
  }

  /**
   * Update group settings
   * @param {number|string} groupId - Group ID
   * @param {Object} updates - Settings to update
   * @returns {Promise<boolean>} Success status
   */
  static async updateGroupSettings(groupId, updates) {
    try {
      const success = await ModerationModel.updateGroupSettings(groupId, updates);

      if (success) {
        await ModerationModel.addLog({
          action: 'settings_updated',
          groupId,
          reason: 'Settings changed',
          details: JSON.stringify(updates),
          moderatorId: 'admin',
        });
      }

      return success;
    } catch (error) {
      logger.error('Error updating group settings:', error);
      return false;
    }
  }

  /**
   * Get moderation statistics
   * @param {number|string} groupId - Group ID
   * @returns {Promise<Object>} Statistics
   */
  static async getStatistics(groupId) {
    try {
      return await ModerationModel.getGroupStatistics(groupId);
    } catch (error) {
      logger.error('Error getting moderation statistics:', error);
      return null;
    }
  }

  /**
   * Get moderation logs
   * @param {number|string} groupId - Group ID
   * @param {number} limit - Max results
   * @returns {Promise<Array>} Moderation logs
   */
  static async getLogs(groupId, limit = 50) {
    try {
      return await ModerationModel.getGroupLogs(groupId, limit);
    } catch (error) {
      logger.error('Error getting moderation logs:', error);
      return [];
    }
  }

  /**
   * Check if bot addition is authorized
   * @param {string} userId - User ID attempting to add bot
   * @param {string} groupId - Group ID
   * @param {string} botUsername - Bot username being added
   * @returns {Object} { isUnauthorized, reason }
   */
  static checkBotAddition(userId, groupId, botUsername) {
    try {
      const config = MODERATION_CONFIG.FILTERS.BOT_ADDITION;
      
      // If bot addition prevention is disabled, allow all
      if (!config.enabled) {
        return { isUnauthorized: false, reason: 'Bot addition prevention disabled' };
      }

      // Check if user is admin (admins can add any bot)
      // Note: In production, this should check actual admin status
      // For now, we'll use the allowOnlyAdmins flag
      if (config.allowOnlyAdmins) {
        // In a real implementation, we would check if userId is an admin
        // For now, we'll assume non-admins are trying to add bots
        // This is a placeholder - actual admin check should be implemented
        
        // Check if the bot being added is an official bot
        const isOfficialBot = config.officialBots.some(
          officialBot => botUsername.toLowerCase() === officialBot.toLowerCase()
        );
        
        if (isOfficialBot) {
          return { isUnauthorized: false, reason: 'Official bot addition' };
        }
        
        // If not official bot and allowOnlyAdmins is true, block it
        return {
          isUnauthorized: true,
          reason: 'Only admins can add bots to this group'
        };
      }

      // If we get here, bot addition is allowed
      return { isUnauthorized: false, reason: 'Bot addition allowed' };
      
    } catch (error) {
      logger.error('Error checking bot addition:', error);
      // Fail safe - allow bot addition if there's an error
      return { isUnauthorized: false, reason: 'Error checking bot addition' };
    }
  }
}

module.exports = ModerationService;
