const ModerationService = require('../../services/moderationService');
const TopicModerationService = require('../../services/topicModerationService');
const ModerationModel = require('../../../models/moderationModel');
const logger = require('../../../utils/logger');
const { isAdmin, isGroupChat } = require('../../../utils/adminUtils');

/**
 * Register moderation admin handlers
 * These are admin-only commands for configuring moderation settings.
 * Note: /ban, /unban, /clearwarnings are handled in moderationCommands.js
 * @param {Telegraf} bot - Bot instance
 */
const registerModerationAdminHandlers = (bot) => {
  // /moderation - Toggle moderation on/off
  bot.command('moderation', handleModerationToggle);

  // /modlogs - View moderation logs
  bot.command('modlogs', handleModLogs);

  // /modstats - View moderation statistics
  bot.command('modstats', handleModStats);

  // /setlinks - Configure link policy
  bot.command('setlinks', handleSetLinks);

  // /userhistory - View username history
  bot.command('userhistory', handleUserHistory);

  // /usernamechanges - View recent username changes in group
  bot.command('usernamechanges', handleUsernameChanges);

  // Topic moderation commands
  bot.command('topicmod', handleTopicModeration);
  bot.command('settopicmod', handleSetTopicModeration);

  logger.info('Moderation admin handlers registered');
};

/**
 * Handle /moderation command
 * Toggle moderation on/off or configure settings
 */
async function handleModerationToggle(ctx) {
  try {
    if (!isGroupChat(ctx)) {
      return ctx.reply('This command only works in groups.');
    }

    if (!(await isAdmin(ctx))) {
      return ctx.reply('⛔ Only administrators can use this command.');
    }

    const groupId = ctx.chat.id;
    const args = ctx.message.text.split(' ').slice(1);
    const action = args[0]?.toLowerCase();

    if (!action || !['on', 'off', 'status'].includes(action)) {
      let helpMessage = '**Moderation Settings**\n\n';
      helpMessage += '**Usage:**\n';
      helpMessage += '`/moderation on` - Enable all moderation features\n';
      helpMessage += '`/moderation off` - Disable all moderation features\n';
      helpMessage += '`/moderation status` - Show current settings\n\n';
      helpMessage += '**Other commands:**\n';
      helpMessage += '`/setlinks <strict|warn|allow>` - Configure link policy\n';
      helpMessage += '`/ban @user [reason]` - Ban user\n';
      helpMessage += '`/unban @user` - Unban user\n';
      helpMessage += '`/clearwarnings @user` - Clear user warnings\n';
      helpMessage += '`/modlogs [limit]` - View moderation logs\n';
      helpMessage += '`/modstats` - View moderation statistics\n';

      return ctx.reply(helpMessage, { parse_mode: 'Markdown' });
    }

    if (action === 'status') {
      const settings = await ModerationModel.getGroupSettings(groupId);

      let statusMessage = '**📊 Moderation Status**\n\n';
      statusMessage += `🔗 Anti-Links: ${settings.antiLinksEnabled ? '✅ Enabled' : '❌ Disabled'}\n`;
      statusMessage += `📢 Anti-Spam: ${settings.antiSpamEnabled ? '✅ Enabled' : '❌ Disabled'}\n`;
      statusMessage += `💬 Anti-Flood: ${settings.antiFloodEnabled ? '✅ Enabled' : '❌ Disabled'}\n`;
      statusMessage += `🚫 Profanity Filter: ${settings.profanityFilterEnabled ? '✅ Enabled' : '❌ Disabled'}\n\n`;
      statusMessage += `⚠️ Max Warnings: ${settings.maxWarnings}\n`;
      statusMessage += `💬 Flood Limit: ${settings.floodLimit} messages / ${settings.floodWindow}s\n`;

      if (settings.allowedDomains && settings.allowedDomains.length > 0) {
        statusMessage += `\n✅ Allowed Domains: ${settings.allowedDomains.join(', ')}`;
      }

      return ctx.reply(statusMessage, { parse_mode: 'Markdown' });
    }

    const enableAll = action === 'on';

    await ModerationService.updateGroupSettings(groupId, {
      antiLinksEnabled: enableAll,
      antiSpamEnabled: enableAll,
      antiFloodEnabled: enableAll,
    });

    const message = enableAll
      ? '✅ Moderation has been **enabled** for this group.'
      : '❌ Moderation has been **disabled** for this group.';

    await ctx.reply(message, { parse_mode: 'Markdown' });

    logger.info('Moderation toggled', {
      groupId,
      adminId: ctx.from.id,
      enabled: enableAll,
    });
  } catch (error) {
    logger.error('Error handling moderation toggle:', error);
    await ctx.reply('Error updating moderation settings.');
  }
}

