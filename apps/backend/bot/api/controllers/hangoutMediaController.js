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

const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL || 'https://pnptv.app';

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
    // Auto-join main group if not already a member
    await query(
      `INSERT INTO hangout_group_members (group_id, user_id, role)
       SELECT id, $1, 'member' FROM hangout_groups WHERE is_main = true
       ON CONFLICT DO NOTHING`,
      [user.id]
    );

    // Membership check (exclude banned users)
    const { rows: memberRows } = await query(
      'SELECT is_banned FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
      [groupId, user.id]
    );
    if (memberRows.length === 0) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }
    if (memberRows[0].is_banned) {
      return res.status(403).json({ error: 'You are banned from this group' });
    }

    // Check allow_media group setting
    const { rows: groupSettingsRows } = await query(
      'SELECT creator_id, name, allow_media FROM hangout_groups WHERE id = $1',
      [groupId]
    );
    if (groupSettingsRows[0]?.allow_media === false) {
      return res.status(403).json({ error: 'Media uploads are disabled in this group' });
    }

    // Block check: group creator blocked uploader OR uploader blocked group creator
    const groupCreatorRows = groupSettingsRows;
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

    // ── Insert into PG + broadcast via Socket.IO ──
    const isValidPhoto = (p) => p && typeof p === 'string' && (p.startsWith('/') || p.startsWith('http'));
    const photoResult = await query('SELECT photo_file_id FROM users WHERE id = $1', [user.id]);
    const rawPhoto = photoResult.rows[0]?.photo_file_id || user.photoUrl || null;
    const photoUrl = isValidPhoto(rawPhoto) ? rawPhoto : null;

    const room = `hangout:${groupId}`;
    const { rows: insertedRows } = await query(
      `INSERT INTO chat_messages (room, user_id, username, first_name, photo_url, content,
         media_url, media_type, media_mime, media_thumb_url, media_width, media_height, media_metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, room, user_id, username, first_name, photo_url, content,
                 media_url, media_type, media_mime, media_thumb_url,
                 media_width, media_height, media_metadata, reply_to_id, created_at`,
      [
        room, user.id, user.username || null, user.firstName || user.first_name || null, photoUrl, caption,
        mediaResult.mediaUrl, mediaResult.mediaType, mediaResult.mediaMime,
        mediaResult.thumbUrl || null, mediaResult.width || null, mediaResult.height || null,
        mediaResult.metadata ? JSON.stringify(mediaResult.metadata) : null,
      ]
    );
    const msg = { ...insertedRows[0], photo_url: isValidPhoto(insertedRows[0].photo_url) ? insertedRows[0].photo_url : null };

    // Touch activity timestamp
    await query('UPDATE hangout_groups SET last_activity_at = NOW() WHERE id = $1', [groupId]);

    // Broadcast via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(room).emit('chat:message', msg);
    }

    // ── Webapp → Telegram bridge: forward media to linked Telegram group ──
    (async () => {
      try {
        const { rows: tgRows } = await query(
          'SELECT telegram_chat_id FROM hangout_groups WHERE id = $1 AND telegram_chat_id IS NOT NULL',
          [groupId]
        );
        if (tgRows.length === 0) return;
        const tgChatId = tgRows[0].telegram_chat_id;
        const { getBotInstance } = require('../../core/bot');
        const bot = getBotInstance();
        if (!bot) return;
        const senderName = user.firstName || user.first_name || user.username || 'User';
        const mediaCaption = caption ? `${senderName}: ${caption}` : senderName;
        const fullMediaUrl = mediaResult.mediaUrl?.startsWith('/') ? `${APP_PUBLIC_URL}${mediaResult.mediaUrl}` : mediaResult.mediaUrl;

        if (mediaResult.mediaType === 'image' && fullMediaUrl) {
          await bot.telegram.sendPhoto(tgChatId, fullMediaUrl, { caption: mediaCaption });
        } else if (mediaResult.mediaType === 'video' && fullMediaUrl) {
          await bot.telegram.sendVideo(tgChatId, fullMediaUrl, { caption: mediaCaption });
        } else if (mediaResult.mediaType === 'audio' && fullMediaUrl) {
          await bot.telegram.sendVoice(tgChatId, fullMediaUrl, { caption: mediaCaption });
        } else if (fullMediaUrl) {
          await bot.telegram.sendMessage(tgChatId, `${senderName} sent a file: ${fullMediaUrl}`);
        }
      } catch (bridgeErr) {
        logger.warn('[App→TG Bridge] REST media forward failed', { error: bridgeErr.message, groupId });
      }
    })();

    // Push notifications to offline members (fire-and-forget)
    const firstName = user.firstName || user.first_name || null;
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
      message: msg,
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
