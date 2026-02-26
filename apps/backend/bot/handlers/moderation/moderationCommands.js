const { Markup } = require('telegraf');
const WarningService = require('../../../services/warningService');
const logger = require('../../../utils/logger');
const MODERATION_CONFIG = require('../../../config/moderationConfig');
const { isAdmin, getUserFromContext, isGroupChat } = require('../../../utils/adminUtils');

const GROUP_ID = process.env.GROUP_ID;
const AUTO_DELETE_DELAY = MODERATION_CONFIG.MOD_MESSAGE_DELAY;

/**
 * Send auto-deleting message
 */
async function sendAutoDeleteMessage(ctx, message, keyboard = null) {
  const sentMessage = await ctx.reply(message, keyboard);

  if (MODERATION_CONFIG.AUTO_DELETE_MOD_MESSAGES) {
    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, sentMessage.message_id);
      } catch (error) {
        logger.debug('Could not delete moderation message:', error.message);
      }
    }, AUTO_DELETE_DELAY);
  }

  return sentMessage;
}

/**
 * /rules - Display community rules
 */
async function handleRules(ctx) {
  try {
    const userLang = ctx.from.language_code || 'en';
    const isSpanish = userLang.startsWith('es');
    const rules = MODERATION_CONFIG.RULES[isSpanish ? 'es' : 'en'];

    const header = isSpanish
      ? '📜 **Reglas de la Comunidad PNPtv**\n\n'
      : '📜 **PNPtv Community Rules**\n\n';

    const footer = isSpanish
      ? '\n\n💡 **Recuerda:** Todos estamos aquí para tener una buena experiencia. ¡Respeta las reglas y diviértete!'
      : '\n\n💡 **Remember:** We\'re all here to have a good time. Respect the rules and have fun!';

    const message = header + rules.join('\n\n') + footer;

    await sendAutoDeleteMessage(ctx, message);
  } catch (error) {
    logger.error('Error displaying rules:', error);
  }
}

/**
 * /warn - Warn a user
 */
async function handleWarn(ctx) {
  try {
    // Check if user is admin
    if (!(await isAdmin(ctx))) {
      return await sendAutoDeleteMessage(ctx, '⛔ Only admins can use this command.');
    }

    const targetUser = getUserFromContext(ctx);
    if (!targetUser || !targetUser.id) {
      return await sendAutoDeleteMessage(ctx, '❌ Please reply to a message or provide a user ID.');
    }

    // Get reason from command args
    const args = ctx.message.text.split(' ').slice(1);
    const reason = args.length > 1 ? args.slice(1).join(' ') : 'No reason provided';

    // Add warning
    const result = await WarningService.addWarning({
      userId: targetUser.id,
      adminId: ctx.from.id,
      reason,
      groupId: ctx.chat.id,
    });

    const username = targetUser.username || targetUser.id;
    let message = `⚠️ Warning issued to @${username}\n\n`;
    message += `**Reason:** ${reason}\n`;
    message += `**Warning Count:** ${result.warningCount}/${MODERATION_CONFIG.WARNING_SYSTEM.MAX_WARNINGS}\n\n`;

    // Execute action based on warning count
    if (result.action.type === 'mute') {
      // Mute user
      try {
        const until = Math.floor((Date.now() + result.action.duration) / 1000);
        await ctx.telegram.restrictChatMember(ctx.chat.id, targetUser.id, {
          until_date: until,
          permissions: { can_send_messages: false },
        });

        await WarningService.recordAction({
          userId: targetUser.id,
          adminId: ctx.from.id,
          action: 'mute',
          reason: `Auto-mute: ${reason}`,
          duration: result.action.duration,
          groupId: ctx.chat.id,
        });

        message += `🔇 User has been muted for 24 hours.`;
      } catch (error) {
        logger.error('Error muting user:', error);
        message += `❌ Could not mute user: ${error.message}`;
      }
    } else if (result.action.type === 'ban') {
      // Ban user
      try {
        await ctx.telegram.banChatMember(ctx.chat.id, targetUser.id);

        await WarningService.recordAction({
          userId: targetUser.id,
          adminId: ctx.from.id,
          action: 'ban',
          reason: `Auto-ban: ${reason}`,
          duration: null,
          groupId: ctx.chat.id,
        });

        message += `🚫 User has been banned (3 warnings).`;
      } catch (error) {
        logger.error('Error banning user:', error);
        message += `❌ Could not ban user: ${error.message}`;
      }
    }

    await sendAutoDeleteMessage(ctx, message);
  } catch (error) {
    logger.error('Error handling warn command:', error);
    await sendAutoDeleteMessage(ctx, '❌ An error occurred while processing the warning.');
  }
}

/**
 * /warnings - Check user warnings
 */
