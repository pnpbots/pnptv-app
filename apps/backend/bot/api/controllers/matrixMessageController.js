'use strict';

/**
 * matrixMessageController.js
 *
 * REST endpoints for Matrix-primary message sends.
 * All sends go through backend (auth/block/entitlement checks) → Matrix → PG sync.
 *
 * Routes (registered in routes.js):
 *   POST /api/webapp/matrix/hangout/:groupId/message
 *   POST /api/webapp/matrix/dm/:userId/message
 */

const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const { getRedis } = require('../../../config/redis');
const matrixService = require('../../services/matrixService');
const DmService = require('../../services/dmService');
const NotificationEmitter = require('../../services/notificationEmitter');
const { resolveUserId } = require('../../utils/helpers');

// ─── helpers ──────────────────────────────────────────────────────────────────

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Not authenticated' });
    return null;
  }
  return user;
};

// MSG_RETURNING_COLS — keep in sync with socketHandlers.js
const MSG_RETURNING_COLS = `
  id, room, user_id, username, first_name, photo_url, content,
  media_url, media_type, media_mime, media_thumb_url,
  media_width, media_height, media_metadata, reply_to_id, matrix_event_id, created_at
`;

// ─── POST /api/webapp/matrix/hangout/:groupId/message ─────────────────────────

/**
 * Send a text message to a hangout group via Matrix with PG sync.
 *
 * Body: { content: string, replyToId?: number }
 * Response: { success, message, matrixEventId }
 */
const sendHangoutMessage = async (req, res) => {
  const user = authGuard(req, res);
  if (!user) return;

  const groupId = parseInt(req.params.groupId, 10);
  if (!Number.isFinite(groupId)) {
    return res.status(400).json({ success: false, error: 'Invalid group ID' });
  }

  const { content, replyToId } = req.body || {};
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ success: false, error: 'Content is required' });
  }
  if (content.length > 2000) {
    return res.status(400).json({ success: false, error: 'Message too long (max 2000 chars)' });
  }

  const trimmed = content.trim();
  const parsedReplyToId = replyToId ? parseInt(replyToId, 10) : null;

  try {
    // Entitlement check (non-admin)
    const userRole = (user.role || '').toLowerCase();
    const isAdminUser = userRole === 'admin' || userRole === 'superadmin';
    if (!isAdminUser) {
      const EntitlementAccessService = require('../../services/entitlementAccessService');
      const hasAccess = await EntitlementAccessService.hasEntitlement(String(user.id), 'pnp-member');
      if (!hasAccess) {
        return res.status(403).json({ success: false, error: 'Member subscription required', code: 'MEMBER_REQUIRED' });
      }
    }

    // Membership check
    const { rows: memberRows } = await query(
      'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
      [groupId, user.id]
    );
    if (memberRows.length === 0) {
      return res.status(403).json({ success: false, error: 'Not a member of this group' });
    }

    // Block check
    const { rows: blockRows } = await query(
      `SELECT 1 FROM blocked_users bu
       JOIN hangout_group_members hgm ON hgm.group_id = $2
         AND ((bu.user_id = $1 AND bu.blocked_user_id = hgm.user_id)
           OR (bu.user_id = hgm.user_id AND bu.blocked_user_id = $1))
       LIMIT 1`,
      [user.id, groupId]
    );
    if (blockRows.length > 0) {
      return res.status(403).json({ success: false, error: 'Cannot send message', code: 'BLOCKED' });
    }

    // Load user DB row for Matrix provisioning
    const userRow = await query(
      `SELECT id, telegram, username, first_name, matrix_user_id, matrix_access_token
       FROM users WHERE id = $1 AND is_deleted = false`,
      [user.id]
    );
    if (!userRow.rows[0]) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }

    // Matrix send
    let matrixEventId = null;
    try {
      const userCreds = await matrixService.provisionMatrixUser(userRow.rows[0]);
      const groupRow = await query('SELECT name FROM hangout_groups WHERE id = $1', [groupId]);
      const groupName = groupRow.rows[0]?.name || `Hangout ${groupId}`;
      const matrixRoomId = await matrixService.getOrCreateHangoutRoom(groupId, userRow.rows[0], groupName);
      await matrixService.ensureUserInRoom(matrixRoomId, userCreds);
      const resp = await matrixService.sendRoomMessage(matrixRoomId, userCreds.accessToken, trimmed);
      matrixEventId = resp.event_id || null;
    } catch (matrixErr) {
      logger.warn('sendHangoutMessage: Matrix send failed', { userId: user.id, groupId, error: matrixErr.message });
    }

    // PG sync
    const room = `hangout:${groupId}`;
    const firstName = user.firstName || user.first_name || null;
    const photoUrl = user.photoUrl || user.photo_url || null;

    const { rows } = await query(
      `INSERT INTO chat_messages (room, user_id, username, first_name, photo_url, content, reply_to_id, matrix_event_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${MSG_RETURNING_COLS}`,
      [room, user.id, user.username || null, firstName, photoUrl, trimmed, parsedReplyToId, matrixEventId]
    );

    const msg = rows[0];

    // Attach reply-to snippet
    if (msg.reply_to_id) {
      const { rows: replyRows } = await query(
        'SELECT first_name, username, content FROM chat_messages WHERE id = $1',
        [msg.reply_to_id]
      );
      if (replyRows[0]) {
        msg.reply_to = {
          name: replyRows[0].first_name || replyRows[0].username || 'User',
          content: (replyRows[0].content || '[media]').slice(0, 100),
        };
      }
    }

    // Touch activity timestamp
    await query('UPDATE hangout_groups SET last_activity_at = NOW() WHERE id = $1', [groupId]);

    // Socket.IO broadcast (during transition)
    const io = req.app.get('io');
    if (io) {
      io.to(room).emit('chat:message', msg);
    }

    // Push notifications (fire-and-forget)
    (async () => {
      try {
        const [groupResult, membersResult] = await Promise.all([
          query('SELECT name FROM hangout_groups WHERE id = $1', [groupId]),
          query('SELECT user_id FROM hangout_group_members WHERE group_id = $1 AND user_id != $2', [groupId, user.id]),
        ]);
        const groupName = groupResult.rows[0]?.name || 'Hangout';
        const memberIds = membersResult.rows.map(r => r.user_id);
        if (memberIds.length === 0) return;

        const roomSockets = io ? await io.in(room).fetchSockets() : [];
        const onlineUserIds = new Set(roomSockets.map(s => String(s.data?.user?.id)).filter(Boolean));
        const offlineIds = memberIds.filter(id => !onlineUserIds.has(String(id)));
        if (offlineIds.length === 0) return;

        const redis = getRedis();
        const senderName = user.username || firstName || 'Someone';
        const preview = trimmed.length > 80 ? trimmed.slice(0, 77) + '...' : trimmed;

        await Promise.allSettled(offlineIds.map(async (targetId) => {
          const countKey = `hangout:unread:${groupId}:${targetId}`;
          const unread = await redis.incr(countKey);
          if (unread === 1) await redis.expire(countKey, 86400);

          const msgText = unread === 1
            ? `${senderName}: ${preview}`
            : `${unread} new messages — ${senderName}: ${preview}`;

          await NotificationEmitter.emit({
            type: 'group_message',
            category: 'hangouts',
            priority: 'normal',
            actorId: user.id,
            targetUserId: targetId,
            entityType: 'hangout',
            entityId: String(groupId),
            message: msgText,
            metadata: {
              groupId,
              groupName,
              senderId: user.id,
              senderName,
              unreadCount: unread,
              url: `/hangouts/${groupId}`,
              pushTitle: groupName,
              pushBody: msgText,
              pushTag: `hangout-${groupId}`,
            },
          });
        }));
      } catch (notifErr) {
        logger.warn('sendHangoutMessage push notification error', { error: notifErr.message, groupId });
      }
    })();

    return res.status(201).json({ success: true, message: msg, matrixEventId });
  } catch (err) {
    logger.error('sendHangoutMessage error', err);
    return res.status(500).json({ success: false, error: 'Failed to send message' });
  }
};

