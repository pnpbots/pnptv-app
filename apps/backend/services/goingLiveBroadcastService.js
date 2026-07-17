'use strict';

/**
 * Going-Live Broadcast Service
 *
 * When a creator starts a stream, fan-out a Telegram DM (and push notification
 * if web-push is configured) to every follower who has not opted out.
 *
 * Dedup key: pnp:live:announced:{creatorId}:{YYYY-MM-DD}  TTL 6 h
 * Opt-out:   notification_preferences JSONB key "going_live" -> { bot: bool, push: bool }
 *            Default is opted-in on both channels.
 *
 * Fan-out cap: 5 000 followers per call (batch window 50 ms between DMs).
 */

const logger = require('../utils/logger');
const { query } = require('../config/postgres');
const { getRedis } = require('../config/redis');
const { Markup } = require('telegraf');

const FOLLOWER_CAP       = 5_000;
const DM_RATE_DELAY_MS   = 50;          // 50 ms between Telegram DMs
const DEDUP_TTL_SECONDS  = 6 * 60 * 60; // 6 hours

/**
 * Build the YYYY-MM-DD string for the dedup key (UTC date).
 */
function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Check (and atomically set) the per-creator dedup key in Redis.
 * Returns true  → already announced for this session, skip.
 * Returns false → first announcement; key is now set.
 *
 * LIVE-H-03: Key is now session-scoped using streamId so the dedup is per stream
 * session, not per calendar day. Falls back to date-granular key when no streamId
 * is supplied (e.g. from the manual broadcast endpoint).
 *
 * @param {string|number} creatorId
 * @param {string|null} [streamId]  — session identifier (timestamp or UUID)
 * @returns {Promise<boolean>}
 */
async function isAlreadyAnnounced(creatorId, streamId) {
  const redis = getRedis();
  const suffix = streamId ? streamId : todayUtc();
  const key = `pnp:live:announced:${creatorId}:${suffix}`;
  // NX = set only if not exists; returns 1 on success, null if key already existed
  const result = await redis.set(key, '1', 'EX', DEDUP_TTL_SECONDS, 'NX');
  return result === null; // null → key existed → already announced
}

/**
 * Load the creator's display name from the DB.
 *
 * @param {string|number} creatorId
 * @returns {Promise<string>}
 */
async function resolveCreatorName(creatorId) {
  try {
    const { rows } = await query(
      `SELECT COALESCE(first_name, username, 'A creator') AS name FROM users WHERE id = $1 LIMIT 1`,
      [String(creatorId)]
    );
    return rows[0]?.name ?? 'A creator';
  } catch {
    return 'A creator';
  }
}

/**
 * Load up to FOLLOWER_CAP followers for a creator.
 * Only includes users who:
 *   - have a Telegram ID linked (telegram IS NOT NULL)
 *   - have not opted out of going_live bot DMs
 *     (notification_preferences->>'going_live' is null OR bot channel is true)
 *
 * @param {string|number} creatorId
 * @returns {Promise<Array<{ telegram: string, id: string, push_opted_in: boolean }>>}
 */
async function loadFollowers(creatorId) {
  // going_live->bot defaults to true when the key is absent; we exclude rows
  // where the stored value explicitly sets bot to false.
  const { rows } = await query(
    `SELECT
       u.id,
       u.telegram,
       COALESCE(
         (u.notification_preferences->'going_live'->>'bot')::boolean,
         true
       ) AS bot_opted_in,
       COALESCE(
         (u.notification_preferences->'going_live'->>'push')::boolean,
         true
       ) AS push_opted_in
     FROM user_follows uf
     JOIN users u ON u.id = uf.follower_id
     WHERE uf.following_id = $1
       AND u.telegram IS NOT NULL
       AND COALESCE(
             (u.notification_preferences->'going_live'->>'bot')::boolean,
             true
           ) = true
     LIMIT $2`,
    [String(creatorId), FOLLOWER_CAP]
  );
  return rows;
}

/**
 * Load followers who have push opted in (separate query, no telegram requirement).
 *
 * @param {string|number} creatorId
 * @returns {Promise<Array<{ id: string }>>}
 */
async function loadPushFollowers(creatorId) {
  const { rows } = await query(
    `SELECT u.id
     FROM user_follows uf
     JOIN users u ON u.id = uf.follower_id
     WHERE uf.following_id = $1
       AND u.deleted_at IS NULL
       AND COALESCE(u.tier, 'free') != 'banned'
       AND COALESCE(
             (u.notification_preferences->'going_live'->>'push')::boolean,
             true
           ) = true
     LIMIT $2`,
    [String(creatorId), FOLLOWER_CAP]
  );
  return rows;
}

/**
 * Fan-out Telegram DMs to followers.
 *
 * @param {import('telegraf').Telegraf} bot
 * @param {Array<{ telegram: string, id: string }>} followers
 * @param {string} creatorName
 * @param {string} channelRef  — Restreamer channel slug, e.g. 'pnptv-frank'
 * @param {string|null} [customMessage]  — Optional override message (plain text, no MD escaping needed from caller)
 */