async function handleWarnings(ctx) {
  try {
    // Check if user is admin
    if (!(await isAdmin(ctx))) {
      return await sendAutoDeleteMessage(ctx, '⛔ Only admins can use this command.');
    }

    const targetUser = getUserFromContext(ctx);
    if (!targetUser || !targetUser.id) {
      return await sendAutoDeleteMessage(ctx, '❌ Please reply to a message or provide a user ID.');
    }

    const warnings = await WarningService.getUserWarnings(targetUser.id);
    const activeCount = await WarningService.getActiveWarningCount(targetUser.id);

    const username = targetUser.username || targetUser.id;
    let message = `📋 **Warnings for @${username}**\n\n`;
    message += `Active Warnings: ${activeCount}/${MODERATION_CONFIG.WARNING_SYSTEM.MAX_WARNINGS}\n\n`;

    if (warnings.length === 0) {
      message += 'No warnings found.';
    } else {
      message += '**Recent Warnings:**\n';
      warnings.slice(0, 5).forEach((w, i) => {
        const date = new Date(w.created_at).toLocaleDateString();
        const status = w.cleared ? '✅ Cleared' : '⚠️ Active';
        message += `\n${i + 1}. ${status} - ${date}\n   Reason: ${w.reason}\n   By: @${w.admin_username || 'Unknown'}`;
      });
    }

    await sendAutoDeleteMessage(ctx, message);
  } catch (error) {
    logger.error('Error handling warnings command:', error);
    await sendAutoDeleteMessage(ctx, '❌ An error occurred while fetching warnings.');
  }
}

/**
 * /clearwarnings - Clear user warnings
 */
async function handleClearWarnings(ctx) {
  try {
    // Check if user is admin
    if (!(await isAdmin(ctx))) {
      return await sendAutoDeleteMessage(ctx, '⛔ Only admins can use this command.');
    }

    const targetUser = getUserFromContext(ctx);
    if (!targetUser || !targetUser.id) {
      return await sendAutoDeleteMessage(ctx, '❌ Please reply to a message or provide a user ID.');
    }

    const count = await WarningService.clearWarnings(targetUser.id, ctx.from.id);
    const username = targetUser.username || targetUser.id;

    await sendAutoDeleteMessage(ctx, `✅ Cleared ${count} warning(s) for @${username}`);
  } catch (error) {
    logger.error('Error handling clearwarnings command:', error);
    await sendAutoDeleteMessage(ctx, '❌ An error occurred while clearing warnings.');
  }
}

/**
 * /mute - Mute a user
 */
async function handleMute(ctx) {
  try {
    // Check if user is admin
    if (!(await isAdmin(ctx))) {
      return await sendAutoDeleteMessage(ctx, '⛔ Only admins can use this command.');
    }

    const targetUser = getUserFromContext(ctx);
    if (!targetUser || !targetUser.id) {
      return await sendAutoDeleteMessage(ctx, '❌ Please reply to a message or provide a user ID.');
    }

    // Get duration from command args (default 24 hours)
    const args = ctx.message.text.split(' ').slice(1);
    let duration = 24 * 60 * 60 * 1000; // 24 hours in ms
    let reason = 'No reason provided';

    if (args.length > 1) {
      // Check if second arg is duration (e.g., "1h", "30m", "2d")
      const durationArg = args[1];
      const match = durationArg.match(/^(\d+)([mhd])$/);

      if (match) {
        const value = parseInt(match[1]);
        const unit = match[2];

        switch (unit) {
          case 'm':
            duration = value * 60 * 1000;
            break;
          case 'h':
            duration = value * 60 * 60 * 1000;
            break;
          case 'd':
            duration = value * 24 * 60 * 60 * 1000;
            break;
        }

        reason = args.length > 2 ? args.slice(2).join(' ') : reason;
      } else {
        reason = args.slice(1).join(' ');
      }
    }

    // Mute user
    const until = Math.floor((Date.now() + duration) / 1000);
    await ctx.telegram.restrictChatMember(ctx.chat.id, targetUser.id, {
      until_date: until,
      permissions: { can_send_messages: false },
    });

    await WarningService.recordAction({
      userId: targetUser.id,
      adminId: ctx.from.id,
      action: 'mute',
      reason,
      duration,
      groupId: ctx.chat.id,
    });

    const username = targetUser.username || targetUser.id;
    const durationStr = duration >= 24 * 60 * 60 * 1000
      ? `${Math.floor(duration / (24 * 60 * 60 * 1000))} day(s)`
      : duration >= 60 * 60 * 1000
      ? `${Math.floor(duration / (60 * 60 * 1000))} hour(s)`
      : `${Math.floor(duration / (60 * 1000))} minute(s)`;

    await sendAutoDeleteMessage(
      ctx,
      `🔇 @${username} has been muted for ${durationStr}\n\n**Reason:** ${reason}`
    );
  } catch (error) {
    logger.error('Error handling mute command:', error);
    await sendAutoDeleteMessage(ctx, `❌ Could not mute user: ${error.message}`);
  }
}

/**
 * /unmute - Unmute a user
 */
