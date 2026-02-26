const logger = require('../../../utils/logger');
const { isUserBlocked, getUserChangeCount, getUserChangeHistory, unblockUser } = require('../../core/middleware/usernameChangeDetection');

/**
 * Register username change detection admin commands
 */
function registerUsernameChangeAdminHandlers(bot) {
  /**
   * Check user name change status - /checkuserstatus <user_id>
   */
  bot.command('checkuserstatus', async (ctx) => {
    try {
      const adminId = process.env.ADMIN_ID || process.env.ADMIN_USER_IDS?.split(',')[0];
      if (String(ctx.from.id) !== String(adminId)) {
        await ctx.reply('🚫 Unauthorized');
        return;
      }

      const args = ctx.message.text.split(' ');
      const userId = args[1];

      if (!userId || isNaN(userId)) {
        await ctx.reply(
          '📋 Check user name change status\n\n' +
          '`/checkuserstatus <user_id>`\n\n' +
          'Example: `/checkuserstatus 123456789`',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const isBlocked = await isUserBlocked(userId);
      const changeCount = await getUserChangeCount(userId);
      const history = await getUserChangeHistory(userId);

      let status = `👤 **User Status:** ${userId}\n\n`;
      status += `🔒 **Blocked:** ${isBlocked ? '❌ YES' : '✅ NO'}\n`;
      status += `📊 **Changes (24h):** ${changeCount}/3\n`;
      status += `📝 **History:** ${history.length} changes recorded\n\n`;

      if (history.length > 0) {
        status += '**Recent Changes:**\n';
        history.slice(-5).reverse().forEach((change, i) => {
          const time = new Date(change.timestamp).toLocaleString();
          status += `${i + 1}. [${time}] ${change.type}\n`;
          if (change.type === 'username' || change.type === 'both') {
            status += `   @${change.oldUsername} → @${change.newUsername}\n`;
          }
          if (change.type === 'name' || change.type === 'both') {
            status += `   "${change.oldName}" → "${change.newName}"\n`;
          }
        });
      }

      const keyboard = [];
      if (isBlocked) {
        keyboard.push([
          { text: '✅ Unblock User', callback_data: `unblock_user:${userId}` }
        ]);
      }

      const { Markup } = require('telegraf');
      await ctx.reply(status, {
        parse_mode: 'Markdown',
        ...(keyboard.length > 0 ? Markup.inlineKeyboard(keyboard) : {})
      });

    } catch (error) {
      logger.error('Error checking user status:', error);
      await ctx.reply('❌ Error checking user status');
    }
  });

  /**
   * Unblock user - /unblockuser <user_id>
   */
  bot.command('unblockuser', async (ctx) => {
    try {
      const adminId = process.env.ADMIN_ID || process.env.ADMIN_USER_IDS?.split(',')[0];
      if (String(ctx.from.id) !== String(adminId)) {
        await ctx.reply('🚫 Unauthorized');
        return;
      }

      const args = ctx.message.text.split(' ');
      const userId = args[1];

      if (!userId || isNaN(userId)) {
        await ctx.reply(
          '🔓 Unblock a user\n\n' +
          '`/unblockuser <user_id>`\n\n' +
          'Example: `/unblockuser 123456789`',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const isBlocked = await isUserBlocked(userId);
      if (!isBlocked) {
        await ctx.reply(`✅ User ${userId} is not blocked`);
        return;
      }

      const success = await unblockUser(userId);
      if (success) {
        await ctx.reply(
          `✅ **User Unblocked**\n\n` +
          `ID: ${userId}\n` +
          `Reason: Excessive name changes block removed\n\n` +
          `The user can now use the bot normally.`,
          { parse_mode: 'Markdown' }
        );
        logger.info('Admin unblocked user', { adminId: ctx.from.id, userId });
      } else {
        await ctx.reply('❌ Error unblocking user');
      }

    } catch (error) {
      logger.error('Error unblocking user:', error);
      await ctx.reply('❌ Error unblocking user');
    }
  });

  /**
   * Handle unblock button callback
   */
  bot.action(/^unblock_user:(.+)$/, async (ctx) => {
    try {
      const adminId = process.env.ADMIN_ID || process.env.ADMIN_USER_IDS?.split(',')[0];
      if (String(ctx.from.id) !== String(adminId)) {
        await ctx.answerCbQuery('🚫 Unauthorized', { show_alert: true });
        return;
      }

      const userId = ctx.match[1];
      const success = await unblockUser(userId);

      if (success) {
        await ctx.editMessageText(
          `✅ **User Unblocked**\n\n` +
          `ID: ${userId}\n` +
          `Unblocked by: ${ctx.from.first_name}`,
          { parse_mode: 'Markdown' }
        );
        await ctx.answerCbQuery('✅ User unblocked');
        logger.info('Admin unblocked user via button', { adminId: ctx.from.id, userId });
      } else {
        await ctx.answerCbQuery('❌ Error unblocking user', { show_alert: true });
      }

    } catch (error) {
      logger.error('Error in unblock callback:', error);
      await ctx.answerCbQuery('❌ Error', { show_alert: true });
    }
  });
}

module.exports = registerUsernameChangeAdminHandlers;
