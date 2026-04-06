'use strict';

/**
 * matrixMessageController.js
 *
 * REST endpoints for Matrix-only message sends.
 * All sends: backend (auth/block/entitlement checks) → Matrix.
 * No PG message inserts. No Socket.IO message broadcasts.
 * PG is only used for metadata (dm_threads, unread counters, push notifications).
 *
 * Routes:
 *   POST /api/webapp/matrix/hangout/:groupId/message
 *   POST /api/webapp/matrix/dm/:userId/message
 */

const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const { getRedis } = require('../../../config/redis');
const matrixService = require('../../services/matrixService');
const NotificationEmitter = require('../../services/notificationEmitter');
const { resolveUserId } = require('../../utils/helpers');

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Not authenticated' });
    return null;
  }
  return user;
};

// ─── POST /api/webapp/matrix/hangout/:groupId/message ─────────────────────────

const sendHangoutMessage = async (req, res) => {
  const user = authGuard(req, res);
  if (!user) return;

  const groupId = parseInt(req.params.groupId, 10);
  if (!Number.isFinite(groupId)) {
    return res.status(400).json({ success: false, error: 'Invalid group ID' });
  }

  const { content } = req.body || {};
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ success: false, error: 'Content is required' });
  }
  if (content.length > 2000) {
    return res.status(400).json({ success: false, error: 'Message too long (max 2000 chars)' });
  }

  const trimmed = content.trim();

  try {
    // Entitlement check
    const userRole = (user.role || '').toLowerCase();
    const isAdminUser = userRole === 'admin' || userRole === 'superadmin';
    if (!isAdminUser) {
      const EntitlementAccessService = require('../../services/entitlementAccessService');
      const hasAccess = await EntitlementAccessService.hasEntitlement(String(user.id), 'pnp-member');
      if (!hasAccess) {
        return res.status(403).json({ success: false, error: 'Member subscription required', code: 'MEMBER_REQUIRED' });
      }
    }

    // Membership check — also rejects banned members
    const { rows: memberRows } = await query(
      'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND (is_banned IS NULL OR is_banned = false)',
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

    // Load user for Matrix provisioning
    const userRow = await query(
      `SELECT id, telegram, username, first_name, matrix_user_id, matrix_access_token
       FROM users WHERE id = $1 AND is_deleted = false`,
      [user.id]
    );
    if (!userRow.rows[0]) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }

    // ── Send to Matrix (the ONLY message store) ──
    const userCreds = await matrixService.provisionMatrixUser(userRow.rows[0]);
    const groupRow = await query('SELECT name FROM hangout_groups WHERE id = $1', [groupId]);
    const groupName = groupRow.rows[0]?.name || `Hangout ${groupId}`;
    const matrixRoomId = await matrixService.getOrCreateHangoutRoom(groupId, userRow.rows[0], groupName);
    await matrixService.ensureUserInRoom(matrixRoomId, userCreds);
    const resp = await matrixService.sendRoomMessage(matrixRoomId, userCreds.accessToken, trimmed);
    const matrixEventId = resp.event_id || null;

    // Touch activity timestamp (metadata only)
    await query('UPDATE hangout_groups SET last_activity_at = NOW() WHERE id = $1', [groupId]);

    // Push notifications (fire-and-forget)
    const firstName = user.firstName || user.first_name || null;
    const room = `hangout:${groupId}`;
    const io = req.app.get('io');
    (async () => {
      try {
        const membersResult = await query(
          'SELECT user_id FROM hangout_group_members WHERE group_id = $1 AND user_id != $2',
          [groupId, user.id]
        );
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
              groupId, groupName, senderId: user.id, senderName,
              unreadCount: unread, url: `/hangouts/${groupId}`,
              pushTitle: groupName, pushBody: msgText, pushTag: `hangout-${groupId}`,
            },
          });
        }));
      } catch (notifErr) {
        logger.warn('sendHangoutMessage push notification error', { error: notifErr.message, groupId });
      }
    })();

    return res.status(201).json({ success: true, matrixEventId });
  } catch (err) {
    logger.error('sendHangoutMessage error', err);
    return res.status(500).json({ success: false, error: 'Failed to send message' });
  }
};

