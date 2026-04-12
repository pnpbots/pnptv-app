const PaymentService = require('../../../services/paymentService');
const CallService = require('../../../services/callService');
const logger = require('../../../utils/logger');

/**
 * Payment Analytics Handlers - Admin dashboard for payment analytics
 */
function registerPaymentAnalyticsHandlers(bot) {
  /**
   * Check if user is admin
   */
  function isAdmin(userId) {
    const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(id => parseInt(id.trim()));
    return adminIds.includes(userId);
  }

  /**
   * Show analytics dashboard
   */
  bot.command('analytics', async (ctx) => {
    try {
      if (!isAdmin(ctx.from.id)) {
        await ctx.reply('❌ This command is only available for administrators.');
        return;
      }

      const keyboard = {
        inline_keyboard: [
          [
            { text: '📊 Payment Analytics', callback_data: 'analytics_payments' },
            { text: '📞 Call Analytics', callback_data: 'analytics_calls' },
          ],
          [
            { text: '📅 This Month', callback_data: 'analytics_month' },
            { text: '📆 This Week', callback_data: 'analytics_week' },
          ],
          [
            { text: '📈 All Time', callback_data: 'analytics_all_time' },
          ],
        ],
      };

      await ctx.reply(
        '📊 *Analytics Dashboard*\n\n' +
        'Select an analytics view:',
        {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        }
      );
    } catch (error) {
      logger.error('Error showing analytics dashboard:', error);
      await ctx.reply('❌ Error loading analytics dashboard.');
    }
  });

  /**
   * Show payment analytics
   */
  bot.action('analytics_payments', async (ctx) => {
    try {
      await ctx.answerCbQuery('Loading payment analytics...');

      if (!isAdmin(ctx.from.id)) {
        await ctx.answerCbQuery('Not authorized', { show_alert: true });
        return;
      }

      const analytics = await PaymentService.getPaymentAnalytics();

      let message = '💰 *Payment Analytics*\n\n';
      message += `📊 *Overview:*\n`;
      message += `• Total Payments: ${analytics.totalPayments}\n`;
      message += `• ✅ Successful: ${analytics.successfulPayments}\n`;
      message += `• ❌ Failed: ${analytics.failedPayments}\n`;
      message += `• ⏳ Pending: ${analytics.pendingPayments}\n\n`;

      message += `💵 *Revenue:*\n`;
      message += `• Total: $${analytics.totalRevenue.toFixed(2)} USD\n`;
      message += `• Average: $${analytics.averagePayment.toFixed(2)} USD\n`;
      message += `• Conversion Rate: ${analytics.conversionRate.toFixed(1)}%\n\n`;

      if (Object.keys(analytics.revenueByProvider).length > 0) {
        message += `🏦 *By Payment Method:*\n`;
        Object.entries(analytics.revenueByProvider).forEach(([provider, revenue]) => {
          message += `• ${provider.charAt(0).toUpperCase() + provider.slice(1)}: $${revenue.toFixed(2)}\n`;
        });
        message += '\n';
      }

      if (Object.keys(analytics.revenueByPlan).length > 0) {
        message += `📦 *By Plan:*\n`;
        Object.entries(analytics.revenueByPlan).forEach(([plan, revenue]) => {
          const planName = plan === 'private_call_45min' ? 'Private Calls' : plan;
          message += `• ${planName}: $${revenue.toFixed(2)}\n`;
        });
      }

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Back to Dashboard', callback_data: 'back_to_analytics' }],
          ],
        },
      });
    } catch (error) {
      logger.error('Error showing payment analytics:', error);
      await ctx.answerCbQuery('Error loading analytics');
    }
  });

  /**
   * Show call analytics
   */
  bot.action('analytics_calls', async (ctx) => {
    try {
      await ctx.answerCbQuery('Loading call analytics...');

      if (!isAdmin(ctx.from.id)) {
        await ctx.answerCbQuery('Not authorized', { show_alert: true });
        return;
      }

      const stats = await CallService.getStatistics();

      let message = '📞 *Call Analytics*\n\n';
      message += `📊 *Overview:*\n`;
      message += `• Total Calls: ${stats.total}\n`;
      message += `• ⏳ Pending: ${stats.pending}\n`;
      message += `• ✅ Confirmed: ${stats.confirmed}\n`;
      message += `• 🎉 Completed: ${stats.completed}\n`;
      message += `• ❌ Cancelled: ${stats.cancelled}\n\n`;

      message += `💰 *Revenue from Calls:*\n`;
      message += `• Total: $${stats.revenue.toFixed(2)} USD\n`;
      if (stats.completed > 0) {
        message += `• Average per Call: $${(stats.revenue / stats.completed).toFixed(2)}\n`;
      }
      message += '\n';

      if (stats.total > 0) {
        const completionRate = (stats.completed / stats.total) * 100;
        const cancellationRate = (stats.cancelled / stats.total) * 100;
        message += `📈 *Performance:*\n`;
        message += `• Completion Rate: ${completionRate.toFixed(1)}%\n`;
        message += `• Cancellation Rate: ${cancellationRate.toFixed(1)}%\n`;
      }

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Back to Dashboard', callback_data: 'back_to_analytics' }],
          ],
        },
      });
    } catch (error) {
      logger.error('Error showing call analytics:', error);
      await ctx.answerCbQuery('Error loading analytics');
    }
  });

  /**
   * Show monthly analytics
   */
  bot.action('analytics_month', async (ctx) => {
    try {
      await ctx.answerCbQuery('Loading monthly analytics...');

      if (!isAdmin(ctx.from.id)) {
        await ctx.answerCbQuery('Not authorized', { show_alert: true });
        return;
      }

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const analytics = await PaymentService.getPaymentAnalytics({
        startDate: startOfMonth,
        endDate: endOfMonth,
      });

      const monthName = startOfMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

      let message = `📅 *${monthName} Analytics*\n\n`;
      message += `💰 *Revenue:*\n`;
      message += `• Total: $${analytics.totalRevenue.toFixed(2)} USD\n`;
      message += `• Payments: ${analytics.successfulPayments}\n`;
      message += `• Average: $${analytics.averagePayment.toFixed(2)} USD\n\n`;

      message += `📊 *Performance:*\n`;
      message += `• Total Attempts: ${analytics.totalPayments}\n`;
      message += `• Success Rate: ${analytics.conversionRate.toFixed(1)}%\n`;
      message += `• Failed: ${analytics.failedPayments}\n`;
      message += `• Pending: ${analytics.pendingPayments}\n`;

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Back to Dashboard', callback_data: 'back_to_analytics' }],
          ],
        },
      });
    } catch (error) {
      logger.error('Error showing monthly analytics:', error);
      await ctx.answerCbQuery('Error loading analytics');
    }
  });

  /**
   * Show weekly analytics
   */
  bot.action('analytics_week', async (ctx) => {
    try {
      await ctx.answerCbQuery('Loading weekly analytics...');

      if (!isAdmin(ctx.from.id)) {
        await ctx.answerCbQuery('Not authorized', { show_alert: true });
        return;
      }

      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
      startOfWeek.setHours(0, 0, 0, 0);

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6); // Saturday
      endOfWeek.setHours(23, 59, 59, 999);

      const analytics = await PaymentService.getPaymentAnalytics({
        startDate: startOfWeek,
        endDate: endOfWeek,
      });

      let message = `📆 *This Week's Analytics*\n\n`;
      message += `💰 *Revenue:*\n`;
      message += `• Total: $${analytics.totalRevenue.toFixed(2)} USD\n`;
      message += `• Payments: ${analytics.successfulPayments}\n`;
      message += `• Average: $${analytics.averagePayment.toFixed(2)} USD\n\n`;

      message += `📊 *Performance:*\n`;
      message += `• Total Attempts: ${analytics.totalPayments}\n`;
      message += `• Success Rate: ${analytics.conversionRate.toFixed(1)}%\n`;

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Back to Dashboard', callback_data: 'back_to_analytics' }],
          ],
        },
      });
    } catch (error) {
      logger.error('Error showing weekly analytics:', error);
      await ctx.answerCbQuery('Error loading analytics');
    }
  });

  /**
   * Show all-time analytics
   */
  bot.action('analytics_all_time', async (ctx) => {
    try {
      await ctx.answerCbQuery('Loading all-time analytics...');

      if (!isAdmin(ctx.from.id)) {
        await ctx.answerCbQuery('Not authorized', { show_alert: true });
        return;
      }

      const [paymentAnalytics, callStats] = await Promise.all([
        PaymentService.getPaymentAnalytics(),
        CallService.getStatistics(),
      ]);

      let message = `📈 *All-Time Analytics*\n\n`;

      message += `💰 *Payment Performance:*\n`;
      message += `• Total Revenue: $${paymentAnalytics.totalRevenue.toFixed(2)} USD\n`;
      message += `• Successful Payments: ${paymentAnalytics.successfulPayments}\n`;
      message += `• Average Payment: $${paymentAnalytics.averagePayment.toFixed(2)}\n`;
      message += `• Conversion Rate: ${paymentAnalytics.conversionRate.toFixed(1)}%\n\n`;

      message += `📞 *Call Performance:*\n`;
      message += `• Total Calls: ${callStats.total}\n`;
      message += `• Completed: ${callStats.completed}\n`;
      message += `• Call Revenue: $${callStats.revenue.toFixed(2)} USD\n\n`;

      const totalRevenue = paymentAnalytics.totalRevenue + callStats.revenue;
      message += `💎 *Combined Total: $${totalRevenue.toFixed(2)} USD*`;

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Back to Dashboard', callback_data: 'back_to_analytics' }],
          ],
        },
      });
    } catch (error) {
      logger.error('Error showing all-time analytics:', error);
      await ctx.answerCbQuery('Error loading analytics');
    }
  });

  /**
   * Back to analytics dashboard
   */
  bot.action('back_to_analytics', async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const keyboard = {
        inline_keyboard: [
          [
            { text: '📊 Payment Analytics', callback_data: 'analytics_payments' },
            { text: '📞 Call Analytics', callback_data: 'analytics_calls' },
          ],
          [
            { text: '📅 This Month', callback_data: 'analytics_month' },
            { text: '📆 This Week', callback_data: 'analytics_week' },
          ],
          [
            { text: '📈 All Time', callback_data: 'analytics_all_time' },
          ],
        ],
      };

      await ctx.editMessageText(
        '📊 *Analytics Dashboard*\n\n' +
        'Select an analytics view:',
        {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        }
      );
    } catch (error) {
      logger.error('Error returning to analytics dashboard:', error);
    }
  });

  logger.info('Payment analytics handlers registered');
}

module.exports = registerPaymentAnalyticsHandlers;