async function sendTelegramDMs(bot, followers, creatorName, channelRef, customMessage) {
  const appUrl = (process.env.APP_PUBLIC_URL || 'https://pnptv.app').replace(/\/$/, '');
  const watchPath = channelRef ? `/live/${encodeURIComponent(channelRef)}` : '/live';
  const watchUrl  = `${appUrl}${watchPath}`;

  // Escape for MarkdownV2
  const safeName = creatorName.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
  let message;
  if (customMessage) {
    const safeCustom = customMessage.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
    message = safeCustom;
  } else {
    message =
      `🔴 *${safeName} is live now on PNPtv\\!*\n\n` +
      `Watch before the room fills up\\.`;
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url('Watch Now', watchUrl)],
  ]);

  let sent = 0;
  for (const follower of followers) {
    try {
      await bot.telegram.sendMessage(follower.telegram, message, {
        parse_mode: 'MarkdownV2',
        ...keyboard,
      });
      sent++;
    } catch (err) {
      if (err.code === 403) {
        logger.warn('goingLiveBroadcast: follower blocked bot', { telegram: follower.telegram });
      } else if (err.code === 400 && err.description?.includes('chat not found')) {
        logger.warn('goingLiveBroadcast: chat not found', { telegram: follower.telegram });
      } else {
        logger.warn('goingLiveBroadcast: DM failed', { telegram: follower.telegram, code: err.code, msg: err.message });
      }
    }
    await new Promise((r) => setTimeout(r, DM_RATE_DELAY_MS));
  }

  return sent;
}

