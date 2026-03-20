'use strict';

/**
 * chatMediaController.js
 *
 * Handles media (image/video) uploads for:
 *   - Hangout group chat:  POST /api/webapp/hangouts/groups/:id/media
 *   - Direct messages:     POST /api/webapp/dm/media/:recipientId
 *
 * Community chat media (POST /api/webapp/chat/:room/media) is handled directly
 * by chatController.sendMediaMessage because it owns the chat_messages table for
 * that use case.
 *
 * All heavy processing (sharp resize/WebP conversion, ffmpeg thumbnail) is
 * delegated to chatMediaService so this controller stays thin.
 *
 * Files are served from /public/uploads/chat/ via the Express static middleware.
 */

const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const { processChatMedia } = require('../../services/chatMediaService');
const { resolveUserId } = require('../../utils/helpers');
const DmService = require('../../services/dmService');
const matrixService = require('../../services/matrixService');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  return user;
};

const isValidPhotoUrl = (p) =>
  p && typeof p === 'string' && (p.startsWith('/') || p.startsWith('http'));

// All media columns returned in every response so clients can render
// images and videos without extra fetches.
const CHAT_MSG_RETURNING = `
  id, room, user_id, username, first_name, photo_url, content,
  media_url, media_type, media_mime, media_thumb_url,
  media_width, media_height, created_at
`;

// ─── Hangout group chat ──────────────────────────────────────────────────────

/**
 * POST /api/webapp/hangouts/groups/:id/media
 *
 * Multipart body:
 *   - media   (File)   required  — image or video
 *   - content (string) optional  — caption text (max 500 chars)
 *
 * Returns: { success: true, message: ChatMessage }
 */
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

    const room = `hangout:${groupId}`;
    const caption = (req.body?.content || '').trim().slice(0, 500) || null;

    // Resolve author avatar (fresh DB value, fallback to session)
    const photoResult = await query(
      'SELECT photo_file_id FROM users WHERE id=$1',
      [user.id]
    );
    const rawPhoto = photoResult.rows[0]?.photo_file_id || user.photoUrl || null;
    const photoUrl = isValidPhotoUrl(rawPhoto) ? rawPhoto : null;

    const { rows } = await query(
      `INSERT INTO chat_messages
         (room, user_id, username, first_name, photo_url, content,
          media_url, media_type, media_mime, media_thumb_url,
          media_width, media_height)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING ${CHAT_MSG_RETURNING}`,
      [
        room,
        user.id,
        user.username || null,
        user.firstName || user.first_name || null,
        photoUrl,
        caption,
        mediaResult.mediaUrl,
        mediaResult.mediaType,
        mediaResult.mediaMime,
        mediaResult.thumbUrl || null,
        mediaResult.width || null,
        mediaResult.height || null,
      ]
    );

    const msg = {
      ...rows[0],
      photo_url: isValidPhotoUrl(rows[0].photo_url) ? rows[0].photo_url : null,
    };

    // Broadcast to group room via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(room).emit('chat:message', msg);
    }

    // Bridge media to Matrix room (fire-and-forget)
    (async () => {
      try {
        const userRow = await query(
          `SELECT id, telegram, username, first_name, matrix_user_id, matrix_access_token
           FROM users WHERE id = $1 AND is_deleted = false`,
          [user.id]
        );
        if (!userRow.rows[0]) return;
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
        });
        if (resp.event_id) {
          await query('UPDATE chat_messages SET matrix_event_id = $1 WHERE id = $2', [resp.event_id, msg.id]);
        }
      } catch (matrixErr) {
        logger.warn('sendGroupMediaMessage Matrix bridge failed', { error: matrixErr.message, groupId });
      }
    })();

    return res.status(201).json({ success: true, message: msg });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.userMessage || err.message });
    }
    logger.error('sendGroupMediaMessage error', err);
    return res.status(500).json({ error: 'Failed to send media message' });
  }
};

// ─── Direct message media upload ─────────────────────────────────────────────

/**
 * POST /api/webapp/dm/media/:recipientId
 *
 * Multipart body:
 *   - media   (File)   required  — image or video
 *   - content (string) optional  — caption text (max 500 chars)
 *
 * Returns: { success: true, message: DirectMessage }
 */
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
    const mediaResult = await processChatMedia(req.file, user.id);
    const caption = (req.body?.content || '').trim().slice(0, 500) || null;

    const senderRole = user.role || '';
    const isAdminSender = senderRole === 'admin' || senderRole === 'superadmin';

    const message = await DmService.sendMessage(
      user.id,
      recipientId,
      {
        content: caption,
        mediaUrl: mediaResult.mediaUrl,
        mediaType: mediaResult.mediaType,
        mediaMime: mediaResult.mediaMime,
        mediaThumbUrl: mediaResult.thumbUrl || null
      },
      { isAdmin: isAdminSender }
    );

    const responseMessage = {
      id: message.id,
      senderId: message.sender_id,
      recipientId: message.recipient_id,
      content: message.content,
      mediaUrl: message.media_url,
      mediaType: message.media_type,
      mediaMime: message.media_mime,
      mediaThumbUrl: message.media_thumb_url,
      isRead: message.is_read,
      createdAt: message.created_at,
      isMine: true
    };

    // Notify recipient via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${recipientId}`).emit('dm:received', {
        ...responseMessage,
        isMine: false,
        sender: {
          id: user.id,
          username: user.username,
          firstName: user.firstName || user.first_name,
          photoUrl: user.photoUrl || user.photo_url,
        },
      });
    }

    // Bridge media to Matrix DM room (fire-and-forget)
    (async () => {
      try {
        const [senderRow, recipRow] = await Promise.all([
          query(`SELECT id, telegram, username, first_name, matrix_user_id, matrix_access_token
                 FROM users WHERE id = $1 AND is_deleted = false`, [user.id]),
          query(`SELECT id, telegram, username, first_name, matrix_user_id, matrix_access_token
                 FROM users WHERE id = $1 AND is_deleted = false`, [recipientId]),
        ]);
        if (!senderRow.rows[0] || !recipRow.rows[0]) return;
        const senderCreds = await matrixService.provisionMatrixUser(senderRow.rows[0]);
        const matrixRoomId = await matrixService.getOrCreateDmRoom(senderRow.rows[0], recipRow.rows[0]);
        await matrixService.ensureUserInRoom(matrixRoomId, senderCreds);
        const msgtype = mediaResult.mediaType === 'video' ? 'm.video' : 'm.image';
        const resp = await matrixService.sendRoomMediaMessage(matrixRoomId, senderCreds.accessToken, {
          url: mediaResult.mediaUrl,
          msgtype,
          body: caption || 'media',
        });
        if (resp.event_id) {
          await query('UPDATE direct_messages SET matrix_event_id = $1 WHERE id = $2', [resp.event_id, message.id]);
        }
      } catch (matrixErr) {
        logger.warn('sendDmMediaMessage Matrix bridge failed', { error: matrixErr.message, recipientId });
      }
    })();

    return res.status(201).json({ success: true, message: responseMessage });
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
