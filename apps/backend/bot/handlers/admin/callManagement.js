const { Markup } = require('telegraf');
const CallService = require('../../../services/callService');
const logger = require('../../../utils/logger');

/**
 * Admin call management handlers
 * @param {Telegraf} bot - Bot instance
 */
const registerCallManagementHandlers = (bot) => {
  // Show call management menu
  bot.action('admin_call_management', async (ctx) => {
    try {
      const availability = await CallService.getAvailability();
      const stats = await CallService.getStatistics();

      const statusEmoji = availability.available ? '🟢' : '🔴';
      const statusText = availability.available ? 'Available' : 'Not Available';

      const message = '📞 *Private Call Management*\n\n'
        + `${statusEmoji} Status: ${statusText}\n`
        + `📊 Total Calls: ${stats.total}\n`
        + `✅ Completed: ${stats.completed}\n`
        + `📅 Upcoming: ${stats.pending + stats.confirmed}\n`
        + `💰 Total Revenue: $${stats.revenue}\n\n`
        + 'Use the buttons below to manage your availability:';

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '🟢 Mark Available',
              'set_call_availability_true',
            ),
            Markup.button.callback(
              '🔴 Mark Unavailable',
              'set_call_availability_false',
            ),
          ],
          [
            Markup.button.callback(
              '📢 Broadcast Availability',
              'broadcast_call_availability',
            ),
          ],
          [
            Markup.button.callback(
              '📋 View Upcoming Calls',
              'view_upcoming_calls',
            ),
          ],
          [Markup.button.callback('🔙 Back', 'admin_home')],
        ]),
      });
    } catch (error) {
      logger.error('Error showing call management:', error);
    }
  });

  // Set availability to available
  bot.action('set_call_availability_true', async (ctx) => {
    try {
      const adminId = ctx.from.id;

      // Set availability for 24 hours
      const validUntil = new Date();
      validUntil.setHours(validUntil.getHours() + 24);

      await CallService.setAvailability({
        adminId,
        available: true,
        message: '🟢 I\'m now available for 1:1 calls! Book yours now.',
        validUntil,
      });

      await ctx.answerCbQuery('✅ Marked as available for 24 hours');
      await ctx.editMessageText(
        '✅ *Availability Updated*\n\n'
        + 'You are now marked as available for private calls.\n'
        + 'This will expire in 24 hours.\n\n'
        + 'Do you want to notify users?',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                '📢 Yes, Notify Users',
                'broadcast_call_availability',
              ),
            ],
            [Markup.button.callback('⏭ Skip Notification', 'admin_call_management')],
          ]),
        },
      );
    } catch (error) {
      logger.error('Error setting availability:', error);
      await ctx.answerCbQuery('❌ Error updating availability');
    }
  });

  // Set availability to unavailable
  bot.action('set_call_availability_false', async (ctx) => {
    try {
      const adminId = ctx.from.id;

      await CallService.setAvailability({
        adminId,
        available: false,
        message: '🔴 Not available for calls at the moment.',
        validUntil: null,
      });

      await ctx.answerCbQuery('✅ Marked as unavailable');
      await ctx.editMessageText(
        '✅ *Availability Updated*\n\n'
        + 'You are now marked as unavailable for private calls.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back', 'admin_call_management')],
          ]),
        },
      );
    } catch (error) {
      logger.error('Error setting availability:', error);
      await ctx.answerCbQuery('❌ Error updating availability');
    }
  });

  // Broadcast availability
  bot.action('broadcast_call_availability', async (ctx) => {
    try {
      const availability = await CallService.getAvailability();

      if (!availability.available) {
        await ctx.answerCbQuery('⚠️ You are not available. Mark yourself available first.');
        return;
      }

      await ctx.answerCbQuery('📢 Broadcasting to all users...');

      const broadcastMessage = '🎉 *Great News!*\n\n'
        + '📞 We\'re now available for *Private 1:1 Calls*!\n\n'
        + '👥 *Choose your performer:*\n'
        + '• 🎭 Santino\n'
        + '• 🎤 Lex Boy\n\n'
        + '💎 *What you get:*\n'
        + '• 45 minutes of personalized consultation\n'
        + '• Direct video call (HD quality)\n'
        + '• Expert advice and guidance\n'
        + '• ⚡ Quick scheduling (can start in 15 min!)\n'
        + '• Or schedule for later\n\n'
        + '💰 Price: $100 USD (pay with Zelle, CashApp, Venmo, Revolut, Wise)\n\n'
        + '🚀 *Limited slots available!*\n'
        + 'Book your call now before they\'re gone.';

      const results = await CallService.broadcastAvailability(
        ctx.telegram,
        broadcastMessage,
      );

      await ctx.editMessageText(
        '📢 *Broadcast Completed*\n\n'
        + `✅ Sent: ${results.sent}\n`
        + `❌ Failed: ${results.failed}\n`
        + `📊 Total: ${results.total}`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back', 'admin_call_management')],
          ]),
        },
      );
    } catch (error) {
      logger.error('Error broadcasting availability:', error);
      await ctx.answerCbQuery('❌ Error broadcasting');
    }
  });

  // View upcoming calls
  bot.action('view_upcoming_calls', async (ctx) => {
    try {
      const calls = await CallService.getUpcomingCalls();

      if (calls.length === 0) {
        await ctx.editMessageText(
          '📅 *Upcoming Calls*\n\n'
          + 'No upcoming calls scheduled.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Back', 'admin_call_management')],
            ]),
          },
        );
        return;
      }

      let message = '📅 *Upcoming Calls*\n\n';

      calls.forEach((call, index) => {
        const date = new Date(call.scheduledDate);
        const dateStr = date.toLocaleDateString();

        message
          += `${index + 1}. ${call.userName} (@${call.userUsername || 'N/A'})\n`
          + `   📅 ${dateStr} at ${call.scheduledTime}\n`
          + `   🔗 ${call.meetingUrl}\n`
          + `   Status: ${call.status}\n\n`;
      });

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Back', 'admin_call_management')],
        ]),
      });
    } catch (error) {
      logger.error('Error viewing upcoming calls:', error);
      await ctx.answerCbQuery('❌ Error loading calls');
    }
  });

  // Command to quickly set availability (shortcut)
  bot.command('available', async (ctx) => {
    try {
      // Check if user is admin
      const adminIds = process.env.ADMIN_USER_IDS?.split(',').map(Number) || [];
      if (!adminIds.includes(ctx.from.id)) {
        return;
      }

      const validUntil = new Date();
      validUntil.setHours(validUntil.getHours() + 24);

      await CallService.setAvailability({
        adminId: ctx.from.id,
        available: true,
        message: '🟢 I\'m now available for 1:1 calls!',
        validUntil,
      });

      await ctx.reply(
        '✅ You are now available for 24 hours.\n\n'
        + 'Send /broadcast to notify users.',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📢 Broadcast Now', callback_data: 'broadcast_call_availability' }],
            ],
          },
        },
      );
    } catch (error) {
      logger.error('Error in /available command:', error);
    }
  });

  // Command to quickly broadcast
  bot.command('broadcast', async (ctx) => {
    try {
      // Check if user is admin
      const adminIds = process.env.ADMIN_USER_IDS?.split(',').map(Number) || [];
      if (!adminIds.includes(ctx.from.id)) {
        return;
      }

      const availability = await CallService.getAvailability();

      if (!availability.available) {
        await ctx.reply('⚠️ You are not marked as available. Use /available first.');
        return;
      }

      const broadcastMessage = '🎉 *Great News!*\n\n'
        + '📞 We\'re now available for *Private 1:1 Calls*!\n\n'
        + '👥 *Choose your performer:*\n'
        + '• 🎭 Santino\n'
        + '• 🎤 Lex Boy\n\n'
        + '💎 *What you get:*\n'
        + '• 45 minutes of personalized consultation\n'
        + '• Direct video call (HD quality)\n'
        + '• Expert advice and guidance\n'
        + '• ⚡ Quick scheduling (can start in 15 min!)\n'
        + '• Or schedule for later\n\n'
        + '💰 Price: $100 USD (pay with Zelle, CashApp, Venmo, Revolut, Wise)\n\n'
        + '🚀 *Limited slots available!*\n'
        + 'Book your call now before they\'re gone.';

      await ctx.reply('📢 Broadcasting to all users...');

      const results = await CallService.broadcastAvailability(
        ctx.telegram,
        broadcastMessage,
      );

      await ctx.reply(
        '📢 *Broadcast Completed*\n\n'
        + `✅ Sent: ${results.sent}\n`
        + `❌ Failed: ${results.failed}\n`
        + `📊 Total: ${results.total}`,
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      logger.error('Error in /broadcast command:', error);
    }
  });
};

module.exports = registerCallManagementHandlers;
