'use strict';

const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');
const { getRedis } = require('../../config/redis');
const { processChatMedia } = require('../services/chatMediaService');
const NotificationEmitter = require('../services/notificationEmitter');
const LiveStreamModel = require('../../models/liveStreamModel');

// ── Session resolution ────────────────────────────────────────────────────────

// Parse session cookie to authenticate Socket.IO connections
async function getUserFromSocket(socket) {
  try {
    const cookieHeader = socket.handshake.headers.cookie || '';
    const match = cookieHeader.match(/(?:^|;\s*)__pnptv_sid=([^;]+)/);
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

// Periodically purge expired rate-limit entries to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitCounters) {
    if (now > entry.reset) rateLimitCounters.delete(key);
  }
}, 5 * 60 * 1000);

// ── Message SELECT columns helper ─────────────────────────────────────────────

// All the columns we return for every chat message — text or media.
// Keep in sync with migrations 072_chat_media_attachments.sql + 076_hangout_video_calls.sql.
const MSG_RETURNING_COLS = `
  id, room, user_id, username, first_name, photo_url, content,
  media_url, media_type, media_mime, media_thumb_url,
  media_width, media_height, media_metadata, created_at
`;

// ── Global online presence ────────────────────────────────────────────────────

// Track online users: userId → { name, photoUrl, hangoutGroupIds: Set<number> }
const onlineUsersMap = new Map();

