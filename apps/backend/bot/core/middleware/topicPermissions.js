const { Markup } = require('telegraf');
const RoleService = require('../../../services/roleService');
const ApprovalService = require('../../../services/approvalService');
const UserModel = require('../../../models/userModel');
const PermissionService = require('../../services/permissionService');
const logger = require('../../../utils/logger');
const ACCESS_CONTROL_CONFIG = require('../../../config/accessControlConfig');

const GROUP_ID = process.env.GROUP_ID;

// Rate limiting storage (messageId -> timestamp)
const rateLimitTracker = new Map();

/**
 * Clean up old rate limit entries
 */
setInterval(() => {
  const now = Date.now();
  const cutoff = now - (60 * 60 * 1000); // 1 hour

  for (const [key, timestamps] of rateLimitTracker.entries()) {
    const filtered = timestamps.filter(t => t > cutoff);
    if (filtered.length === 0) {
      rateLimitTracker.delete(key);
    } else {
      rateLimitTracker.set(key, filtered);
    }
  }
}, ACCESS_CONTROL_CONFIG.RATE_LIMIT.cleanupInterval);

/**
 * Check if user is Telegram admin/creator
 */
async function isTelegramAdmin(ctx) {
  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    return ['creator', 'administrator'].includes(member.status);
  } catch (error) {
    logger.error('Error checking Telegram admin status:', error);
    return false;
  }
}

/**
 * Get role display names
 */
function getRoleDisplayNames(roles) {
  return roles.map(role =>
    ACCESS_CONTROL_CONFIG.ROLE_NAMES[ACCESS_CONTROL_CONFIG.ROLES[role]] || role
  ).join(', ');
}

/**
 * Check rate limit for user in topic
 */
function checkRateLimit(userId, topicId, rateLimit) {
  if (!rateLimit) return { allowed: true };

  const key = `${userId}:${topicId}`;
  const now = Date.now();
  const timestamps = rateLimitTracker.get(key) || [];

  // Filter to only recent timestamps within window
  const recentTimestamps = timestamps.filter(t => t > now - rateLimit.windowMs);

  if (recentTimestamps.length >= rateLimit.maxPosts) {
    const oldestTimestamp = Math.min(...recentTimestamps);
    const waitTime = (oldestTimestamp + rateLimit.windowMs) - now;

    return {
      allowed: false,
      waitTime,
      window: rateLimit.windowMs,
      max: rateLimit.maxPosts,
    };
  }

  // Add current timestamp
  recentTimestamps.push(now);
  rateLimitTracker.set(key, recentTimestamps);

  return { allowed: true };
}

/**
 * Format time duration
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  return `${seconds} second${seconds > 1 ? 's' : ''}`;
}

/**
 * Topic Permissions Middleware
 * Handles all topic-based access control
 */