async function handleUnmute(ctx) {
  try {
    // Check if user is admin
    if (!(await isAdmin(ctx))) {
      return await sendAutoDeleteMessage(ctx, '⛔ Only admins can use this command.');
    }

    const targetUser = getUserFromContext(ctx);
    if (!targetUser || !targetUser.id) {
      return await sendAutoDeleteMessage(ctx, '❌ Please reply to a message or provide a user ID.');
    }

    // Unmute user
    await ctx.telegram.restrictChatMember(ctx.chat.id, targetUser.id, {
      permissions: {
        can_send_messages: true,
        can_send_media_messages: true,
        can_send_polls: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true,
        can_invite_users: true,
      },
    });

    await WarningService.unmute(targetUser.id, ctx.from.id, ctx.chat.id);

    const username = targetUser.username || targetUser.id;
    await sendAutoDeleteMessage(ctx, `✅ @${username} has been unmuted`);
  } catch (error) {
    logger.error('Error handling unmute command:', error);
    await sendAutoDeleteMessage(ctx, `❌ Could not unmute user: ${error.message}`);
  }
}

/**
 * /kick - Kick a user
 */
async function handleKick(ctx) {
  try {
    // Check if user is admin
    if (!(await isAdmin(ctx))) {
      return await sendAutoDeleteMessage(ctx, '⛔ Only admins can use this command.');
    }

    const targetUser = getUserFromContext(ctx);
    if (!targetUser || !targetUser.id) {
      return await sendAutoDeleteMessage(ctx, '❌ Please reply to a message or provide a user ID.');
    }

    const args = ctx.message.text.split(' ').slice(1);
    const reason = args.length > 1 ? args.slice(1).join(' ') : 'No reason provided';

    // Kick user (ban then unban)
    await ctx.telegram.banChatMember(ctx.chat.id, targetUser.id);
    await ctx.telegram.unbanChatMember(ctx.chat.id, targetUser.id);

    await WarningService.recordAction({
      userId: targetUser.id,
      adminId: ctx.from.id,
      action: 'kick',
      reason,
      duration: null,
      groupId: ctx.chat.id,
    });

    const username = targetUser.username || targetUser.id;
    await sendAutoDeleteMessage(ctx, `👢 @${username} has been kicked\n\n**Reason:** ${reason}`);
  } catch (error) {
    logger.error('Error handling kick command:', error);
    await sendAutoDeleteMessage(ctx, `❌ Could not kick user: ${error.message}`);
  }
}

/**
 * /ban - Ban a user
 */
async function handleBan(ctx) {
  try {
    // Check if user is admin
    if (!(await isAdmin(ctx))) {
      return await sendAutoDeleteMessage(ctx, '⛔ Only admins can use this command.');
    }

    const targetUser = getUserFromContext(ctx);
    if (!targetUser || !targetUser.id) {
      return await sendAutoDeleteMessage(ctx, '❌ Please reply to a message or provide a user ID.');
    }

    const args = ctx.message.text.split(' ').slice(1);
    const reason = args.length > 1 ? args.slice(1).join(' ') : 'No reason provided';

    // Ban user
    await ctx.telegram.banChatMember(ctx.chat.id, targetUser.id);

    await WarningService.recordAction({
      userId: targetUser.id,
      adminId: ctx.from.id,
      action: 'ban',
      reason,
      duration: null,
      groupId: ctx.chat.id,
    });

    const username = targetUser.username || targetUser.id;
    await sendAutoDeleteMessage(ctx, `🚫 @${username} has been banned\n\n**Reason:** ${reason}`);
  } catch (error) {
    logger.error('Error handling ban command:', error);
    await sendAutoDeleteMessage(ctx, `❌ Could not ban user: ${error.message}`);
  }
}

/**
 * /unban - Unban a user
 */
async function handleUnban(ctx) {
  try {
    // Check if user is admin
    if (!(await isAdmin(ctx))) {
      return await sendAutoDeleteMessage(ctx, '⛔ Only admins can use this command.');
    }

    const args = ctx.message.text.split(' ').slice(1);
    if (args.length === 0) {
      return await sendAutoDeleteMessage(ctx, '❌ Please provide a user ID.');
    }

    const userId = args[0];

    // Unban user
    await ctx.telegram.unbanChatMember(ctx.chat.id, userId);

    await WarningService.recordAction({
      userId,
      adminId: ctx.from.id,
      action: 'unban',
      reason: 'Unbanned by admin',
      duration: null,
      groupId: ctx.chat.id,
    });

    await sendAutoDeleteMessage(ctx, `✅ User ${userId} has been unbanned`);
  } catch (error) {
    logger.error('Error handling unban command:', error);
    await sendAutoDeleteMessage(ctx, `❌ Could not unban user: ${error.message}`);
  }
}

/**
 * Register moderation command handlers
 */
const registerModerationCommands = (bot) => {
  bot.command('rules', handleRules);
  bot.command('warn', handleWarn);
  bot.command('warnings', handleWarnings);
  bot.command('clearwarnings', handleClearWarnings);
  bot.command('mute', handleMute);
  bot.command('unmute', handleUnmute);
  bot.command('kick', handleKick);
  bot.command('ban', handleBan);
  bot.command('unban', handleUnban);

  logger.info('Moderation command handlers registered');
};

module.exports = registerModerationCommands;