function escHtml(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/**
 * Post the "going live" announcement to every linked Telegram group with
 * the same format used in the in-app social feed and the DM: a branded
 * stream snapshot as the header image, a caption with the creator name +
 * PNPtv tagline, and an inline "Watch Now" button.
 *
 * Falls back to a text-only send with link preview if the snapshot fetch
 * fails (Restreamer down, channel offline for a moment, etc.).
 *
 * Dedup key `live:group:notif:{chatId}:{creatorId}` with 1h TTL prevents
 * spamming a group if the creator toggles live off/on quickly.
 *
 * @param {import('telegraf').Telegraf} bot
 * @param {string|number} creatorId
 * @param {string} channelRef
 * @param {string} creatorName
 * @param {string|null} [customMessage]
 * @returns {Promise<number>} count of groups notified
 */
async function notifyLinkedGroups(bot, creatorId, channelRef, creatorName, customMessage) {
  if (!bot) return 0;
  const groupManagerService = require('./groupManagerService');
  const ogService = require('./ogService');
  const redis = getRedis();

  const groups = await groupManagerService.getLinkedGroups().catch(() => []);
  if (!groups || groups.length === 0) return 0;

  const appUrl = (process.env.APP_PUBLIC_URL || 'https://pnptv.app').replace(/\/$/, '');
  const watchUrl = channelRef ? `${appUrl}/live/${encodeURIComponent(channelRef)}` : appUrl;

  // Build the branded snapshot once and reuse across every group in this run.
  let snapshotBuf = null;
  try {
    snapshotBuf = await ogService.fetchAndBrandStreamSnapshot(channelRef, creatorName);
  } catch (err) {
    logger.warn('goingLiveBroadcast: snapshot fetch failed — text-only fallback', {
      creatorId, channelRef, error: err.message,
    });
  }

  const safeName = escHtml(creatorName || 'A creator');
  const tagline = 'Real Models. Real Clouds. 🌫️';
  const caption = customMessage
    ? `🔴 <b>${safeName} is LIVE!</b>\n\n${escHtml(String(customMessage).slice(0, 400))}\n\n${tagline}\n\n👉 ${escHtml(watchUrl)}`
    : `🔴 <b>${safeName} is LIVE on PNPtv!</b>\n${tagline}\n\n👉 ${escHtml(watchUrl)}`;

  const kb = Markup.inlineKeyboard([[Markup.button.url('▶️ Watch Now', watchUrl)]]);

  let sent = 0;
  for (const group of groups) {
    const chatId = group.telegram_chat_id;
    const dedupKey = `live:group:notif:${chatId}:${creatorId}`;
    if (redis && (await redis.get(dedupKey).catch(() => null))) continue;

    try {
      if (snapshotBuf) {
        await bot.telegram.sendPhoto(
          chatId,
          { source: snapshotBuf },
          { caption, parse_mode: 'HTML', ...kb },
        );
      } else {
        await bot.telegram.sendMessage(
          chatId,
          caption,
          { parse_mode: 'HTML', disable_web_page_preview: false, ...kb },
        );
      }
      sent++;
      if (redis) await redis.set(dedupKey, '1', 'EX', 3600).catch(() => {});
    } catch (err) {
      logger.warn('goingLiveBroadcast: group notify failed', {
        chatId, creatorId, error: err?.response?.description || err.message,
      });
    }
  }
  return sent;
}

/**
 * Fan-out web-push notifications to opted-in followers.
 * Silently no-ops if PushNotificationService is unavailable.
 *
 * @param {Array<{ id: string }>} followers
 * @param {string} creatorName
 * @param {string} channelRef
 */
async function sendPushNotifications(followers, creatorName, channelRef) {
  let PushNotificationService;
  try {
    PushNotificationService = require('./pushNotificationService');
  } catch {
    return 0;
  }

  const appUrl = (process.env.APP_PUBLIC_URL || 'https://pnptv.app').replace(/\/$/, '');
  const watchPath = channelRef ? `/live/${encodeURIComponent(channelRef)}` : '/live';
  const watchUrl  = `${appUrl}${watchPath}`;

  const followerIds = followers.map(f => f.id);
  if (followerIds.length === 0) return 0;

  // Single batched query for all follower subscriptions instead of N per-user queries.
  const sent = await PushNotificationService.sendToUsers(followerIds, {
    title: `${creatorName} is live!`,
    body:  'Watch now before the room fills up.',
    url:   watchUrl,
    tag:   `going-live-${channelRef}`,
  }).catch(() => 0);
  return sent;
}

/**
 * Main entry point — call this immediately after emitting 'stream:started'.
 * Fire-and-forget: caller uses setImmediate to not block the socket response.
 *
 * @param {import('telegraf').Telegraf} bot
 * @param {string|number} creatorId
 * @param {string} channelRef
 * @param {{ message?: string }} [opts]  — Optional overrides
 * @param {string|null} [streamId]  — Session-scoped dedup identifier (LIVE-H-03)
 * @returns {Promise<{ dispatched: number, skippedDedup: boolean }>}
 */
async function broadcastGoingLive(bot, creatorId, channelRef, opts = {}, streamId = null) {
  try {
    const alreadyAnnounced = await isAlreadyAnnounced(creatorId, streamId);
    if (alreadyAnnounced) {
      logger.info('goingLiveBroadcast: skipped (dedup)', { creatorId, channelRef });
      return { dispatched: 0, skippedDedup: true };
    }

    const [creatorName, dmFollowers, pushFollowers] = await Promise.all([
      resolveCreatorName(creatorId),
      loadFollowers(creatorId),
      loadPushFollowers(creatorId),
    ]);

    const customMessage = opts?.message || null;

    if (dmFollowers.length === 0 && pushFollowers.length === 0) {
      logger.info('goingLiveBroadcast: no opted-in followers — feed+X+groups announce only', { creatorId });
      setImmediate(() => {
        const cristinaFeedService = require('./cristinaFeedService');
        cristinaFeedService.announceLiveStream(creatorId, creatorName, channelRef).catch((err) => {
          logger.warn('goingLiveBroadcast: announceLiveStream error', { creatorId, error: err.message });
        });
      });
      setImmediate(() => {
        notifyLinkedGroups(bot, creatorId, channelRef, creatorName, customMessage).catch((err) => {
          logger.warn('goingLiveBroadcast: notifyLinkedGroups error', { creatorId, error: err.message });
        });
      });
      return { dispatched: 0, skippedDedup: false };
    }

    const [dmSent, pushSent] = await Promise.all([
      // Telegram notification mirroring disabled — notifications are in-app and push only
      // bot ? sendTelegramDMs(bot, dmFollowers, creatorName, channelRef, customMessage) : Promise.resolve(0),
      Promise.resolve(0),
      sendPushNotifications(pushFollowers, creatorName, channelRef),
    ]);

    logger.info('goingLiveBroadcast: fan-out complete', {
      creatorId,
      channelRef,
      dmFollowers: dmFollowers.length,
      pushFollowers: pushFollowers.length,
      dmSent,
      pushSent,
    });

    // Fire-and-forget: feed post + X announcement (branded snapshot card)
    setImmediate(() => {
      const cristinaFeedService = require('./cristinaFeedService');
      cristinaFeedService.announceLiveStream(creatorId, creatorName, channelRef).catch((err) => {
        logger.warn('goingLiveBroadcast: announceLiveStream error', { creatorId, error: err.message });
      });
    });

    // Fire-and-forget: Telegram group notifications with the same branded
    // snapshot + tagline + Watch Now button as the feed post and DM.
    setImmediate(() => {
      notifyLinkedGroups(bot, creatorId, channelRef, creatorName, customMessage).catch((err) => {
        logger.warn('goingLiveBroadcast: notifyLinkedGroups error', { creatorId, error: err.message });
      });
    });

    return { dispatched: dmSent + pushSent, skippedDedup: false };
  } catch (err) {
    logger.error('goingLiveBroadcast: error', { creatorId, channelRef, error: err.message });
    return { dispatched: 0, skippedDedup: false };
  }
}

module.exports = { broadcastGoingLive, notifyLinkedGroups };
