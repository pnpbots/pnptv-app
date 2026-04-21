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
const DmService = require('../../../services/dmService');

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  return user;
};

// ─── Hangout group chat media ────────────────────────────────────────────────

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
    const mediaResult = await processChatMedia(req.file, user.id);
    const caption = (req.body?.content || '').trim().slice(0, 500) || null;
    const replyToId = req.body?.replyToId ? Number(req.body.replyToId) : null;

    // Send via DmService — handles blocks, privacy, thread upsert, DB row, push notif
    const isAdmin = user.role === 'admin' || user.role === 'superadmin';
    const message = await DmService.sendMessage(
      user.id,
      recipientId,
      {
        content: caption,
        mediaUrl: mediaResult.mediaUrl,
        mediaType: mediaResult.mediaType,
        mediaMime: mediaResult.mediaMime || (mediaResult.mediaType === 'video' ? 'video/mp4' : mediaResult.mediaType === 'audio' ? 'audio/webm' : 'image/webp'),
        mediaThumbUrl: mediaResult.thumbUrl || null,
        replyToId,
      },
      { isAdmin }
    );

    // Deliver to recipient via Socket.IO (real-time)
    const io = req.app.get('io');
    const senderName = user.firstName || user.first_name || user.username || 'User';
    if (io) {
      io.to(`user:${recipientId}`).emit('dm:message', {
        ...message,
        senderName,
        senderPhoto: user.photoUrl || user.photo_url || null,
      });
    }

    // Bridge to Telegram (fire-and-forget)
    DmService.bridgeToTelegram(user.id, recipientId, message).catch(() => {});

    return res.status(201).json({ success: true, message });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    logger.error('sendDmMediaMessage error', err);
    return res.status(500).json({ error: 'Failed to send media message' });
  }
};

module.exports = {
  sendDmMediaMessage,
};