/**
 * Handle /setlinks command
 * Configure link policy
 */
async function handleSetLinks(ctx) {
  try {
    if (!isGroupChat(ctx)) {
      return ctx.reply('This command only works in groups.');
    }

    if (!(await isAdmin(ctx))) {
      return ctx.reply('⛔ Only administrators can use this command.');
    }

    const groupId = ctx.chat.id;
    const args = ctx.message.text.split(' ').slice(1);
    const policy = args[0]?.toLowerCase();

    if (!policy || !['strict', 'warn', 'allow'].includes(policy)) {
      let helpMessage = '**Link Policy Configuration**\n\n';
      helpMessage += '**Usage:** `/setlinks <policy>`\n\n';
      helpMessage += '**Policies:**\n';
      helpMessage += '• `strict` - Delete all links immediately\n';
      helpMessage += '• `warn` - Warn users before deleting (default)\n';
      helpMessage += '• `allow` - Allow all links\n';

      return ctx.reply(helpMessage, { parse_mode: 'Markdown' });
    }

    const enabled = policy !== 'allow';

    await ModerationService.updateGroupSettings(groupId, {
      antiLinksEnabled: enabled,
    });

    const message = policy === 'allow'
      ? '✅ Links are now **allowed** in this group.'
      : `✅ Link policy set to **${policy}** mode.`;

    await ctx.reply(message, { parse_mode: 'Markdown' });

    logger.info('Link policy updated', {
      groupId,
      adminId: ctx.from.id,
      policy,
    });
  } catch (error) {
    logger.error('Error setting link policy:', error);
    await ctx.reply('Error updating link policy.');
  }
}

/**
 * Handle /modlogs command
 * View moderation logs
 */
async function handleModLogs(ctx) {
  try {
    if (!isGroupChat(ctx)) {
      return ctx.reply('This command only works in groups.');
    }

    if (!(await isAdmin(ctx))) {
      return ctx.reply('⛔ Only administrators can use this command.');
    }

    const groupId = ctx.chat.id;
    const args = ctx.message.text.split(' ').slice(1);
    const limit = parseInt(args[0], 10) || 10;

    const logs = await ModerationService.getLogs(groupId, Math.min(limit, 50));

    if (logs.length === 0) {
      return ctx.reply('No moderation logs found.');
    }

    let message = `📋 **Moderation Logs** (Last ${logs.length})\n\n`;

    logs.forEach((log, index) => {
      const date = new Date(log.timestamp.toDate());
      const dateStr = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;

      message += `**${index + 1}.** ${log.action}\n`;
      message += `   User: ${log.userId || 'N/A'}\n`;
      message += `   Reason: ${log.reason || 'N/A'}\n`;
      message += `   Date: ${dateStr}\n\n`;
    });

    // Send as document if too long
    if (message.length > 4000) {
      message = `${message.substring(0, 4000)}\n\n_...truncated_`;
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });

    logger.info('Moderation logs viewed', {
      groupId,
      adminId: ctx.from.id,
      count: logs.length,
    });
  } catch (error) {
    logger.error('Error viewing moderation logs:', error);
    await ctx.reply('Error loading moderation logs.');
  }
}

/**
 * Handle /modstats command
 * View moderation statistics
 */
async function handleModStats(ctx) {
  try {
    if (!isGroupChat(ctx)) {
      return ctx.reply('This command only works in groups.');
    }

    if (!(await isAdmin(ctx))) {
      return ctx.reply('⛔ Only administrators can use this command.');
    }

    const groupId = ctx.chat.id;
    const stats = await ModerationService.getStatistics(groupId);

    let message = '📊 **Moderation Statistics**\n\n';
    message += `⚠️ Total Warnings: ${stats.totalWarnings}\n`;
    message += `👥 Users with Warnings: ${stats.usersWithWarnings}\n`;
    message += `🚫 Total Bans: ${stats.totalBans}\n`;
    message += `⚡ Recent Actions (24h): ${stats.recentActions}\n`;

    await ctx.reply(message, { parse_mode: 'Markdown' });

    logger.info('Moderation stats viewed', {
      groupId,
      adminId: ctx.from.id,
    });
  } catch (error) {
    logger.error('Error viewing moderation stats:', error);
    await ctx.reply('Error loading moderation statistics.');
  }
}

/**
 * Handle /userhistory command
 * View username change history for a specific user
 */
