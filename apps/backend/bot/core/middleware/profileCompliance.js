const ModerationModel = require('../../../models/moderationModel');
const UserModel = require('../../../models/userModel');
const ChatCleanupService = require('../../services/chatCleanupService');
const logger = require('../../../utils/logger');
const { t } = require('../../../utils/i18n');
const { query } = require('../../../config/postgres');

/**
 * Profile compliance middleware
 * - Requires users to have a valid @username
 * - Sends warnings with 48-hour compliance deadline
 * - Automatically purges non-compliant users after deadline
 *
 * @returns {Function} Middleware function
 */
const profileCompliance = () => {
  return async (ctx, next) => {
    const chatType = ctx.chat?.type;

    // Only apply to groups and supergroups
    if (!chatType || (chatType !== 'group' && chatType !== 'supergroup')) {
      return next();
    }

    const userId = ctx.from?.id;
    const groupId = ctx.chat.id;
    const username = ctx.from?.username;
    const firstName = ctx.from?.first_name;
    const lastName = ctx.from?.last_name;

    if (!userId) {
      return next();
    }

    try {
      // Check if user is admin (admins bypass compliance)
      const isAdmin = await checkIfAdmin(ctx, userId);
      if (isAdmin) {
        return next();
      }

      // Check profile compliance
      const complianceIssues = checkCompliance(username, firstName, lastName);

      if (complianceIssues.length === 0) {
        // User is compliant, mark as compliant if not already
        await markCompliant(userId, groupId);
        return next();
      }

      // User is non-compliant, check if we've already warned them
      const complianceRecord = await getComplianceRecord(userId, groupId);

      if (!complianceRecord) {
        // First time detecting non-compliance, send warning
        await sendComplianceWarning(
          ctx,
          userId,
          complianceIssues,
          firstName,
          groupId,
        );

        // Create compliance record
        await createComplianceRecord(userId, groupId, complianceIssues);

        // Log the warning
        await ModerationModel.addLog({
          action: 'compliance_warning_sent',
          userId,
          groupId,
          reason: 'Non-compliant profile',
          details: complianceIssues.join(', '),
        });

        logger.info('Profile compliance warning sent', {
          userId,
          groupId,
          issues: complianceIssues,
        });
      } else if (complianceRecord.warning_sent_at && !complianceRecord.compliance_met_at) {
        // Check if 48-hour deadline passed
        const deadlineTime = new Date(complianceRecord.purge_deadline);
        const now = new Date();

        if (now >= deadlineTime && !complianceRecord.purged) {
          // Deadline passed, purge the user
          await purgeNonCompliantUser(ctx, userId, groupId, complianceIssues, firstName);
        }
      }

      // Block message from non-compliant user
      try {
        await ctx.deleteMessage();
      } catch (error) {
        logger.debug('Could not delete message from non-compliant user:', error.message);
      }

      // Don't call next() - message is blocked
      return;
    } catch (error) {
      logger.error('Profile compliance middleware error:', error);
      // On error, allow message through to avoid blocking legitimate users
      return next();
    }
  };
};

/**
 * Check if user is admin
 */
async function checkIfAdmin(ctx, userId) {
  try {
    const chatMember = await ctx.getChatMember(userId);
    return ['creator', 'administrator'].includes(chatMember.status);
  } catch (error) {
    logger.error('Error checking admin status:', error);
    return false;
  }
}

/**
 * Check profile compliance
 * Returns array of issues (empty if compliant)
 */
function checkCompliance(username, firstName, lastName) {
  const issues = [];

  // Check for username only
  if (!username) {
    issues.push('no_username');
  }

  return issues;
}

/**
 * Check if string contains only Latin alphabet (and basic punctuation)
 */
