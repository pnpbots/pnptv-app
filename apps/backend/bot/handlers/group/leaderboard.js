'use strict';

const logger = require('../../../utils/logger');
const { query } = require('../../../config/postgres');

/**
 * Leaderboard Handler
 * Displays top contributors in the group by cumulative points (group_points table).
 * Falls back to current-week group_activity_ranks if data is available for this week.
 */

// Returns the ISO Monday date string for the current UTC week (YYYY-MM-DD).
function currentWeekStart() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon
  const daysSinceMonday = (day + 6) % 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
  return monday.toISOString().slice(0, 10);
}

async function showLeaderboard(ctx) {
  try {
    const chatId = String(ctx.chat?.id);
    if (!chatId) {
      await ctx.reply('This command only works inside a group.');
      return;
    }

    // Prefer current-week ranking rows if they already exist for this group.
    const weekStart = currentWeekStart();
    const rankRes = await query(
      `SELECT username, telegram_user_id, points, rank_position, prime_awarded
         FROM group_activity_ranks
        WHERE telegram_chat_id = $1
          AND week_start = $2
        ORDER BY rank_position ASC NULLS LAST, points DESC
        LIMIT 10`,
      [chatId, weekStart]
    );

    let rows = rankRes.rows;
    let sourceLabel = 'This Week';

    if (rows.length === 0) {
      // No current-week rank yet — aggregate all-time points for this group.
      const pointsRes = await query(
        `SELECT MAX(username) AS username,
                MAX(telegram_user_id) AS telegram_user_id,
                SUM(points)::int AS points
           FROM group_points
          WHERE telegram_chat_id = $1
          GROUP BY pnptv_user_id
          HAVING SUM(points) > 0
          ORDER BY SUM(points) DESC, MIN(created_at) ASC
          LIMIT 10`,
        [chatId]
      );
      rows = pointsRes.rows;
      sourceLabel = 'All Time';
    }

    if (rows.length === 0) {
      await ctx.reply('No activity recorded for this group yet. Start contributing to appear on the leaderboard!');
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = [];
    lines.push(`🏆 Top Contributors — ${sourceLabel}`);
    lines.push('');

    rows.forEach((r, i) => {
      const medal = medals[i] || `${i + 1}.`;
      const who = r.username ? `@${r.username}` : 'Member';
      const pts = Number(r.points).toLocaleString();
      lines.push(`${medal} ${who} — ${pts} pts`);
    });

    lines.push('');
    lines.push('Keep the energy going! 🔥');

    await ctx.reply(lines.join('\n'));
  } catch (error) {
    logger.error('[Leaderboard] Error showing leaderboard', { error: error.message });
    await ctx.reply('Could not load the leaderboard right now. Try again in a moment.');
  }
}

function registerLeaderboardHandlers(bot) {
  bot.command('leaderboard', showLeaderboard);
  bot.command('ranking', showLeaderboard);
  bot.command('top', showLeaderboard);
}

module.exports = {
  showLeaderboard,
  registerLeaderboardHandlers,
};
