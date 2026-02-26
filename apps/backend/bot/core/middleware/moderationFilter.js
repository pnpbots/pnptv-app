const ModerationService = require('../../services/moderationService');
const ChatCleanupService = require('../../services/chatCleanupService');
const logger = require('../../../utils/logger');
const { t } = require('../../../utils/i18n');

/**
 * Moderation filter middleware
 * Filters messages in groups based on moderation rules
 * @returns {Function} Middleware function
 */
const moderationFilter = () => async (ctx, next) => {
  try {
    // Only moderate group/supergroup messages
    const chatType = ctx.chat?.type;
    if (!chatType || (chatType !== 'group' && chatType !== 'supergroup')) {
      return next();
    }

    const groupId = ctx.chat.id;
    const userId = ctx.from?.id;
    const message = ctx.message || ctx.editedMessage;

    // Skip if no message or user
    if (!message || !userId) {
      return next();
    }

    // Skip if message is from a bot
    if (ctx.from?.is_bot) {
      return next();
    }

    // Check if user is admin/creator (admins bypass moderation)
    try {
      const chatMember = await ctx.getChatMember(userId);
      const isAdmin = ['creator', 'administrator'].includes(chatMember.status);

      if (isAdmin) {
        return next();
      }
    } catch (error) {
      logger.error('Error checking chat member status:', error);
      // Continue with moderation if we can't verify admin status
    }

    // Process message through moderation service
    const result = await ModerationService.processMessage(message, groupId);

    if (!result.shouldModerate) {
      return next();
    }

    // Get language
    const lang = ctx.session?.language || 'en';

    // Handle moderation action
    switch (result.action) {
      case 'delete':
        await handleDelete(ctx, result, lang);
        break;

      case 'warn':
        await handleWarn(ctx, result, lang);
        break;

      case 'warn_and_delete':
        await handleWarnAndDelete(ctx, result, lang);
        break;

      default:
        logger.warn('Unknown moderation action', { action: result.action });
        return next();
    }

    // Don't call next() - message has been moderated
  } catch (error) {
    logger.error('Moderation filter error:', error);
    // On error, allow message through
    return next();
  }
};

/**
 * Handle delete action (banned users)
 * @param {Object} ctx - Telegraf context
 * @param {Object} result - Moderation result
 * @param {string} _lang - Language code (unused)
 */
async function handleDelete(ctx, result, _lang) {
  try {
    // Delete the message
    await ctx.deleteMessage();

    logger.info('Message deleted (user banned)', {
      userId: ctx.from.id,
      groupId: ctx.chat.id,
      reason: result.reason,
    });
  } catch (error) {
    logger.error('Error deleting message:', error);
  }
}

/**
 * Handle warn action (flooding)
 * @param {Object} ctx - Telegraf context
 * @param {Object} result - Moderation result
 * @param {string} lang - Language code
 */
async function handleWarn(ctx, result, lang) {
  try {
    const userId = ctx.from.id;
    const groupId = ctx.chat.id;

    // Add warning
    const warningResult = await ModerationService.addWarning(
      userId,
      groupId,
      result.reason,
      result.details,
    );

    // Send warning message (delete after 10 seconds)
    const warningMessage = formatWarningMessage(
      ctx.from,
      warningResult,
      result.reason,
      lang,
    );

    const sentMessage = await ctx.reply(warningMessage, {
      parse_mode: 'Markdown',
    });

    // Delete warning message after 10 seconds
    ChatCleanupService.scheduleBotMessage(ctx.telegram, sentMessage, 10000);

    // If user should be banned, kick them
    if (warningResult.shouldBan) {
      await kickUser(ctx, userId, groupId, result.reason, lang);
    }

    logger.info('User warned', {
      userId,
      groupId,
      reason: result.reason,
      warningCount: warningResult.warningCount,
    });
  } catch (error) {
    logger.error('Error handling warn action:', error);
  }
}

/**
 * Handle warn and delete action (links, spam, profanity)
 * @param {Object} ctx - Telegraf context
 * @param {Object} result - Moderation result
 * @param {string} lang - Language code
 */
