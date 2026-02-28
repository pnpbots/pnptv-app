'use strict';

const { query } = require('../../config/postgres');
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
};

let _io = null;

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
   * Emit a single notification.
   * @param {Object} opts
   * @param {string} opts.type          - like, reply, dm, group_message, group_join, wof_winner, payment, system, announcement
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

      // Check user notification preferences
      const prefKey = TYPE_TO_PREF[type];
      if (prefKey) {
        const { rows } = await query(
          'SELECT notification_preferences FROM users WHERE id = $1',
          [targetUserId]
        );
        const prefs = rows[0]?.notification_preferences || {};
        if (prefs[prefKey] === false) return;
      }

      // Upsert into notifications table
      const { rows: inserted } = await query(
        `INSERT INTO notifications (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (type, actor_id, target_user_id, entity_type, entity_id)
         DO UPDATE SET is_read = FALSE, created_at = NOW(), message = EXCLUDED.message, metadata = EXCLUDED.metadata, priority = EXCLUDED.priority
         RETURNING id, type, category, priority, actor_id, target_user_id, entity_type, entity_id, message, metadata, is_read, created_at`,
        [type, category, priority, actorId, targetUserId, entityType, entityId, message, JSON.stringify(metadata)]
      );

      const notification = inserted[0];
      if (!notification) return;

      // Enrich with actor info for the Socket.IO payload
      let actor = null;
      if (actorId) {
        const { rows: actorRows } = await query(
          'SELECT id, username, first_name, photo_file_id FROM users WHERE id = $1',
          [actorId]
        );
        if (actorRows[0]) {
          const a = actorRows[0];
          actor = {
            id: a.id,
            username: a.username,
            firstName: a.first_name,
            photoUrl: a.photo_file_id,
          };
        }
      }

      // Emit via Socket.IO
      if (_io) {
        _io.to(`user:${targetUserId}`).emit('notification:new', {
          id: notification.id,
          type: notification.type,
          category: notification.category,
          priority: notification.priority,
          entityType: notification.entity_type,
          entityId: notification.entity_id,
          message: notification.message,
          metadata: notification.metadata,
          isRead: false,
          createdAt: notification.created_at,
          actor,
        });
      }
    } catch (err) {
      // Fire-and-forget: never let notification failures break features
      logger.error('NotificationEmitter.emit error', { type, targetUserId, error: err.message });
    }
  },

  /**
   * Emit the same notification to many users (e.g. announcements).
   * @param {string[]} targetUserIds
   * @param {Object} opts - same as emit() minus targetUserId
   */
  async emitToMany(targetUserIds, opts) {
    if (!Array.isArray(targetUserIds)) return;
    await Promise.allSettled(
      targetUserIds.map((uid) => this.emit({ ...opts, targetUserId: uid }))
    );
  },
};

module.exports = NotificationEmitter;
