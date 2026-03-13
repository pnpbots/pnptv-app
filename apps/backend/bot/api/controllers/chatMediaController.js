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
