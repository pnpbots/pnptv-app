'use strict';

const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');
const { getRedis } = require('../../config/redis');
const { processChatMedia } = require('../services/chatMediaService');

// ── Session resolution ────────────────────────────────────────────────────────

// Parse session cookie to authenticate Socket.IO connections
async function getUserFromSocket(socket) {
  try {
    const cookieHeader = socket.handshake.headers.cookie || '';
    const match = cookieHeader.match(/connect\.sid=([^;]+)/);
    if (!match) return null;
    const raw = decodeURIComponent(match[1]);
    const sid = raw.startsWith('s:') ? raw.slice(2).split('.')[0] : raw.split('.')[0];
    const redis = getRedis();
    const data = await redis.get(`sess:${sid}`);
    if (!data) return null;
    const session = JSON.parse(data);
    return session?.user || null;
  } catch {
    return null;
  }
}

// ── Rate limiting ─────────────────────────────────────────────────────────────

// In-process rate limit: allow maxCount per windowMs per key
const rateLimitCounters = new Map();
function rateLimit(key, maxCount, windowMs) {
  const now = Date.now();
  const entry = rateLimitCounters.get(key) || { count: 0, reset: now + windowMs };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs; }
  entry.count++;
  rateLimitCounters.set(key, entry);
  return entry.count <= maxCount;
}

// ── Message SELECT columns helper ─────────────────────────────────────────────

// All the columns we return for every chat message — text or media.
// Keep in sync with the migration 072_chat_media_attachments.sql columns.
const MSG_RETURNING_COLS = `
  id, room, user_id, username, first_name, photo_url, content,
  media_url, media_type, media_mime, media_thumb_url,
  media_width, media_height, created_at
`;

// ── Socket.IO initialisation ──────────────────────────────────────────────────

