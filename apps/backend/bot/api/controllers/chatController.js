'use strict';

const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const { processChatMedia } = require('../../services/chatMediaService');

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  return user;
};

// ── Get chat history (REST fallback) ─────────────────────────────────────────
// Returns the 50 most recent messages for a room, optionally paginated via
// cursor (ISO timestamp). Media columns are included so clients can render
// photo/video attachments without a separate fetch.
const getChatHistory = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const room = req.params.room || 'general';
  const { cursor } = req.query;
  try {
    const { rows } = await query(
      `SELECT id, room, user_id, username, first_name, photo_url, content,
              media_url, media_type, media_mime, media_thumb_url,
              media_width, media_height, created_at
       FROM chat_messages
       WHERE room=$1 AND is_deleted=false
         ${cursor ? 'AND created_at < $2' : ''}
       ORDER BY created_at DESC LIMIT 50`,
      cursor ? [room, cursor] : [room]
    );
    return res.json({ success: true, messages: rows.reverse() });
  } catch (err) {
    logger.error('getChatHistory error', err);
    return res.status(500).json({ error: 'Failed to load chat history' });
  }
};

// ── Send a text message via REST (fallback when Socket.IO is unavailable) ────
const sendMessage = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const room = req.params.room || 'general';
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content required' });
  try {
    const text = content.trim().slice(0, 2000);
    const { rows } = await query(
      `INSERT INTO chat_messages
         (room, user_id, username, first_name, photo_url, content)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, room, user_id, username, first_name, photo_url, content,
                 media_url, media_type, media_mime, media_thumb_url,
                 media_width, media_height, created_at`,
      [room, user.id, user.username || null, user.firstName || user.first_name || null, user.photoUrl || user.photo_url || null, text]
    );
    const msg = rows[0];
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${room}`).emit('chat:message', msg);
    }
    return res.json({ success: true, message: msg });
  } catch (err) {
    logger.error('chat sendMessage error', err);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};

// ── Upload media and persist a media message in a community chat room ─────────
// POST /api/webapp/chat/:room/media
// Content-Type: multipart/form-data
// Field: media (required) — the image or video file
// Field: content (optional) — caption text (max 500 chars)
//
// Limits enforced by the multer middleware configured in routes.js:
//   images: 20 MB   videos: 100 MB
// Additional validation (mime type, processing) happens inside chatMediaService.
const sendMediaMessage = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const room = req.params.room || 'general';
  const caption = (req.body?.content || '').trim().slice(0, 500);

  try {
    const mediaResult = await processChatMedia(req.file, user.id);

    const firstName = user.firstName || user.first_name || null;
    const photoUrl = user.photoUrl || user.photo_url || null;

    const { rows } = await query(
      `INSERT INTO chat_messages
         (room, user_id, username, first_name, photo_url, content,
          media_url, media_type, media_mime, media_thumb_url,
          media_width, media_height)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, room, user_id, username, first_name, photo_url, content,
                 media_url, media_type, media_mime, media_thumb_url,
                 media_width, media_height, created_at`,
      [
        room,
        user.id,
        user.username || null,
        firstName,
        photoUrl,
        caption || null,
        mediaResult.mediaUrl,
        mediaResult.mediaType,
        mediaResult.mediaMime,
        mediaResult.thumbUrl || null,
        mediaResult.width || null,
        mediaResult.height || null,
      ]
    );

    const msg = rows[0];

    // Broadcast to all room members via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${room}`).emit('chat:message', msg);
    }

    return res.status(201).json({ success: true, message: msg });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.userMessage || err.message });
    }
    logger.error('chat sendMediaMessage error', err);
    return res.status(500).json({ error: 'Failed to upload media' });
  }
};

module.exports = { getChatHistory, sendMessage, sendMediaMessage };
