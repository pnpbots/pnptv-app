const userService = require('../../services/userService');
const { formatProfileMessage } = require('../user/profile');
const logger = require('../../../utils/logger');

/**
 * Handle user management menu
 */
async function handleUserManagement(ctx) {
  try {
    await ctx.editMessageText(
      '👥 **User Management**\n\nEnter a username or user ID to search:',
      { parse_mode: 'Markdown' }
    );

    // Save session
    await ctx.saveSession({ waitingForUserSearch: true });

    logger.info(`User management accessed by admin ${ctx.from.id}`);
  } catch (error) {
    logger.error('Error in user management:', error);
    await ctx.answerCbQuery('❌ Error');
  }
}

/**
 * Handle user search
 */
async function handleUserSearch(ctx) {
  try {
    const session = ctx.session || {};

    if (!session.waitingForUserSearch) {
      return false;
    }

    const query = ctx.message?.text?.trim();
    if (!query) {
      await ctx.reply('❌ Please provide a valid username or user ID.');
      return true;
    }

    let user = null;

    // Try to find by username
    if (query.startsWith('@')) {
      user = await userService.searchUserByUsername(query.substring(1));
    } else if (!isNaN(query)) {
      // Try to find by ID
      user = await userService.getUser(parseInt(query));
    } else {
      user = await userService.searchUserByUsername(query);
    }

    if (!user) {
      await ctx.reply('❌ User not found. Try again or /admin to go back.');
      return true;
    }

    // Show user profile
    const profileMessage = formatProfileMessage(user, 'en');
    await ctx.reply(profileMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✏️ Edit User', callback_data: `admin_edit_user_${user.id}` }],
          [{ text: '🔄 Extend Subscription', callback_data: `admin_extend_sub_${user.id}` }],
          [{ text: '🔙 Back to Admin', callback_data: 'back_admin' }],
        ],
      },
    });

    await ctx.clearSession();
    return true;
  } catch (error) {
    logger.error('Error in user search:', error);
    await ctx.reply('❌ Error searching for user');
    return false;
  }
}

/**
 * Handle extend subscription
 */
async function handleExtendSubscription(ctx) {
  try {
    const userId = ctx.callbackQuery.data.split('_')[3];
    const user = await userService.getUser(userId);

    if (!user) {
      await ctx.answerCbQuery('User not found');
      return;
    }

    // Extend subscription by 30 days
    const currentExpiry = user.planExpiry ? new Date(user.planExpiry) : new Date();
    const newExpiry = new Date(currentExpiry);
    newExpiry.setDate(newExpiry.getDate() + 30);

    await userService.updateSubscription(userId, user.plan || 'basic', newExpiry);

    await ctx.answerCbQuery('✅ Subscription extended by 30 days');
    await ctx.editMessageText(
      `✅ Subscription extended for user ${user.username || userId}\n\n` +
      `New expiry date: ${newExpiry.toLocaleDateString()}`
    );

    logger.info(`Admin ${ctx.from.id} extended subscription for user ${userId}`);
  } catch (error) {
    logger.error('Error extending subscription:', error);
    await ctx.answerCbQuery('❌ Error extending subscription');
  }
}

module.exports = {
  handleUserManagement,
  handleUserSearch,
  handleExtendSubscription,
};
