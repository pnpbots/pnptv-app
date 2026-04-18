'use strict';

const crypto = require('crypto');
const { spawn } = require('child_process');
const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');
const { getRedis } = require('../../config/redis');
const { processChatMedia } = require('../../services/chatMediaService');
const NotificationEmitter = require('../../services/notificationEmitter');
const LiveStreamModel = require('../../models/liveStreamModel');
const BlockedUser = require('../../models/blockedUser');
const DmService = require('../../services/dmService');

// ── Lua script: atomic viewer-count decrement clamped to 0 ────────────────────
// H4: Replaces the non-atomic decr + conditional set(0) pattern.
// KEYS[1] = the viewer count key; returns the new count (never negative).
const VIEWER_DECR_CLAMP_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local val = tonumber(current)
if not val or val <= 0 then
  redis.call('SET', KEYS[1], 0)
  return 0
end
return redis.call('DECR', KEYS[1])
`;

// Helper: atomically decrement viewer count for a stream, clamp to 0, refresh
// TTL, and return the resulting count.
async function atomicViewerDecrement(redis, streamId) {
  const result = await redis.eval(VIEWER_DECR_CLAMP_SCRIPT, 1, `live:viewers:${streamId}`);
  const count = Math.max(0, parseInt(result, 10) || 0);
  await redis.expire(`live:viewers:${streamId}`, 3600);
  return count;
}

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

// Extract the session ID from the socket's cookie header (no Redis lookup).
// Returns null if the cookie is absent or malformed.
function getSidFromSocket(socket) {
  try {
    const cookieHeader = socket.handshake.headers.cookie || '';
    const match = cookieHeader.match(/(?:^|;\s*)__pnptv_sid=([^;]+)/);
    if (!match) return null;
    const raw = decodeURIComponent(match[1]);
    return raw.startsWith('s:') ? raw.slice(2).split('.')[0] : raw.split('.')[0];
  } catch {
    return null;
  }
}

// Re-validate that the session still exists in Redis and belongs to the same
// user stored on socket.data.user.  Returns the fresh user object on success,
// or null if the session is gone / belongs to a different user (TOCTOU guard).
async function revalidateSession(socket) {
  try {
    const sid = getSidFromSocket(socket);
    if (!sid) return null;
    const redis = getRedis();
    const data = await redis.get(`sess:${sid}`);
    if (!data) return null;
    const session = JSON.parse(data);
    const freshUser = session?.user || null;
    if (!freshUser) return null;
    // Ensure the session still belongs to the same user that connected
    if (String(freshUser.id) !== String(socket.data.user?.id)) return null;
    return freshUser;
  } catch {
    return null;
  }
}

// SESSION_REVALIDATION_INTERVAL_MS — how often to re-check the session while
// the socket is connected.  5 minutes is a reasonable balance between security
// (catching revoked sessions promptly) and Redis load.
const SESSION_REVALIDATION_INTERVAL_MS = 5 * 60 * 1000;

// ── Message SELECT columns helper ─────────────────────────────────────────────

// All the columns we return for every chat message — text or media.
// Keep in sync with migrations 072_chat_media_attachments.sql + 076_hangout_video_calls.sql.
const MSG_RETURNING_COLS = `
  id, room, user_id, username, first_name, photo_url, content,
  media_url, media_type, media_mime, media_thumb_url,
  media_width, media_height, media_metadata, reply_to_id, matrix_event_id, created_at
