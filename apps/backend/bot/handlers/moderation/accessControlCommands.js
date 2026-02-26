const { Markup } = require('telegraf');
const RoleService = require('../../../services/roleService');
const ApprovalService = require('../../../services/approvalService');
const logger = require('../../../utils/logger');
const ACCESS_CONTROL_CONFIG = require('../../../config/accessControlConfig');

/**
 * Get user ID from command (reply or mention)
 */
function getUserFromContext(ctx) {
  // Check if replying to a message
  if (ctx.message.reply_to_message) {
    return {
      id: ctx.message.reply_to_message.from.id,
      username: ctx.message.reply_to_message.from.username || ctx.message.reply_to_message.from.first_name,
    };
  }

  // Check if user ID or username in command
  if (!ctx.message?.text) {
    return null;
  }

  const args = ctx.message.text.split(' ').slice(1);
  if (args.length > 0) {
    const userRef = args[0];

    // Check if it's a user ID (numeric)
    if (/^\d+$/.test(userRef)) {
      return { id: userRef, username: null };
    }

    // Check if it's a mention (@username)
    if (userRef.startsWith('@')) {
      return { username: userRef.substring(1), id: null };
    }
  }

  return null;
}

/**
 * /grantrole - Grant a role to a user
 */
async function handleGrantRole(ctx) {
  try {
    // Check if user is admin
    const isAdmin = await RoleService.isAdmin(ctx.from.id);
    if (!isAdmin) {
      return await ctx.reply('⛔ Only admins can grant roles.');
    }

    const args = ctx.message.text.split(' ').slice(1);
    const targetUser = getUserFromContext(ctx);

    if (!targetUser || !targetUser.id) {
      return await ctx.reply(
        '❌ Please reply to a user\'s message or provide a user ID.\n\n' +
        'Usage: `/grantrole @username ROLE` or reply to a message with `/grantrole ROLE`',
        { parse_mode: 'Markdown' }
      );
    }

    // Get role from args
    let role;
    if (ctx.message.reply_to_message) {
      role = args[0];
    } else {
      role = args[1];
    }

    if (!role) {
      return await ctx.reply(
        '❌ Please specify a role.\n\n**Available roles:**\n' +
        '• USER (default)\n' +
        '• CONTRIBUTOR (can post in approval topics)\n' +
        '• PERFORMER (can post in approval topics + extras)\n' +
        '• ADMIN (full access)',
        { parse_mode: 'Markdown' }
      );
    }

    role = role.toUpperCase();

    // Validate role
    if (!ACCESS_CONTROL_CONFIG.ROLES[role]) {
      return await ctx.reply(
        '❌ Invalid role.\n\n**Available roles:**\n' +
        '• USER\n• CONTRIBUTOR\n• PERFORMER\n• ADMIN',
        { parse_mode: 'Markdown' }
      );
    }

    // Grant role
    const success = await RoleService.setUserRole(targetUser.id, role, ctx.from.id);

    if (success) {
      const roleName = ACCESS_CONTROL_CONFIG.ROLE_NAMES[ACCESS_CONTROL_CONFIG.ROLES[role]];
      await ctx.reply(
        `✅ Role granted successfully!\n\n` +
        `**User:** @${targetUser.username || targetUser.id}\n` +
        `**Role:** ${roleName} (${role})`,
        { parse_mode: 'Markdown' }
      );

      logger.info('Role granted', {
        adminId: ctx.from.id,
        userId: targetUser.id,
        role,
      });
    } else {
      await ctx.reply('❌ Failed to grant role. Please try again.');
    }

  } catch (error) {
    logger.error('Error granting role:', error);
    await ctx.reply('❌ An error occurred while granting the role.');
  }
}

/**
 * /revokerole - Revoke a user's role
 */
async function handleRevokeRole(ctx) {
  try {
    const isAdmin = await RoleService.isAdmin(ctx.from.id);
    if (!isAdmin) {
      return await ctx.reply('⛔ Only admins can revoke roles.');
    }

    const targetUser = getUserFromContext(ctx);

    if (!targetUser || !targetUser.id) {
      return await ctx.reply(
        '❌ Please reply to a user\'s message or provide a user ID.\n\n' +
        'Usage: `/revokerole @username` or reply to a message with `/revokerole`',
        { parse_mode: 'Markdown' }
      );
    }

    const currentRole = await RoleService.getUserRole(targetUser.id);
    const success = await RoleService.removeRole(targetUser.id);

    if (success) {
      await ctx.reply(
        `✅ Role revoked successfully!\n\n` +
        `**User:** @${targetUser.username || targetUser.id}\n` +
        `**Previous Role:** ${currentRole}\n` +
        `**New Role:** USER`,
        { parse_mode: 'Markdown' }
      );

      logger.info('Role revoked', {
        adminId: ctx.from.id,
        userId: targetUser.id,
        previousRole: currentRole,
      });
    } else {
      await ctx.reply('❌ Failed to revoke role. Please try again.');
    }

  } catch (error) {
    logger.error('Error revoking role:', error);
    await ctx.reply('❌ An error occurred while revoking the role.');
  }
}

