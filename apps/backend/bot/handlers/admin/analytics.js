const userService = require('../../../services/userService');
const paymentService = require('../../../services/paymentService');
const logger = require('../../../utils/logger');

/**
 * Handle analytics menu
 */
async function handleAnalytics(ctx) {
  try {
    await ctx.editMessageText(
      '📊 **Analytics**\n\nSelect a metric to view:',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📈 User Growth', callback_data: 'analytics_users' }],
            [{ text: '💰 Revenue Stats', callback_data: 'analytics_revenue' }],
            [{ text: '📊 Plan Distribution', callback_data: 'analytics_plans' }],
            [{ text: '🔙 Back to Admin', callback_data: 'back_admin' }],
          ],
        },
      }
    );

    logger.info(`Analytics accessed by admin ${ctx.from.id}`);
  } catch (error) {
    logger.error('Error in analytics menu:', error);
    await ctx.answerCbQuery('❌ Error');
  }
}

/**
 * Handle user growth analytics
 */
async function handleUserGrowthAnalytics(ctx) {
  try {
    const stats = await userService.getUserStats();

    const message = `📈 **User Growth Analytics**\n\n` +
      `**Total Users:** ${stats.totalUsers}\n` +
      `**Active Subscriptions:** ${stats.activeSubscriptions}\n` +
      `**New Users (Last 30 Days):** ${stats.newUsersLast30Days}\n\n` +
      `**Growth Rate:** ${((stats.newUsersLast30Days / stats.totalUsers) * 100).toFixed(2)}%`;

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Analytics', callback_data: 'admin_analytics' }],
        ],
      },
    });

    logger.info(`User growth analytics viewed by admin ${ctx.from.id}`);
  } catch (error) {
    logger.error('Error in user growth analytics:', error);
    await ctx.answerCbQuery('❌ Error loading analytics');
  }
}

/**
 * Handle revenue analytics
 */
async function handleRevenueAnalytics(ctx) {
  try {
    const stats = await paymentService.getRevenueStats();

    let message = `💰 **Revenue Statistics**\n\n` +
      `**Total Revenue:** $${stats.totalRevenue.toFixed(2)}\n` +
      `**Total Transactions:** ${stats.totalTransactions}\n\n`;

    if (Object.keys(stats.paymentsByProvider).length > 0) {
      message += `**By Provider:**\n`;
      for (const [provider, amount] of Object.entries(stats.paymentsByProvider)) {
        message += `• ${provider}: $${amount.toFixed(2)}\n`;
      }
      message += `\n`;
    }

    if (Object.keys(stats.paymentsByPlan).length > 0) {
      message += `**By Plan:**\n`;
      for (const [plan, amount] of Object.entries(stats.paymentsByPlan)) {
        message += `• ${plan}: $${amount.toFixed(2)}\n`;
      }
    }

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Analytics', callback_data: 'admin_analytics' }],
        ],
      },
    });

    logger.info(`Revenue analytics viewed by admin ${ctx.from.id}`);
  } catch (error) {
    logger.error('Error in revenue analytics:', error);
    await ctx.answerCbQuery('❌ Error loading revenue stats');
  }
}

/**
 * Handle plan distribution analytics
 */
async function handlePlanDistributionAnalytics(ctx) {
  try {
    const stats = await userService.getUserStats();

    let message = `📊 **Plan Distribution**\n\n`;
    for (const [plan, count] of Object.entries(stats.byPlan)) {
      const percentage = ((count / stats.totalUsers) * 100).toFixed(2);
      message += `**${plan}:** ${count} users (${percentage}%)\n`;
    }

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Analytics', callback_data: 'admin_analytics' }],
        ],
      },
    });

    logger.info(`Plan distribution analytics viewed by admin ${ctx.from.id}`);
  } catch (error) {
    logger.error('Error in plan distribution analytics:', error);
    await ctx.answerCbQuery('❌ Error loading plan stats');
  }
}

module.exports = {
  handleAnalytics,
  handleUserGrowthAnalytics,
  handleRevenueAnalytics,
  handlePlanDistributionAnalytics,
};