function emitGroupPresence(io, gid) {
  const online = [];
  for (const [uid, p] of onlineUsersMap) {
    if (p.hangoutGroupIds.has(gid)) {
      online.push({ userId: uid, name: p.name, photoUrl: p.photoUrl });
    }
  }
  io.to(`hangout:${gid}`).emit('hangout:presence', { groupId: gid, online });
}

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

    // Register user in the global presence map
    onlineUsersMap.set(user.id, {
      name: user.firstName || user.first_name || user.username || 'User',
      photoUrl: user.photoUrl || user.photo_url || null,
      hangoutGroupIds: new Set(),
    });

    // ── Group Chat ───────────────────────────────────────────────────────────

    // Allowed community chat rooms (non-hangout)
    const ALLOWED_COMMUNITY_ROOMS = new Set(['general', 'prime']);

    socket.on('chat:join', async ({ room = 'general' } = {}) => {
      // Authorization: hangout rooms require membership
      const hangoutMatch = String(room).match(/^hangout:(\d+)$/);
      if (hangoutMatch) {
        const groupId = parseInt(hangoutMatch[1], 10);
        try {
          const { rows: memberRows } = await query(
            'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
            [groupId, user.id]
          );
          if (memberRows.length === 0) {
            socket.emit('chat:error', { message: 'Not a member of this group' });
            return;
          }
        } catch (err) {
          logger.error('chat:join membership check error', err);
          socket.emit('chat:error', { message: 'Failed to verify membership' });
          return;
        }
      } else if (!ALLOWED_COMMUNITY_ROOMS.has(room)) {
        socket.emit('chat:error', { message: 'Invalid room' });
        return;
      }

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

      // Hangout rooms require membership
      const hangoutMatch = String(room).match(/^hangout:(\d+)$/);
      if (hangoutMatch) {
        const gid = parseInt(hangoutMatch[1], 10);
        const { rows } = await query('SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2', [gid, user.id]);
        if (rows.length === 0) return;
      }

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

      // ── Room validation (mirrors chat:message) ──────────────────────────────
      const mediaHangoutMatch = String(room).match(/^hangout:(\d+)$/);
      if (mediaHangoutMatch) {
        const gid = parseInt(mediaHangoutMatch[1], 10);
        try {
          const { rows: memberRows } = await query(
            'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
            [gid, user.id]
          );
          if (memberRows.length === 0) {
            socket.emit('chat:error', { message: 'Access denied' });
            return;
          }
        } catch (err) {
          logger.error('chat:media membership check error', err);
          socket.emit('chat:error', { message: 'Access denied' });
          return;
        }
      } else if (room === 'prime') {
        // Prime room requires prime tier
        try {
          const { rows: tierRows } = await query(
            `SELECT tier FROM users WHERE id = $1`,
            [user.id]
          );
          if (tierRows.length === 0 || tierRows[0].tier?.toLowerCase() !== 'prime') {
            socket.emit('chat:error', { message: 'Access denied' });
            return;
          }
        } catch (err) {
          logger.error('chat:media prime tier check error', err);
          socket.emit('chat:error', { message: 'Access denied' });
          return;
        }
      } else if (!ALLOWED_COMMUNITY_ROOMS.has(room)) {
        socket.emit('chat:error', { message: 'Access denied' });
        return;
      }
      // ── End room validation ─────────────────────────────────────────────────

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

    // ── Hangout Group Rooms ─────────────────────────────────────────────────
    // Clients join hangout rooms to receive chat messages AND call events.

    socket.on('hangout:join', async ({ groupId } = {}) => {
      if (!groupId) return;
      const gid = parseInt(groupId, 10);
      if (!Number.isFinite(gid)) return;

      try {
        // Verify membership before joining the Socket.IO room
        const { rows } = await query(
          'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
          [gid, user.id]
        );
        if (rows.length === 0) {
          socket.emit('hangout:error', { message: 'Not a member of this group' });
          return;
        }

        const room = `hangout:${gid}`;
        socket.join(room);

        // Send recent message history
        const { rows: history } = await query(
          `SELECT ${MSG_RETURNING_COLS}
           FROM chat_messages
           WHERE room = $1 AND is_deleted = false
           ORDER BY created_at DESC LIMIT 50`,
          [room]
        );
        socket.emit('hangout:history', history.reverse());

        // Send active call info if any
        const { rows: activeCall } = await query(
          `SELECT hvc.id, hvc.room_name, hvc.creator_id, hvc.created_at,
                  (SELECT COUNT(*)::int
                   FROM hangout_call_participants hcp
                   WHERE hcp.call_id = hvc.id AND hcp.left_at IS NULL) AS participant_count
           FROM hangout_video_calls hvc
           WHERE hvc.group_id = $1 AND hvc.status = 'active'
           LIMIT 1`,
          [gid]
        );
        if (activeCall.length > 0) {
          socket.emit('hangout:call:active', {
            callId: activeCall[0].id,
            roomName: activeCall[0].room_name,
            creatorId: activeCall[0].creator_id,
            createdAt: activeCall[0].created_at,
            participantCount: activeCall[0].participant_count,
          });
        }

        // Update presence map and emit presence to the joining socket and room
        onlineUsersMap.get(user.id)?.hangoutGroupIds.add(gid);

        // Build online members list: all members of this group who are currently in onlineUsersMap
        const { rows: memberRows } = await query(
          'SELECT user_id FROM hangout_group_members WHERE group_id=$1',
          [gid]
        );
        const memberIds = new Set(memberRows.map(r => r.user_id));
        const onlineNow = [];
        for (const [uid, p] of onlineUsersMap) {
          if (memberIds.has(uid)) {
            onlineNow.push({ userId: uid, name: p.name, photoUrl: p.photoUrl });
          }
        }
        socket.emit('hangout:presence', { groupId: gid, online: onlineNow });
        // Also notify others in the room that this user came online
        emitGroupPresence(io, gid);
      } catch (err) {
        logger.error('hangout:join error', err);
      }
    });

    socket.on('hangout:leave', ({ groupId } = {}) => {
      if (!groupId) return;
      const gid = parseInt(groupId, 10);
      socket.leave(`hangout:${gid}`);
      const presenceEntry = onlineUsersMap.get(user.id);
      if (presenceEntry) {
        presenceEntry.hangoutGroupIds.delete(gid);
        emitGroupPresence(io, gid);
      }
    });

    // Hangout text message via Socket.IO (alternative to REST POST)
    socket.on('hangout:message', async ({ groupId, content } = {}) => {
      if (!groupId || !content || !content.trim()) return;
      if (content.length > 2000) return;

      const gid = parseInt(groupId, 10);
      if (!Number.isFinite(gid)) return;

      if (!rateLimit(`hangout:${user.id}`, 30, 60000)) {
        socket.emit('hangout:error', { message: 'Too many messages. Slow down.' });
        return;
      }

      try {
        // Verify membership
        const { rows: memberRows } = await query(
          'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
          [gid, user.id]
        );
        if (memberRows.length === 0) {
          socket.emit('hangout:error', { message: 'Not a member of this group' });
          return;
        }

        const room = `hangout:${gid}`;
        const firstName = user.firstName || user.first_name || null;
        const photoUrl = user.photoUrl || user.photo_url || null;

        const { rows } = await query(
          `INSERT INTO chat_messages (room, user_id, username, first_name, photo_url, content)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING ${MSG_RETURNING_COLS}`,
          [room, user.id, user.username || null, firstName, photoUrl, content.trim()]
        );

        // Touch activity timestamp for 72h inactivity cleanup
        await query('UPDATE hangout_groups SET last_activity_at = NOW() WHERE id = $1', [gid]);

        io.to(room).emit('chat:message', rows[0]);
      } catch (err) {
        logger.error('hangout:message error', err);
        socket.emit('hangout:error', { message: 'Failed to send message' });
      }
    });

    // Hangout typing indicator (ephemeral, no DB writes)
    socket.on('hangout:typing', async ({ groupId } = {}) => {
      if (!groupId) return;
      const gid = parseInt(groupId, 10);
      if (!Number.isFinite(gid)) return;

      // Verify membership before broadcasting typing indicator
      const { rows } = await query('SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2', [gid, user.id]);
      if (rows.length === 0) return;

      // Rate limit: max 1 typing event per 2s per user per group
      if (!rateLimit(`typing:${user.id}:${gid}`, 1, 2000)) return;
      socket.to(`hangout:${gid}`).emit('hangout:typing', {
        userId: user.id,
        firstName: user.firstName || user.first_name || user.username || 'Someone',
      });
    });

    socket.on('hangout:invite', async ({ groupId, targetUserId } = {}) => {
      if (!groupId || !targetUserId) return;
      const gid = parseInt(groupId, 10);
      if (!Number.isFinite(gid)) return;
      if (targetUserId === user.id) return;

      if (!rateLimit(`hangout:invite:${user.id}`, 10, 60000)) return;

      try {
        // Verify sender is a member
        const { rows: senderRows } = await query(
          'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
          [gid, user.id]
        );
        if (senderRows.length === 0) return;

        // Get group name
        const { rows: groupRows } = await query(
          'SELECT name FROM hangout_groups WHERE id=$1',
          [gid]
        );
        if (groupRows.length === 0) return;

        const groupName = groupRows[0].name;
        const fromName = user.firstName || user.first_name || user.username || 'Someone';

        io.to(`user:${targetUserId}`).emit('hangout:invite:received', {
          groupId: gid,
          groupName,
          fromUserId: user.id,
          fromName,
          fromPhotoUrl: user.photoUrl || user.photo_url || null,
        });
      } catch (err) {
        logger.error('hangout:invite error', err);
      }
    });

    // ── Direct Messages ──────────────────────────────────────────────────────

    socket.on('dm:send', async ({ recipientId, content } = {}) => {
      if (!recipientId || !content || !content.trim()) return;
      if (recipientId === user.id) return;

      // Free-tier daily DM limit (mirrors REST requireFreeTierDmLimit middleware)
      const tier = (user.tier || 'free').toLowerCase();
      const role = user.role || '';
      const isFreeUser = tier === 'free' && role !== 'admin' && role !== 'superadmin';
      if (isFreeUser) {
        try {
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
            socket.emit('dm:error', { message: 'Daily message limit reached. Upgrade for unlimited messaging.', code: 'DM_LIMIT_REACHED' });
            return;
          }
        } catch (limErr) {
          logger.warn('dm:send tier limit check failed (fail-open)', { userId: user.id, error: limErr.message });
        }
      }

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

        // Notify recipient of new DM
        NotificationEmitter.emit({
          type: 'dm', category: 'messaging', priority: 'high',
          actorId: user.id, targetUserId: recipientId,
          entityType: 'message', entityId: String(msg.id),
          message: `${user.firstName || user.username} sent you a message`,
        });
      } catch (err) {
        logger.error('dm:send error', err);
      }
    });

    socket.on('dm:typing', ({ recipientId } = {}) => {
      if (!recipientId) return;
      io.to(`user:${recipientId}`).emit('dm:typing', { from: user.id });
    });

    // ── Live Stream Chat ──────────────────────────────────────────────────────

    const STREAM_ID_RE = /^[a-zA-Z0-9_:\-\.]{1,200}$/;

    socket.on('live:join', async ({ streamId } = {}) => {
      if (!streamId || !STREAM_ID_RE.test(String(streamId))) {
        socket.emit('live:error', { message: 'Invalid stream ID' });
        return;
      }
      if (!rateLimit(`live:join:${user.id}`, 5, 60000)) {
        socket.emit('live:error', { message: 'Too many join attempts. Please slow down.' });
        return;
      }
      try {
        socket.join(`live:${streamId}`);
        socket.data.liveRooms = socket.data.liveRooms || new Set();
        socket.data.liveRooms.add(streamId);

        const redis = getRedis();
        await redis.incr(`live:viewers:${streamId}`);
        await redis.expire(`live:viewers:${streamId}`, 3600);
        const countRaw = await redis.get(`live:viewers:${streamId}`);
        const count = parseInt(countRaw, 10) || 0;

        io.to(`live:${streamId}`).emit('live:viewer_count', { streamId, count });

        const history = await LiveStreamModel.getComments(streamId, 50);
        socket.emit('live:history', history);
      } catch (err) {
        logger.error('live:join error', { streamId, userId: user.id, error: err.message });
        socket.emit('live:error', { message: 'Failed to join stream' });
      }
    });

    socket.on('live:leave', async ({ streamId } = {}) => {
      if (!streamId || !STREAM_ID_RE.test(String(streamId))) return;

      socket.leave(`live:${streamId}`);
      if (socket.data.liveRooms) socket.data.liveRooms.delete(streamId);

      try {
        const redis = getRedis();
        const afterDecr = await redis.decr(`live:viewers:${streamId}`);
        if (afterDecr < 0) await redis.set(`live:viewers:${streamId}`, 0);
        await redis.expire(`live:viewers:${streamId}`, 3600);
        const countRaw = await redis.get(`live:viewers:${streamId}`);
        const count = Math.max(0, parseInt(countRaw, 10) || 0);
        io.to(`live:${streamId}`).emit('live:viewer_count', { streamId, count });
      } catch (err) {
        logger.error('live:leave error', { streamId, userId: user.id, error: err.message });
      }
    });

    socket.on('live:message', async ({ streamId, content } = {}) => {
      if (!streamId || !STREAM_ID_RE.test(String(streamId))) {
        socket.emit('live:error', { message: 'Invalid stream ID' });
        return;
      }
      if (!content || !String(content).trim()) {
        socket.emit('live:error', { message: 'Message cannot be empty' });
        return;
      }
      if (String(content).length > 500) {
        socket.emit('live:error', { message: 'Message too long (max 500 characters)' });
        return;
      }
      if (!rateLimit(`live:msg:${user.id}`, 20, 60000)) {
        socket.emit('live:error', { message: 'Too many messages. Slow down.' });
        return;
      }
      if (!socket.data.liveRooms?.has(streamId)) {
        socket.emit('live:error', { message: 'You must join the stream before sending messages' });
        return;
      }
      try {
        const username = user.username || user.firstName || user.first_name || 'Viewer';
        const trimmedContent = String(content).trim();
        const commentData = await LiveStreamModel.addComment(streamId, user.id, username, trimmedContent);

        io.to(`live:${streamId}`).emit('live:message', {
          id: commentData.commentId,
          streamId,
          userId: user.id,
          username,
          content: trimmedContent,
          createdAt: commentData.timestamp || new Date(),
        });
      } catch (err) {
        logger.error('live:message error', { streamId, userId: user.id, error: err.message });
        socket.emit('live:error', { message: 'Failed to send message' });
      }
    });

    socket.on('disconnect', async () => {
      logger.info(`Socket disconnected: user ${user.id}`);

      if (socket.data.liveRooms && socket.data.liveRooms.size > 0) {
        const redis = getRedis();
        for (const streamId of socket.data.liveRooms) {
          try {
            const afterDecr = await redis.decr(`live:viewers:${streamId}`);
            if (afterDecr < 0) await redis.set(`live:viewers:${streamId}`, 0);
            await redis.expire(`live:viewers:${streamId}`, 3600);
            const countRaw = await redis.get(`live:viewers:${streamId}`);
            const count = Math.max(0, parseInt(countRaw, 10) || 0);
            io.to(`live:${streamId}`).emit('live:viewer_count', { streamId, count });
          } catch (err) {
            logger.warn('live viewer count cleanup error on disconnect', { streamId, userId: user.id, error: err.message });
          }
        }
      }

      const presenceEntry = onlineUsersMap.get(user.id);
      if (presenceEntry) {
        for (const gid of presenceEntry.hangoutGroupIds) {
          presenceEntry.hangoutGroupIds.delete(gid);
          // Emit after a tiny delay so the socket fully disconnects first
          setImmediate(() => emitGroupPresence(io, gid));
        }
      }
      onlineUsersMap.delete(user.id);
    });
  });
}

module.exports = { initSocketIO };
