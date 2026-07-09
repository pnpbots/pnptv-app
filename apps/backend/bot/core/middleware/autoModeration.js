const WarningService = require('../../../services/warningService');
const logger = require('../../../utils/logger');
const MODERATION_CONFIG = require('../../../config/moderationConfig');
const { autoModerationReasons } = require('../../../config/groupMessages');

// Store recent messages for spam/flood detection
const userMessageHistory = new Map();

/**
 * Check if user is exempt from auto-moderation.
 *
 * Two independent checks, either one is sufficient:
 *   1. Telegram-level: chat creator/administrator.
 *   2. Platform-level: users.role in (admin, moderator, superadmin).
 *
 * Both checks are wrapped independently so a transient failure on one
 * doesn't skip the other (a Telegram API hiccup must not silently strip
 * platform staff of their exemption).
 */
async function isExempt(ctx) {
  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    if (['creator', 'administrator'].includes(member.status)) return true;
  } catch (error) {
    if (error?.description === 'Bad Request: CHAT_ADMIN_REQUIRED') {
      logger.debug('Bot lacks admin in chat, treating user as non-exempt', {
        chatId: ctx.chat.id,
        userId: ctx.from.id,
      });
    } else {
      logger.error('Error checking telegram exempt status:', error);
    }
  }

  try {
    const UserModel = require('../../../models/userModel');
    const user = await UserModel.getById(ctx.from.id);
    if (user && ['admin', 'moderator', 'superadmin'].includes(user.role)) return true;
  } catch (error) {
    logger.error('Error checking platform-role exempt status:', error);
  }

  return false;
}

/**
 * Check if message is forwarded
 * @param {Object} message - Telegram message object
 * @returns {boolean} Is forwarded
 */
function isForwardedMessage(message) {
  if (!message) return false;

  return !!(message.forward_from ||
           message.forward_from_chat ||
           message.forward_from_message_id ||
           message.forward_sender_name ||
           message.forward_date);
}

/**
 * Enhanced link detection patterns
 */
// IMPORTANT: No /g flag on any pattern — module-level regex with /g is stateful
// (lastIndex persists between .test() calls), causing false positives on alternate invocations.
const ENHANCED_LINK_PATTERNS = [
  // Standard URLs with protocol
  /https?:\/\/[^\s]+/i,
  // URLs without protocol
  /(?:www\.)[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[^\s]*/i,
  // Short URLs
  /(?:bit\.ly|t\.me|tinyurl\.com|goo\.gl|ow\.ly|buff\.ly|is\.gd|v\.gd)\/[^\s]+/i,
  // Telegram invite links (t.me links only - @usernames are allowed for mentions)
  /t\.me\/[a-zA-Z0-9_]+/i,
  // IP addresses — deliberately omitted: the X.X.X.X pattern matches Colombian phone
  // numbers (e.g. 300.123.45.67) and semantic version strings, causing innocent bans.
  // NOTE: email pattern removed — matching user@domain caused permanent bans on innocent messages
];

/**
 * Enhanced link detection
 * @param {string} text - Message text
 * @returns {boolean} Contains links
 */
function detectAnyLink(text) {
  if (!text) return false;

  for (const pattern of ENHANCED_LINK_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }

  return false;
}

/**
 * Add message to user history for tracking
 */
function addToHistory(userId, messageText) {
  if (!userMessageHistory.has(userId)) {
    userMessageHistory.set(userId, []);
  }

  const history = userMessageHistory.get(userId);
  history.push({
    text: messageText,
    timestamp: Date.now(),
  });

  // Keep only recent messages (last 2 minutes)
  const cutoff = Date.now() - 2 * 60 * 1000;
  userMessageHistory.set(
    userId,
    history.filter((msg) => msg.timestamp > cutoff)
  );
}

/**
 * Check for spam (duplicate messages)
 */
function checkSpam(userId, messageText) {
  if (!MODERATION_CONFIG.FILTERS.SPAM.enabled) {
    return false;
  }

  const history = userMessageHistory.get(userId) || [];
  const { maxDuplicateMessages, duplicateTimeWindow } = MODERATION_CONFIG.FILTERS.SPAM;

  const cutoff = Date.now() - duplicateTimeWindow;
  const recentDuplicates = history.filter(
    (msg) => msg.text === messageText && msg.timestamp > cutoff
  );

  return recentDuplicates.length >= maxDuplicateMessages;
}

/**
 * Check for flooding (too many messages)
 */
function checkFlood(userId) {
  if (!MODERATION_CONFIG.FILTERS.FLOOD.enabled) {
    return false;
  }

  const history = userMessageHistory.get(userId) || [];
  const { maxMessages, timeWindow } = MODERATION_CONFIG.FILTERS.FLOOD;

  const cutoff = Date.now() - timeWindow;
  const recentMessages = history.filter((msg) => msg.timestamp > cutoff);

  return recentMessages.length >= maxMessages;
}

/**
 * Check for unauthorized links
 */
function checkLinks(messageText) {
  if (!MODERATION_CONFIG.FILTERS.LINKS.enabled) {
    return false;
  }

  // URL regex pattern
  const urlPattern = /(https?:\/\/[^\s]+)/gi;
  const urls = messageText.match(urlPattern);

  if (!urls) {
    return false;
  }

  const { allowedDomains } = MODERATION_CONFIG.FILTERS.LINKS;

  // Check if any URL is not in allowed domains
  for (const url of urls) {
    const isAllowed = allowedDomains.some((domain) => url.includes(domain));
    if (!isAllowed) {
      return true; // Found unauthorized link
    }
  }

  return false;
}

/**
 * Check for profanity
 */
function checkProfanity(messageText) {
  if (!MODERATION_CONFIG.FILTERS.PROFANITY.enabled) {
    return false;
  }

  const { blacklist } = MODERATION_CONFIG.FILTERS.PROFANITY;
  const lowerText = messageText.toLowerCase();

  return blacklist.some((word) => lowerText.includes(word.toLowerCase()));
}

/**
 * Delete message and notify user
 */
async function deleteAndNotify(ctx, reason) {
  try {
    // Delete the message
    await ctx.deleteMessage();

    // Send notification (auto-delete after 15 seconds)
    const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    const notification = await ctx.telegram.sendMessage(
      ctx.chat.id,
      `⚠️ ${username}, your message was removed: ${reason}`
    );

    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, notification.message_id);
      } catch (error) {
        logger.debug('Could not delete notification:', error.message);
      }
    }, 15000);

    logger.info('Message auto-moderated', { userId: ctx.from.id, reason });
  } catch (error) {
    logger.error('Error deleting message:', error);
  }
}