function initSocketIO(io) {
  // Auth middleware: reject connections with no valid session
  io.use(async (socket, next) => {
    const user = await getUserFromSocket(socket);
    if (!user) return next(new Error('Unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', async (socket) => {
    const user = socket.data.user;
    logger.info(`Socket connected: user ${user.id}`);

    // Join personal room for DMs and targeted notifications
    socket.join(`user:${user.id}`);

    // ── Group Chat ───────────────────────────────────────────────────────────

    socket.on('chat:join', async ({ room = 'general' } = {}) => {
      socket.join(`chat:${room}`);
      try {
        const { rows } = await query(
          `SELECT ${MSG_RETURNING_COLS}
           FROM chat_messages
           WHERE room = $1 AND is_deleted = false
           ORDER BY created_at DESC LIMIT 50`,
          [room]
        );
        socket.emit('chat:history', rows.reverse());
      } catch (err) {
        logger.error('chat:join history error', err);
      }
    });

    // Text message
    socket.on('chat:message', async ({ room = 'general', content } = {}) => {
      if (!content || !content.trim()) return;
      if (content.length > 2000) return;
      if (!rateLimit(`chat:${user.id}`, 30, 60000)) {
        socket.emit('chat:error', { message: 'Too many messages. Slow down.' });
        return;
      }
      try {
        const firstName = user.firstName || user.first_name || null;
        const photoUrl = user.photoUrl || user.photo_url || null;

        const { rows } = await query(
          `INSERT INTO chat_messages (room, user_id, username, first_name, photo_url, content)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING ${MSG_RETURNING_COLS}`,
          [room, user.id, user.username || null, firstName, photoUrl, content.trim()]
        );
        io.to(`chat:${room}`).emit('chat:message', rows[0]);
      } catch (err) {
        logger.error('chat:message error', err);
        socket.emit('chat:error', { message: 'Failed to save message' });
      }
    });

    // Media message sent over Socket.IO.
    // Payload: { room, file: { buffer (base64 string), mimetype, size } }
    // The client encodes the file buffer as a base64 string before emitting,
    // because Socket.IO serialises payloads as JSON by default.
    //
    // Note: for large files (videos) the HTTP REST endpoint
    // POST /api/webapp/chat/:room/media is strongly preferred because
    // Socket.IO is not optimised for large binary payloads.
    socket.on('chat:media', async ({ room = 'general', file, content } = {}) => {
      if (!file || !file.buffer || !file.mimetype) {
        socket.emit('chat:error', { message: 'Invalid media payload' });
        return;
      }

      // Enforce a 20 MB cap over Socket.IO (images only — videos should use REST)
      const MAX_SOCKET_MEDIA_BYTES = 20 * 1024 * 1024;
      const buffer = Buffer.from(file.buffer, 'base64');
      if (buffer.length > MAX_SOCKET_MEDIA_BYTES) {
        socket.emit('chat:error', { message: 'File too large. Use the upload button for videos.' });
        return;
      }

      if (!rateLimit(`chat:media:${user.id}`, 10, 60000)) {
        socket.emit('chat:error', { message: 'Too many media uploads. Please slow down.' });
        return;
      }

      const caption = typeof content === 'string' ? content.trim().slice(0, 500) : null;

      try {
        const multerLike = { buffer, mimetype: file.mimetype, size: buffer.length };
        const mediaResult = await processChatMedia(multerLike, user.id);

        const firstName = user.firstName || user.first_name || null;
        const photoUrl = user.photoUrl || user.photo_url || null;

        const { rows } = await query(
          `INSERT INTO chat_messages
             (room, user_id, username, first_name, photo_url, content,
              media_url, media_type, media_mime, media_thumb_url,
              media_width, media_height)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING ${MSG_RETURNING_COLS}`,
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

        io.to(`chat:${room}`).emit('chat:message', rows[0]);
      } catch (err) {
        logger.error('chat:media error', err);
        const userMsg = err.userMessage || 'Failed to process media. Please try again.';
        socket.emit('chat:error', { message: userMsg });
      }
    });

    // ── Direct Messages ──────────────────────────────────────────────────────

    socket.on('dm:send', async ({ recipientId, content } = {}) => {
      if (!recipientId || !content || !content.trim()) return;
      if (recipientId === user.id) return;
      if (!rateLimit(`dm:${user.id}`, 100, 3600000)) {
        socket.emit('dm:error', { message: 'Too many messages.' });
        return;
      }
      try {
        // Insert message
        const { rows } = await query(
          `INSERT INTO direct_messages (sender_id, recipient_id, content)
           VALUES ($1, $2, $3)
           RETURNING id, sender_id, recipient_id, content, is_read, created_at`,
          [user.id, recipientId, content.trim()]
        );
        const msg = rows[0];

        // Upsert dm_thread
        const [a, b] = [user.id, recipientId].sort();
        await query(
          `INSERT INTO dm_threads (user_a, user_b, last_message_at, last_message, unread_for_a, unread_for_b)
           VALUES ($1, $2, NOW(), $3, $4, $5)
           ON CONFLICT (user_a, user_b) DO UPDATE SET
             last_message_at = NOW(), last_message = $3,
             unread_for_a = CASE WHEN dm_threads.user_a = $6 THEN 0 ELSE dm_threads.unread_for_a + 1 END,
             unread_for_b = CASE WHEN dm_threads.user_b = $6 THEN 0 ELSE dm_threads.unread_for_b + 1 END`,
          [a, b, content.trim().slice(0, 100),
           user.id === a ? 0 : 1,
           user.id === b ? 0 : 1,
           user.id]
        );

        // Deliver to sender and recipient
        const payload = {
          ...msg,
          sender: {
            id: user.id,
            username: user.username,
            firstName: user.firstName,
            photoUrl: user.photoUrl,
          },
        };
        socket.emit('dm:sent', payload);
        io.to(`user:${recipientId}`).emit('dm:received', payload);
      } catch (err) {
        logger.error('dm:send error', err);
      }
    });

    socket.on('dm:typing', ({ recipientId } = {}) => {
      if (!recipientId) return;
      io.to(`user:${recipientId}`).emit('dm:typing', { from: user.id });
    });

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: user ${user.id}`);
    });
  });
}

module.exports = { initSocketIO };
