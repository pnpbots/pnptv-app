const { getAdminMenu } = require('../../utils/menus');
const { adminOnly } = require('../../core/middleware/admin');
const adminService = require('../../../services/adminService');
const logger = require('../../../utils/logger');

/**
 * Handle /admin command - show admin dashboard
 */
async function handleAdminDashboard(ctx) {
  try {
    const userId = ctx.from.id;

    // Get dashboard stats
    const stats = await adminService.getDashboardStats();
    const users = stats.users || {};

    // Safely get values with fallbacks
    const totalUsers = users.totalUsers ?? users.total ?? 0;
    const activeSubscriptions = users.activeSubscriptions ?? users.active ?? 0;
    const newUsersLast30Days = users.newUsersLast30Days ?? 0;
    const byPlan = users.byPlan || {};

    // Build plans distribution text
    let plansText = '';
    if (Object.keys(byPlan).length > 0) {
      plansText = Object.entries(byPlan)
        .map(([plan, count]) => `• ${plan}: ${count}`)
        .join('\n');
    } else {
      plansText = '• No plan data available';
    }

    const dashboardMessage = `🔐 **Admin Dashboard**\n\n` +
      `**User Statistics:**\n` +
      `• Total Users: ${totalUsers}\n` +
      `• Active Subscriptions: ${activeSubscriptions}\n` +
      `• New Users (30 days): ${newUsersLast30Days}\n\n` +
      `**Plans Distribution:**\n` +
      `${plansText}\n\n` +
      `Use the buttons below to manage your bot:`;

    await ctx.reply(dashboardMessage, {
      parse_mode: 'Markdown',
      reply_markup: getAdminMenu(),
    });

    logger.info(`Admin dashboard accessed by ${userId}`);
  } catch (error) {
    logger.error('Error in admin dashboard:', error);
    await ctx.reply('❌ Error loading dashboard. Please try again.');
  }
}

module.exports = {
  handleAdminDashboard,
};
