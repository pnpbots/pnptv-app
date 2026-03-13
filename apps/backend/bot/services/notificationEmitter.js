'use strict';

const { query } = require('../../config/postgres');
const { cache } = require('../../config/redis');
const logger = require('../../utils/logger');

// Mapping from notification type to the user preference key
const TYPE_TO_PREF = {
  like: 'likes',
  reply: 'replies',
  dm: 'dms',
  group_message: 'group_messages',
  group_join: 'group_joins',
  wof_winner: 'wof',
  payment: 'payments',
  announcement: 'announcements',
  system: 'announcements',
  follow: 'follows',
  hangout_call: 'hangout_calls',
  hangout_creator_joined: 'hangout_calls',
  reaction_post: 'reactions',
  reaction_chat: 'reactions',
  mention_post: 'mentions',
  mention_chat: 'mentions',
};

// TTL constants (seconds)
const NOTIF_PREFS_TTL = 300;  // 5 minutes
const UNREAD_COUNT_TTL = 300; // 5 minutes

// Maximum number of recipients for a single emitToMany call.
const MAX_FANOUT = 500;

// Types that should NOT trigger a bot DM (would double-notify)
const SKIP_BOT_TYPES = new Set(['dm', 'group_message']);

// Notification types that originate from a specific user action toward another user.
// These must be suppressed when a block relationship exists between actor and target.
const USER_TO_USER_TYPES = new Set(['follow', 'like', 'reply', 'dm', 'hangout_call', 'hangout_creator_joined', 'group_join', 'reaction_post', 'reaction_chat', 'mention_post', 'mention_chat']);

// Redis key for caching block check results (short TTL — blocks can be added/removed)
const BLOCK_CHECK_TTL = 60; // 1 minute

/**
 * Returns true if a block relationship exists between actorId and targetUserId
 * in either direction. Results are cached in Redis for BLOCK_CHECK_TTL seconds.
 */
async function isBlockedBetween(actorId, targetUserId) {
  const cacheKey = `notif:block_check:${actorId}:${targetUserId}`;
  try {
    const cached = await cache.get(cacheKey);
    if (cached !== null) return cached === true || cached === 'true';
  } catch (_) { /* non-fatal */ }

  try {
    const { rowCount } = await query(
      `SELECT 1 FROM blocked_users
       WHERE (user_id = $1 AND blocked_user_id = $2)
          OR (user_id = $2 AND blocked_user_id = $1)
       LIMIT 1`,
      [actorId, targetUserId]
    );
    const blocked = rowCount > 0;
    cache.set(cacheKey, blocked, BLOCK_CHECK_TTL).catch(() => {});
    return blocked;
  } catch (err) {
    logger.warn('NotificationEmitter: block check query failed', { actorId, targetUserId, error: err.message });
    // Fail open — do not suppress notifications when the DB check itself errors
    return false;
  }
}

let _io = null;

function prefKey(userId) {
  return `user:${userId}:notif_prefs`;
}

function unreadKey(userId) {
  return `notif:unread:${userId}`;
}

async function getPrefs(userId) {
  const cached = await cache.get(prefKey(userId));
  if (cached !== null) return cached;

  const { rows } = await query(
    'SELECT notification_preferences FROM users WHERE id = $1',
    [userId]
  );
  const prefs = rows[0]?.notification_preferences || {};
  await cache.set(prefKey(userId), prefs, NOTIF_PREFS_TTL);
  return prefs;
}

async function invalidatePrefsCache(userId) {
  await cache.del(prefKey(userId));
}

async function invalidateUnreadCache(userId) {
  await cache.del(unreadKey(userId));
}

/**
 * Check if a specific channel is enabled for a notification type.
 * Handles both legacy boolean format and new per-channel object format.
 */
function isChannelEnabled(prefVal, channel, defaultVal = true) {
  if (prefVal === undefined || prefVal === null) return defaultVal;
  if (typeof prefVal === 'boolean') return prefVal;
  if (typeof prefVal === 'object') {
    return prefVal[channel] !== undefined ? prefVal[channel] !== false : defaultVal;
  }
  return defaultVal;
}