/**
 * Enforce warning action: mute or ban based on warning count
 */
async function enforceWarningAction(ctx, warningResult) {
  if (!warningResult) return;

  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
  const { warningCount, action, isMaxWarnings } = warningResult;

  try {
    if (isMaxWarnings || action.type === 'ban') {
      // BAN the user
      await ctx.telegram.banChatMember(chatId, userId);
      const msg = await ctx.telegram.sendMessage(
        chatId,
        `🚫 ${username} ha sido expulsado del grupo. (${warningCount} advertencias)`
      );
      setTimeout(() => ctx.telegram.deleteMessage(chatId, msg.message_id).catch(() => {}), 30000);

      await WarningService.recordAction({
        userId,
        adminId: 'system',
        action: 'ban',
        reason: `Auto-ban: ${warningCount} warnings reached`,
        groupId: chatId,
      });

      logger.info('User auto-banned', { userId, username, warningCount });
    } else if (action.type === 'mute') {
      // MUTE the user
      const muteDuration = action.duration || 24 * 60 * 60 * 1000;
      const until = Math.floor((Date.now() + muteDuration) / 1000);

      await ctx.telegram.restrictChatMember(chatId, userId, {
        until_date: until,
        permissions: { can_send_messages: false },
      });

      const hours = Math.round(muteDuration / (60 * 60 * 1000));
      const msg = await ctx.telegram.sendMessage(
        chatId,
        `🔇 ${username} ha sido silenciado por ${hours}h. (${warningCount}/3 advertencias)`
      );
      setTimeout(() => ctx.telegram.deleteMessage(chatId, msg.message_id).catch(() => {}), 30000);

      await WarningService.recordAction({
        userId,
        adminId: 'system',
        action: 'mute',
        reason: `Auto-mute: ${warningCount} warnings`,
        duration: muteDuration,
        groupId: chatId,
      });

      logger.info('User auto-muted', { userId, username, warningCount, hours });
    }
  } catch (error) {
    logger.error('Error enforcing warning action', { userId, error: error.message });
  }
}

/**
 * Check for URL entities in message
 */
function hasUrlEntities(message) {
  if (!message) return false;
  const entities = message.entities || message.caption_entities || [];
  return entities.some(e => e.type === 'url' || e.type === 'text_link');
}

/**
 * Auto-moderation middleware
 */