// ─── POST /api/webapp/matrix/dm/:userId/message ──────────────────────────────

/**
 * Send a DM text message via Matrix with PG sync.
 *
 * Body: { content: string }
 * Response: { success, message, matrixEventId, remaining?, limit? }
 */
const sendDmMessage = async (req, res) => {
  const user = authGuard(req, res);
  if (!user) return;

  const recipientId = await resolveUserId(req.params.userId);
  if (!recipientId) {
    return res.status(404).json({ success: false, error: 'Recipient not found' });
  }

  const { content } = req.body || {};
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ success: false, error: 'Content is required' });
  }
  if (content.length > 4000) {
    return res.status(400).json({ success: false, error: 'Message too long (max 4000 chars)' });
  }

  if (String(user.id) === String(recipientId)) {
    return res.status(400).json({ success: false, error: 'Cannot message yourself' });
  }

  try {
    // Free-tier daily DM limit
    const EntitlementAccessService = require('../../services/entitlementAccessService');
    const role = (user.role || '').toLowerCase();
    const hasDmMembership = role === 'admin' || role === 'superadmin' ||
      await EntitlementAccessService.hasEntitlement(user.id, 'pnp-member');
    const isFreeUser = !hasDmMembership;

    let remaining = null;
    let limit = null;

    if (isFreeUser) {
      const redis = getRedis();
      const today = new Date().toISOString().slice(0, 10);
      const dmKey = `pnptv:dm_limit:${user.id}:${today}`;
      const createdAt = user.created_at || user.createdAt;
      let dmLimit = 3;
      if (createdAt) {
        const daysSince = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince > 14) dmLimit = 1;
      }
      const newCount = await redis.incr(dmKey);
      if (newCount === 1) await redis.expire(dmKey, 86400);
      if (newCount > dmLimit) {
        await redis.decr(dmKey);
        return res.status(429).json({
          success: false,
          error: 'Daily message limit reached. Upgrade for unlimited messaging.',
          code: 'DM_LIMIT_REACHED',
        });
      }
      remaining = dmLimit - newCount;
      limit = dmLimit;
    }

    const isAdminSender = role === 'admin' || role === 'superadmin';

    // Use DmService.sendMatrixDm which handles all checks + Matrix + PG
    const { message, matrixEventId } = await DmService.sendMatrixDm(
      user.id,
      recipientId,
      { content },
      { isAdmin: isAdminSender }
    );

    const payload = {
      id: message.id,
      senderId: message.sender_id,
      recipientId: message.recipient_id,
      content: message.content,
      isRead: message.is_read,
      createdAt: message.created_at,
      isMine: true,
    };

    // Socket.IO notification (during transition)
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${message.recipient_id}`).emit('dm:received', {
        ...payload,
        isMine: false,
        sender: {
          id: user.id,
          username: user.username,
          firstName: user.firstName || user.first_name,
          photoUrl: user.photoUrl || user.photo_url,
        },
      });
    }

    const result = { success: true, message: payload, matrixEventId };
    if (remaining !== null) result.remaining = remaining;
    if (limit !== null) result.limit = limit;

    return res.status(201).json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, error: err.message, code: err.code });
    }
    logger.error('sendDmMessage error', err);
    return res.status(500).json({ success: false, error: 'Failed to send message' });
  }
};

module.exports = {
  sendHangoutMessage,
  sendDmMessage,
};