`;

// ── Stream ID validation regex (module-scope so it is compiled once) ─────────
// SOCK-L1: moved out of the per-connection handler closure.
const STREAM_ID_RE = /^[a-zA-Z0-9_:\-\.]{1,200}$/;

// ── Global online presence ────────────────────────────────────────────────────

// Track online users: userId → { name, photoUrl, hangoutGroupIds: Set<number>, socketIds: Set<string> }
// SOCK-H3: socketIds tracks every active socket for this user so that closing
// one tab (one socket) does not evict the user from the presence map while
// other tabs remain connected.
const onlineUsersMap = new Map();

// ── In-memory music state per hangout group ───────────────────────────────────
// Map<groupId, { trackId, trackUrl, trackTitle, trackArtist, trackArt, isPlaying, position, startedAt }>
const hangoutMusicState = new Map();

// ── Random Video Call state ──────────────────────────────────────────────────
const pendingRandomCalls = new Map(); // callId → { callerId, calleeId, roomId, matrixRoomId, timeout }

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
    try {
      const { rows: banRows } = await query(
        `SELECT 1 FROM users WHERE id = $1 AND tier = 'banned' LIMIT 1`,
        [String(user.id)]
      );
      if (banRows.length > 0) return next(new Error('Account suspended'));
    } catch (err) {
      logger.error('Socket ban check failed', { userId: user.id, error: err.message });
      return next(new Error('Authorization check failed'));
    }
    socket.data.user = user;
    next();
  });

  io.on('connection', async (socket) => {
    const user = socket.data.user;
    logger.info(`Socket connected: user ${user.id}`);

    // Activity tracking — 5-min TTL key for notification throttling
    const _activityRedis = getRedis();
    const _activityKey = `user:${user.id}:active`;
    _activityRedis.set(_activityKey, '1', 'EX', 300).catch(() => {});
    socket.onAny(() => {
      _activityRedis.set(_activityKey, '1', 'EX', 300).catch(() => {});
    });

    // ── Periodic session re-validation (TOCTOU guard) ────────────────────────
    // The session was validated at connection time and stored in socket.data.user.
    // During a 90-day session TTL the user's session can be revoked (logout,
    // admin ban, password change) without the socket handler knowing.  Re-check
    // the Redis session every SESSION_REVALIDATION_INTERVAL_MS and disconnect
    // the socket if the session is gone or has been reassigned to a different user.
    // N2: Track consecutive revalidation failures to disconnect after 3 failures
    // (roughly 15 minutes) rather than failing open indefinitely on Redis outage.
    let _sessionRevalidationFailures = 0;
    const MAX_CONSECUTIVE_REVALIDATION_FAILURES = 3;

    const _sessionRevalidationTimer = setInterval(async () => {
      try {
        const freshUser = await revalidateSession(socket);
        if (!freshUser) {
          logger.warn(`Socket session expired or revoked for user ${user.id} — disconnecting`);
          socket.emit('auth:session_expired', { message: 'Your session has expired. Please log in again.' });
          socket.disconnect(true);
          return;
        }
        // Also re-check ban status on every revalidation tick
        const { rows: banRows } = await query(
          `SELECT 1 FROM users WHERE id = $1 AND tier = 'banned' LIMIT 1`,
          [String(freshUser.id)]
        );
        if (banRows.length > 0) {
          logger.warn(`Socket revalidation: banned user ${user.id} disconnected`);
          socket.emit('auth:suspended', { message: 'Your account has been suspended.' });
          socket.disconnect(true);
          return;
        }
        // Reset failure counter on a successful revalidation round
        _sessionRevalidationFailures = 0;
      } catch (err) {
        _sessionRevalidationFailures += 1;
        logger.error('Periodic session revalidation error', {
          userId: user.id,
          error: err.message,
          consecutiveFailures: _sessionRevalidationFailures,
        });
        if (_sessionRevalidationFailures >= MAX_CONSECUTIVE_REVALIDATION_FAILURES) {
          logger.warn(
            `Socket revalidation: ${MAX_CONSECUTIVE_REVALIDATION_FAILURES} consecutive failures for user ${user.id} — disconnecting`,
          );
          socket.emit('auth:session_expired', { message: 'Session check unavailable. Please reconnect.' });
          socket.disconnect(true);
        }
      }
    }, SESSION_REVALIDATION_INTERVAL_MS);

    // Clear the revalidation timer when the socket disconnects so we don't
    // accumulate timers for dead connections.
    socket.once('disconnect', () => clearInterval(_sessionRevalidationTimer));

    // Join personal room for DMs and targeted notifications
    socket.join(`user:${user.id}`);

    // Register user in the global presence map.
    // SOCK-H3: If the user already has an entry (another open tab / socket),
    // we add this socket to the existing set rather than overwriting, so that
    // disconnecting one tab does not remove the user from presence while other
    // connections are still alive.
    if (onlineUsersMap.has(user.id)) {
      onlineUsersMap.get(user.id).socketIds.add(socket.id);
    } else {
      onlineUsersMap.set(user.id, {
        name: user.firstName || user.first_name || user.username || 'User',
        photoUrl: user.photoUrl || user.photo_url || null,
        hangoutGroupIds: new Set(),
        socketIds: new Set([socket.id]),
      });
    }

    // ── Nearby Real-Time ────────────────────────────────────────────────────

    socket.on('nearby:join-grid', ({ lat, lng } = {}) => {
      if (typeof lat !== 'number' || typeof lng !== 'number') return;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
      const gridLat = Math.floor(lat * 10) / 10;
      const gridLng = Math.floor(lng * 10) / 10;
      const room = `nearby:${gridLat}:${gridLng}`;
      // Leave any previous nearby rooms
      for (const r of socket.rooms) {
        if (r.startsWith('nearby:') && r !== room) socket.leave(r);
      }
      socket.join(room);
    });

    socket.on('nearby:leave', () => {
      for (const r of socket.rooms) {
        if (r.startsWith('nearby:')) socket.leave(r);
      }
    });

    // ── Legacy community chat handlers removed — messaging now via PG + Socket.IO ──

    // ── Hangout Group Rooms ─────────────────────────────────────────────────
    // Clients join hangout rooms to receive chat messages AND call events.

    socket.on('hangout:join', async ({ groupId } = {}) => {
      if (!groupId) return;
      const gid = parseInt(groupId, 10);
      if (!Number.isFinite(gid)) return;

      try {
        // Verify non-banned membership before joining the Socket.IO room
        const { rows } = await query(
          'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND (is_banned = false OR is_banned IS NULL)',
          [gid, user.id]
        );
        if (rows.length === 0) {
          socket.emit('hangout:error', { message: 'Not a member of this group' });
          return;
        }

        const room = `hangout:${gid}`;
        socket.join(room);

        // Messages live in PG chat_messages — frontend fetches via REST API.

        // Send current music state to joining user
        const musicState = hangoutMusicState.get(gid);
        if (musicState) {
          const effectivePosition = musicState.isPlaying && musicState.startedAt
            ? musicState.position + (Date.now() - musicState.startedAt) / 1000
            : musicState.position;
          socket.emit('hangout:music:state', { ...musicState, position: effectivePosition, shuffle: !!musicState.shuffle });
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

        // Clear unread message counter now that user is viewing this hangout
        try {
          const redis = getRedis();
          await redis.del(`hangout:unread:${gid}:${user.id}`);
        } catch (_) { /* non-fatal */ }

        // Messages now stored in PG chat_messages, no Matrix sync needed.
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
    socket.on('hangout:message', async ({ groupId, content, replyToId } = {}) => {
      if (!groupId || !content || !content.trim()) return;
      if (content.length > 2000) return;
      const parsedReplyToId = replyToId ? parseInt(replyToId, 10) : null;

      const gid = parseInt(groupId, 10);
      if (!Number.isFinite(gid)) return;

      const userRole = (user.role || '').toLowerCase();
      const isAdminUser = userRole === 'admin' || userRole === 'superadmin';
      if (!isAdminUser) {
        try {
          const EntitlementAccessService = require('../../services/entitlementAccessService');
          const hasAccess = await EntitlementAccessService.hasEntitlement(String(user.id), 'pnp-member');
          if (!hasAccess) {
            socket.emit('hangout:error', { message: 'Member subscription required', code: 'MEMBER_REQUIRED' });
            return;
          }
        } catch (err) {
          logger.error('Hangout entitlement check failed', { userId: user.id, error: err.message });
          socket.emit('hangout:error', { message: 'Access check unavailable. Please try again.', code: 'ENTITLEMENT_CHECK_FAILED' });
          return;
        }
      }

      try {
        // Mute check
        const { rows: memberInfo } = await query(
          'SELECT role, is_muted, muted_until, is_banned FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
          [gid, user.id]
        );
        if (memberInfo.length === 0) {
          socket.emit('hangout:error', { message: 'Not a member of this group' });
          return;
        }
        if (memberInfo[0].is_banned) {
          socket.emit('hangout:error', { message: 'You are banned from this group', code: 'BANNED' });
          return;
        }
        if (memberInfo[0].is_muted) {
          if (memberInfo[0].muted_until && new Date(memberInfo[0].muted_until) > new Date()) {
            socket.emit('hangout:error', { message: 'You are muted in this group', code: 'MUTED' });
            return;
          }
          // Mute expired, clear it
          await query('UPDATE hangout_group_members SET is_muted = false, muted_until = NULL WHERE group_id=$1 AND user_id=$2', [gid, user.id]);
        }

        // Read-only mode check
        const { rows: groupSettings } = await query(
          'SELECT is_read_only, slow_mode_seconds FROM hangout_groups WHERE id = $1',
          [gid]
        );
        if (groupSettings[0]?.is_read_only) {
          const memberRole = memberInfo[0].role;
          if (memberRole !== 'owner' && memberRole !== 'moderator') {
            const isAdminRole = (user.role || '').toLowerCase() === 'admin' || (user.role || '').toLowerCase() === 'superadmin';
            if (!isAdminRole) {
              socket.emit('hangout:error', { message: 'This group is in read-only mode', code: 'READ_ONLY' });
              return;
            }
          }
        }

        // Block check: only check against the group creator (matches REST endpoint behavior).
        // Checking all members would let any single block prevent messaging the entire group.
        const { rows: hangoutCreatorRows } = await query(
          'SELECT creator_id FROM hangout_groups WHERE id = $1',
          [gid]
        );
        const hangoutCreatorId = hangoutCreatorRows[0]?.creator_id;
        if (hangoutCreatorId && String(hangoutCreatorId) !== String(user.id)) {
          const { rows: hangoutBlockRows } = await query(
            `SELECT 1 FROM blocked_users
             WHERE (user_id = $1 AND blocked_user_id = $2)
                OR (user_id = $2 AND blocked_user_id = $1)
             LIMIT 1`,
            [user.id, hangoutCreatorId]
          );
          if (hangoutBlockRows.length > 0) {
            socket.emit('hangout:error', { message: 'Cannot send message', code: 'BLOCKED' });
            return;
          }
        }

        // Slow mode enforcement (matches REST sendMessage behavior)
        const slowModeSeconds = groupSettings[0]?.slow_mode_seconds || 0;
        if (slowModeSeconds > 0) {
          const memberRole = memberInfo[0].role;
          const isModOrOwner = memberRole === 'owner' || memberRole === 'moderator';
          const isAdminRole = (user.role || '').toLowerCase() === 'admin' || (user.role || '').toLowerCase() === 'superadmin';
          if (!isModOrOwner && !isAdminRole) {
            const { rows: lastMsgRows } = await query(
              `SELECT created_at FROM chat_messages WHERE room = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`,
              [`hangout:${gid}`, user.id]
            );
            if (lastMsgRows.length > 0) {
              const elapsed = (Date.now() - new Date(lastMsgRows[0].created_at).getTime()) / 1000;
              if (elapsed < slowModeSeconds) {
                socket.emit('hangout:error', { message: `Slow mode: wait ${Math.ceil(slowModeSeconds - elapsed)}s`, code: 'SLOW_MODE' });
                return;
              }
            }
          }
        }

        // ── PG insert + Socket.IO broadcast ──
        const isValidPhoto = (p) => p && typeof p === 'string' && (p.startsWith('/') || p.startsWith('http'));
        const photoResult = await query('SELECT photo_file_id FROM users WHERE id = $1', [user.id]);
        const rawPhoto = photoResult.rows[0]?.photo_file_id || user.photoUrl || null;
        const photoUrl = isValidPhoto(rawPhoto) ? rawPhoto : null;

        const room = `hangout:${gid}`;
        const text = content.trim().slice(0, 2000);
        const { rows: insertedRows } = await query(
          `INSERT INTO chat_messages (room, user_id, username, first_name, photo_url, content, reply_to_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, room, user_id, username, first_name, photo_url, content,
                     media_url, media_type, media_mime, media_thumb_url,
                     media_width, media_height, media_metadata, reply_to_id, created_at`,
          [room, user.id, user.username || null, user.firstName || user.first_name || null, photoUrl, text, parsedReplyToId]
        );
        const msg = { ...insertedRows[0], photo_url: isValidPhoto(insertedRows[0].photo_url) ? insertedRows[0].photo_url : null };

        // Attach reply_to preview if replying
        if (parsedReplyToId) {
          const { rows: replyRows } = await query(
            'SELECT first_name, username, content FROM chat_messages WHERE id = $1 AND room = $2',
            [parsedReplyToId, `hangout:${groupId}`]
          );
          if (replyRows[0]) {
            msg.reply_to = { name: replyRows[0].first_name || replyRows[0].username || 'User', content: (replyRows[0].content || '[media]').slice(0, 100) };
          }
        }

        // Broadcast to all users in the hangout room
        io.to(room).emit('chat:message', msg);

        // Auto-drop feed-worthy messages to the hangout feed (non-blocking)
        setImmediate(() => {
          const SocialPostService = require('../../services/socialPostService');
          SocialPostService.autoDropToFeed(msg, gid, io).catch(() => {});
        });

        // Touch activity timestamp for 72h inactivity cleanup
        await query('UPDATE hangout_groups SET last_activity_at = NOW() WHERE id = $1', [gid]);

        // ── Webapp → Telegram bridge: forward text message to linked Telegram group ──
        (async () => {
          try {
            const { rows: tgRows } = await query(
              'SELECT telegram_chat_id FROM hangout_groups WHERE id = $1 AND telegram_chat_id IS NOT NULL',
              [gid]
            );
            if (tgRows.length === 0) return;
            const tgChatId = tgRows[0].telegram_chat_id;
            const { getBotInstance } = require('../core/bot');
            const bot = getBotInstance();
            if (!bot) return;
            const senderName = user.firstName || user.first_name || user.username || 'User';
            const tgResult = await bot.telegram.sendMessage(tgChatId, `${senderName}: ${text}`, { parse_mode: undefined });
            // Store TG message ID so edits/deletes can be synced back
            if (tgResult?.message_id) {
              await query(
                `UPDATE chat_messages SET media_metadata = COALESCE(media_metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
                [JSON.stringify({ source: 'webapp', telegramMsgId: tgResult.message_id, telegramChatId: String(tgChatId) }), msg.id]
              );
            }
          } catch (bridgeErr) {
            logger.warn('[App→TG Bridge] socket text forward failed', { error: bridgeErr.message, groupId: gid });
          }
        })();

        // ── Push notifications to offline hangout members ──
        // Fire-and-forget: don't block the message flow
        (async () => {
          try {
            // Get group name + all member IDs
            const [groupResult, membersResult] = await Promise.all([
              query('SELECT name FROM hangout_groups WHERE id = $1', [gid]),
              query('SELECT user_id FROM hangout_group_members WHERE group_id = $1 AND user_id != $2', [gid, user.id]),
            ]);
            const groupName = groupResult.rows[0]?.name || 'Hangout';
            const memberIds = membersResult.rows.map(r => r.user_id);
            if (memberIds.length === 0) return;

            // Find which members are currently in the socket room (online & viewing)
            const roomSockets = await io.in(room).fetchSockets();
            const onlineUserIds = new Set(roomSockets.map(s => String(s.data?.user?.id)).filter(Boolean));

            // Only notify members NOT currently in the room
            const offlineIds = memberIds.filter(id => !onlineUserIds.has(String(id)));
            if (offlineIds.length === 0) return;

            // Batch: use Redis counter to aggregate message count per user per group.
            // Each notification replaces the previous one (same tag) with updated count.
            const redis = getRedis();
            const senderName = user.username || user.firstName || user.first_name || 'Someone';
            const preview = text.length > 80 ? text.slice(0, 77) + '...' : text;

            await Promise.allSettled(offlineIds.map(async (targetId) => {
              const countKey = `hangout:unread:${gid}:${targetId}`;
              const unread = await redis.incr(countKey);
              // Expire counter after 24h (resets if user doesn't open the hangout)
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
                entityId: String(gid),
                message: msgText,
                metadata: {
                  groupId: gid,
                  groupName,
                  senderId: user.id,
                  senderName,
                  unreadCount: unread,
                  url: `/hangouts/${gid}`,
                  // Push notification fields
                  pushTitle: groupName,
                  pushBody: msgText,
                  pushTag: `hangout-${gid}`,  // replaces previous notification for same group
                },
              });
            }));
          } catch (notifErr) {
            logger.warn('hangout:message push notification error', { error: notifErr.message, groupId: gid });
          }
        })();
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
      try {
        const { rows: typingMemberRows } = await query(
          'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
          [gid, user.id]
        );
        if (typingMemberRows.length === 0) return;
      } catch (err) {
        logger.error('hangout:typing membership check failed', { userId: user.id, groupId: gid, error: err.message });
        return;
      }

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


      try {
        // Verify sender is a member
        const { rows: senderRows } = await query(
          'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
          [gid, user.id]
        );
        if (senderRows.length === 0) return;

        // Block check — do not deliver invitations between users who have blocked
        // each other (in either direction).  Uses the same blocked_users schema
        // as the DM and REST endpoints.
        const { rows: blockRows } = await query(
          `SELECT 1 FROM blocked_users
           WHERE (user_id = $1 AND blocked_user_id = $2)
              OR (user_id = $2 AND blocked_user_id = $1)
           LIMIT 1`,
          [user.id, targetUserId]
        );
        if (blockRows.length > 0) {
          // Silently drop — do not reveal to the sender that the target has blocked them
          return;
        }

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

    // ── Hangout Mark-Read (broadcasts read receipt to group) ─────────────────

    socket.on('hangout:mark-read', async ({ groupId } = {}) => {
      if (!groupId) return;
      const gid = parseInt(groupId, 10);
      if (!Number.isFinite(gid)) return;


      try {
        // Verify membership
        const { rows: memberRows } = await query(
          'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
          [gid, user.id]
        );
        if (memberRows.length === 0) return;

        // Update last_read_at in DB
        await query(
          'UPDATE hangout_group_members SET last_read_at = NOW() WHERE group_id=$1 AND user_id=$2',
          [gid, user.id]
        );

        // Clear Redis unread counter
        const unreadKey = `hangout:unread:${gid}:${user.id}`;
        try { const r = getRedis(); if (r) await r.del(unreadKey); } catch { /* silent */ }

        // Broadcast read receipt to other members
        const userName = user.firstName || user.first_name || user.username || 'User';
        socket.to(`hangout:${gid}`).emit('hangout:read', {
          userId: user.id,
          name: userName,
          photoUrl: user.photoUrl || user.photo_url || null,
          lastReadAt: new Date().toISOString(),
        });
      } catch (err) {
        logger.error('hangout:mark-read error', { userId: user.id, groupId: gid, error: err.message });
      }
    });

    // ── Hangout Message Edit ───────────────────────────────────────────────────

    socket.on('hangout:message:edit', async ({ groupId, messageId, content } = {}) => {
      if (!groupId || !messageId || !content?.trim()) return;
      const gid   = parseInt(groupId,  10);
      const msgId = parseInt(messageId, 10);
      if (!Number.isFinite(gid) || !Number.isFinite(msgId)) return;

      const text = content.trim();
      if (text.length > 2000) {
        socket.emit('hangout:error', { message: 'Content too long', code: 'CONTENT_TOO_LONG' });
        return;
      }


      try {
        const { rows: memberRows } = await query(
          'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND (is_banned=false OR is_banned IS NULL)',
          [gid, user.id]
        );
        if (memberRows.length === 0) return;

        const { rows: msgRows } = await query(
          `SELECT id, user_id, created_at, is_deleted FROM chat_messages WHERE id=$1 AND room='hangout:'||$2`,
          [msgId, gid]
        );
        if (msgRows.length === 0) return;

        const msg = msgRows[0];
        if (String(msg.user_id) !== String(user.id)) return;
        if (msg.is_deleted) return;

        const ageMs = Date.now() - new Date(msg.created_at).getTime();
        if (ageMs > 48 * 60 * 60 * 1000) {
          socket.emit('hangout:error', { message: 'Message too old to edit (48-hour limit)', code: 'TOO_OLD' });
          return;
        }

        const { rows: updated } = await query(
          `UPDATE chat_messages
           SET content = $1,
               edited_at = NOW(),
               edit_count = edit_count + 1,
               original_content = COALESCE(original_content, content)
           WHERE id = $2
           RETURNING id, content, edited_at, edit_count`,
          [text, msgId]
        );

        const result = updated[0];
        io.to(`hangout:${gid}`).emit('hangout:message:edited', {
          messageId: result.id,
          content:   result.content,
          editedAt:  result.edited_at,
          editCount: result.edit_count,
        });

        // ── Webapp → Telegram bridge: sync edit to linked Telegram group ──
        (async () => {
          try {
            const { rows: metaRows } = await query(
              `SELECT media_metadata FROM chat_messages WHERE id = $1`,
              [msgId]
            );
            const meta = metaRows[0]?.media_metadata;
            if (!meta?.telegramMsgId || !meta?.telegramChatId) return;
            const { getBotInstance } = require('../core/bot');
            const bot = getBotInstance();
            if (!bot) return;
            const senderName = user.firstName || user.first_name || user.username || 'User';
            await bot.telegram.editMessageText(
              meta.telegramChatId, meta.telegramMsgId, undefined,
              `${senderName}: ${text}`
            );
          } catch (editBridgeErr) {
            // Telegram may reject edits after 48h or for non-text — ignore silently
            logger.warn('[App→TG Bridge] edit sync failed', { error: editBridgeErr.message, messageId: msgId });
          }
        })();
      } catch (err) {
        logger.error('hangout:message:edit error', { userId: user.id, groupId: gid, messageId: msgId, error: err.message });
      }
    });

    // ── Hangout Message Delete ─────────────────────────────────────────────────

    socket.on('hangout:message:delete', async ({ groupId, messageId, forAll } = {}) => {
      if (!groupId || !messageId) return;
      const gid   = parseInt(groupId,  10);
      const msgId = parseInt(messageId, 10);
      if (!Number.isFinite(gid) || !Number.isFinite(msgId)) return;

      const deleteForAll = forAll === true || forAll === 'true';

      try {
        const { rows: memberRows } = await query(
          'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND (is_banned=false OR is_banned IS NULL)',
          [gid, user.id]
        );
        if (memberRows.length === 0) return;

        const { rows: msgRows } = await query(
          `SELECT id, user_id, is_deleted FROM chat_messages WHERE id=$1 AND room='hangout:'||$2`,
          [msgId, gid]
        );
        if (msgRows.length === 0) return;

        const msg = msgRows[0];
        if (msg.is_deleted) return;

        const isOwnMessage = String(msg.user_id) === String(user.id);

        if (!isOwnMessage) {
          if (!deleteForAll) return; // Cannot soft-delete another user's message for self-only
          // Moderator/owner check
          const { rows: roleRows } = await query(
            "SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND role IN ('owner','moderator')",
            [gid, user.id]
          );
          if (roleRows.length === 0) return;
        }

        await query(
          `UPDATE chat_messages SET is_deleted=true, deleted_by=$1, deleted_for_all=$2 WHERE id=$3`,
          [String(user.id), deleteForAll, msgId]
        );

        io.to(`hangout:${gid}`).emit('hangout:message:deleted', {
          messageId: msgId,
          deletedBy: user.id,
          forAll:    deleteForAll,
        });

        // ── Webapp → Telegram bridge: sync delete to linked Telegram group ──
        if (deleteForAll) {
          (async () => {
            try {
              const { rows: metaRows } = await query(
                `SELECT media_metadata FROM chat_messages WHERE id = $1`,
                [msgId]
              );
              const meta = metaRows[0]?.media_metadata;
              if (!meta?.telegramMsgId || !meta?.telegramChatId) return;
              const { getBotInstance } = require('../core/bot');
              const bot = getBotInstance();
              if (!bot) return;
              await bot.telegram.deleteMessage(meta.telegramChatId, meta.telegramMsgId);
            } catch (delBridgeErr) {
              logger.warn('[App→TG Bridge] delete sync failed', { error: delBridgeErr.message, messageId: msgId });
            }
          })();
        }
      } catch (err) {
        logger.error('hangout:message:delete error', { userId: user.id, groupId: gid, messageId: msgId, error: err.message });
      }
    });

    // ── Hangout Reaction Toggle ────────────────────────────────────────────────

    socket.on('hangout:reaction:toggle', async ({ groupId, messageId, emoji } = {}) => {
      if (!groupId || !messageId || !emoji?.trim()) return;
      const gid   = parseInt(groupId,  10);
      const msgId = parseInt(messageId, 10);
      if (!Number.isFinite(gid) || !Number.isFinite(msgId)) return;

      const emojiStr = emoji.trim();
      const { isAllowedReaction } = require('../../services/reactionService');
      if (!isAllowedReaction(emojiStr)) {
        socket.emit('hangout:error', { message: 'Emoji not allowed', code: 'EMOJI_NOT_ALLOWED' });
        return;
      }


      try {
        const { rows: memberRows } = await query(
          'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND (is_banned=false OR is_banned IS NULL)',
          [gid, user.id]
        );
        if (memberRows.length === 0) return;

        const { rows: msgRows } = await query(
          `SELECT id FROM chat_messages WHERE id=$1 AND room='hangout:'||$2 AND is_deleted=false`,
          [msgId, gid]
        );
        if (msgRows.length === 0) return;

        const { rows: existing } = await query(
          `SELECT id FROM chat_message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3`,
          [msgId, String(user.id), emojiStr]
        );

        if (existing.length > 0) {
          await query(
            `DELETE FROM chat_message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3`,
            [msgId, String(user.id), emojiStr]
          );
        } else {
          const { rows: uniqueEmojiRows } = await query(
            `SELECT COUNT(DISTINCT emoji)::int AS cnt FROM chat_message_reactions WHERE message_id=$1`,
            [msgId]
          );
          if (uniqueEmojiRows[0].cnt >= 20) {
            socket.emit('hangout:error', { message: 'Maximum emoji reactions reached for this message', code: 'REACTION_LIMIT' });
            return;
          }
          await query(
            `INSERT INTO chat_message_reactions (message_id, user_id, emoji) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
            [msgId, String(user.id), emojiStr]
          );
        }

        const { rows: aggRows } = await query(
          `SELECT emoji, COUNT(*)::int AS count, array_agg(user_id) AS users
           FROM chat_message_reactions WHERE message_id=$1 GROUP BY emoji`,
          [msgId]
        );
        const reactions = aggRows.map((r) => ({
          emoji:  r.emoji,
          count:  r.count,
          users:  Array.isArray(r.users) ? r.users.map(String) : [],
        }));

        io.to(`hangout:${gid}`).emit('hangout:reaction:updated', { messageId: msgId, reactions });

        // ── Webapp → Telegram reaction bridge: set bot reaction to the top emoji ──
        // Limitation: Telegram's setMessageReaction attributes the reaction to the
        // bot, not the user. We show the current top emoji as the bot's reaction
        // so TG users can see activity. Empty reactions clear the bot's reaction.
        (async () => {
          try {
            const { rows: metaRows } = await query(
              `SELECT media_metadata FROM chat_messages WHERE id = $1`,
              [msgId]
            );
            const meta = metaRows[0]?.media_metadata;
            if (!meta?.telegramMsgId || !meta?.telegramChatId) return;

            const { getBotInstance } = require('../core/bot');
            const bot = getBotInstance();
            if (!bot) return;

            // Pick the emoji with the highest count (ties broken by emoji string)
            const top = reactions.slice().sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji))[0];
            const tgReaction = top ? [{ type: 'emoji', emoji: top.emoji }] : [];

            await bot.telegram.callApi('setMessageReaction', {
              chat_id: meta.telegramChatId,
              message_id: meta.telegramMsgId,
              reaction: tgReaction,
              is_big: false,
            });
          } catch (rxnBridgeErr) {
            // TG rejects unsupported/custom emoji — ignore silently
            logger.warn('[App→TG Bridge] reaction sync failed', { error: rxnBridgeErr.message, messageId: msgId });
          }
        })();
      } catch (err) {
        logger.error('hangout:reaction:toggle error', { userId: user.id, groupId: gid, messageId: msgId, error: err.message });
      }
    });

    // ── Hangout Read Receipt (per-message) ────────────────────────────────────

    socket.on('hangout:read:message', async ({ groupId, messageId } = {}) => {
      if (!groupId || !messageId) return;
      const gid   = parseInt(groupId,  10);
      const msgId = parseInt(messageId, 10);
      if (!Number.isFinite(gid) || !Number.isFinite(msgId)) return;


      try {
        await query(
          `UPDATE hangout_group_members
           SET last_read_message_id = GREATEST(COALESCE(last_read_message_id, 0), $1)
           WHERE group_id=$2 AND user_id=$3`,
          [msgId, gid, user.id]
        );

        socket.to(`hangout:${gid}`).emit('hangout:read:update', {
          userId:            user.id,
          lastReadMessageId: msgId,
        });
      } catch (err) {
        logger.error('hangout:read:message error', { userId: user.id, groupId: gid, messageId: msgId, error: err.message });
      }
    });

    // ── Hangout Call socket handlers removed — calls now use Telegram native ─────

    // ── Hangout Music Sync ───────────────────────────────────────────────────

    async function isHangoutMod(userId, gid) {
      if (user.role === 'admin' || user.role === 'superadmin') return true;
      const { rows: ownerRows } = await query(
        "SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND role='owner'",
        [gid, userId]
      );
      if (ownerRows.length > 0) return true;
      const { rows: callRows } = await query(
        "SELECT 1 FROM hangout_video_calls WHERE group_id=$1 AND status='active' AND creator_id=$2",
        [gid, userId]
      );
      return callRows.length > 0;
    }

    socket.on('hangout:music:play', async ({ groupId, trackId, trackUrl, trackTitle, trackArtist, trackArt } = {}) => {
      if (!groupId || !trackId || !trackUrl) return;
      const gid = parseInt(groupId, 10);
      if (!Number.isFinite(gid)) return;
      try {
        const isMod = await isHangoutMod(user.id, gid);
        if (!isMod) { socket.emit('hangout:error', { message: 'Not a moderator', code: 'NOT_MOD' }); return; }
        const existingShuffle = hangoutMusicState.get(gid)?.shuffle || false;
        const state = {
          trackId: String(trackId),
          trackUrl: String(trackUrl).slice(0, 500),
          trackTitle: String(trackTitle || '').slice(0, 200),
          trackArtist: String(trackArtist || '').slice(0, 200),
          trackArt: trackArt ? String(trackArt).slice(0, 500) : null,
          isPlaying: true,
          position: 0,
          startedAt: Date.now(),
          shuffle: existingShuffle,
        };
        hangoutMusicState.set(gid, state);
        io.to(`hangout:${gid}`).emit('hangout:music:play', state);
      } catch (err) { logger.error('hangout:music:play error', err); }
    });

    socket.on('hangout:music:pause', async ({ groupId, position } = {}) => {
      if (!groupId) return;
      const gid = parseInt(groupId, 10);
      if (!Number.isFinite(gid)) return;
      try {
        const isMod = await isHangoutMod(user.id, gid);
        if (!isMod) return;
        const existing = hangoutMusicState.get(gid);
        if (!existing) return;
        const pausePos = typeof position === 'number'
          ? position
          : (existing.isPlaying && existing.startedAt
              ? existing.position + (Date.now() - existing.startedAt) / 1000
              : existing.position);
        const updated = { ...existing, isPlaying: false, position: pausePos, startedAt: null };
        hangoutMusicState.set(gid, updated);
        io.to(`hangout:${gid}`).emit('hangout:music:pause', { position: pausePos });
      } catch (err) { logger.error('hangout:music:pause error', err); }
    });

    socket.on('hangout:music:resume', async ({ groupId, position } = {}) => {
      if (!groupId) return;
      const gid = parseInt(groupId, 10);
      if (!Number.isFinite(gid)) return;
      try {
        const isMod = await isHangoutMod(user.id, gid);
        if (!isMod) return;
        const existing = hangoutMusicState.get(gid);
        if (!existing) return;
        const resumePos = typeof position === 'number' ? position : existing.position;
        const updated = { ...existing, isPlaying: true, position: resumePos, startedAt: Date.now() };
        hangoutMusicState.set(gid, updated);
        io.to(`hangout:${gid}`).emit('hangout:music:resume', {
          position: resumePos,
          startedAt: updated.startedAt,
          trackId: updated.trackId,
        });
      } catch (err) { logger.error('hangout:music:resume error', err); }
    });

    socket.on('hangout:music:seek', async ({ groupId, position } = {}) => {
      if (!groupId || typeof position !== 'number') return;
      const gid = parseInt(groupId, 10);
      if (!Number.isFinite(gid) || !Number.isFinite(position)) return;
      try {
        const isMod = await isHangoutMod(user.id, gid);
        if (!isMod) return;
        const existing = hangoutMusicState.get(gid);
        if (!existing) return;
        const updated = { ...existing, position, startedAt: existing.isPlaying ? Date.now() : null };
        hangoutMusicState.set(gid, updated);
        io.to(`hangout:${gid}`).emit('hangout:music:seek', { position, startedAt: updated.startedAt });
      } catch (err) { logger.error('hangout:music:seek error', err); }
    });

    socket.on('hangout:music:stop', async ({ groupId } = {}) => {
      if (!groupId) return;
      const gid = parseInt(groupId, 10);
      if (!Number.isFinite(gid)) return;
      try {
        const isMod = await isHangoutMod(user.id, gid);
        if (!isMod) return;
        hangoutMusicState.delete(gid);
        io.to(`hangout:${gid}`).emit('hangout:music:stop', {});
      } catch (err) { logger.error('hangout:music:stop error', err); }
    });

    // ── Music Auto-Advance ───────────────────────────────────────────────────

    socket.on('hangout:music:ended', async ({ groupId } = {}) => {
      if (!groupId) return;
      const gid = parseInt(groupId, 10);
      if (!Number.isFinite(gid)) return;
      try {
        const existing = hangoutMusicState.get(gid);
        if (!existing || !existing.isPlaying) return;
        // Debounce: multiple clients fire ended simultaneously
        if (existing._lastAdvancedAt && Date.now() - existing._lastAdvancedAt < 2000) return;
        existing._lastAdvancedAt = Date.now();
        hangoutMusicState.set(gid, existing);

        // Auto-advance disabled (Ampache removed)
        logger.info(`Music ended in group ${gid}, no auto-advance available`);
      } catch (err) { logger.error('hangout:music:ended auto-advance error', err); }
    });

    socket.on('hangout:music:shuffle', async ({ groupId } = {}) => {
      if (!groupId) return;
      const gid = parseInt(groupId, 10);
      if (!Number.isFinite(gid)) return;
      try {
        const isMod = await isHangoutMod(user.id, gid);
        if (!isMod) { socket.emit('hangout:error', { message: 'Not a moderator', code: 'NOT_MOD' }); return; }
        const existing = hangoutMusicState.get(gid);
        if (!existing) return;
        existing.shuffle = !existing.shuffle;
        hangoutMusicState.set(gid, existing);
        io.to(`hangout:${gid}`).emit('hangout:music:shuffle', { shuffle: existing.shuffle });
      } catch (err) { logger.error('hangout:music:shuffle error', err); }
    });

    // ── Direct Messages ──────────────────────────────────────────────────────

    socket.on('dm:send', async ({ recipientId, content } = {}) => {
      if (!recipientId || !content || !content.trim()) return;
      if (content.length > 4000) { socket.emit('dm:error', { error: 'Message too long' }); return; }
      if (recipientId === user.id) return;

      // Free-tier daily DM limit — users without pnp-member entitlement are limited
      const EntitlementAccessService = require('../../services/entitlementAccessService');
      const role = user.role || '';
      const hasDmMembership = role === 'admin' || role === 'superadmin' || await EntitlementAccessService.hasEntitlement(user.id, 'pnp-member');
      const isFreeUser = !hasDmMembership;
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
          logger.error('dm:send tier limit check failed (fail-closed)', { userId: user.id, error: limErr.message });
          socket.emit('dm:error', { message: 'Unable to verify message limit. Please try again shortly.', code: 'LIMIT_CHECK_FAILED' });
          return;
        }
      }


      try {
        // ── PG insert via DmService (handles blocks, privacy, thread upsert, push) ──
        const isAdmin = user.role === 'admin' || user.role === 'superadmin';
        const message = await DmService.sendMessage(user.id, recipientId, { content: content.trim() }, { isAdmin });

        // Emit to recipient's personal room for real-time delivery
        io.to(`user:${recipientId}`).emit('dm:message', {
          ...message,
          senderName: user.firstName || user.first_name || user.username || 'User',
          senderPhoto: user.photoUrl || user.photo_url || null,
        });

        // Confirm to sender with the saved message
        socket.emit('dm:sent', { success: true, message });

        // ── Webapp → Telegram DM bridge: forward to recipient's Telegram ──
        if (!message._ticket) {
          DmService.bridgeToTelegram(user.id, recipientId, message).catch(() => {});
        }
      } catch (err) {
        if (err.statusCode) {
          socket.emit('dm:error', { message: err.message, code: err.code });
          return;
        }
        logger.error('dm:send error', err);
        socket.emit('dm:error', { error: 'Failed to send message' });
      }
    });


    socket.on('dm:typing', async ({ recipientId } = {}) => {
      if (!recipientId) return;
      try {
        const { rows } = await query(
          `SELECT 1 FROM blocked_users
           WHERE (user_id=$1 AND blocked_user_id=$2) OR (user_id=$2 AND blocked_user_id=$1) LIMIT 1`,
          [recipientId, user.id]
        );
        if (rows.length > 0) return;
      } catch { return; }
      io.to(`user:${recipientId}`).emit('dm:typing', { from: user.id });
    });

    // Edit an existing DM (sender only, within 48 hours)
    socket.on('dm:message:edit', async ({ messageId, content } = {}) => {
      if (!messageId || !content || !content.trim()) return;
      if (content.length > 4000) {
        socket.emit('dm:error', { message: 'Message too long', code: 'MSG_TOO_LONG' });
        return;
      }

      try {
        const { rows } = await query(
          `SELECT id, sender_id, recipient_id, content, created_at, is_deleted
           FROM direct_messages WHERE id = $1`,
          [messageId]
        );

        if (rows.length === 0) {
          socket.emit('dm:error', { message: 'Message not found', code: 'NOT_FOUND' });
          return;
        }

        const msg = rows[0];
        if (String(msg.sender_id) !== String(user.id)) {
          socket.emit('dm:error', { message: 'Cannot edit another user\'s message', code: 'FORBIDDEN' });
          return;
        }
        if (msg.is_deleted) {
          socket.emit('dm:error', { message: 'Message has been deleted', code: 'DELETED' });
          return;
        }
        const ageMs = Date.now() - new Date(msg.created_at).getTime();
        if (ageMs > 48 * 60 * 60 * 1000) {
          socket.emit('dm:error', { message: 'Message is too old to edit', code: 'TOO_OLD' });
          return;
        }

        const { rows: updated } = await query(
          `UPDATE direct_messages
           SET content = $1,
               edited_at = NOW(),
               edit_count = edit_count + 1,
               original_content = COALESCE(original_content, content)
           WHERE id = $2
           RETURNING id, sender_id, recipient_id, content, edited_at, edit_count`,
          [content.trim(), messageId]
        );

        const updatedMsg = updated[0];
        const payload = {
          messageId: updatedMsg.id,
          content: updatedMsg.content,
          editedAt: updatedMsg.edited_at,
          editCount: updatedMsg.edit_count,
        };

        io.to(`user:${msg.sender_id}`).to(`user:${msg.recipient_id}`)
          .emit('dm:message:edited', payload);
      } catch (err) {
        logger.error('dm:message:edit error', err);
        socket.emit('dm:error', { message: 'Failed to edit message', code: 'SERVER_ERROR' });
      }
    });

    // Delete a DM (soft-delete; sender only)
    socket.on('dm:message:delete', async ({ messageId } = {}) => {
      if (!messageId) return;

      try {
        const { rows } = await query(
          `SELECT id, sender_id, recipient_id, is_deleted FROM direct_messages WHERE id = $1`,
          [messageId]
        );

        if (rows.length === 0) {
          socket.emit('dm:error', { message: 'Message not found', code: 'NOT_FOUND' });
          return;
        }

        const msg = rows[0];
        if (String(msg.sender_id) !== String(user.id)) {
          socket.emit('dm:error', { message: 'Cannot delete another user\'s message', code: 'FORBIDDEN' });
          return;
        }
        if (msg.is_deleted) {
          socket.emit('dm:error', { message: 'Message already deleted', code: 'ALREADY_DELETED' });
          return;
        }

        await query(
          `UPDATE direct_messages SET is_deleted = true WHERE id = $1`,
          [messageId]
        );

        io.to(`user:${msg.sender_id}`).to(`user:${msg.recipient_id}`)
          .emit('dm:message:deleted', {
            messageId: msg.id,
            forAll: true,
          });
      } catch (err) {
        logger.error('dm:message:delete error', err);
        socket.emit('dm:error', { message: 'Failed to delete message', code: 'SERVER_ERROR' });
      }
    });

    // Decline an incoming DM video call (callee only)
    socket.on('dm:call:decline', async ({ callId } = {}) => {
      if (!callId) return;

      try {
        const { rows, rowCount } = await query(
          `UPDATE dm_video_calls
           SET status = 'declined', ended_at = NOW(), ended_by = $1
           WHERE id = $2 AND callee_id = $1 AND status = 'active'
           RETURNING id, caller_id, callee_id`,
          [user.id, callId]
        );

        if (rowCount === 0) {
          socket.emit('dm:error', { message: 'Call not found or already ended', code: 'NOT_FOUND' });
          return;
        }

        const call = rows[0];
        io.to(`user:${call.caller_id}`).emit('dm:call:declined', {
          callId: call.id,
          declinedBy: {
            id: user.id,
            username: user.username,
            firstName: user.firstName || user.first_name,
          },
        });

        logger.info('DM call declined via socket', { callId, calleeId: user.id, callerId: call.caller_id });
      } catch (err) {
        logger.error('dm:call:decline error', err);
        socket.emit('dm:error', { message: 'Failed to decline call', code: 'SERVER_ERROR' });
      }
    });

    // ── Live Stream Chat ──────────────────────────────────────────────────────

    socket.on('live:join', async ({ streamId } = {}) => {
      if (!streamId || !STREAM_ID_RE.test(String(streamId))) {
        socket.emit('live:error', { message: 'Invalid stream ID' });
        return;
      }
      try {
        // Verify the stream exists before allowing join.
        // A valid streamId is either:
        //   (a) a record in the live_streams table (DB-tracked stream), OR
        //   (b) a channel ref currently assigned to a user in users.live_channel
        //       (Restreamer slug-based stream, e.g. 'pnptv-frank'), OR
        //   (c) a numeric Directus performer ID that resolves to a live_channel.
        // Reject anything that matches none of these to prevent resource exhaustion
        // from arbitrary room creation.
        const isNumericId = /^\d+$/.test(String(streamId));
        const isSlug = /^[a-zA-Z][a-zA-Z0-9-]*$/.test(String(streamId));

        let streamVerified = false;

        // Check live_streams table (handles DB-backed streams + numeric Directus IDs)
        const dbStream = await LiveStreamModel.getById(String(streamId));
        if (dbStream) {
          streamVerified = true;
        }

        // Check users.live_channel for Restreamer slug-based streams
        if (!streamVerified && isSlug) {
          const { rows: channelRows } = await query(
            'SELECT 1 FROM users WHERE live_channel = $1 LIMIT 1',
            [String(streamId)]
          );
          if (channelRows.length > 0) streamVerified = true;
        }

        // Check performers.directus_id → users.live_channel for numeric Directus IDs
        if (!streamVerified && isNumericId) {
          const { rows: performerRows } = await query(
            `SELECT 1 FROM performers p
             JOIN users u ON u.id = p.user_id
             WHERE p.directus_id = $1 AND u.live_channel IS NOT NULL
             LIMIT 1`,
            [String(streamId)]
          );
          if (performerRows.length > 0) streamVerified = true;
        }

        if (!streamVerified) {
          socket.emit('live:error', { message: 'Stream not found', code: 'STREAM_NOT_FOUND' });
          return;
        }

        // N1: Access control — if the DB-backed stream is not public, the viewer
        // must hold the pnp-prime entitlement (creator-gated / subscribers-only stream).
        // Restreamer slug streams and Directus performer streams without a live_streams
        // row are treated as public (platform-level RTMP channels).
        if (dbStream && dbStream.is_public === false) {
          const userRole = (user.role || '').toLowerCase();
          const isAdminUser = userRole === 'admin' || userRole === 'superadmin';
          if (!isAdminUser && String(user.id) !== String(dbStream.host_id)) {
            try {
              const EntitlementAccessService = require('../../services/entitlementAccessService');
              const hasPrime = await EntitlementAccessService.hasEntitlement(String(user.id), 'pnp-prime');
              if (!hasPrime) {
                socket.emit('live:error', { message: 'Subscription required to view this stream', code: 'ACCESS_DENIED' });
                return;
              }
            } catch (accessErr) {
              logger.error('live:join access check failed', { streamId, userId: user.id, error: accessErr.message });
              socket.emit('live:error', { message: 'Access check unavailable. Please try again.', code: 'ACCESS_CHECK_FAILED' });
              return;
            }
          }
        }

        socket.join(`live:${streamId}`);
        socket.data.liveRooms = socket.data.liveRooms || new Set();
        socket.data.liveRooms.add(streamId);

        const redis = getRedis();

        // SOCK-H1: Deduplicate viewer-count increments per user per stream.
        // A user opening multiple tabs or reconnecting rapidly must only count
        // once in the viewer total.  SET NX with a 1-hour TTL acts as the gate;
        // if the key already exists the increment (and broadcast) are skipped.
        const joinKey = `live:joined:${streamId}:${user.id}`;
        const firstJoin = await redis.set(joinKey, '1', 'EX', 3600, 'NX');
        if (firstJoin === 'OK') {
          await redis.incr(`live:viewers:${streamId}`);
          await redis.expire(`live:viewers:${streamId}`, 3600);
        }
        const countRaw = await redis.get(`live:viewers:${streamId}`);
        const count = parseInt(countRaw, 10) || 0;

        io.to(`live:${streamId}`).emit('live:viewer_count', { streamId, count });

        // Try DB history first; fall back to Redis for Restreamer/Directus streams
        let history = [];
        try {
          history = await LiveStreamModel.getComments(streamId, 50);
        } catch {
          const raw = await redis.lrange(`live:chat:${streamId}`, 0, 49);
          history = raw.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean).reverse();
        }
        socket.emit('live:history', history);

        // Best-effort: send the current active overlay to this viewer.
        // The streamId from the client may be a Directus performer ID (numeric
        // string) or a Restreamer channel ref (e.g. 'pnptv-frank'). We try
        // both: direct match on channel_ref, then join through users.live_channel
        // via a performers lookup.  Either query may return 0 rows — that is
        // fine; viewers simply render no overlay.
        try {
          // Attempt 1: streamId is itself a channel_ref slug
          let overlayRows = [];
          if (/^[a-zA-Z0-9-]+$/.test(String(streamId)) && !/^\d+$/.test(String(streamId))) {
            const direct = await query(
              'SELECT * FROM stream_overlays WHERE channel_ref = $1 AND is_active = true',
              [streamId]
            );
            overlayRows = direct.rows;
          }

          // Attempt 2: streamId is a numeric Directus performer ID — resolve through
          // the performers → users → live_channel chain
          if (overlayRows.length === 0 && /^\d+$/.test(String(streamId))) {
            const resolved = await query(
              `SELECT so.*
               FROM stream_overlays so
               JOIN users u ON u.live_channel = so.channel_ref
               JOIN performers p ON p.user_id = u.id
               WHERE p.directus_id = $1 AND so.is_active = true
               LIMIT 1`,
              [String(streamId)]
            );
            overlayRows = resolved.rows;
          }

          if (overlayRows.length > 0) {
            // SOCK-L2: Strip server-only audit field before sending to clients.
            const { updated_by: _ub, ...overlayPayload } = overlayRows[0];
            socket.emit('overlay:config', overlayPayload);
          }
        } catch (overlayErr) {
          // Non-fatal — viewer just won't see the overlay on join
          logger.debug('live:join overlay fetch failed (non-fatal)', { streamId, error: overlayErr.message });
        }
      } catch (err) {
        logger.error('live:join error', { streamId, userId: user.id, error: err.message });
        socket.emit('live:error', { message: 'Failed to join stream' });
      }
    });

    socket.on('live:leave', async ({ streamId } = {}) => {
      if (!streamId || !STREAM_ID_RE.test(String(streamId))) return;


      // SOCK-H5: Only process leave if the user actually joined this stream room.
      // This prevents a client from decrementing the viewer count for a stream
      // it never joined (e.g., spoofed leave packets).
      if (!socket.data.liveRooms?.has(streamId)) return;

      socket.leave(`live:${streamId}`);
      if (socket.data.liveRooms) socket.data.liveRooms.delete(streamId);

      try {
        // H4: Atomic decrement clamped to 0 via Lua script.
        // Also clear the deduplication key so a rejoin is counted fresh.
        const redis = getRedis();
        const count = await atomicViewerDecrement(redis, streamId);
        await redis.del(`live:joined:${streamId}:${user.id}`);
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
      if (!socket.data.liveRooms?.has(streamId)) {
        socket.emit('live:error', { message: 'You must join the stream before sending messages' });
        return;
      }
      try {
        const username = user.username || user.firstName || user.first_name || 'Viewer';
        const trimmedContent = String(content).trim();

        // Try DB-backed storage first; fall back to Redis for Restreamer/Directus streams
        let commentId;
        let timestamp;
        try {
          const commentData = await LiveStreamModel.addComment(streamId, user.id, username, trimmedContent);
          commentId = commentData.commentId;
          timestamp = commentData.timestamp;
        } catch {
          commentId = `${Date.now()}-${user.id}`;
          timestamp = new Date();
          const redis = getRedis();
          const msg = JSON.stringify({ id: commentId, streamId, userId: user.id, username, content: trimmedContent, createdAt: timestamp });
          await redis.lpush(`live:chat:${streamId}`, msg);
          await redis.ltrim(`live:chat:${streamId}`, 0, 199);
          await redis.expire(`live:chat:${streamId}`, 86400);
        }

        io.to(`live:${streamId}`).emit('live:message', {
          id: commentId,
          streamId,
          userId: user.id,
          username,
          content: trimmedContent,
          createdAt: timestamp,
        });
      } catch (err) {
        logger.error('live:message error', { streamId, userId: user.id, error: err.message });
        socket.emit('live:error', { message: 'Failed to send message' });
      }
    });

    // ── Live Raid ────────────────────────────────────────────────────────────
    // Creator emits live:raid:initiate to send all viewers in their stream room
    // to another live stream. The server validates channel ownership, then
    // broadcasts live:raid to the source room so all viewers see the overlay.
    //
    // Payload: { streamId: string, targetChannelRef: string }
    //   streamId         — creator's current channel ref (must match live_channel)
    //   targetChannelRef — target channel ref to redirect viewers to

    socket.on('live:raid:initiate', async ({ streamId, targetChannelRef } = {}) => {
      if (!streamId || !STREAM_ID_RE.test(String(streamId))) {
        socket.emit('live:error', { message: 'Invalid streamId for raid' });
        return;
      }
      if (!targetChannelRef || typeof targetChannelRef !== 'string' || !/^[a-zA-Z0-9\-_.]+$/.test(targetChannelRef)) {
        socket.emit('live:error', { message: 'Invalid targetChannelRef for raid' });
        return;
      }
      if (String(streamId) === String(targetChannelRef)) {
        socket.emit('live:error', { message: 'Cannot raid your own stream' });
        return;
      }
      try {
        // Verify the requesting user owns the source channel
        const { rows: channelRows } = await query(
          'SELECT live_channel FROM users WHERE id = $1',
          [user.id]
        );
        const ownedChannel = channelRows[0]?.live_channel;
        if (!ownedChannel) {
          socket.emit('live:error', { message: 'No streaming channel assigned to your account' });
          return;
        }
        if (String(streamId) !== String(ownedChannel)) {
          socket.emit('live:error', { message: 'You can only raid from your own stream' });
          return;
        }

        const redis = getRedis();
        const viewerCountRaw = await redis.get(`live:viewers:${streamId}`).catch(() => '0');
        const viewerCount = parseInt(viewerCountRaw, 10) || 0;

        const publicUrl = (process.env.RESTREAMER_PUBLIC_URL || 'https://live.pnptv.app').replace(/\/$/, '');
        const targetName = targetChannelRef
          .replace(/^pnptv-/, '')
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());

        io.to(`live:${streamId}`).emit('live:raid', {
          sourceChannelRef: streamId,
          targetChannelRef,
          targetName,
          targetHlsUrl: `${publicUrl}/memfs/${targetChannelRef}.m3u8`,
          viewerCount,
          raidedBy: user.id,
        });

        logger.info(`Socket raid: ${streamId} → ${targetChannelRef} by user ${user.id}, viewers: ${viewerCount}`);
        socket.emit('live:raid:ack', { success: true, targetChannelRef });
      } catch (err) {
        logger.error('live:raid:initiate error', { userId: user.id, error: err.message });
        socket.emit('live:error', { message: 'Failed to initiate raid' });
      }
    });

    // ── Browser → RTMP Stream Bridge ────────────────────────────────────────
    //
    // Allows creators to stream directly from their browser using MediaRecorder.
    // The frontend captures camera/mic via getUserMedia, encodes as webm/opus,
    // and sends binary chunks via Socket.IO. This handler pipes those chunks
    // into an FFmpeg child process that re-encodes to H.264+AAC and pushes
    // to Restreamer over RTMP.
    //
    // Only one active stream per socket (enforced by socket.data.ffmpegProcess).
    // The user's assigned live_channel is verified against channelRef before
    // spawning FFmpeg.

    socket.on('stream:start', async ({ channelRef, videoBitrate, audioBitrate, fps, title, description, tags, thumbnailDataUrl } = {}) => {
      // Reject if already streaming — one stream per connection
      if (socket.data.ffmpegProcess) {
        socket.emit('stream:error', { message: 'Already streaming. Stop the current stream first.' });
        return;
      }

      if (!channelRef || typeof channelRef !== 'string' || !/^[a-zA-Z0-9-]+$/.test(channelRef)) {
        socket.emit('stream:error', { message: 'Invalid channelRef' });
        return;
      }

      // Validate and clamp quality parameters
      const safeVideoBitrate = (typeof videoBitrate === 'number' && isFinite(videoBitrate))
        ? Math.min(Math.max(videoBitrate, 100_000), 6_000_000)
        : 2_500_000;
      const safeAudioBitrate = (typeof audioBitrate === 'number' && isFinite(audioBitrate))
        ? Math.min(Math.max(audioBitrate, 32_000), 320_000)
        : 128_000;
      const safeFps = (typeof fps === 'number' && isFinite(fps))
        ? Math.min(Math.max(Math.round(fps), 15), 60)
        : 30;

      const videoBitrateK = Math.round(safeVideoBitrate / 1000);
      const maxrateK      = Math.round(safeVideoBitrate * 1.2 / 1000);
      const bufsizeK      = Math.round(safeVideoBitrate * 2 / 1000);
      const audioBitrateK = Math.round(safeAudioBitrate / 1000);

      try {
        // Verify the user has a channel assigned and that it matches channelRef
        // (admins may stream to any channel)
        const { rows } = await query(
          'SELECT live_channel FROM users WHERE id = $1',
          [user.id]
        );

        const assignedChannel = rows[0]?.live_channel ?? null;
        const isAdmin = user.role === 'admin' || user.role === 'superadmin';

        if (!isAdmin) {
          const { rows: performerRows } = await query(
            `SELECT 1 FROM performers WHERE user_id = $1 AND status = 'active' LIMIT 1`,
            [user.id]
          );
          if (performerRows.length === 0) {
            socket.emit('stream:error', { message: 'Creator account required to stream.' });
            return;
          }
        }

        if (!assignedChannel) {
          socket.emit('stream:error', { message: 'No streaming channel assigned to your account.' });
          return;
        }

        if (!isAdmin && assignedChannel !== channelRef) {
          socket.emit('stream:error', { message: 'channelRef does not match your assigned channel.' });
          return;
        }

        // Derive the RTMP stream key from the channel slug.
        // 'pnptv-santino' → 'santino'. Non-prefixed slugs are used as-is.
        const streamKey = channelRef.startsWith('pnptv-')
          ? channelRef.slice('pnptv-'.length)
          : channelRef;

        const rtmpToken = process.env.RESTREAMER_RTMP_TOKEN;
        const rtmpTarget = rtmpToken
          ? `rtmp://restreamer:1935/live/${streamKey}?token=${rtmpToken}`
          : `rtmp://restreamer:1935/live/${streamKey}`;

        // Spawn FFmpeg: read webm/opus from stdin, transcode to H.264+AAC, push to RTMP.
        // -re is omitted so FFmpeg consumes input as fast as it arrives from the socket.
        // -fflags nobuffer + -flags low_delay minimise latency through the pipeline.
        // -f webm is required so FFmpeg knows the container format on stdin (without it,
        // format probing on a pipe is unreliable and causes VP8 keyframe decode errors).
        // -analyzeduration/-probesize are set low for fast startup on live piped input.
        const ffmpeg = spawn('ffmpeg', [
          '-loglevel', 'warning',
          '-fflags', '+nobuffer+discardcorrupt',
          '-flags', 'low_delay',
          '-f', 'webm',
          '-analyzeduration', '500000',
          '-probesize', '500000',
          '-i', 'pipe:0',
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-tune', 'zerolatency',
          '-pix_fmt', 'yuv420p',
          '-b:v', `${videoBitrateK}k`,
          '-maxrate', `${maxrateK}k`,
          '-bufsize', `${bufsizeK}k`,
          '-r', String(safeFps),
          '-g', String(safeFps * 2),  // Keyframe every 2 seconds for HLS segment alignment
          '-c:a', 'aac',
          '-b:a', `${audioBitrateK}k`,
          '-ar', '44100',
          '-f', 'flv',
          rtmpTarget,
        ], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        socket.data.ffmpegProcess = ffmpeg;
        socket.data.streamChannelRef = channelRef;

        let ffmpegStderrLines = 0;
        ffmpeg.stderr.on('data', (chunk) => {
          ffmpegStderrLines++;
          // Log first 20 lines at warn level to capture startup errors/codec info,
          // then switch to debug to avoid flooding production logs.
          const line = chunk.toString().trim();
          if (ffmpegStderrLines <= 20) {
            logger.warn(`[ffmpeg:${channelRef}] ${line}`);
          } else {
            logger.debug(`[ffmpeg:${channelRef}] ${line}`);
          }
        });

        ffmpeg.on('close', (code, signal) => {
          logger.info(`FFmpeg process for channel '${channelRef}' exited (code=${code}, signal=${signal}), received ${socket.data.streamDataChunks || 0} chunks / ${socket.data.streamDataBytes || 0} bytes`);
          // Only emit stopped if the process wasn't already cleaned up by stream:stop
          if (socket.data.ffmpegProcess === ffmpeg) {
            socket.data.ffmpegProcess = null;
            socket.data.streamChannelRef = null;
            socket.emit('stream:stopped', { channelRef, reason: code !== 0 ? 'ffmpeg_error' : 'completed' });
          }
        });

        ffmpeg.on('error', (err) => {
          logger.error(`FFmpeg spawn error for channel '${channelRef}'`, err);
          socket.data.ffmpegProcess = null;
          socket.data.streamChannelRef = null;
          socket.emit('stream:error', { message: 'Streaming process failed to start. Is FFmpeg installed?' });
        });

        socket.data.streamDataChunks = 0;
        socket.data.streamDataBytes = 0;
        logger.info(`Browser stream started: user ${user.id} → channel '${channelRef}' → ${rtmpTarget}`);

        // Store stream metadata in Redis (TTL 12h — auto-expires if stream ends uncleanly)
        try {
          const { getRedis } = require('../../config/redis');
          const redis = getRedis();
          if (redis) {
            const safeTitle = (typeof title === 'string' ? title : '').slice(0, 100).trim();
            const safeDesc = (typeof description === 'string' ? description : '').slice(0, 500).trim();
            const safeTags = Array.isArray(tags)
              ? tags.filter(tg => typeof tg === 'string').slice(0, 7).map(tg => tg.slice(0, 32))
              : [];
            await redis.set(`stream:meta:${channelRef}`, JSON.stringify({ title: safeTitle, description: safeDesc, tags: safeTags }), 'EX', 43200);
            if (
              typeof thumbnailDataUrl === 'string' &&
              thumbnailDataUrl.startsWith('data:image/jpeg;base64,') &&
              thumbnailDataUrl.length < 200 * 1024
            ) {
              await redis.set(`stream:thumb:${channelRef}`, thumbnailDataUrl, 'EX', 43200);
            }
          }
        } catch (metaErr) {
          logger.warn('stream:start: failed to store metadata in Redis (non-fatal)', { channelRef, error: metaErr.message });
        }

        // SOCK-H4: Do not send rtmpTarget to the client — it exposes the internal
        // RTMP server address and stream key which are server-side concerns only.
        socket.emit('stream:started', { channelRef });

        // Notify followers
        const { getBotInstance } = require('../core/bot');
        const bot = getBotInstance();
        if (bot) {
          LiveStreamModel.notifyFollowers(
            user.id,
            {
              hostName: user.first_name || user.username,
              title: 'Live Stream',
              streamId: channelRef,
            },
            async (subscriberId, message, streamId) => {
              try {
                await bot.telegram.sendMessage(
                  subscriberId,
                  message,
                  {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                      [Markup.button.callback('📺 Join Stream', `live_join_${streamId}`)],
                    ]),
                  }
                );
              } catch (error) {
                logger.warn('Failed to send notification to follower', { subscriberId, error: error.message });
              }
            }
          ).catch(err => logger.error('Error notifying followers:', err));
        }

        // Cristina AI live stream announcement in social feed (non-blocking)
        setImmediate(() => {
          const CristinaFeedService = require('../../services/cristinaFeedService');
          const safeTitle = (typeof title === 'string' ? title : '').slice(0, 100).trim();
          CristinaFeedService.announceLiveStream(
            user.id,
            user.first_name || user.username,
            safeTitle
          ).catch(() => {});
        });
      } catch (err) {
        logger.error('stream:start error', { userId: user.id, channelRef, err });
        socket.emit('stream:error', { message: 'Failed to start stream. Please try again.' });
      }
    });

    socket.on('stream:data', (data) => {
      const MAX_CHUNK_BYTES = 512 * 1024;

      const ffmpeg = socket.data.ffmpegProcess;
      if (!ffmpeg || !ffmpeg.stdin || ffmpeg.stdin.destroyed) return;

      // Handle backpressure: if the stdin write buffer is full, skip the chunk
      // rather than buffering unboundedly. This keeps latency low at the cost
      // of minor visual artefacts when the network or encoder is congested.
      if (ffmpeg.stdin.writableNeedDrain) return;

      try {
        // data may arrive as Buffer, ArrayBuffer, Uint8Array, or other typed arrays
        // from the browser's MediaRecorder Blob sent via Socket.IO binary frames.
        let buf;
        if (Buffer.isBuffer(data)) {
          buf = data;
        } else if (data instanceof ArrayBuffer) {
          buf = Buffer.from(data);
        } else if (data instanceof Uint8Array || ArrayBuffer.isView(data)) {
          buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        } else if (typeof data === 'object' && data !== null && data.type === 'Buffer' && Array.isArray(data.data)) {
          // Socket.IO JSON-serialized Buffer fallback
          buf = Buffer.from(data.data);
        } else {
          // Last resort: try direct conversion
          buf = Buffer.from(data);
        }

        if (!buf || buf.length === 0) return;

        if (buf.length > MAX_CHUNK_BYTES) {
          logger.warn(`stream:data oversized chunk from user ${user.id}: ${buf.length} bytes`);
          return;
        }

        socket.data.streamDataChunks = (socket.data.streamDataChunks || 0) + 1;
        socket.data.streamDataBytes = (socket.data.streamDataBytes || 0) + buf.length;
        if (socket.data.streamDataChunks <= 3 || socket.data.streamDataChunks % 100 === 0) {
          logger.info(`[stream:data] chunk #${socket.data.streamDataChunks}, ${buf.length} bytes, total ${socket.data.streamDataBytes} bytes`);
        }

        ffmpeg.stdin.write(buf, (writeErr) => {
          if (writeErr && !ffmpeg.stdin.destroyed) {
            logger.warn(`stream:data write error for channel '${socket.data.streamChannelRef}'`, { error: writeErr.message });
          }
        });
      } catch (err) {
        logger.warn('stream:data processing error', { error: err.message });
      }
    });

    socket.on('stream:stop', () => {
      const ffmpeg = socket.data.ffmpegProcess;
      const channelRef = socket.data.streamChannelRef;

      if (!ffmpeg) {
        // Nothing to stop — emit stopped anyway so the client can reset its UI
        socket.emit('stream:stopped', { channelRef: channelRef ?? null, reason: 'not_streaming' });
        return;
      }

      try {
        // Gracefully close stdin so FFmpeg can flush its output buffers before exiting
        if (ffmpeg.stdin && !ffmpeg.stdin.destroyed) {
          ffmpeg.stdin.end();
        }

        // Give FFmpeg 3 seconds to flush and exit cleanly; then force-kill
        const killTimer = setTimeout(() => {
          if (!ffmpeg.killed) {
            ffmpeg.kill('SIGKILL');
          }
        }, 3000);

        ffmpeg.once('close', () => {
          clearTimeout(killTimer);
        });
      } catch (err) {
        logger.warn('stream:stop cleanup error', { channelRef, error: err.message });
      } finally {
        socket.data.ffmpegProcess = null;
        socket.data.streamChannelRef = null;
        logger.info(`Browser stream stopped: user ${user.id}, channel '${channelRef}'`);
        socket.emit('stream:stopped', { channelRef, reason: 'user_stopped' });
      }
    });

    // ── Random Video Call ────────────────────────────────────────────────────

    socket.on('randomcall:initiate', async ({ context } = {}) => {
      if (!user) return;
      const userId = String(user.id);

      try {
        // Check caller is Prime
        const tierRes = await query(
          `SELECT tier, COALESCE(role, 'user') as role FROM users WHERE id = $1`, [userId]
        );
        if (!tierRes.rows.length) return;
        const callerRow = tierRes.rows[0];
        if (callerRow.tier !== 'prime' && callerRow.role !== 'admin' && callerRow.role !== 'superadmin') {
          return socket.emit('randomcall:error', { message: 'Prime subscription required' });
        }

        // Check not already in a call
        for (const [, call] of pendingRandomCalls) {
          if (call.callerId === userId || call.calleeId === userId) {
            return socket.emit('randomcall:error', { message: 'Already in a call' });
          }
        }

        // Get online users, exclude self
        const candidates = [];
        for (const [uid, presence] of onlineUsersMap) {
          if (String(uid) !== userId) {
            candidates.push({ userId: String(uid), name: presence.name, photoUrl: presence.photoUrl });
          }
        }

        if (candidates.length === 0) {
          return socket.emit('randomcall:no-match', {});
        }

        // Filter blocked users
        let blocked = new Set();
        try {
          const blockedByMe = await BlockedUser.getBlockedByUser(userId);
          blockedByMe.forEach(b => blocked.add(String(b.blocked_user_id || b.blocked_id)));
          const blockersOfMe = await BlockedUser.getBlockedByUser(userId); // reverse check
          // Also check who blocked us
          const blockCheckRes = await query(
            `SELECT blocker_id FROM blocked_users WHERE blocked_id = $1`, [userId]
          );
          blockCheckRes.rows.forEach(r => blocked.add(String(r.blocker_id)));
        } catch (e) {
          logger.warn('[RandomCall] Block check failed:', e.message);
        }

        const eligible = candidates.filter(c => !blocked.has(c.userId));

        // Filter to Prime users only
        if (eligible.length === 0) {
          return socket.emit('randomcall:no-match', {});
        }

        const eligibleIds = eligible.map(c => c.userId);
        let primeUsers;
        try {
          const primeRes = await query(
            `SELECT id FROM users WHERE id = ANY($1) AND (tier = 'prime' OR role IN ('admin', 'superadmin'))`,
            [eligibleIds]
          );
          const primeSet = new Set(primeRes.rows.map(r => String(r.id)));
          primeUsers = eligible.filter(c => primeSet.has(c.userId));
        } catch (e) {
          logger.warn('[RandomCall] Prime filter failed:', e.message);
          primeUsers = eligible; // fallback: allow all if query fails
        }

        if (primeUsers.length === 0) {
          return socket.emit('randomcall:no-match', {});
        }

        // Random pick
        const callee = primeUsers[Math.floor(Math.random() * primeUsers.length)];

        // Check callee not already in a call
        for (const [, call] of pendingRandomCalls) {
          if (call.callerId === callee.userId || call.calleeId === callee.userId) {
            // Try another
            const filtered = primeUsers.filter(u => {
              for (const [, c] of pendingRandomCalls) {
                if (c.callerId === u.userId || c.calleeId === u.userId) return false;
              }
              return true;
            });
            if (filtered.length === 0) {
              return socket.emit('randomcall:no-match', {});
            }
            // reassign callee
            Object.assign(callee, filtered[Math.floor(Math.random() * filtered.length)]);
            break;
          }
        }

        // Generate call ID
        const callId = `rc_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
        const roomId = `random-${callId}`;

        // Store pending call with 30s timeout
        const timeoutHandle = setTimeout(() => {
          const call = pendingRandomCalls.get(callId);
          if (call) {
            pendingRandomCalls.delete(callId);
            io.to(`user:${call.callerId}`).emit('randomcall:timeout', { callId });
            io.to(`user:${call.calleeId}`).emit('randomcall:timeout', { callId });
          }
        }, 30000);

        pendingRandomCalls.set(callId, {
          callerId: userId,
          calleeId: callee.userId,
          matrixRoomId,
          timeout: timeoutHandle,
          createdAt: Date.now(),
        });

        // Get caller info for callee
        const callerInfo = {
          userId,
          name: user.name || user.firstName || 'Someone',
          photoUrl: user.photoUrl || null,
        };

        const calleeInfo = {
          userId: callee.userId,
          name: calleeDbUser.first_name || callee.name || 'Someone',
          photoUrl: calleeDbUser.photo_url || callee.photoUrl || null,
        };

        // Emit to both parties
        socket.emit('randomcall:ringing', { callId, peer: calleeInfo });
        io.to(`user:${callee.userId}`).emit('randomcall:incoming', { callId, caller: callerInfo });

        logger.info(`[RandomCall] ${userId} → ${callee.userId} (callId=${callId})`);

      } catch (err) {
        logger.error('[RandomCall] initiate error:', err);
        socket.emit('randomcall:error', { message: 'Something went wrong' });
      }
    });

    socket.on('randomcall:accept', async ({ callId } = {}) => {
      if (!user || !callId) return;
      const userId = String(user.id);
      const call = pendingRandomCalls.get(callId);

      if (!call || call.calleeId !== userId) {
        return socket.emit('randomcall:error', { message: 'Call not found or expired' });
      }

      // Clear timeout
      clearTimeout(call.timeout);

      try {
        // Build Element Call URL
        const elementCallUrl = process.env.ELEMENT_CALL_URL || 'https://call.pnptv.app';
        const callUrl = `${elementCallUrl}/#/room/${encodeURIComponent(call.matrixRoomId)}?skipLobby=true&hideHeader=true`;

        // Get peer info
        const callerRes = await query(
          `SELECT first_name, photo_url FROM users WHERE id = $1`, [call.callerId]
        );
        const calleeRes = await query(
          `SELECT first_name, photo_url FROM users WHERE id = $1`, [call.calleeId]
        );

        const callerInfo = {
          userId: call.callerId,
          name: callerRes.rows[0]?.first_name || 'User',
          photoUrl: callerRes.rows[0]?.photo_url || null,
        };
        const calleeInfo = {
          userId: call.calleeId,
          name: calleeRes.rows[0]?.first_name || 'User',
          photoUrl: calleeRes.rows[0]?.photo_url || null,
        };

        // Update call state (keep in map for end-call tracking, extend timeout to 1h)
        call.status = 'active';
        call.timeout = setTimeout(() => {
          pendingRandomCalls.delete(callId);
        }, 3600000);

        // Emit accepted to both
        io.to(`user:${call.callerId}`).emit('randomcall:accepted', {
          callId,
          callUrl,
          peer: calleeInfo,
          matrixRoomId: call.matrixRoomId,
        });
        io.to(`user:${call.calleeId}`).emit('randomcall:accepted', {
          callId,
          callUrl,
          peer: callerInfo,
          matrixRoomId: call.matrixRoomId,
        });

        logger.info(`[RandomCall] Accepted: ${call.callerId} ↔ ${call.calleeId} (callId=${callId})`);

      } catch (err) {
        logger.error('[RandomCall] accept error:', err);
        socket.emit('randomcall:error', { message: 'Failed to set up call' });
      }
    });

    socket.on('randomcall:decline', ({ callId } = {}) => {
      if (!user || !callId) return;
      const userId = String(user.id);
      const call = pendingRandomCalls.get(callId);

      if (!call || call.calleeId !== userId) return;

      clearTimeout(call.timeout);
      pendingRandomCalls.delete(callId);

      io.to(`user:${call.callerId}`).emit('randomcall:declined', { callId });
      logger.info(`[RandomCall] Declined by ${userId} (callId=${callId})`);
    });

    socket.on('randomcall:cancel', ({ callId } = {}) => {
      if (!user || !callId) return;
      const userId = String(user.id);
      const call = pendingRandomCalls.get(callId);

      if (!call || call.callerId !== userId) return;

      clearTimeout(call.timeout);
      pendingRandomCalls.delete(callId);

      io.to(`user:${call.calleeId}`).emit('randomcall:cancelled', { callId });
      logger.info(`[RandomCall] Cancelled by ${userId} (callId=${callId})`);
    });

    socket.on('randomcall:end', ({ callId } = {}) => {
      if (!user || !callId) return;
      const userId = String(user.id);
      const call = pendingRandomCalls.get(callId);

      if (!call) return;
      if (call.callerId !== userId && call.calleeId !== userId) return;

      clearTimeout(call.timeout);
      pendingRandomCalls.delete(callId);

      const otherUserId = call.callerId === userId ? call.calleeId : call.callerId;
      io.to(`user:${otherUserId}`).emit('randomcall:ended', { callId });
      logger.info(`[RandomCall] Ended by ${userId} (callId=${callId})`);
    });

    // ── Main Stage Events ────────────────────────────────────────────────────

    socket.on('mainstage:join', () => {
      socket.join('mainstage');
      logger.debug('Socket joined mainstage room', { socketId: socket.id, userId: user.id });
    });

    socket.on('mainstage:leave', () => {
      socket.leave('mainstage');
      logger.debug('Socket left mainstage room', { socketId: socket.id, userId: user.id });
    });

    socket.on('disconnect', async () => {
      logger.info(`Socket disconnected: user ${user.id}`);

      // Clean up any running FFmpeg browser-stream process
      if (socket.data.ffmpegProcess) {
        const ffmpeg = socket.data.ffmpegProcess;
        const channelRef = socket.data.streamChannelRef;
        try {
          if (ffmpeg.stdin && !ffmpeg.stdin.destroyed) ffmpeg.stdin.end();
          setTimeout(() => { if (!ffmpeg.killed) ffmpeg.kill('SIGKILL'); }, 3000);
          logger.info(`FFmpeg cleanup on disconnect: user ${user.id}, channel '${channelRef}'`);
        } catch (cleanupErr) {
          logger.warn('FFmpeg disconnect cleanup error', { channelRef, error: cleanupErr.message });
        }
        socket.data.ffmpegProcess = null;
        socket.data.streamChannelRef = null;
      }

      if (socket.data.liveRooms && socket.data.liveRooms.size > 0) {
        // H4: Atomic decrement clamped to 0 via Lua script.
        // SOCK-H1: Also delete the deduplication join key so that if the same
        // user reconnects (e.g., page refresh) their next join is counted fresh.
        const redis = getRedis();
        for (const streamId of socket.data.liveRooms) {
          try {
            const count = await atomicViewerDecrement(redis, streamId);
            await redis.del(`live:joined:${streamId}:${user.id}`);
            io.to(`live:${streamId}`).emit('live:viewer_count', { streamId, count });
          } catch (err) {
            logger.warn('live viewer count cleanup error on disconnect', { streamId, userId: user.id, error: err.message });
          }
        }
      }

      // SOCK-H3: Remove this socket from the user's presence entry.  Only purge
      // the user entirely (and broadcast absence) when the last socket closes.
      const presenceEntry = onlineUsersMap.get(user.id);
      if (presenceEntry) {
        presenceEntry.socketIds.delete(socket.id);
        if (presenceEntry.socketIds.size === 0) {
          // Last tab/connection closed — remove from presence and notify groups.
          // Snapshot the set before clearing to avoid mutating during iteration.
          const groupIds = [...presenceEntry.hangoutGroupIds];
          presenceEntry.hangoutGroupIds.clear();
          onlineUsersMap.delete(user.id);
          for (const gid of groupIds) {
            setImmediate(() => emitGroupPresence(io, gid));
          }
        }
      }
    });
  });
}

module.exports = { initSocketIO };