async function handleWarnAndDelete(ctx, result, lang) {
  try {
    const userId = ctx.from.id;
    const groupId = ctx.chat.id;

    // Delete the offending message
    await ctx.deleteMessage();

    // Add warning
    const warningResult = await ModerationService.addWarning(
      userId,
      groupId,
      result.reason,
      result.details,
    );

    // Send warning message in the group (delete after 10 seconds)
    const warningMessage = formatWarningMessage(
      ctx.from,
      warningResult,
      result.reason,
      lang,
    );

    const sentMessage = await ctx.reply(warningMessage, {
      parse_mode: 'Markdown',
    });

    // Delete warning message after 10 seconds
    ChatCleanupService.scheduleBotMessage(ctx.telegram, sentMessage, 10000);

    // Try to send a private message to the user
    try {
      await ctx.telegram.sendMessage(
        userId,
        formatPrivateWarningMessage(warningResult, result.reason, ctx.chat.title, lang),
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      logger.debug('Could not send private warning to user:', error.message);
    }

    // If user should be banned, kick them
    if (warningResult.shouldBan) {
      await kickUser(ctx, userId, groupId, result.reason, lang);
    }

    logger.info('Message deleted and user warned', {
      userId,
      groupId,
      reason: result.reason,
      warningCount: warningResult.warningCount,
    });
  } catch (error) {
    logger.error('Error handling warn and delete action:', error);
  }
}

/**
 * Kick user from group
 * @param {Object} ctx - Telegraf context
 * @param {number|string} userId - User ID
 * @param {number|string} groupId - Group ID
 * @param {string} reason - Kick reason
 * @param {string} lang - Language code
 */
async function kickUser(ctx, userId, groupId, reason, lang) {
  try {
    // Ban user in database
    await ModerationService.banUser(userId, groupId, reason, 'system');

    // Kick from Telegram group
    await ctx.kickChatMember(userId);

    // Unban immediately (so they can rejoin if invited, but message history is preserved)
    // Comment this line if you want permanent bans
    setTimeout(async () => {
      try {
        await ctx.unbanChatMember(userId);
      } catch (error) {
        logger.debug('Could not unban user:', error.message);
      }
    }, 1000);

    // Notify group
    const userName = ctx.from.first_name || 'User';
    const kickMessage = `🚫 ${t('moderation.user_kicked', lang)}\n\n`
      + `👤 **${userName}** has been removed from the group.\n`
      + `📋 **Reason:** ${t(`moderation.reason.${reason}`, lang)}\n`
      + '⚠️ Maximum warnings (3) reached.';

    const sentMessage = await ctx.reply(kickMessage, { parse_mode: 'Markdown' });

    // Delete kick message after 30 seconds
    ChatCleanupService.scheduleBotMessage(ctx.telegram, sentMessage, 30000);

    logger.info('User kicked from group', { userId, groupId, reason });
  } catch (error) {
    logger.error('Error kicking user:', error);
  }
}

/**
 * Format warning message for group chat
 * @param {Object} user - Telegram user
 * @param {Object} warningResult - Warning result
 * @param {string} reason - Warning reason
 * @param {string} lang - Language code
 * @returns {string} Formatted message
 */
function formatWarningMessage(user, warningResult, reason, lang) {
  const userName = user.first_name || 'User';
  const { warningCount, maxWarnings } = warningResult;

  let message = `⚠️ **${t('moderation.warning', lang)}**\n\n`;
  message += `👤 ${userName}\n`;
  message += `📋 ${t(`moderation.reason.${reason}`, lang)}\n`;
  message += `⚠️ Warning **${warningCount}** of **${maxWarnings}**\n\n`;

  if (warningCount < maxWarnings) {
    const remaining = maxWarnings - warningCount;
    message += `You have ${remaining} warning(s) remaining before being removed from the group.`;
  } else {
    message += 'Maximum warnings reached. You will be removed from the group.';
  }

  return message;
}

/**
 * Format private warning message for user
 * @param {Object} warningResult - Warning result
 * @param {string} reason - Warning reason
 * @param {string} groupTitle - Group title
 * @param {string} lang - Language code
 * @returns {string} Formatted message
 */
function formatPrivateWarningMessage(warningResult, reason, groupTitle, lang) {
  const { warningCount, maxWarnings } = warningResult;

  let message = `⚠️ **${t('moderation.warning', lang)}**\n\n`;
  message += `You received a warning in **${groupTitle}**\n\n`;
  message += `📋 **Reason:** ${t(`moderation.reason.${reason}`, lang)}\n`;
  message += `⚠️ **Warning ${warningCount} of ${maxWarnings}**\n\n`;

  if (warningCount < maxWarnings) {
    const remaining = maxWarnings - warningCount;
    message += `You have **${remaining} warning(s)** remaining.\n\n`;
    message += 'Please follow the group rules to avoid being removed.';
  } else {
    message += '⛔ You have reached the maximum number of warnings and will be removed from the group.';
  }

  return message;
}

module.exports = moderationFilter;