/**
 * /checkrole - Check a user's role
 */
async function handleCheckRole(ctx) {
  try {
    const targetUser = getUserFromContext(ctx);
    const userId = targetUser?.id || ctx.from.id;
    const username = targetUser?.username || ctx.from.username || ctx.from.first_name;

    const role = await RoleService.getUserRole(userId);
    const roleLevel = ACCESS_CONTROL_CONFIG.ROLES[role];
    const roleName = ACCESS_CONTROL_CONFIG.ROLE_NAMES[roleLevel];

    await ctx.reply(
      `👤 **Role Information**\n\n` +
      `**User:** @${username}\n` +
      `**Role:** ${roleName} (${role})\n` +
      `**Level:** ${roleLevel}`,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    logger.error('Error checking role:', error);
    await ctx.reply('❌ An error occurred while checking the role.');
  }
}

/**
 * /rolestats - Show role statistics
 */
async function handleRoleStats(ctx) {
  try {
    const isAdmin = await RoleService.isAdmin(ctx.from.id);
    if (!isAdmin) {
      return await ctx.reply('⛔ Only admins can view role statistics.');
    }

    const stats = await RoleService.getRoleStats();

    if (!stats) {
      return await ctx.reply('❌ Failed to fetch role statistics.');
    }

    const total = Object.values(stats).reduce((sum, count) => sum + count, 0);

    await ctx.reply(
      `📊 **Role Statistics**\n\n` +
      `**Total Users with Roles:** ${total}\n\n` +
      `**Breakdown:**\n` +
      `• Admins: ${stats.ADMIN || 0}\n` +
      `• Performers: ${stats.PERFORMER || 0}\n` +
      `• Contributors: ${stats.CONTRIBUTOR || 0}\n` +
      `• Users: ${stats.USER || 0}`,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    logger.error('Error getting role stats:', error);
    await ctx.reply('❌ An error occurred while fetching statistics.');
  }
}

/**
 * /approvalqueue - View pending approvals
 */
async function handleApprovalQueue(ctx) {
  try {
    const isAdmin = await RoleService.isAdmin(ctx.from.id);
    if (!isAdmin) {
      return await ctx.reply('⛔ Only admins can view the approval queue.');
    }

    const pendingPosts = await ApprovalService.getAllPending();

    if (pendingPosts.length === 0) {
      return await ctx.reply('✅ No posts pending approval.');
    }

    let message = `📋 **Approval Queue**\n\n` +
                 `**Pending Posts:** ${pendingPosts.length}\n\n`;

    pendingPosts.slice(0, 10).forEach((post, index) => {
      const topicName = ACCESS_CONTROL_CONFIG.TOPIC_PERMISSIONS[post.topicId]?.name || 'Unknown Topic';
      const preview = post.messageText?.substring(0, 50) || '[Media]';

      message += `${index + 1}. **ID ${post.id}** - ${topicName}\n`;
      message += `   User ID: ${post.userId}\n`;
      message += `   Preview: ${preview}${post.messageText?.length > 50 ? '...' : ''}\n`;
      message += `   Submitted: ${new Date(post.createdAt).toLocaleString()}\n\n`;
    });

    if (pendingPosts.length > 10) {
      message += `\n_Showing first 10 of ${pendingPosts.length} pending posts_`;
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });

  } catch (error) {
    logger.error('Error viewing approval queue:', error);
    await ctx.reply('❌ An error occurred while fetching the approval queue.');
  }
}

/**
 * /approvalstats - View approval statistics
 */
async function handleApprovalStats(ctx) {
  try {
    const isAdmin = await RoleService.isAdmin(ctx.from.id);
    if (!isAdmin) {
      return await ctx.reply('⛔ Only admins can view approval statistics.');
    }

    const stats = await ApprovalService.getStats();

    if (!stats) {
      return await ctx.reply('❌ Failed to fetch approval statistics.');
    }

    const total = stats.pending + stats.approved + stats.rejected;

    await ctx.reply(
      `📊 **Approval Statistics**\n\n` +
      `**Total Posts:** ${total}\n\n` +
      `**Status Breakdown:**\n` +
      `• Pending: ${stats.pending}\n` +
      `• Approved: ${stats.approved}\n` +
      `• Rejected: ${stats.rejected}\n\n` +
      `**Approval Rate:** ${total > 0 ? Math.round((stats.approved / total) * 100) : 0}%`,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    logger.error('Error getting approval stats:', error);
    await ctx.reply('❌ An error occurred while fetching statistics.');
  }
}

/**
 * Register access control commands
 */
function registerAccessControlCommands(bot) {
  bot.command('grantrole', handleGrantRole);
  bot.command('revokerole', handleRevokeRole);
  bot.command('checkrole', handleCheckRole);
  bot.command('rolestats', handleRoleStats);
  bot.command('approvalqueue', handleApprovalQueue);
  bot.command('approvalstats', handleApprovalStats);

  logger.info('Access control commands registered');
}

module.exports = registerAccessControlCommands;