function isLatinAlphabet(str) {
  if (!str || str.length === 0) {
    return false;
  }

  // Allow: a-z, A-Z, 0-9, spaces, hyphens, apostrophes, periods
  const latinRegex = /^[a-zA-Z0-9\s\-'.\s]+$/;
  return latinRegex.test(str);
}

/**
 * Get compliance record for user in group
 */
async function getComplianceRecord(userId, groupId) {
  try {
    const result = await query(
      `SELECT * FROM profile_compliance
       WHERE user_id = $1 AND group_id = $2`,
      [userId.toString(), groupId.toString()],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error) {
    logger.error('Error getting compliance record:', error);
    return null;
  }
}

/**
 * Create compliance record with warning
 */
async function createComplianceRecord(userId, groupId, issues) {
  try {
    const warningTime = new Date();
    const deadlineTime = new Date(warningTime.getTime() + 48 * 60 * 60 * 1000); // 48 hours

    await query(
      `INSERT INTO profile_compliance
       (user_id, group_id, compliance_issues, warning_sent_at, purge_deadline, warning_count)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, group_id)
       DO UPDATE SET compliance_issues = $3, warning_sent_at = $4, purge_deadline = $5, warning_count = warning_count + 1`,
      [
        userId.toString(),
        groupId.toString(),
        issues,
        warningTime,
        deadlineTime,
        1,
      ],
    );

    logger.info('Compliance record created', { userId, groupId, issues });
  } catch (error) {
    logger.error('Error creating compliance record:', error);
  }
}

/**
 * Mark user as compliant
 */
async function markCompliant(userId, groupId) {
  try {
    await query(
      `INSERT INTO profile_compliance
       (user_id, group_id, username_valid, name_valid, compliance_met_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, group_id)
       DO UPDATE SET username_valid = true, name_valid = true, compliance_met_at = $5`,
      [userId.toString(), groupId.toString(), true, true, new Date()],
    );

    logger.debug('User marked as compliant', { userId, groupId });
  } catch (error) {
    logger.error('Error marking user as compliant:', error);
  }
}

/**
 * Send compliance warning to user
 */
async function sendComplianceWarning(ctx, userId, issues, firstName, groupId) {
  try {
    const issueDescriptions = formatIssueDescriptions(issues);

    // Send private message
    const privateMessage = `⚠️ **Profile Compliance Warning**\n\n`
      + `Hello ${firstName}!\n\n`
      + `Your profile does not meet the requirements in **${ctx.chat.title}**:\n\n`
      + `${issueDescriptions}\n\n`
      + `**📋 Requirements:**\n`
      + `✅ Must have a Telegram username (@username)\n\n`
      + `**⏰ Deadline: 48 hours**\n\n`
      + `If you do not update your profile within 48 hours, you will be automatically removed from the group.\n\n`
      + `**How to update:**\n`
      + `1. Open Telegram Settings\n`
      + `2. Tap "Edit Profile"\n`
      + `3. Set your first name in English (Latin characters only)\n`
      + `4. Set your username (@username)\n`
      + `5. Return to the group\n\n`
      + `After you update, your profile will be re-checked automatically.`;

    try {
      await ctx.telegram.sendMessage(userId, privateMessage, {
        parse_mode: 'Markdown',
      });

      logger.info('Private compliance warning sent', { userId, issues });
    } catch (error) {
      logger.debug('Could not send private message:', error.message);
    }

    // Also send group notification
    const groupMessage = `⚠️ **Profile Compliance Warning**\n\n`
      + `👤 **${firstName}** - Your profile does not meet our requirements.\n\n`
      + `${issueDescriptions}\n\n`
      + `⏰ **You have 48 hours to update your profile**\n\n`
      + `Please set:\n`
      + `• A Telegram username (@username)\n`
      + `• Your name in Latin alphabet (English characters)\n\n`
      + `If not corrected within 48 hours, you will be removed from the group.`;

    const sentMessage = await ctx.reply(groupMessage, {
      parse_mode: 'Markdown',
    });

    // Delete after 60 seconds
    ChatCleanupService.scheduleBotMessage(ctx.telegram, sentMessage, 60000);
  } catch (error) {
    logger.error('Error sending compliance warning:', error);
  }
}

/**
 * Format issue descriptions for messages
 */
function formatIssueDescriptions(issues) {
  const descriptions = {
    no_username: '❌ **No Username**: You must set a Telegram username (@username)',
    non_latin_characters: '❌ **Invalid Name**: Your first/last name contains non-Latin characters (Arabic, Russian, Chinese, etc.). Use English characters only.',
    invalid_name: '❌ **Invalid Name**: Your name is not valid.',
  };

  return issues
    .map((issue) => descriptions[issue] || `❌ **Issue**: ${issue}`)
    .join('\n\n');
}

/**
 * Purge non-compliant user
 */
async function purgeNonCompliantUser(ctx, userId, groupId, issues, firstName) {
  try {
    // Update compliance record
    await query(
      `UPDATE profile_compliance
       SET purged = true, purged_at = $1
       WHERE user_id = $2 AND group_id = $3`,
      [new Date(), userId.toString(), groupId.toString()],
    );

    // Try to kick user
    try {
      await ctx.kickChatMember(userId);
      logger.info('Non-compliant user purged', { userId, groupId, issues });
    } catch (error) {
      logger.debug('Could not kick non-compliant user:', error.message);
    }

    // Log the purge
    await ModerationModel.addLog({
      action: 'profile_compliance_purge',
      userId,
      groupId,
      reason: 'Non-compliant profile after 48-hour deadline',
      details: `Issues: ${issues.join(', ')}`,
    });

    // Notify admins
    try {
      const admins = await ctx.getChatAdministrators();

      const purgeNotification = `🚫 **Profile Compliance Purge**\n\n`
        + `👤 **${firstName}** (ID: ${userId})\n`
        + `Has been automatically removed from the group.\n\n`
        + `**Reason:** Non-compliant profile (not corrected within 48 hours)\n\n`
        + `**Issues:**\n`
        + formatIssueDescriptions(issues);

      for (const admin of admins) {
        if (admin.user.is_bot) continue;

        try {
          await ctx.telegram.sendMessage(admin.user.id, purgeNotification, {
            parse_mode: 'Markdown',
          });
        } catch (error) {
          logger.debug(`Could not notify admin ${admin.user.id}:`, error.message);
        }
      }
    } catch (error) {
      logger.debug('Error notifying admins of purge:', error.message);
    }
  } catch (error) {
    logger.error('Error purging non-compliant user:', error);
  }
}

module.exports = profileCompliance;
