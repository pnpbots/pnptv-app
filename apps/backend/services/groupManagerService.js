'use strict';

const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const MILESTONES = [10, 25, 50, 100, 250, 500];

async function awardPoints(telegramChatId, pnptvUserId, telegramUserId, username, points, reason) {
  try {
    await query(
      `INSERT INTO group_points (telegram_chat_id, pnptv_user_id, telegram_user_id, username, points, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [String(telegramChatId), String(pnptvUserId), telegramUserId ? String(telegramUserId) : null, username || null, points, reason]
    );
  } catch (err) {
    logger.warn('groupManagerService.awardPoints failed', { error: err.message });
  }
}

async function trackMigration(telegramChatId, hangoutGroupId, pnptvUserId, telegramUserId, username) {
  try {
    const result = await query(
      `INSERT INTO group_migration_tracking (telegram_chat_id, hangout_group_id, pnptv_user_id, telegram_user_id, username)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (telegram_chat_id, pnptv_user_id) DO NOTHING`,
      [String(telegramChatId), hangoutGroupId || null, String(pnptvUserId), String(telegramUserId), username || null]
    );
    return result.rowCount > 0;
  } catch (err) {
    logger.warn('groupManagerService.trackMigration failed', { error: err.message });
    return false;
  }
}

async function getMigrationCount(telegramChatId) {
  const result = await query(
    `SELECT COUNT(*) AS count FROM group_migration_tracking WHERE telegram_chat_id = $1`,
    [String(telegramChatId)]
  );
  return parseInt(result.rows[0]?.count || '0', 10);
}

async function checkMilestone(telegramChatId) {
  const count = await getMigrationCount(telegramChatId);
  return MILESTONES.includes(count) ? count : null;
}

async function getLeaderboard(telegramChatId, limit = 10) {
  const result = await query(
    `SELECT pnptv_user_id, telegram_user_id, username, SUM(points) AS total_points
     FROM group_points
     WHERE telegram_chat_id = $1
     GROUP BY pnptv_user_id, telegram_user_id, username
     ORDER BY total_points DESC
     LIMIT $2`,
    [String(telegramChatId), limit]
  );
  return result.rows;
}

async function getGroupStats(telegramChatId) {
  const [migCount, pointsRes] = await Promise.all([
    getMigrationCount(telegramChatId),
    query(
      `SELECT COUNT(DISTINCT pnptv_user_id) AS participants, COALESCE(SUM(points), 0) AS total_points
       FROM group_points WHERE telegram_chat_id = $1`,
      [String(telegramChatId)]
    ),
  ]);
  return {
    migrationCount: migCount,
    participants: parseInt(pointsRes.rows[0]?.participants || '0', 10),
    totalPoints: parseInt(pointsRes.rows[0]?.total_points || '0', 10),
  };
}

async function getLinkedHangout(telegramChatId) {
  const result = await query(
    `SELECT id, name FROM hangout_groups WHERE telegram_chat_id = $1 LIMIT 1`,
    [String(telegramChatId)]
  );
  return result.rows[0] || null;
}

module.exports = { awardPoints, trackMigration, getMigrationCount, checkMilestone, getLeaderboard, getGroupStats, getLinkedHangout };
