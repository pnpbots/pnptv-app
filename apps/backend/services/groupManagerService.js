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

// Returns all hangout_groups that have a linked telegram_chat_id
async function getLinkedGroups() {
  const result = await query(
    `SELECT telegram_chat_id::text AS telegram_chat_id, id, name FROM hangout_groups WHERE telegram_chat_id IS NOT NULL`
  );
  return result.rows; // [{ telegram_chat_id, id, name }]
}

// Weekly stats for a group: new migrations in the last 7 days + top weekly contributor
async function getWeeklyStats(telegramChatId) {
  const [weeklyMig, topWeekly] = await Promise.all([
    query(
      `SELECT COUNT(*) AS count FROM group_migration_tracking
       WHERE telegram_chat_id = $1 AND migrated_at >= NOW() - INTERVAL '7 days'`,
      [String(telegramChatId)]
    ),
    query(
      `SELECT username, SUM(points) AS weekly_points
       FROM group_points
       WHERE telegram_chat_id = $1 AND created_at >= NOW() - INTERVAL '7 days'
       GROUP BY username ORDER BY weekly_points DESC LIMIT 1`,
      [String(telegramChatId)]
    ),
  ]);
  return {
    newMigrations: parseInt(weeklyMig.rows[0]?.count || '0', 10),
    topContributor: topWeekly.rows[0] || null,
  };
}

// Set a weekly challenge for a group (deactivates previous ones)
async function setChallenge(telegramChatId, description, setByUserId, expiresAt) {
  await query(
    `UPDATE group_challenges SET is_active = false WHERE telegram_chat_id = $1 AND is_active = true`,
    [String(telegramChatId)]
  );
  await query(
    `INSERT INTO group_challenges (telegram_chat_id, description, set_by_user_id, is_active, expires_at)
     VALUES ($1, $2, $3, true, $4)`,
    [String(telegramChatId), description, setByUserId ? String(setByUserId) : null, expiresAt || null]
  );
}

// Get current active challenge for a group
async function getActiveChallenge(telegramChatId) {
  const result = await query(
    `SELECT description, set_by_user_id, created_at, expires_at
     FROM group_challenges
     WHERE telegram_chat_id = $1 AND is_active = true AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at DESC LIMIT 1`,
    [String(telegramChatId)]
  );
  return result.rows[0] || null;
}

// Send a message to a Telegram group via HTTP API (used by scheduler + live bridge)
async function sendGroupMessage(telegramChatId, text, botToken) {
  const axios = require('axios');
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const resp = await axios.post(url, {
    chat_id: Number(telegramChatId),
    text,
    parse_mode: 'Markdown',
  }, { timeout: 8000 });
  return resp.data;
}

module.exports = { awardPoints, trackMigration, getMigrationCount, checkMilestone, getLeaderboard, getGroupStats, getLinkedHangout, getLinkedGroups, getWeeklyStats, setChallenge, getActiveChallenge, sendGroupMessage };