function topicPermissionsMiddleware() {
  return async (ctx, next) => {
    try {
      // Only process messages in groups with topics (forums)
      if (!ctx.message || ctx.chat?.type === 'private') {
        return next();
      }

      // Only process in configured group
      if (GROUP_ID && ctx.chat.id.toString() !== GROUP_ID) {
        return next();
      }

      // Get topic ID (message_thread_id)
      const topicId = ctx.message.message_thread_id;

      // If not in a topic, or topic not configured, allow
      if (!topicId || !ACCESS_CONTROL_CONFIG.TOPIC_PERMISSIONS[topicId]) {
        return next();
      }

      const topicConfig = ACCESS_CONTROL_CONFIG.TOPIC_PERMISSIONS[topicId];
      const userId = ctx.from.id;
      const messageId = ctx.message.message_id;

      // Check if Telegram admin (always allow)
      const isAdmin = await isTelegramAdmin(ctx);
      if (isAdmin) {
        return next();
      }

      // Check if env-based admin/superadmin (always allow)
      if (PermissionService.isEnvSuperAdmin(userId) || PermissionService.isEnvAdmin(userId)) {
        logger.debug('Admin/SuperAdmin bypass: topic permissions skipped', { userId });
        return next();
      }

      // Get user's role
      const userRole = await RoleService.getUserRole(userId);
      const hasPermission = await RoleService.hasAnyRole(userId, topicConfig.allowedRoles);

      // Check subscription requirement (if configured)
      if (topicConfig.requireSubscription) {
        const user = await UserModel.getById(userId);
        if (!user?.subscription?.isPrime) {
          // Delete message
          try {
            await ctx.deleteMessage();
          } catch (error) {
            logger.debug('Could not delete message:', error.message);
          }

          // Send subscription required message
          const userLang = ctx.from.language_code || 'en';
          const isSpanish = userLang.startsWith('es');
          const message = ACCESS_CONTROL_CONFIG.MESSAGES.subscriptionRequired[isSpanish ? 'es' : 'en'];

          const sentMessage = await ctx.reply(message);

          // Auto-delete warning
          setTimeout(async () => {
            try {
              await ctx.telegram.deleteMessage(ctx.chat.id, sentMessage.message_id);
            } catch (error) {
              logger.debug('Could not delete warning:', error.message);
            }
          }, ACCESS_CONTROL_CONFIG.AUTO_DELETE.warningDelay);

          return; // Don't proceed
        }
      }

      // Check rate limit
      if (topicConfig.rateLimit) {
        const rateLimitCheck = checkRateLimit(userId, topicId, topicConfig.rateLimit);

        if (!rateLimitCheck.allowed) {
          // Delete message
          try {
            await ctx.deleteMessage();
          } catch (error) {
            logger.debug('Could not delete message:', error.message);
          }

          // Send rate limit message
          const userLang = ctx.from.language_code || 'en';
          const isSpanish = userLang.startsWith('es');
          let message = ACCESS_CONTROL_CONFIG.MESSAGES.rateLimitExceeded[isSpanish ? 'es' : 'en'];

          message = message
            .replace('{max}', rateLimitCheck.max)
            .replace('{window}', formatDuration(rateLimitCheck.window))
            .replace('{wait}', formatDuration(rateLimitCheck.waitTime));

          const sentMessage = await ctx.reply(message);

          // Auto-delete warning
          setTimeout(async () => {
            try {
              await ctx.telegram.deleteMessage(ctx.chat.id, sentMessage.message_id);
            } catch (error) {
              logger.debug('Could not delete warning:', error.message);
            }
          }, ACCESS_CONTROL_CONFIG.AUTO_DELETE.warningDelay);

          return; // Don't proceed
        }
      }

      // Handle topic-specific permissions
      if (!hasPermission) {
        // Auto-delete unauthorized post
        if (topicConfig.autoDelete) {
          const userLang = ctx.from.language_code || 'en';
          const isSpanish = userLang.startsWith('es');
          const delaySeconds = Math.floor(ACCESS_CONTROL_CONFIG.AUTO_DELETE.deleteDelay / 1000);

          let message = ACCESS_CONTROL_CONFIG.MESSAGES.unauthorized[isSpanish ? 'es' : 'en'];
          message = message
            .replace('{roles}', getRoleDisplayNames(topicConfig.allowedRoles))
            .replace('{seconds}', delaySeconds);

          // Send warning
          if (topicConfig.notifyUser) {
            const sentMessage = await ctx.reply(message, {
              reply_to_message_id: messageId,
            });

            // Auto-delete warning
            setTimeout(async () => {
              try {
                await ctx.telegram.deleteMessage(ctx.chat.id, sentMessage.message_id);
              } catch (error) {
                logger.debug('Could not delete warning:', error.message);
              }
            }, ACCESS_CONTROL_CONFIG.AUTO_DELETE.warningDelay);
          }

          // Delete original message after delay
          setTimeout(async () => {
            try {
              await ctx.telegram.deleteMessage(ctx.chat.id, messageId);
              logger.info('Auto-deleted unauthorized post', {
                userId,
                topicId,
                userRole,
                requiredRoles: topicConfig.allowedRoles
              });
            } catch (error) {
              logger.debug('Could not delete unauthorized message:', error.message);
            }
          }, ACCESS_CONTROL_CONFIG.AUTO_DELETE.deleteDelay);

          return; // Don't proceed
        }

        // Approval system (for topic 3134)
        if (topicConfig.requireApproval) {
          // Add to approval queue
          try {
            const approvalId = await ApprovalService.addToQueue({
              userId,
              messageId,
              topicId,
              chatId: ctx.chat.id,
              messageText: ctx.message.text || ctx.message.caption,
              hasMedia: !!(ctx.message.photo || ctx.message.video || ctx.message.document),
              mediaType: ctx.message.photo ? 'photo' :
                         ctx.message.video ? 'video' :
                         ctx.message.document ? 'document' : null,
            });

            // Notify user
            const userLang = ctx.from.language_code || 'en';
            const isSpanish = userLang.startsWith('es');
            const message = ACCESS_CONTROL_CONFIG.MESSAGES.pendingApproval[isSpanish ? 'es' : 'en'];

            await ctx.reply(message, {
              reply_to_message_id: messageId,
            });

            // Notify admins
            if (ACCESS_CONTROL_CONFIG.APPROVAL.notifyAdmins) {
              await notifyAdminsOfPendingPost(ctx, approvalId, topicConfig.name);
            }

            logger.info('Post added to approval queue', {
              approvalId,
              userId,
              topicId,
              messageId
            });

          } catch (error) {
            logger.error('Error adding to approval queue:', error);
          }

          return; // Don't proceed (pending approval)
        }
      }

      // User has permission, proceed
      return next();

    } catch (error) {
      logger.error('Error in topic permissions middleware:', error);
      return next(); // Continue on error
    }
  };
}

/**
 * Notify admins of pending post
 */
