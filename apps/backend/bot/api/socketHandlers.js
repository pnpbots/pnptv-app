'use strict';

const { spawn } = require('child_process');
const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');
const { getRedis } = require('../../config/redis');
const { processChatMedia } = require('../services/chatMediaService');
const NotificationEmitter = require('../services/notificationEmitter');
const LiveStreamModel = require('../../models/liveStreamModel');
const BlockedUser = require('../../models/blockedUser');
const DmService = require('../services/dmService');
const matrixService = require('../services/matrixService');

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
      // N5: Rate-limit grid joins to 10 per 60 seconds per user
      if (!rateLimit(`nearby:join-grid:${user.id}`, 10, 60000)) return;
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

    // ── Legacy community chat handlers removed — all messaging now via Matrix ──

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

        // Messages live in Matrix — frontend fetches via useRoomMessages() hook.
        // No PG history push needed.

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

        // Ensure this user is in the Matrix room for this hangout — fire-and-forget.
        // This is a best-effort sync: the authoritative membership change happens in
        // the REST joinGroup handler, but sockets may connect before that in edge cases
        // (e.g. the Matrix room was created after the user joined the PG group).
        matrixService.inviteToHangoutRoom(gid, {
          id:                  user.id,
          telegram:            user.telegram || String(user.id),
          username:            user.username || null,
          first_name:          user.firstName || user.first_name || null,
          matrix_user_id:      user.matrix_user_id      || null,
          matrix_access_token: user.matrix_access_token || null,
          matrix_device_id:    user.matrix_device_id    || null,
        }).catch((matrixErr) => {
          logger.debug(`[Matrix] hangout:join sync failed for user ${user.id} / group ${gid}: ${matrixErr.message}`);
        });
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

      if (!rateLimit(`hangout:${user.id}:${gid}`, 30, 60000)) {
        socket.emit('hangout:error', { message: 'Too many messages. Slow down.' });
        return;
      }

      const userRole = (user.role || '').toLowerCase();
      const isAdminUser = userRole === 'admin' || userRole === 'superadmin';
      if (!isAdminUser) {
        try {
          const EntitlementAccessService = require('../services/entitlementAccessService');
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

        // Slow mode check (in addition to existing rate limit)
        const slowMode = groupSettings[0]?.slow_mode_seconds || 0;
        if (slowMode > 0) {
          const memberRole = memberInfo[0].role;
          if (memberRole !== 'owner' && memberRole !== 'moderator') {
            if (!rateLimit(`hangout:slow:${user.id}:${gid}`, 1, slowMode * 1000)) {
              socket.emit('hangout:error', { message: `Slow mode: wait ${slowMode}s between messages`, code: 'SLOW_MODE' });
              return;
            }
          }
        }

        // N3: Block check — reject messages between mutually blocked users.
        // Fetch all other members of the group and check for any block relationship
        // between the sender and any member; a simpler and cheaper check is to
        // verify that the group owner or any admin has not blocked the sender.
        // We use the same bidirectional query pattern as hangout:invite.
        const { rows: hangoutBlockRows } = await query(
          `SELECT 1 FROM blocked_users bu
           JOIN hangout_group_members hgm
             ON hgm.group_id = $2
            AND (
                  (bu.user_id = $1 AND bu.blocked_user_id = hgm.user_id)
               OR (bu.user_id = hgm.user_id AND bu.blocked_user_id = $1)
            )
           LIMIT 1`,
          [user.id, gid]
        );
        if (hangoutBlockRows.length > 0) {
          socket.emit('hangout:error', { message: 'Cannot send message', code: 'BLOCKED' });
          return;
        }

        // ── Matrix-only send (no PG insert) ──
        const userRow = await query(
          `SELECT id, telegram, username, first_name, matrix_user_id, matrix_access_token
           FROM users WHERE id = $1 AND is_deleted = false`,
          [user.id]
        );
        if (!userRow.rows[0]) {
          socket.emit('hangout:error', { message: 'User not found' });
          return;
        }

        const userCreds = await matrixService.provisionMatrixUser(userRow.rows[0]);
        const groupRow = await query('SELECT name FROM hangout_groups WHERE id = $1', [gid]);
        const groupName = groupRow.rows[0]?.name || `Hangout ${gid}`;
        const matrixRoomId = await matrixService.getOrCreateHangoutRoom(gid, userRow.rows[0], groupName);
        await matrixService.ensureUserInRoom(matrixRoomId, userCreds);
        await matrixService.sendRoomMessage(matrixRoomId, userCreds.accessToken, content.trim());

        // Touch activity timestamp for 72h inactivity cleanup
        await query('UPDATE hangout_groups SET last_activity_at = NOW() WHERE id = $1', [gid]);

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
            const senderName = user.username || firstName || 'Someone';
            const preview = content.trim().length > 80 ? content.trim().slice(0, 77) + '...' : content.trim();

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

      // Rate limit: 1 read receipt per 5s per user per group
      if (!rateLimit(`hangout:read:${user.id}:${gid}`, 1, 5000)) return;

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

    // ── Hangout Call Screen Share (relay from Jitsi to group) ──────────────────

    socket.on('hangout:call:screenshare', async ({ groupId, sharing } = {}) => {
      if (!groupId || typeof sharing !== 'boolean') return;
      const gid = parseInt(groupId, 10);
      if (!Number.isFinite(gid)) return;

      // Rate limit: 5 per 30s per user
      if (!rateLimit(`hangout:screenshare:${user.id}:${gid}`, 5, 30000)) return;

      try {
        const { rows: memberRows } = await query(
          'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
          [gid, user.id]
        );
        if (memberRows.length === 0) return;

        // Broadcast to all in the hangout room
        io.to(`hangout:${gid}`).emit('hangout:call:screenshare', {
          userId: user.id,
          sharing,
        });
      } catch (err) {
        logger.error('hangout:call:screenshare error', { userId: user.id, groupId: gid, error: err.message });
      }
    });

    // ── Hangout Call Participants (snapshot on join/leave) ─────────────────────

    socket.on('hangout:call:request-participants', async ({ groupId } = {}) => {
      if (!groupId) return;
      const gid = parseInt(groupId, 10);
      if (!Number.isFinite(gid)) return;

      // Rate limit: 5 per 10s
      if (!rateLimit(`hangout:participants:${user.id}:${gid}`, 5, 10000)) return;

      try {
        const { rows: memberRows } = await query(
          'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
          [gid, user.id]
        );
        if (memberRows.length === 0) return;

        // Get active call participants from DB
        const { rows: participants } = await query(
          `SELECT cp.user_id AS "userId", u.first_name AS name, u.photo_url AS "photoUrl"
           FROM hangout_call_participants cp
           JOIN hangout_video_calls vc ON vc.id = cp.call_id
           JOIN users u ON u.id = cp.user_id
           WHERE vc.group_id = $1 AND vc.status = 'active' AND cp.left_at IS NULL`,
          [gid]
        );

        socket.emit('hangout:call:participants', { participants });
      } catch (err) {
        logger.error('hangout:call:request-participants error', { userId: user.id, groupId: gid, error: err.message });
      }
    });

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
      if (!rateLimit(`music:${user.id}:${gid}`, 10, 60000)) return;
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
      if (!rateLimit(`music-ended:${user.id}:${gid}`, 5, 10000)) return;
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
      if (!rateLimit(`music-shuffle:${user.id}:${gid}`, 5, 10000)) return;
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
      const EntitlementAccessService = require('./services/entitlementAccessService');
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

      if (!rateLimit(`dm:${user.id}`, 100, 3600000)) {
        socket.emit('dm:error', { message: 'Too many messages.' });
        return;
      }

      try {
        // ── Matrix-only send (no PG insert) ──
        const [senderRow, recipientRow] = await Promise.all([
          query(`SELECT id, telegram, username, first_name, matrix_user_id, matrix_access_token
                 FROM users WHERE id = $1 AND is_deleted = false`, [user.id]),
          query(`SELECT id, telegram, username, first_name, matrix_user_id, matrix_access_token
                 FROM users WHERE id = $1 AND is_deleted = false`, [recipientId]),
        ]);
        if (!senderRow.rows[0] || !recipientRow.rows[0]) {
          socket.emit('dm:error', { message: 'User not found' });
          return;
        }

        const senderCreds = await matrixService.provisionMatrixUser(senderRow.rows[0]);
        const matrixRoomId = await matrixService.getOrCreateDmRoom(senderRow.rows[0], recipientRow.rows[0]);
        await matrixService.ensureUserInRoom(matrixRoomId, senderCreds);
        await matrixService.sendRoomMessage(matrixRoomId, senderCreds.accessToken, content.trim());

        // Update dm_threads metadata (no message row)
        const [a, b] = [user.id, recipientId].sort();
        const preview = content.trim().slice(0, 100);
        await query(
          `INSERT INTO dm_threads (user_a, user_b, last_message_at, last_message, unread_for_a, unread_for_b)
           VALUES ($1, $2, NOW(), $3, $4, $5)
           ON CONFLICT (user_a, user_b) DO UPDATE SET
             last_message_at = NOW(),
             last_message = EXCLUDED.last_message,
             unread_for_a = CASE WHEN dm_threads.user_a = $6 THEN 0 ELSE dm_threads.unread_for_a + 1 END,
             unread_for_b = CASE WHEN dm_threads.user_b = $6 THEN 0 ELSE dm_threads.unread_for_b + 1 END`,
          [a, b, preview, user.id === a ? 0 : 1, user.id === b ? 0 : 1, user.id]
        );

        socket.emit('dm:sent', { success: true });
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

    // ── Live Stream Chat ──────────────────────────────────────────────────────

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
              const EntitlementAccessService = require('../services/entitlementAccessService');
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

      // SOCK-H5: Rate-limit leave events (max 10 per minute per user) to prevent
      // flooding that could artificially thrash the viewer-count counter.
      if (!rateLimit(`live:leave:${user.id}`, 10, 60000)) return;

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
      // Rate-limit: 1 raid per 5 minutes per user
      if (!rateLimit(`live:raid:${user.id}`, 1, 5 * 60 * 1000)) {
        socket.emit('live:error', { message: 'Raid on cooldown. Wait before raiding again.' });
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
      } catch (err) {
        logger.error('stream:start error', { userId: user.id, channelRef, err });
        socket.emit('stream:error', { message: 'Failed to start stream. Please try again.' });
      }
    });

    socket.on('stream:data', (data) => {
      // 30 chunks × 512 KB = ~15 MB/sec max throughput, which is more than
      // sufficient for a 6 Mbps H.264 stream with headroom.  The previous
      // limit of 300 chunks/sec (150 MB/sec) was excessively high and could
      // allow a single client to overwhelm the server's memory and I/O.
      if (!rateLimit(`stream:data:${user.id}`, 30, 1000)) {
        return;
      }
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
