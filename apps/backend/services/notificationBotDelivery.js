'use strict';

/**
 * notificationBotDelivery
 *
 * Sends notification messages to users via Telegram bot DM.
 * Fire-and-forget — never throws.
 *
 * userId here is the INTERNAL database user id (users.id).
 * Looks up users.telegram (numeric Telegram user id) before sending.
 */

const logger = require('../utils/logger');
const { query } = require('../config/postgres');
const { cache } = require('../config/redis');

// Bot reference — set from bot.js or lazy-loaded
let _bot = null;

function setBotRef(bot) {
  _bot = bot;
}

function getBot() {
  if (_bot) return _bot;
  try {
    const { getBotInstance } = require('../bot/core/bot');
    _bot = getBotInstance();
  } catch {
    // bot.js not ready yet
  }
  return _bot;
}

const TYPE_EMOJI = {
  follow: '\u{1F464}',
  like: '\u2764\uFE0F',
  reply: '\u{1F4AC}',
  dm: '\u2709\uFE0F',
  group_message: '\u{1F465}',
  group_join: '\u{1F389}',
  wof_winner: '\u{1F3C6}',
  payment: '\u{1F4B0}',
  announcement: '\u{1F4E2}',
  system: '\u{1F514}',
  hangout_call: '\u{1F4F9}',
  hangout_creator_joined: '\u2B50',
  creator_activated: '\u{1F389}',
  creator_approved: '\u{1F389}',
};

function buildUrl(type, entityType, entityId) {
  const base = process.env.APP_PUBLIC_URL || 'https://pnptv.app';
  switch (type) {
    case 'follow':
      return entityId ? `${base}/profile/${entityId}` : base;
    case 'like':
    case 'reply':
    case 'reaction_post':
    case 'mention_post':
      return entityId ? `${base}/social/post/${entityId}` : `${base}/social`;
    case 'dm':
      return entityId ? `${base}/dm/${entityId}` : `${base}/dm`;
    case 'reaction_chat':
    case 'mention_chat':
    case 'group_message':
    case 'group_join':
    case 'group_join_request':
    case 'group_request_accepted':
    case 'hangout_call':
    case 'hangout_creator_joined':
      return entityId ? `${base}/chat/${entityId}` : `${base}/chat`;
    case 'creator_activated':
    case 'creator_approved':
      return `${base}/profile`;
    case 'wof_winner':
      return `${base}/social`;
    case 'payment':
      return `${base}/subscribe`;
    case 'live_stream_started':
      return entityId ? `${base}/live/${entityId}` : `${base}/live`;
    default:
      return base;
  }
}

const TELEGRAM_ID_CACHE_TTL = 600; // 10 minutes

async function getTelegramId(userId) {
  const cacheKey = `notif:tgid:${userId}`;
  try {
    const cached = await cache.get(cacheKey);
    if (cached !== null) return cached || null; // cached empty string = no telegram

    const { rows } = await query(
      'SELECT telegram FROM users WHERE id = $1',
      [userId]
    );
    const telegramId = rows[0]?.telegram || '';
    await cache.set(cacheKey, telegramId, TELEGRAM_ID_CACHE_TTL);
    return telegramId || null;
  } catch (err) {
    logger.warn('[notificationBotDelivery] getTelegramId error', { userId, error: err.message });
    return null;
  }
}

/**
 * Send a notification to a user via Telegram bot DM.
 * Fire-and-forget: never throws.
 */
async function sendNotificationViaTelegram(userId, { type, message, entityType = null, entityId = null }) {
  // Telegram notification mirroring disabled — notifications are in-app and push only
  return;

  const bot = getBot();
  if (!bot) return;

  const telegramId = await getTelegramId(userId);
  if (!telegramId) return;

  try {
    const emoji = TYPE_EMOJI[type] || '\u{1F514}';
    const escapedMessage = message
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const deepUrl = buildUrl(type, entityType, entityId);

    await bot.telegram.sendMessage(telegramId, `${emoji} ${escapedMessage}`, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: 'View on PNPtv!', url: deepUrl },
        ]],
      },
    });
  } catch (err) {
    const code = err.response?.error_code;
    // 403 = blocked bot, 400 = chat not found — both expected, silent
    if (code === 403 || code === 400) return;
    logger.warn('[notificationBotDelivery] Telegram DM failed', {
      userId, telegramId, type, errorCode: code, error: err.message,
    });
  }
}

module.exports = { sendNotificationViaTelegram, setBotRef };
