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
};

// TTL constants (seconds)
const NOTIF_PREFS_TTL = 300;  // 5 minutes
const UNREAD_COUNT_TTL = 300; // 5 minutes

// Maximum number of recipients for a single emitToMany call.
// Prevents runaway fan-out when a group has thousands of members.
const MAX_FANOUT = 500;

let _io = null;

/**
 * Build the Redis key for a user's cached notification preferences.
 * NOTE: ioredis applies the global keyPrefix ('pnptv:') automatically.
 */
function prefKey(userId) {
  return `user:${userId}:notif_prefs`;
}

/**
 * Build the Redis key for a user's cached unread notification counts.
 */
function unreadKey(userId) {
  return `notif:unread:${userId}`;
}

/**
 * Retrieve notification preferences for a user, using Redis as a read-through cache.
 * Returns the raw preferences object (or {} if the user doesn't exist).
 */
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

/**
 * Invalidate the cached notification preferences for a user.
 * Call this whenever the user updates their notification settings.
 */
async function invalidatePrefsCache(userId) {
  await cache.del(prefKey(userId));
}

/**
 * Invalidate the cached unread counts for a user.
 * Call this after a new notification is inserted or notifications are marked read.
 */
async function invalidateUnreadCache(userId) {
  await cache.del(unreadKey(userId));
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

  /**
   * Expose cache invalidation helpers so controllers can call them directly.
   */
  invalidatePrefsCache,
  invalidateUnreadCache,

  /**
   * Emit a single notification.
   *
   * Optimisation: the preference check uses Redis (read-through, 5 min TTL).
   * The INSERT and actor lookup are combined into a single CTE query, reducing
   * the total number of round-trips from 3 to 2 (pref check + combined INSERT/SELECT).
   *
   * @param {Object} opts
   * @param {string} opts.type          - like, reply, dm, group_message, group_join, wof_winner, payment, system, announcement, hangout_call, hangout_creator_joined
   * @param {string} [opts.category]    - social, messaging, hangouts, commerce, system (default: social)
   * @param {string} [opts.priority]    - low, normal, high (default: normal)
   * @param {string|null} opts.actorId  - user who caused the notification (null for system)
   * @param {string} opts.targetUserId  - user who receives the notification
   * @param {string} [opts.entityType]  - post, message, group, payment, user
   * @param {string} [opts.entityId]    - id of the entity
   * @param {string} opts.message       - human-readable message
   * @param {Object} [opts.metadata]    - extra JSON payload
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

      // Query 1: Check user notification preferences (Redis-cached, 5 min TTL)
      const prefKey2 = TYPE_TO_PREF[type];
      if (prefKey2) {
        const prefs = await getPrefs(targetUserId);
        if (prefs[prefKey2] === false) return;
      }

      // Query 2: Combined INSERT + actor lookup in a single CTE round-trip.
      // The actor_info CTE is a LEFT JOIN so it gracefully handles null actorId.
      const { rows: resultRows } = await query(
        `WITH upserted AS (
           INSERT INTO notifications
             (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (type, actor_id, target_user_id, entity_type, entity_id)
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
           u.id,
           u.type,
           u.category,
           u.priority,
           u.actor_id,
           u.target_user_id,
           u.entity_type,
           u.entity_id,
           u.message,
           u.metadata,
           u.is_read,
           u.created_at,
           a.username        AS actor_username,
           a.first_name      AS actor_first_name,
           a.photo_file_id   AS actor_photo_url
         FROM   upserted u
         LEFT JOIN actor_info a ON TRUE`,
        [type, category, priority, actorId, targetUserId, entityType, entityId, message, JSON.stringify(metadata)]
      );

      const row = resultRows[0];
      if (!row) return;

      // Invalidate the unread count cache for this user so the next poll is fresh
      invalidateUnreadCache(targetUserId).catch(() => {});

      // Emit via Socket.IO
      if (_io) {
        const actor = row.actor_username || row.actor_first_name
          ? {
              id: row.actor_id,
              username: row.actor_username,
              firstName: row.actor_first_name,
              photoUrl: row.actor_photo_url,
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
    } catch (err) {
      // Fire-and-forget: never let notification failures break features
      logger.error('NotificationEmitter.emit error', { type, targetUserId, error: err.message });
    }
  },

  /**
   * Emit the same notification to many users (e.g. announcements, group calls).
   * Capped at MAX_FANOUT recipients to prevent runaway fan-out.
   *
   * @param {string[]} targetUserIds
   * @param {Object} opts - same as emit() minus targetUserId
   */
  async emitToMany(targetUserIds, opts) {
    if (!Array.isArray(targetUserIds) || targetUserIds.length === 0) return;

    // Hard cap: never fan-out beyond MAX_FANOUT to avoid overwhelming the DB
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