async function handleUserHistory(ctx) {
  try {
    if (!isGroupChat(ctx)) {
      return ctx.reply('This command only works in groups.');
    }

    if (!(await isAdmin(ctx))) {
      return ctx.reply('⛔ Only administrators can use this command.');
    }

    const args = ctx.message.text.split(' ').slice(1);
    let targetUserId;

    // Get user from reply or argument
    if (ctx.message.reply_to_message) {
      targetUserId = ctx.message.reply_to_message.from.id;
    } else if (args[0]) {
      targetUserId = args[0];
    } else {
      return ctx.reply('Usage: `/userhistory <user_id>` or reply to a user\'s message with `/userhistory`', {
        parse_mode: 'Markdown',
      });
    }

    // Get username history
    const history = await ModerationModel.getUsernameHistory(targetUserId, 20);

    if (history.length === 0) {
      return ctx.reply('No username history found for this user.');
    }

    let message = '📋 **Username History**\n\n';
    message += `👤 **User ID:** ${targetUserId}\n`;
    message += `📊 **Total Changes:** ${history.length}\n\n`;

    history.forEach((record, index) => {
      const date = new Date(record.changedAt.toDate());
      const dateStr = date.toLocaleString();

      message += `**${index + 1}.** ${dateStr}\n`;
      message += `   From: @${record.oldUsername || 'none'}\n`;
      message += `   To: @${record.newUsername || 'none'}\n`;

      if (record.flagged) {
        message += `   🚩 **FLAGGED:** ${record.flagReason || 'Suspicious'}\n`;
      }

      message += '\n';
    });

    // Send as file if too long
    if (message.length > 4000) {
      message = `${message.substring(0, 4000)}\n\n_...truncated_`;
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });

    logger.info('Username history viewed', {
      groupId: ctx.chat.id,
      adminId: ctx.from.id,
      targetUserId,
      historyCount: history.length,
    });
  } catch (error) {
    logger.error('Error viewing username history:', error);
    await ctx.reply('Error loading username history.');
  }
}

/**
 * Handle /usernamechanges command
 * View recent username changes in the group
 */
async function handleUsernameChanges(ctx) {
  try {
    if (!isGroupChat(ctx)) {
      return ctx.reply('This command only works in groups.');
    }

    if (!(await isAdmin(ctx))) {
      return ctx.reply('⛔ Only administrators can use this command.');
    }

    const groupId = ctx.chat.id;
    const args = ctx.message.text.split(' ').slice(1);
    const limit = parseInt(args[0], 10) || 20;

    // Get recent username changes
    const changes = await ModerationModel.getRecentUsernameChanges(groupId, Math.min(limit, 50));

    if (changes.length === 0) {
      return ctx.reply('No username changes recorded in this group yet.');
    }

    let message = '📋 **Recent Username Changes**\n\n';
    message += `📊 **Last ${changes.length} changes:**\n\n`;

    changes.forEach((record, index) => {
      const date = new Date(record.changedAt.toDate());
      const dateStr = date.toLocaleDateString();

      message += `**${index + 1}.** User ID: ${record.userId}\n`;
      message += `   ${dateStr}: @${record.oldUsername || 'none'} → @${record.newUsername || 'none'}\n`;

      if (record.flagged) {
        message += '   🚩 FLAGGED\n';
      }

      message += '\n';
    });

    message += '\nUse /userhistory <user_id> to see full history for a specific user.';

    // Send as file if too long
    if (message.length > 4000) {
      message = `${message.substring(0, 4000)}\n\n_...truncated_`;
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });

    logger.info('Username changes viewed', {
      groupId,
      adminId: ctx.from.id,
      count: changes.length,
    });
  } catch (error) {
    logger.error('Error viewing username changes:', error);
    await ctx.reply('Error loading username changes.');
  }
}

/**
 * Handle /topicmod command
 * View topic moderation status
 */
async function handleTopicModeration(ctx) {
  try {
    if (!isGroupChat(ctx)) {
      return ctx.reply('This command only works in groups.');
    }

    if (!(await isAdmin(ctx))) {
      return ctx.reply('⛔ Only administrators can use this command.');
    }

    // Get topic ID from current message
    const topicId = ctx.message.message_thread_id;
    
    if (!topicId) {
      return ctx.reply('This command must be used within a topic.');
    }

    const status = await TopicModerationService.getTopicModerationStatus(topicId);

    let message = `📊 **Topic ${topicId} Moderation Status**\n\n`;
    message += `🔗 Anti-Links: ${status.anti_links_enabled ? '✅ Enabled' : '❌ Disabled'}\n`;
    message += `📢 Anti-Spam: ${status.anti_spam_enabled ? '✅ Enabled' : '❌ Disabled'}\n`;
    message += `💬 Anti-Flood: ${status.anti_flood_enabled ? '✅ Enabled' : '❌ Disabled'}\n`;
    
    if (status.max_posts_per_hour) {
      message += `⏳ Max Posts/Hour: ${status.max_posts_per_hour}\n`;
    }
    
    if (status.allowed_domains && status.allowed_domains.length > 0) {
      message += `\n✅ Allowed Domains: ${status.allowed_domains.join(', ')}`;
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });

    logger.info('Topic moderation status viewed', {
      topicId,
      adminId: ctx.from.id,
    });
  } catch (error) {
    logger.error('Error viewing topic moderation status:', error);
    await ctx.reply('Error loading topic moderation status.');
  }
}

