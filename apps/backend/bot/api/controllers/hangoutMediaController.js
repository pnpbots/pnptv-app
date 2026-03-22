'use strict';

/**
 * hangoutMediaController.js
 *
 * Handles media uploads for hangout group chats with per-hangout subdirectories.
 * Media is processed locally (thumbnails, compression) and then sent to the
 * hangout's Matrix room as the single source of truth.
 *
 *   POST /api/webapp/hangouts/groups/:id/media
 *     multipart body:
 *       - media   (File)   required  -- image (max 10 MB) or video (max 50 MB)
 *       - content (string) optional  -- caption text (max 500 chars)
 */

const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const { processHangoutMedia } = require('../../services/hangoutMediaService');
const BlockedUser = require('../../../models/blockedUser');
const matrixService = require('../../services/matrixService');
const NotificationEmitter = require('../../services/notificationEmitter');
const { getRedis } = require('../../../config/redis');

// ── Helpers ──────────────────────────────────────────────────────────────────

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  return user;
};

const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL || 'https://app.pnptv.app';

// ── POST /api/webapp/hangouts/groups/:id/media ──────────────────────────────

const uploadHangoutMedia = async (req, res) => {
  const user = authGuard(req, res);
  if (!user) return;

  const groupId = parseInt(req.params.id, 10);
  if (!Number.isFinite(groupId)) {
    return res.status(400).json({ error: 'Invalid group ID' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    // Membership check
    const { rows: memberRows } = await query(
      'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
      [groupId, user.id]
    );
    if (memberRows.length === 0) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    // Block check: group creator blocked uploader OR uploader blocked group creator
    const { rows: groupCreatorRows } = await query(
      'SELECT creator_id, name FROM hangout_groups WHERE id = $1',
      [groupId]
    );
    const creatorId = groupCreatorRows[0]?.creator_id;
    const groupName = groupCreatorRows[0]?.name || `Hangout ${groupId}`;
    if (creatorId && String(creatorId) !== String(user.id)) {
      const [blockedByCreator, blockedByUser] = await Promise.all([
        BlockedUser.isBlocked(creatorId, user.id),
        BlockedUser.isBlocked(user.id, creatorId),
      ]);
      if (blockedByCreator || blockedByUser) {
        return res.status(403).json({ error: 'Cannot upload media in this group' });
      }
    }

    // Process the media into per-hangout directory (thumbnails, compression)
    const mediaResult = await processHangoutMedia(req.file, groupId, user.id);
    const caption = (req.body?.content || '').trim().slice(0, 500) || null;

    // ── Send to Matrix (the ONLY message store) ──
    const userRow = await query(
      `SELECT id, telegram, username, first_name, matrix_user_id, matrix_access_token
       FROM users WHERE id = $1 AND is_deleted = false`,
      [user.id]
    );
    if (!userRow.rows[0]) {
      return res.status(401).json({ error: 'User not found' });
    }

    const userCreds = await matrixService.provisionMatrixUser(userRow.rows[0]);
    const matrixRoomId = await matrixService.getOrCreateHangoutRoom(groupId, userRow.rows[0], groupName);
    await matrixService.ensureUserInRoom(matrixRoomId, userCreds);

    // Build absolute media URL for Matrix
    const mediaAbsUrl = mediaResult.mediaUrl.startsWith('http')
      ? mediaResult.mediaUrl
      : `${APP_PUBLIC_URL}${mediaResult.mediaUrl}`;

    const thumbAbsUrl = mediaResult.thumbUrl
      ? (mediaResult.thumbUrl.startsWith('http') ? mediaResult.thumbUrl : `${APP_PUBLIC_URL}${mediaResult.thumbUrl}`)
      : undefined;

    const msgtype = mediaResult.mediaType === 'video' ? 'm.video' : mediaResult.mediaType === 'audio' ? 'm.audio' : 'm.image';
    const body = caption || (mediaResult.mediaType === 'video' ? 'video.mp4' : mediaResult.mediaType === 'audio' ? 'voice-message.webm' : 'image.webp');

    const resp = await matrixService.sendRoomMediaMessage(matrixRoomId, userCreds.accessToken, {
      url: mediaAbsUrl,
      msgtype,
      body,
      info: {
        mimetype: mediaResult.mediaMime || (mediaResult.mediaType === 'video' ? 'video/mp4' : 'image/webp'),
        w: mediaResult.width || undefined,
        h: mediaResult.height || undefined,
        thumbnail_url: thumbAbsUrl,
      },
    });

    const matrixEventId = resp.event_id || null;

    // Touch activity timestamp
    await query('UPDATE hangout_groups SET last_activity_at = NOW() WHERE id = $1', [groupId]);

    // Push notifications to offline members (fire-and-forget)
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
        const preview = mediaResult.mediaType === 'video' ? 'sent a video' : mediaResult.mediaType === 'audio' ? 'sent a voice message' : 'sent a photo';

        await Promise.allSettled(offlineIds.map(async (targetId) => {
          const countKey = `hangout:unread:${groupId}:${targetId}`;
          const unread = await redis.incr(countKey);
          if (unread === 1) await redis.expire(countKey, 86400);

          const msgText = unread === 1
            ? `${senderName} ${preview}`
            : `${unread} new messages — ${senderName} ${preview}`;

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
        logger.warn('uploadHangoutMedia push notification error', { error: notifErr.message, groupId });
      }
    })();

    return res.status(201).json({
      success: true,
      matrixEventId,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.userMessage || err.message });
    }
    logger.error('uploadHangoutMedia error', err);
    return res.status(500).json({ error: 'Failed to upload media' });
  }
};

module.exports = {
  uploadHangoutMedia,
};
