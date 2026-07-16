'use strict';

const cron = require('node-cron');
const logger = require('../../../utils/logger');
const groupManagerService = require('../../../services/groupManagerService');

const DIGEST_CRON = '0 10 * * 0'; // Sunday 10:00 AM UTC
const DIGEST_TZ = 'UTC';

// FIX 19: Accept telegram object to use bot.telegram instead of raw axios calls
async function runGroupDigest(telegram) {
  if (!telegram) {
    logger.warn('[GroupDigest] No telegram instance provided, skipping digest');
    return;
  }

  let groups;
  try {
    groups = await groupManagerService.getLinkedGroups();
  } catch (err) {
    logger.error('[GroupDigest] Failed to fetch linked groups', { error: err.message });
    return;
  }

  if (groups.length === 0) {
    logger.info('[GroupDigest] No linked groups, skipping');
    return;
  }

  logger.info('[GroupDigest] Starting weekly digest', { groupCount: groups.length });

  for (const group of groups) {
    try {
      const [stats, weekly, top, challenge] = await Promise.all([
        groupManagerService.getGroupStats(group.telegram_chat_id),
        groupManagerService.getWeeklyStats(group.telegram_chat_id),
        groupManagerService.getLeaderboard(group.telegram_chat_id, 1),
        groupManagerService.getActiveChallenge(group.telegram_chat_id),
      ]);

      let msg = `📊 *Weekly PNPtv Report* — ${group.name}\n\n`;
      msg += `New members who joined PNPtv this week: *${weekly.newMigrations}*\n`;
      msg += `Total community members on PNPtv: *${stats.migrationCount}*\n`;

      if (weekly.topContributor?.username) {
        msg += `\n🏆 Top contributor this week: *@${weekly.topContributor.username}* (${weekly.topContributor.weekly_points} pts)\n`;
      } else if (top.length > 0 && top[0].username) {
        msg += `\n🏆 All-time top member: *@${top[0].username}* (${top[0].total_points} pts)\n`;
      }

      if (challenge) {
        msg += `\n🎯 *Active challenge:* ${challenge.description}\n`;
      }

      msg += `\n_Not on PNPtv yet? Join now: https://pnptv.app_`;

      // FIX 19: Use bot.telegram.sendMessage instead of raw axios (avoids token in URLs/logs)
      await telegram.sendMessage(Number(group.telegram_chat_id), msg, { parse_mode: 'Markdown' });
      logger.info('[GroupDigest] Sent digest to group', { chatId: group.telegram_chat_id, name: group.name });

      // Small delay to avoid Telegram rate limits
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      logger.warn('[GroupDigest] Failed to send digest to group', { chatId: group.telegram_chat_id, error: err.message });
    }
  }

  logger.info('[GroupDigest] Weekly digest complete', { groupCount: groups.length });
}

// FIX 19: Accept telegram parameter and forward it to runGroupDigest
function startGroupDigestScheduler(telegram) {
  if (!cron.validate(DIGEST_CRON)) {
    logger.error('[GroupDigest] Invalid cron expression', { cron: DIGEST_CRON });
    return;
  }

  cron.schedule(DIGEST_CRON, () => runGroupDigest(telegram), { timezone: DIGEST_TZ });

  logger.info('[GroupDigest] Scheduler started', {
    cron: DIGEST_CRON,
    timezone: DIGEST_TZ,
    nextRun: 'Sunday 10:00 AM UTC',
  });
}

module.exports = { startGroupDigestScheduler, runGroupDigest };