async function notifyAdminsOfPendingPost(ctx, approvalId, topicName) {
  try {
    const adminIds = await RoleService.getAdmins();

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Approve', `approve:${approvalId}`),
        Markup.button.callback('❌ Reject', `reject:${approvalId}`),
      ],
    ]);

    const message = `🔔 **New Post Pending Approval**\n\n` +
                   `**Topic:** ${topicName}\n` +
                   `**User:** @${ctx.from.username || ctx.from.first_name}\n` +
                   `**Message:** ${ctx.message.text || ctx.message.caption || '[Media]'}\n\n` +
                   `Approval ID: ${approvalId}`;

    for (const adminId of adminIds) {
      try {
        await ctx.telegram.sendMessage(adminId, message, {
          parse_mode: 'Markdown',
          ...keyboard,
        });
      } catch (error) {
        logger.debug(`Could not notify admin ${adminId}:`, error.message);
      }
    }

  } catch (error) {
    logger.error('Error notifying admins:', error);
  }
}

/**
 * Register approval handlers
 */
function registerApprovalHandlers(bot) {
  // Approve post
  bot.action(/^approve:(\d+)$/, async (ctx) => {
    try {
      const approvalId = ctx.match[1];
      const adminId = ctx.from.id;

      // Check if user is admin
      if (!(await RoleService.isAdmin(adminId))) {
        return await ctx.answerCbQuery('⛔ Only admins can approve posts.');
      }

      // Get post data
      const post = await ApprovalService.getById(approvalId);
      if (!post) {
        return await ctx.answerCbQuery('❌ Approval not found.');
      }

      if (post.status !== 'pending') {
        return await ctx.answerCbQuery(`⚠️ Post already ${post.status}.`);
      }

      // Approve post
      await ApprovalService.approvePost(approvalId, adminId);

      // Notify user
      try {
        const userLang = 'en'; // Could fetch from user profile
        const message = ACCESS_CONTROL_CONFIG.MESSAGES.approved[userLang]
          .replace('{topic}', ACCESS_CONTROL_CONFIG.TOPIC_PERMISSIONS[post.topicId]?.name || 'Unknown');

        await bot.telegram.sendMessage(post.userId, message);
      } catch (error) {
        logger.debug('Could not notify user of approval:', error.message);
      }

      // Update callback message
      await ctx.editMessageText(
        `✅ **Post Approved**\n\n${ctx.callbackQuery.message.text}\n\n_Approved by @${ctx.from.username || ctx.from.first_name}_`,
        { parse_mode: 'Markdown' }
      );

      await ctx.answerCbQuery('✅ Post approved!');

      logger.info('Post approved', { approvalId, adminId, userId: post.userId });

    } catch (error) {
      logger.error('Error approving post:', error);
      await ctx.answerCbQuery('❌ Error approving post.');
    }
  });

  // Reject post
  bot.action(/^reject:(\d+)$/, async (ctx) => {
    try {
      const approvalId = ctx.match[1];
      const adminId = ctx.from.id;

      // Check if user is admin
      if (!(await RoleService.isAdmin(adminId))) {
        return await ctx.answerCbQuery('⛔ Only admins can reject posts.');
      }

      // Get post data
      const post = await ApprovalService.getById(approvalId);
      if (!post) {
        return await ctx.answerCbQuery('❌ Approval not found.');
      }

      if (post.status !== 'pending') {
        return await ctx.answerCbQuery(`⚠️ Post already ${post.status}.`);
      }

      // Reject post
      const reason = 'Does not meet community guidelines'; // Could prompt admin for reason
      await ApprovalService.rejectPost(approvalId, adminId, reason);

      // Delete original message
      try {
        await bot.telegram.deleteMessage(post.chatId, post.messageId);
      } catch (error) {
        logger.debug('Could not delete rejected message:', error.message);
      }

      // Notify user
      try {
        const userLang = 'en';
        const message = ACCESS_CONTROL_CONFIG.MESSAGES.rejected[userLang]
          .replace('{topic}', ACCESS_CONTROL_CONFIG.TOPIC_PERMISSIONS[post.topicId]?.name || 'Unknown')
          .replace('{reason}', reason);

        await bot.telegram.sendMessage(post.userId, message);
      } catch (error) {
        logger.debug('Could not notify user of rejection:', error.message);
      }

      // Update callback message
      await ctx.editMessageText(
        `❌ **Post Rejected**\n\n${ctx.callbackQuery.message.text}\n\n_Rejected by @${ctx.from.username || ctx.from.first_name}_\n_Reason: ${reason}_`,
        { parse_mode: 'Markdown' }
      );

      await ctx.answerCbQuery('❌ Post rejected.');

      logger.info('Post rejected', { approvalId, adminId, userId: post.userId, reason });

    } catch (error) {
      logger.error('Error rejecting post:', error);
      await ctx.answerCbQuery('❌ Error rejecting post.');
    }
  });

  logger.info('Approval handlers registered');
}

module.exports = {
  topicPermissionsMiddleware,
  registerApprovalHandlers,
};
