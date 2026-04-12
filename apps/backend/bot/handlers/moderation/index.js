const ModerationService = require('../../../services/moderationService');
const ChatCleanupService = require('../../../services/chatCleanupService');
const logger = require('../../../utils/logger');
const { t } = require('../../../utils/i18n');

/**
 * Register moderation user handlers
 * @param {Telegraf} bot - Bot instance
 */
const registerModerationHandlers = (bot) => {
  // /rules - Show group rules
  bot.command('rules', handleRules);

  // /warnings - Show my warnings
  bot.command('warnings', handleMyWarnings);
};

/**
 * Handle /rules command
 * Shows group rules
 */
async function handleRules(ctx) {
  try {
    const chatType = ctx.chat?.type;

    // Only works in groups
    if (!chatType || (chatType !== 'group' && chatType !== 'supergroup')) {
      return ctx.reply('This command only works in groups.');
    }

    const groupId = ctx.chat.id;
    const lang = ctx.session?.language || 'en';

    // Get group settings
    const settings = await ModerationService.getStatistics(groupId);

    let rulesMessage = `📋 **${t('moderation.group_rules', lang)}**\n\n`;
    rulesMessage += `Welcome to **${ctx.chat.title}**!\n\n`;
    rulesMessage += 'Please follow these rules:\n\n';

    // Anti-Links
    rulesMessage += '🔗 **Links:** Not allowed (will be deleted)\n';

    // Anti-Spam
    rulesMessage += '📢 **Spam:** No excessive caps, emojis, or repeated characters\n';

    // Anti-Flood
    rulesMessage += '💬 **Flooding:** Maximum 5 messages in 10 seconds\n';

    // Warnings
    rulesMessage += '\n⚠️ **Warning System:**\n';
    rulesMessage += '• You will receive up to 3 warnings\n';
    rulesMessage += '• After 3 warnings, you will be removed from the group\n';
    rulesMessage += '• Use /warnings to check your current warnings\n\n';

    rulesMessage += 'Thank you for helping keep this group safe and friendly! 🙏';

    await ctx.reply(rulesMessage, { parse_mode: 'Markdown' });

    // Note: Both the command and bot reply will be auto-deleted by chatCleanupMiddleware after 5 minutes

    logger.info('Rules displayed', {
      userId: ctx.from.id,
      groupId,
    });
  } catch (error) {
    logger.error('Error handling rules command:', error);
    await ctx.reply('Error loading group rules. Please try again later.');
  }
}

/**
 * Handle /warnings command
 * Shows user's current warnings
 */
async function handleMyWarnings(ctx) {
  try {
    const chatType = ctx.chat?.type;

    // Only works in groups
    if (!chatType || (chatType !== 'group' && chatType !== 'supergroup')) {
      return ctx.reply('This command only works in groups.');
    }

    const userId = ctx.from.id;
    const groupId = ctx.chat.id;
    const lang = ctx.session?.language || 'en';

    // Get user warnings
    const warnings = await ModerationService.getUserWarnings(userId, groupId);

    let message;

    if (!warnings || warnings.totalWarnings === 0) {
      message = `✅ **${t('moderation.no_warnings', lang)}**\n\n`;
      message += 'You have no warnings in this group. Keep up the good behavior!';
    } else {
      message = `⚠️ **${t('moderation.your_warnings', lang)}**\n\n`;
      message += `You have **${warnings.totalWarnings}** warning(s) in this group.\n`;
      message += 'Maximum warnings: **3**\n\n';

      message += '**Recent warnings:**\n';

      // Show last 3 warnings
      const recentWarnings = warnings.warnings.slice(-3).reverse();
      recentWarnings.forEach((warning, index) => {
        const date = new Date(warning.timestamp.toDate());
        const dateStr = date.toLocaleDateString();
        message += `${index + 1}. ${t(`moderation.reason.${warning.reason}`, lang)} - ${dateStr}\n`;
      });

      const remaining = 3 - warnings.totalWarnings;
      if (remaining > 0) {
        message += `\n⚠️ You have **${remaining}** warning(s) remaining before being removed.`;
      } else {
        message += '\n🚫 You have reached the maximum warnings.';
      }
    }

    // Send as private message if possible, otherwise in group
    try {
      await ctx.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });

      // Delete command in group (will be auto-deleted by chatCleanupMiddleware)
      // No need to manually delete
    } catch (error) {
      // User hasn't started bot, send in group
      const sentMessage = await ctx.reply(message, { parse_mode: 'Markdown' });

      // Delete reply after 10 seconds (faster than default 5 min)
      ChatCleanupService.scheduleBotMessage(ctx.telegram, sentMessage, 10000);

      // Command will be auto-deleted by chatCleanupMiddleware after 5 minutes
    }

    logger.info('Warnings checked', {
      userId,
      groupId,
      warningCount: warnings?.totalWarnings || 0,
    });
  } catch (error) {
    logger.error('Error handling warnings command:', error);
    await ctx.reply('Error loading warnings. Please try again later.');
  }
}

module.exports = registerModerationHandlers;
