'use strict';

/**
 * Send a Telegram DM to every platform admin/superadmin via the bot.
 *
 * Used for security-sensitive alerts (identity change, moderation flags,
 * suspicious activity) where we want the admin to see the alert in
 * real-time inside Telegram — not just queued to `/admin/moderation`
 * dashboards they may not check for hours.
 *
 * Failure is non-fatal for the caller: a Telegram outage must not block
 * the underlying user action.
 */

const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const CACHE_TTL_MS = 60_000;
let _cache = { list: [], expiresAt: 0 };

async function getAdminTelegramIds() {
  const now = Date.now();
  if (now < _cache.expiresAt) return _cache.list;
  try {
    const { rows } = await query(
      `SELECT telegram FROM users
        WHERE role IN ('admin', 'superadmin')
          AND telegram IS NOT NULL
          AND COALESCE(is_deleted, false) = false`
    );
    const list = rows.map((r) => r.telegram).filter(Boolean);
    _cache = { list, expiresAt: now + CACHE_TTL_MS };
    return list;
  } catch (err) {
    logger.warn(`adminAlertService: admin list lookup failed: ${err.message}`);
    return _cache.list; // fall back to stale cache — better than dropping the alert
  }
}

/**
 * @param {string} html — Message body with Telegram HTML formatting already applied
 * @param {Object} [opts]
 * @param {boolean} [opts.silent=false] — Send as a quiet notification
 * @returns {Promise<{sent: number, failed: number}>}
 */
async function alertAdmins(html, opts = {}) {
  const { silent = false } = opts;
  try {
    const { getBotInstance } = require('../bot/core/bot');
    const bot = getBotInstance();
    if (!bot) {
      logger.warn('adminAlertService: bot instance unavailable — alert dropped');
      return { sent: 0, failed: 0 };
    }
    const ids = await getAdminTelegramIds();
    if (ids.length === 0) return { sent: 0, failed: 0 };

    let sent = 0;
    let failed = 0;
    for (const tgId of ids) {
      try {
        await bot.telegram.sendMessage(tgId, html, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          disable_notification: silent,
        });
        sent++;
      } catch (err) {
        failed++;
        // 403 = admin blocked the bot; log at debug so it's not noise
        if (err?.response?.error_code === 403) {
          logger.debug(`adminAlertService: admin ${tgId} blocked the bot`);
        } else {
          logger.warn(`adminAlertService: send to ${tgId} failed: ${err.message}`);
        }
      }
    }
    return { sent, failed };
  } catch (err) {
    logger.error(`adminAlertService: unexpected error: ${err.message}`);
    return { sent: 0, failed: 0 };
  }
}

function escape(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

module.exports = { alertAdmins, escape };