const autoModerationMiddleware = () => async (ctx, next) => {
  try {
    // Only process messages in groups
    if (!ctx.message || ctx.chat.type === 'private') {
      return next();
    }

    // Guard against unbounded Map growth during peak usage: if more than 10 000 users
    // are tracked, evict the oldest half to keep memory stable.
    if (userMessageHistory.size > 10000) {
      const entries = Array.from(userMessageHistory.keys());
      const evictCount = Math.floor(entries.length / 2);
      for (let i = 0; i < evictCount; i++) {
        userMessageHistory.delete(entries[i]);
      }
      logger.warn('autoModeration: userMessageHistory exceeded 10 000 entries, evicted oldest half', {
        evicted: evictCount,
        remaining: userMessageHistory.size,
      });
    }

    // Skip if user is exempt
    if (await isExempt(ctx)) {
      return next();
    }

    // Check if user is muted
    const muteStatus = await WarningService.getMuteStatus(ctx.from.id, ctx.chat.id);
    if (muteStatus?.isMuted) {
      await deleteAndNotify(ctx, autoModerationReasons.muted);
      return; // Don't proceed
    }

    const userId = ctx.from.id;
    const message = ctx.message;
    // Get text from message or caption (for photos/videos)
    const messageText = message.text || message.caption || '';

    // ENHANCED: Check for forwarded messages - BLOCK ALL
    if (isForwardedMessage(message)) {
      await deleteAndNotify(ctx, autoModerationReasons.forwarded);

      const result = await WarningService.addWarning({
        userId,
        adminId: 'system',
        reason: 'Auto-moderation: Forwarded message',
        groupId: ctx.chat.id,
      });
      await enforceWarningAction(ctx, result);

      return; // Don't proceed
    }

    // Add message to history (only if has text)
    if (messageText) {
      addToHistory(userId, messageText);

      // Check for spam
      if (checkSpam(userId, messageText)) {
        await deleteAndNotify(ctx, autoModerationReasons.spam);

        const result = await WarningService.addWarning({
          userId,
          adminId: 'system',
          reason: 'Auto-moderation: Spam',
          groupId: ctx.chat.id,
        });
        await enforceWarningAction(ctx, result);

        return; // Don't proceed
      }
    }

    // Check for flooding (all message types)
    if (checkFlood(userId)) {
      await deleteAndNotify(ctx, autoModerationReasons.flood);

      // Mute for 5 minutes
      const muteDuration = 5 * 60 * 1000;
      const until = Math.floor((Date.now() + muteDuration) / 1000);

      await ctx.telegram.restrictChatMember(ctx.chat.id, userId, {
        until_date: until,
        permissions: { can_send_messages: false },
      });

      await WarningService.recordAction({
        userId,
        adminId: 'system',
        action: 'mute',
        reason: 'Auto-moderation: Flooding',
        duration: muteDuration,
        groupId: ctx.chat.id,
      });

      return; // Don't proceed
    }

    // Check for ANY links — delete the message and escalate through the warning system.
    // Respects the 3-strike progression (warn → mute → ban) configured in /groupadmin Filters.
    const hasLink = (messageText && detectAnyLink(messageText)) ||
                    hasUrlEntities(message) ||
                    (message.caption && detectAnyLink(message.caption));
    if (hasLink) {
      await deleteAndNotify(ctx, autoModerationReasons.links);

      const result = await WarningService.addWarning({
        userId,
        adminId: 'system',
        reason: 'Auto-moderation: Link detected',
        groupId: ctx.chat.id,
      });
      await enforceWarningAction(ctx, result);

      logger.info('User warned for link', { userId, username: ctx.from.username, warningCount: result?.warningCount });

      return; // Don't proceed
    }

    // Check for profanity (only if has text)
    if (messageText && checkProfanity(messageText)) {
      await deleteAndNotify(ctx, autoModerationReasons.profanity);

      const result = await WarningService.addWarning({
        userId,
        adminId: 'system',
        reason: 'Auto-moderation: Profanity',
        groupId: ctx.chat.id,
      });
      await enforceWarningAction(ctx, result);

      return; // Don't proceed
    }

    // All checks passed, proceed to next middleware
    return next();
  } catch (error) {
    logger.error('Error in auto-moderation middleware:', error);
    return next(); // Continue on error to avoid blocking legitimate messages
  }
};

// Clean up old message history every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;

  for (const [userId, history] of userMessageHistory.entries()) {
    const filtered = history.filter((msg) => msg.timestamp > cutoff);

    if (filtered.length === 0) {
      userMessageHistory.delete(userId);
    } else {
      userMessageHistory.set(userId, filtered);
    }
  }

  logger.debug('Auto-moderation history cleaned', { activeUsers: userMessageHistory.size });
}, 5 * 60 * 1000);

module.exports = autoModerationMiddleware;
