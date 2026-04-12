'use strict';

/**
 * chatMediaController.js
 *
 * Handles media (image/video) uploads — Matrix-only (no PG message inserts).
 *   - Hangout group chat:  POST /api/webapp/hangouts/groups/:id/media
 *   - Direct messages:     POST /api/webapp/dm/media/:recipientId
 *
 * Flow: process media → send to Matrix → return success.
 * PG is only used for metadata (dm_threads for DMs).
 */

const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const { processChatMedia } = require('../../../services/chatMediaService');
const { resolveUserId } = require('../../utils/helpers');
// Matrix removed — stub prevents crash; media endpoints return 503
const matrixService = new Proxy({}, { get: (_, method) => () => { throw new Error(`Matrix removed – ${method}() unavailable`); } });
const NotificationEmitter = require('../../../services/notificationEmitter');

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  return user;
};

// ─── Hangout group chat media ────────────────────────────────────────────────

const sendGroupMediaMessage = async (req, res) => {
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

    const mediaResult = await processChatMedia(req.file, user.id);
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
    const groupRow = await query('SELECT name FROM hangout_groups WHERE id = $1', [groupId]);
    const groupName = groupRow.rows[0]?.name || `Hangout ${groupId}`;
    const matrixRoomId = await matrixService.getOrCreateHangoutRoom(groupId, userRow.rows[0], groupName);
    await matrixService.ensureUserInRoom(matrixRoomId, userCreds);

    const msgtype = mediaResult.mediaType === 'video' ? 'm.video' : 'm.image';
    const resp = await matrixService.sendRoomMediaMessage(matrixRoomId, userCreds.accessToken, {
      url: mediaResult.mediaUrl,
      msgtype,
      body: caption || 'media',
      info: {
        mimetype: mediaResult.mediaMime,
        w: mediaResult.width || undefined,
        h: mediaResult.height || undefined,
      },
    });

    // Touch activity timestamp
    await query('UPDATE hangout_groups SET last_activity_at = NOW() WHERE id = $1', [groupId]);

    return res.status(201).json({
      success: true,
      matrixEventId: resp.event_id || null,
      media_url: mediaResult.mediaUrl,
      media_type: mediaResult.mediaType,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.userMessage || err.message });
    }
    logger.error('sendGroupMediaMessage error', err);
    return res.status(500).json({ error: 'Failed to send media message' });
  }
};

// ─── DM media upload ─────────────────────────────────────────────────────────

const sendDmMediaMessage = async (req, res) => {
  const user = authGuard(req, res);
  if (!user) return;

  const recipientId = await resolveUserId(req.params.recipientId || req.body?.recipientId);
  if (!recipientId) {
    return res.status(400).json({ error: 'recipientId is required' });
  }
  if (String(recipientId) === String(user.id)) {
    return res.status(400).json({ error: 'Cannot message yourself' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
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
      return res.status(403).json({ error: 'Cannot send message to this user', code: 'BLOCKED' });
    }

    const mediaResult = await processChatMedia(req.file, user.id);
    const caption = (req.body?.content || '').trim().slice(0, 500) || null;

    // ── Send to Matrix (the ONLY message store) ──
    const [senderRow, recipRow] = await Promise.all([
      query(`SELECT id, telegram, username, first_name, matrix_user_id, matrix_access_token
             FROM users WHERE id = $1 AND is_deleted = false`, [user.id]),
      query(`SELECT id, telegram, username, first_name, matrix_user_id, matrix_access_token
             FROM users WHERE id = $1 AND is_deleted = false`, [recipientId]),
    ]);

    if (!senderRow.rows[0] || !recipRow.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }

    const senderCreds = await matrixService.provisionMatrixUser(senderRow.rows[0]);
    const matrixRoomId = await matrixService.getOrCreateDmRoom(senderRow.rows[0], recipRow.rows[0]);
    await matrixService.ensureUserInRoom(matrixRoomId, senderCreds);

    // Upload media to Matrix content repository (mxc:// URL)
    const fs = require('fs').promises;
    const path = require('path');
    const PUBLIC_ROOT = path.join(__dirname, '../../../../public');
    const localPath = path.join(PUBLIC_ROOT, mediaResult.mediaUrl);
    const fileBuffer = await fs.readFile(localPath);

    const mxcFilename = caption || (mediaResult.mediaType === 'video' ? 'video.mp4' : mediaResult.mediaType === 'audio' ? 'voice-message.webm' : 'image.webp');
    const mxcMime = mediaResult.mediaMime || (mediaResult.mediaType === 'video' ? 'video/mp4' : mediaResult.mediaType === 'audio' ? 'audio/webm' : 'image/webp');
    const mxcUrl = await matrixService.uploadMedia(fileBuffer, mxcFilename, mxcMime, senderCreds.accessToken);

    // Upload thumbnail if available
    let thumbMxcUrl;
    if (mediaResult.thumbUrl) {
      try {
        const thumbPath = path.join(PUBLIC_ROOT, mediaResult.thumbUrl);
        const thumbBuf = await fs.readFile(thumbPath);
        thumbMxcUrl = await matrixService.uploadMedia(thumbBuf, 'thumbnail.webp', 'image/webp', senderCreds.accessToken);
      } catch { /* non-critical */ }
    }

    const msgtype = mediaResult.mediaType === 'video' ? 'm.video' : mediaResult.mediaType === 'audio' ? 'm.audio' : 'm.image';
    const resp = await matrixService.sendRoomMediaMessage(matrixRoomId, senderCreds.accessToken, {
      url: mxcUrl,
      msgtype,
      body: mxcFilename,
      info: {
        mimetype: mxcMime,
        w: mediaResult.width || undefined,
        h: mediaResult.height || undefined,
        thumbnail_url: thumbMxcUrl,
      },
    });

    // Update dm_threads metadata
    const [a, b] = [user.id, recipientId].sort();
    const threadPreview = caption || `[${mediaResult.mediaType}]`;
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
          message: `${senderName} sent you ${mediaResult.mediaType === 'video' ? 'a video' : 'an image'}`,
          metadata: { senderId: user.id, senderName, preview: threadPreview, url: `/messages/${user.id}` },
        });
      } catch (notifErr) {
        logger.warn('sendDmMediaMessage push error', { error: notifErr.message });
      }
    })();

    return res.status(201).json({
      success: true,
      matrixEventId: resp.event_id || null,
      media_url: mediaResult.mediaUrl,
      media_type: mediaResult.mediaType,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    logger.error('sendDmMediaMessage error', err);
    return res.status(500).json({ error: 'Failed to send media message' });
  }
};

module.exports = {
  sendGroupMediaMessage,
  sendDmMediaMessage,
};