/**
 * Build a deep-link URL for push/bot notifications.
 */
function buildNotificationUrl(type, entityType, entityId) {
  switch (type) {
    case 'follow':
      return entityId ? `/profile/${entityId}` : '/';
    case 'like':
    case 'reply':
    case 'reaction_post':
    case 'mention_post':
      return entityId ? `/social/post/${entityId}` : '/social';
    case 'reaction_chat':
    case 'mention_chat':
      return '/chat';
    case 'dm':
      return entityId ? `/dm/${entityId}` : '/dm';
    case 'hangout_call':
    case 'hangout_creator_joined':
      return '/main-stage';
    case 'wof_winner':
      return '/social';
    case 'payment':
      return '/subscribe';
    default:
      return '/';
  }
}

/**
 * Unified Notification Emitter — singleton.
 * Call setIO(io) once from bot.js after Socket.IO is created.
 */
const NotificationEmitter = {
  setIO(io) {
    _io = io;
    logger.info('NotificationEmitter: Socket.IO reference set');
  },

  invalidatePrefsCache,
  invalidateUnreadCache,

  /**
   * Emit a single notification.
   *
   * Flow: check prefs → insert to DB → emit Socket.IO → fire-and-forget push + bot DM
   */
  async emit({
    type,
    category = 'social',
    priority = 'normal',
    actorId = null,
    targetUserId,
    entityType = null,
    entityId = null,
    message,
    metadata = {},
  }) {
    try {
      if (!targetUserId || !type || !message) return;

      // No self-notifications
      if (actorId && String(actorId) === String(targetUserId)) return;

      // ── Block gate — silently drop user-to-user notifications when a block exists ──
      if (actorId && USER_TO_USER_TYPES.has(type)) {
        const blocked = await isBlockedBetween(actorId, targetUserId);
        if (blocked) return;
      }

      // ── Preference check (Redis-cached, 5 min TTL) ──
      const prefKey2 = TYPE_TO_PREF[type];
      let prefVal;

      if (prefKey2) {
        const prefs = await getPrefs(targetUserId);
        prefVal = prefs[prefKey2];

        // Legacy: boolean false = skip entirely
        if (prefVal === false) return;

        // New format: inApp:false = skip DB insert + all channels
        if (typeof prefVal === 'object' && prefVal !== null && prefVal.inApp === false) return;
      }

      // ── DB insert (combined INSERT + actor lookup in single CTE) ──
      // The notifications table has two partial unique indexes:
      //   uq_notif_dedup_with_actor  — WHERE actor_id IS NOT NULL
      //   uq_notif_dedup_system      — WHERE actor_id IS NULL
      // ON CONFLICT must reference the correct one based on whether actor_id is set.
      const hasActor = actorId != null;
      const conflictClause = hasActor
        ? 'ON CONFLICT (type, actor_id, target_user_id, entity_type, entity_id) WHERE actor_id IS NOT NULL'
        : 'ON CONFLICT (type, target_user_id, entity_type, entity_id) WHERE actor_id IS NULL';

      const { rows: resultRows } = await query(
        `WITH upserted AS (
           INSERT INTO notifications
             (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ${conflictClause}
           DO UPDATE SET
             is_read    = FALSE,
             created_at = NOW(),
             message    = EXCLUDED.message,
             metadata   = EXCLUDED.metadata,
             priority   = EXCLUDED.priority
           RETURNING
             id, type, category, priority, actor_id, target_user_id,
             entity_type, entity_id, message, metadata, is_read, created_at
         ),
         actor_info AS (
           SELECT id, username, first_name, photo_file_id
           FROM   users
           WHERE  id = $4
         )
         SELECT
           u.id, u.type, u.category, u.priority, u.actor_id, u.target_user_id,
           u.entity_type, u.entity_id, u.message, u.metadata, u.is_read, u.created_at,
           a.username AS actor_username, a.first_name AS actor_first_name,
           a.photo_file_id AS actor_photo_url
         FROM   upserted u
         LEFT JOIN actor_info a ON TRUE`,
        [type, category, priority, actorId, targetUserId, entityType, entityId, message, JSON.stringify(metadata)]
      );

      const row = resultRows[0];
      if (!row) return;

      // Invalidate unread count cache
      invalidateUnreadCache(targetUserId).catch(() => {});

      // ── Socket.IO (in-app, real-time) ──
      if (_io) {
        const rawPhoto = row.actor_photo_url;
        const photoUrl = (typeof rawPhoto === 'string' &&
          (rawPhoto.startsWith('/') || /^https?:\/\//i.test(rawPhoto)))
          ? rawPhoto : null;

        const actor = row.actor_username || row.actor_first_name
          ? {
              id: row.actor_id,
              username: row.actor_username,
              firstName: row.actor_first_name,
              photoUrl,
            }
          : null;

        _io.to(`user:${targetUserId}`).emit('notification:new', {
          id: row.id,
          type: row.type,
          category: row.category,
          priority: row.priority,
          entityType: row.entity_type,
          entityId: row.entity_id,
          message: row.message,
          metadata: row.metadata,
          isRead: false,
          createdAt: row.created_at,
          actor,
        });
      }

      // ── Multi-channel delivery (fire-and-forget) ──
      this._deliverExtraChannels(targetUserId, row, type, prefVal, entityType, entityId).catch(() => {});

    } catch (err) {
      logger.error('NotificationEmitter.emit error', { type, targetUserId, error: err.message });
    }
  },

  /**
   * Deliver to push + bot channels (fire-and-forget).
   * @private
   */
  async _deliverExtraChannels(targetUserId, row, type, prefVal, entityType, entityId) {
    const NotificationThrottleService = require('./notificationThrottleService');

    // ── Web Push (opt-out: enabled by default) ──
    if (isChannelEnabled(prefVal, 'push', true)) {
      try {
        const canPush = await NotificationThrottleService.canSendPush(targetUserId);
        if (canPush) {
          const PushNotificationService = require('./pushNotificationService');
          const meta = (typeof row.metadata === 'object' && row.metadata) || {};
          await PushNotificationService.sendToUser(targetUserId, {
            title: meta.pushTitle || 'PNPtv!',
            body: meta.pushBody || row.message,
            url: meta.url || buildNotificationUrl(type, entityType, entityId),
            tag: meta.pushTag || `${type}-${entityId || 'general'}`,
          });
        }
      } catch (err) {
        logger.warn('NotificationEmitter: push delivery error', { targetUserId, type, error: err.message });
      }
    }

    // ── Telegram Bot DM (opt-in: disabled by default for legacy, must explicitly enable) ──
    // Skip dm/group_message types to avoid double-notifying
    if (!SKIP_BOT_TYPES.has(type) && isChannelEnabled(prefVal, 'bot', false)) {
      try {
        const canBot = await NotificationThrottleService.canSendBot(targetUserId);
        if (canBot) {
          const { sendNotificationViaTelegram } = require('./notificationBotDelivery');
          await sendNotificationViaTelegram(targetUserId, {
            type,
            message: row.message,
            entityType,
            entityId,
          });
        }
      } catch (err) {
        logger.warn('NotificationEmitter: bot delivery error', { targetUserId, type, error: err.message });
      }
    }
  },

  /**
   * Emit the same notification to many users.
   * Capped at MAX_FANOUT recipients.
   */
  async emitToMany(targetUserIds, opts) {
    if (!Array.isArray(targetUserIds) || targetUserIds.length === 0) return;

    const recipients = targetUserIds.slice(0, MAX_FANOUT);
    if (targetUserIds.length > MAX_FANOUT) {
      logger.warn('NotificationEmitter.emitToMany: recipient list capped', {
        type: opts.type,
        requested: targetUserIds.length,
        capped: MAX_FANOUT,
      });
    }

    await Promise.allSettled(
      recipients.map((uid) => this.emit({ ...opts, targetUserId: uid }))
    );
  },
};

module.exports = NotificationEmitter;