/**
 * Handle /settopicmod command
 * Configure topic moderation settings
 */
async function handleSetTopicModeration(ctx) {
  try {
    if (!isGroupChat(ctx)) {
      return ctx.reply('This command only works in groups.');
    }

    if (!(await isAdmin(ctx))) {
      return ctx.reply('⛔ Only administrators can use this command.');
    }

    // Get topic ID from current message
    const topicId = ctx.message.message_thread_id;
    
    if (!topicId) {
      return ctx.reply('This command must be used within a topic.');
    }

    const args = ctx.message.text.split(' ').slice(1);
    const action = args[0]?.toLowerCase();

    if (!action || !['on', 'off', 'spam', 'flood', 'links', 'limit'].includes(action)) {
      let helpMessage = '**Topic Moderation Settings**\n\n';
      helpMessage += '**Usage:**\n';
      helpMessage += '`/settopicmod on` - Enable all topic moderation\n';
      helpMessage += '`/settopicmod off` - Disable all topic moderation\n';
      helpMessage += '`/settopicmod spam on|off` - Toggle anti-spam\n';
      helpMessage += '`/settopicmod flood on|off` - Toggle anti-flood\n';
      helpMessage += '`/settopicmod links on|off` - Toggle anti-links\n';
      helpMessage += '`/settopicmod limit <number>` - Set max posts/hour\n';

      return ctx.reply(helpMessage, { parse_mode: 'Markdown' });
    }

    const settings = {};

    if (action === 'on') {
      settings.anti_spam_enabled = true;
      settings.anti_flood_enabled = true;
      settings.anti_links_enabled = true;
    } else if (action === 'off') {
      settings.anti_spam_enabled = false;
      settings.anti_flood_enabled = false;
      settings.anti_links_enabled = false;
    } else if (action === 'spam') {
      const value = args[1]?.toLowerCase();
      if (value === 'on' || value === 'off') {
        settings.anti_spam_enabled = value === 'on';
      } else {
        return ctx.reply('Usage: /settopicmod spam on|off');
      }
    } else if (action === 'flood') {
      const value = args[1]?.toLowerCase();
      if (value === 'on' || value === 'off') {
        settings.anti_flood_enabled = value === 'on';
      } else {
        return ctx.reply('Usage: /settopicmod flood on|off');
      }
    } else if (action === 'links') {
      const value = args[1]?.toLowerCase();
      if (value === 'on' || value === 'off') {
        settings.anti_links_enabled = value === 'on';
      } else {
        return ctx.reply('Usage: /settopicmod links on|off');
      }
    } else if (action === 'limit') {
      const limit = parseInt(args[1]);
      if (isNaN(limit) || limit < 1 || limit > 1000) {
        return ctx.reply('Usage: /settopicmod limit <number> (1-1000)');
      }
      settings.max_posts_per_hour = limit;
    }

    const success = await TopicModerationService.updateTopicModerationSettings(topicId, settings);

    if (success) {
      const status = await TopicModerationService.getTopicModerationStatus(topicId);
      
      let message = '✅ Topic moderation settings updated:\n\n';
      message += `📢 Anti-Spam: ${status.anti_spam_enabled ? 'Enabled' : 'Disabled'}\n`;
      message += `💬 Anti-Flood: ${status.anti_flood_enabled ? 'Enabled' : 'Disabled'}\n`;
      message += `🔗 Anti-Links: ${status.anti_links_enabled ? 'Enabled' : 'Disabled'}\n`;
      
      if (status.max_posts_per_hour) {
        message += `⏳ Max Posts/Hour: ${status.max_posts_per_hour}`;
      }

      await ctx.reply(message, { parse_mode: 'Markdown' });

      logger.info('Topic moderation settings updated', {
        topicId,
        adminId: ctx.from.id,
        settings,
      });
    } else {
      await ctx.reply('❌ Failed to update topic moderation settings.');
    }
  } catch (error) {
    logger.error('Error updating topic moderation settings:', error);
    await ctx.reply('Error updating topic moderation settings.');
  }
}

module.exports = registerModerationAdminHandlers;