// ─── POST /api/webapp/matrix/dm/:userId/message ──────────────────────────────

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
    // Block check
    const blockCheck = await query(
      `SELECT 1 FROM blocked_users
       WHERE (user_id = $1 AND blocked_user_id = $2)
          OR (user_id = $2 AND blocked_user_id = $1) LIMIT 1`,
      [recipientId, user.id]
    );
    if (blockCheck.rows.length > 0) {
      return res.status(403).json({ success: false, error: 'Cannot send message to this user', code: 'BLOCKED' });
    }

    // Privacy check
    const role = (user.role || '').toLowerCase();
    const isAdminSender = role === 'admin' || role === 'superadmin';
    if (!isAdminSender) {
      const recipientResult = await query(
        'SELECT privacy, role, creator_status FROM users WHERE id = $1',
        [recipientId]
      );
      const recipientRow = recipientResult.rows[0] || {};
      const privacy = recipientRow.privacy || {};
      const allowMessages = privacy.allowMessages !== undefined ? privacy.allowMessages : true;
      if (!allowMessages) {
        const followResult = await query(
          'SELECT 1 FROM user_follows WHERE follower_id = $1 AND following_id = $2 LIMIT 1',
          [user.id, recipientId]
        );
        if ((followResult.rowCount ?? followResult.rows.length) === 0) {
          return res.status(403).json({ success: false, error: 'This user is not accepting messages', code: 'PRIVACY_RESTRICTED' });
        }
      }
      // Creator DM policy
      if (recipientRow.role === 'model' && recipientRow.creator_status === 'active') {
        const dmPolicy = privacy.creatorDmPolicy || 'subscribers_and_mutuals';
        if (dmPolicy === 'subscribers_and_mutuals') {
          const [subscriberCheck, mutualCheck] = await Promise.all([
            query(
              `SELECT 1 FROM user_entitlements
               WHERE user_id = $1 AND add_on_id = 'creator-subscription' AND creator_id = $2
                 AND (is_lifetime = true OR expires_at > NOW()) LIMIT 1`,
              [String(user.id), String(recipientId)]
            ),
            query(
              `SELECT 1 FROM user_follows f1
               JOIN user_follows f2 ON f1.follower_id = f2.following_id AND f1.following_id = f2.follower_id
               WHERE f1.follower_id = $1 AND f1.following_id = $2 LIMIT 1`,
              [user.id, recipientId]
            ),
          ]);
          if (subscriberCheck.rows.length === 0 && mutualCheck.rows.length === 0) {
            return res.status(403).json({
              success: false,
              error: 'Only subscribers and mutual follows can message this creator',
              code: 'CREATOR_DM_RESTRICTED',
            });
          }
        }
      }
    }

    // Free-tier daily DM limit
    const EntitlementAccessService = require('../../services/entitlementAccessService');
    const hasDmMembership = isAdminSender ||
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

    // ── Send to Matrix (the ONLY message store) ──
    const [senderRow, recipientRow2] = await Promise.all([
      query(`SELECT id, telegram, username, first_name, matrix_user_id, matrix_access_token
             FROM users WHERE id = $1 AND is_deleted = false`, [user.id]),
      query(`SELECT id, telegram, username, first_name, matrix_user_id, matrix_access_token
             FROM users WHERE id = $1 AND is_deleted = false`, [recipientId]),
    ]);

    if (!senderRow.rows[0] || !recipientRow2.rows[0]) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const senderCreds = await matrixService.provisionMatrixUser(senderRow.rows[0]);
    const matrixRoomId = await matrixService.getOrCreateDmRoom(senderRow.rows[0], recipientRow2.rows[0]);
    await matrixService.ensureUserInRoom(matrixRoomId, senderCreds);
    const resp = await matrixService.sendRoomMessage(matrixRoomId, senderCreds.accessToken, content.trim());
    const matrixEventId = resp.event_id || null;

    // Update dm_threads metadata (no message row — just thread metadata for list UI)
    const trimmed = content.trim();
    const [a, b] = [user.id, recipientId].sort();
    const threadPreview = trimmed.slice(0, 100);
    await query(
      `INSERT INTO dm_threads (user_a, user_b, last_message_at, last_message, unread_for_a, unread_for_b)
       VALUES ($1, $2, NOW(), $3, $4, $5)
       ON CONFLICT (user_a, user_b) DO UPDATE SET
         last_message_at = NOW(),
         last_message = EXCLUDED.last_message,
         unread_for_a = CASE WHEN dm_threads.user_a = $6 THEN 0 ELSE dm_threads.unread_for_a + 1 END,
         unread_for_b = CASE WHEN dm_threads.user_b = $6 THEN 0 ELSE dm_threads.unread_for_b + 1 END`,
      [a, b, threadPreview, user.id === a ? 0 : 1, user.id === b ? 0 : 1, user.id]
    );

    // Push notification (fire-and-forget)
    (async () => {
      try {
        const senderName = user.firstName || user.first_name || user.username || 'Someone';
        await NotificationEmitter.emit({
          type: 'dm',
          category: 'messaging',
          priority: 'high',
          actorId: user.id,
          targetUserId: recipientId,
          entityType: 'user',
          entityId: String(user.id),
          message: `${senderName} sent you a message`,
          metadata: {
            senderId: user.id,
            senderName,
            preview: threadPreview,
            url: `/messages/${user.id}`,
          },
        });
      } catch (notifErr) {
        logger.warn('sendDmMessage push notification error', { error: notifErr.message, recipientId });
      }
    })();

    const result = { success: true, matrixEventId };
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
