'use strict';

const { spawn } = require('child_process');
const { query, getPool } = require('../../config/postgres');
const logger = require('../../utils/logger');
const { getRedis } = require('../../config/redis');
const { processChatMedia } = require('../../services/chatMediaService');
const NotificationEmitter = require('../../services/notificationEmitter');
const LiveStreamModel = require('../../models/liveStreamModel');
const DmService = require('../../services/dmService');
const streamAnalyticsService = require('../../services/streamAnalyticsService');
const streamRecordingService = require('../../services/streamRecordingService');

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
  await redis.expire(`live:viewers:${streamId}`, 28800);
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

// ── Socket-local entitlement cache ───────────────────────────────────────────
// Caches entitlement booleans on socket.data to avoid a DB hit on every message.
// TTL: 60s. On expiry the value is re-fetched from EntitlementAccessService.
const SOCKET_ENTITLEMENT_TTL_MS = 60 * 1000;

/**
 * Return a cached entitlement value for (socket, userId, key).
 * Re-fetches via EntitlementAccessService when the cache entry is absent or expired.
 *
 * @param {import('socket.io').Socket} socket
 * @param {string} userId
 * @param {string} entitlementKey  e.g. 'pnp-member'
 * @returns {Promise<boolean>}
 */
async function getCachedEntitlement(socket, userId, entitlementKey) {
  if (!socket.data.entitlementCache) socket.data.entitlementCache = {};
  const cached = socket.data.entitlementCache[entitlementKey];
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const EntitlementAccessService = require('../../services/entitlementAccessService');
  const value = await EntitlementAccessService.hasEntitlement(String(userId), entitlementKey);
  socket.data.entitlementCache[entitlementKey] = { value, expiresAt: Date.now() + SOCKET_ENTITLEMENT_TTL_MS };
  return value;
}

// ── Global online presence ────────────────────────────────────────────────────

// Track online users: userId → { name, photoUrl, hangoutGroupIds: Set<number>, socketIds: Set<string> }
// SOCK-H3: socketIds tracks every active socket for this user so that closing
// one tab (one socket) does not evict the user from the presence map while
// other tabs remain connected.
const onlineUsersMap = new Map();

// ── In-memory music state per hangout group ───────────────────────────────────
// Map<groupId, { trackId, trackUrl, trackTitle, trackArtist, trackArt, isPlaying, position, startedAt }>
const hangoutMusicState = new Map();

// ── Cristina-in-call state per hangout group ─────────────────────────────────
// Map<groupId, { callId, tipTimer, videoTimer, latestTip, latestVideo, askCooldownByUser: Map<uid, lastTs> }>
const hangoutCristinaState = new Map();
const CRISTINA_TIP_INTERVAL_MS = 10 * 60 * 1000; // 10 min
const CRISTINA_VIDEO_INTERVAL_MS = 25 * 60 * 1000; // 25 min
const CRISTINA_ASK_COOLDOWN_MS = 30 * 1000; // 30 s per user

function cristinaStopSession(gid) {
  const s = hangoutCristinaState.get(gid);
  if (!s) return;
  if (s._firstTipTimeout) clearTimeout(s._firstTipTimeout);
  if (s.tipTimer) clearInterval(s.tipTimer);
  if (s.videoTimer) clearInterval(s.videoTimer);
  hangoutCristinaState.delete(gid);
}

function cristinaStartSession(io, gid) {
  if (hangoutCristinaState.has(gid)) return hangoutCristinaState.get(gid);
  let CristinaFeed;
  try { CristinaFeed = require('../../services/cristinaFeedService'); }
  catch (e) { logger.warn('cristinaStartSession: service load failed', { error: e.message }); return null; }

  const state = {
    attachedAt: Date.now(),
    latestTip: null,
    latestVideo: null,
    askCooldownByUser: new Map(),
    tipTimer: null,
    videoTimer: null,
  };
  hangoutCristinaState.set(gid, state);

  const emitGreeting = async () => {
    io.to(`hangout:${gid}`).emit('hangout:cristina:joined', {
      groupId: gid,
      at: Date.now(),
      greeting: "Hi everyone, I'm Cristina — I'll drop in with wellness tips and video suggestions while you hang out. Ask me anything via the chip below.",
    });
  };
  emitGreeting().catch(() => {});

  // Auto-stop the session if the hangout room has been empty of sockets for
  // two consecutive ticks. Prevents Cristina timers from running forever on
  // orphaned groups after everyone leaves.
  const isRoomEmpty = () => {
    const room = io.sockets.adapter.rooms.get(`hangout:${gid}`);
    return !room || room.size === 0;
  };

  const tick = async () => {
    if (!hangoutCristinaState.has(gid)) return;
    if (isRoomEmpty()) {
      const s = hangoutCristinaState.get(gid);
      if (s) s._emptyTicks = (s._emptyTicks || 0) + 1;
      if (s && s._emptyTicks >= 2) { cristinaStopSession(gid); return; }
      return;
    } else {
      const s = hangoutCristinaState.get(gid);
      if (s) s._emptyTicks = 0;
    }
    try {
      const content = await CristinaFeed.generateCallWellnessTip();
      if (!content) return;
      const tip = { groupId: gid, content, at: Date.now() };
      const s = hangoutCristinaState.get(gid);
      if (s) s.latestTip = tip;
      io.to(`hangout:${gid}`).emit('hangout:cristina:tip', tip);
    } catch (err) { logger.warn('cristina tip tick error', { gid, error: err.message }); }
  };
  // First tip 60s after attach so the call settles first, then on interval.
  state._firstTipTimeout = setTimeout(tick, 60 * 1000);
  state.tipTimer = setInterval(tick, CRISTINA_TIP_INTERVAL_MS);

  const videoTick = async () => {
    if (!hangoutCristinaState.has(gid)) return;
    try {
      const suggestion = await CristinaFeed.pickCallVideoSuggestion();
      if (!suggestion) return;
      const s = hangoutCristinaState.get(gid);
      if (s) s.latestVideo = { ...suggestion, at: Date.now() };
      io.to(`hangout:${gid}`).emit('hangout:cristina:video', { groupId: gid, video: suggestion, at: Date.now() });
    } catch (err) { logger.warn('cristina video tick error', { gid, error: err.message }); }
  };
  state.videoTimer = setInterval(videoTick, CRISTINA_VIDEO_INTERVAL_MS);

  // Persist attach in DB (best-effort, non-fatal)
  (async () => {
    try {
      const { rows } = await query(
        `SELECT id FROM hangout_video_calls WHERE group_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
        [gid]
      );
      if (rows.length) {
        state.callId = rows[0].id;
        await query(
          `INSERT INTO hangout_call_cristina_sessions (call_id, group_id, attached_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (call_id) DO UPDATE SET attached_at = EXCLUDED.attached_at`,
          [state.callId, gid]
        );
      }
    } catch (err) { logger.warn('cristina attach persist failed', { gid, error: err.message }); }
  })();

  return state;
}

function emitGroupPresence(io, gid) {
  const online = [];
  for (const [uid, p] of onlineUsersMap) {
    if (p.hangoutGroupIds.has(gid)) {
      online.push({ userId: uid, name: p.name, photoUrl: p.photoUrl });
    }
  }
  io.to(`hangout:${gid}`).emit('hangout:presence', { groupId: gid, online });
}

// ── Main Stage service ────────────────────────────────────────────────────────
// Loaded lazily to avoid circular-require issues at module parse time.
let _mainStageService = null;
function getMainStageService() {
  if (!_mainStageService) {
    try {
      _mainStageService = require('../../services/mainStageService');
    } catch (e) {
      logger.error('socketHandlers: failed to load mainStageService', { error: e.message });
    }
  }
  return _mainStageService;
}

// ── Socket.IO initialisation ──────────────────────────────────────────────────

// HIGH-03: Ban-event subscriber — disconnect sockets immediately when a user is banned.
// Initialised once at module load (not per-connection). Uses a dedicated Redis connection
// because pub/sub mode locks a client to subscribe-only commands.
// The `io` reference is injected by initSocketIO; the subscriber is shared across all
// socket connections on this process.
let _banSubscriberReady = false;
function _initBanSubscriber(io) {
  if (_banSubscriberReady) return;
  _banSubscriberReady = true;
  try {
    const redisSub = getRedis().duplicate();
    redisSub.subscribe('user:banned', (err) => {
      if (err) {
        logger.error('socketHandlers: failed to subscribe to user:banned channel', { error: err.message });
      } else {
        logger.info('socketHandlers: subscribed to user:banned Redis channel');
      }
    });
    redisSub.on('message', (channel, message) => {
      if (channel !== 'user:banned') return;
      try {
        const { userId } = JSON.parse(message);
        if (!userId) return;
        // Iterate all connected sockets on this process and disconnect banned user.
        // Users are stored as socket.data.user (set in initSocketIO auth middleware).
        io.sockets.sockets.forEach((sock) => {
          if (sock.data && sock.data.user && String(sock.data.user.id) === String(userId)) {
            logger.info('socketHandlers: disconnecting banned user socket', { userId, socketId: sock.id });
            sock.emit('force:disconnect', { reason: 'banned' });
            sock.disconnect(true);
          }
        });
      } catch (parseErr) {
        logger.warn('socketHandlers: malformed user:banned message', { error: parseErr.message });
      }
    });
  } catch (subErr) {
    logger.error('socketHandlers: ban subscriber init failed', { error: subErr.message });
  }
}

function initSocketIO(io) {
  // Wire up the Main Stage service io reference so it can emit state broadcasts.
  // Called once at boot; safe to call even if mainStageService fails to load.
  const ms = getMainStageService();
  if (ms && typeof ms.setIo === 'function') {
    ms.setIo(io);
    logger.info('socketHandlers: mainStageService.setIo wired');
  }

  // HIGH-03: Start the ban-event subscriber once, passing the io instance
  _initBanSubscriber(io);
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
    const connectedAt = Date.now();
    logger.info('Socket connected', {
      userId: String(user.id),
      socketId: socket.id,
      transport: socket.conn?.transport?.name || null,
      userAgent: socket.handshake?.headers?.['user-agent'] || null,
      referer: socket.handshake?.headers?.referer || null,
    });

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

    // ── Main Stage — everyone auto-joins for state broadcasts ────────────────
    socket.join('mainstage');

    // Send the current state to the joining socket and tell everyone the
    // viewer count moved. Debounced inside the service so a connection burst
    // doesn't spam the room.
    const _ms = getMainStageService();
    if (_ms) {
      _ms.getState().then(state => {
        socket.emit('mainstage:state', state);
      }).catch(() => {});
      if (typeof _ms.notifyViewersChanged === 'function') _ms.notifyViewersChanged();
    }
    socket.once('disconnect', () => {
      const ms3 = getMainStageService();
      if (ms3 && typeof ms3.notifyViewersChanged === 'function') ms3.notifyViewersChanged();
    });

    // mainstage:join-cammer — called by cammers who want to publish video.
    // Main Stage is open to all authenticated users. Only the kicked-set
    // is enforced here; the slot reservation is addCammer (atomic + idempotent).
    socket.on('mainstage:join-cammer', async () => {
      const ms2 = getMainStageService();
      if (!ms2) return;

      // Kicked-set guard — kicked users may not rejoin via socket either.
      try {
        const isKicked = await getRedis().get(`mainstage:kicked:${String(user.id)}`);
        if (isKicked) {
          socket.emit('mainstage:error', {
            code: 'MAIN_STAGE_KICKED',
            message: 'You have been removed from Main Stage.',
          });
          return;
        }
      } catch (guardErr) {
        logger.error('mainstage:join-cammer guard error', { userId: user.id, error: guardErr.message });
        socket.emit('mainstage:error', { code: 'SERVER_ERROR', message: 'Failed to verify access. Please try again.' });
        return;
      }

      try {
        const result = await ms2.addCammer(String(user.id));
        if (result === 'full') {
          socket.emit('mainstage:error', {
            code: 'CAMMER_CAP_REACHED',
            message: `Cammer slots full (max ${ms2.MAX_CAMMERS})`,
          });
          return;
        }
        // Mark this socket as an active cammer so the disconnect handler knows
        // to remove them from the queue if their last socket closes.
        socket.data.isMainStageCammer = true;
        socket.emit('mainstage:cammer-joined', { identity: String(user.id) });
      } catch (err) {
        logger.error('mainstage:join-cammer error', { userId: user.id, error: err.message });
        socket.emit('mainstage:error', { code: 'SERVER_ERROR', message: 'Failed to join as cammer' });
      }
    });

    // mainstage:leave-cammer — client cleans up when they stop publishing
    socket.on('mainstage:leave-cammer', async () => {
      const ms2 = getMainStageService();
      if (!ms2) return;
      try {
        logger.info('[MainStageDiag] leave-cammer requested', {
          userId: String(user.id),
          socketId: socket.id,
        });
        await ms2.removeCammer(String(user.id));
      } catch (err) {
        logger.warn('mainstage:leave-cammer error', { userId: user.id, error: err.message });
      }
    });

    socket.on('mainstage:client-lifecycle', (payload = {}) => {
      const event = payload && typeof payload.event === 'string' ? payload.event : 'unknown';
      const extra = {};
      // Capture event-specific diagnostic fields so they show up in logs.
      if (payload.disconnectReasonName !== undefined) extra.disconnectReasonName = payload.disconnectReasonName;
      if (payload.disconnectReason !== undefined) extra.disconnectReason = payload.disconnectReason;
      if (payload.nextState !== undefined) extra.nextState = payload.nextState;
      if (typeof payload.persisted === 'boolean') extra.persisted = payload.persisted;
      if (typeof payload.tokenRole === 'string') extra.tokenRole = payload.tokenRole;
      logger.info('[MainStageDiag] client lifecycle', {
        userId: String(user.id),
        socketId: socket.id,
        event,
        role: typeof payload.role === 'string' ? payload.role : null,
        reason: typeof payload.reason === 'string' ? payload.reason : null,
        livekitState: typeof payload.livekitState === 'string' ? payload.livekitState : null,
        roomName: typeof payload.roomName === 'string' ? payload.roomName : null,
        sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : null,
        visibilityState: typeof payload.visibilityState === 'string' ? payload.visibilityState : null,
        pathname: typeof payload.pathname === 'string' ? payload.pathname : null,
        ...extra,
      });
    });
    // ── End Main Stage socket handlers ───────────────────────────────────────

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

    // ── Redis presence: mark online + notify DM partners ─────────────────────
    try { await DmService.setOnline(user.id); } catch (_) {}
    setImmediate(async () => {
      try {
        const { rows: dmPartnerRows } = await query(
          `SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS partner_id
           FROM dm_threads WHERE user_a = $1 OR user_b = $1
           ORDER BY last_message_at DESC LIMIT 50`,
          [user.id]
        );
        for (const r of dmPartnerRows) {
          io.to(`user:${r.partner_id}`).emit('presence:update', {
            userId: String(user.id),
            online: true,
            lastSeen: null,
          });
        }
      } catch (_) {}
    });

    // Heartbeat: client sends this every ~30s to keep the Redis TTL alive
    socket.on('presence:heartbeat', async () => {
      if (!user || !user.id) return;
      try { await DmService.refreshOnline(user.id); } catch (_) {}
    });

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

        // Emit active call if one exists so the joining client can show the call UI
        try {
          const { rows: activeCallRows } = await query(
            `SELECT id, group_id, room_name, creator_id, status, created_at
               FROM hangout_video_calls WHERE group_id=$1 AND status='active' LIMIT 1`,
            [gid]
          );
          if (activeCallRows.length > 0) {
            const ac = activeCallRows[0];
            const { rows: pRows } = await query(
              `SELECT COUNT(*)::int AS count FROM hangout_call_participants WHERE call_id=$1 AND left_at IS NULL`,
              [ac.id]
            );
            socket.emit('hangout:call:active', {
              callId: String(ac.id),
              roomName: ac.room_name,
              participantCount: pRows[0]?.count || 0,
              createdAt: ac.created_at,
            });
          }
        } catch (callCheckErr) {
          logger.warn('hangout:join active-call check failed', { gid, error: callCheckErr.message });
        }
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
          const hasAccess = await getCachedEntitlement(socket, user.id, 'pnp-member');
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
        // Sliding-window rate limit: max 5 messages per 10s per user per group
        {
          const rlRedis = getRedis();
          const rlKey = `rl:hangout:msg:${user.id}:${gid}`;
          const current = await rlRedis.incr(rlKey);
          if (current === 1) await rlRedis.expire(rlKey, 10);
          if (current > 5) {
            socket.emit('hangout:message:error', { error: 'rate_limited', message: 'Slow down — max 5 messages per 10s' });
            return;
          }
        }

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

        // ── Webapp → Telegram bridge: forward BEFORE broadcast so telegramMsgId is in the emitted payload ──
        let telegramMsgId = null;
        try {
          const { rows: tgRows } = await query(
            'SELECT telegram_chat_id FROM hangout_groups WHERE id = $1 AND telegram_chat_id IS NOT NULL',
            [gid]
          );
          if (tgRows.length > 0) {
            const tgChatId = tgRows[0].telegram_chat_id;
            const { getBotInstance } = require('../core/bot');
            const bot = getBotInstance();
            if (bot) {
              const senderName = user.firstName || user.first_name || user.username || 'User';
              const tgResult = await bot.telegram.sendMessage(tgChatId, `${senderName}: ${text}`, { parse_mode: undefined });
              if (tgResult?.message_id) {
                telegramMsgId = tgResult.message_id;
                await query(
                  `UPDATE chat_messages SET media_metadata = COALESCE(media_metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
                  [JSON.stringify({ source: 'webapp', telegramMsgId: tgResult.message_id, telegramChatId: String(tgChatId) }), msg.id]
                );
                // Patch the in-memory msg so broadcast includes telegramMsgId
                if (!msg.media_metadata) msg.media_metadata = {};
                msg.media_metadata.telegramMsgId = tgResult.message_id;
                msg.media_metadata.telegramChatId = String(tgChatId);
              }
            }
          }
        } catch (bridgeErr) {
          // Never block local chat on Telegram issues — log and continue
          logger.warn('[App→TG Bridge] socket text forward failed', { error: bridgeErr.message, groupId: gid });
        }

        // Broadcast to all users in the hangout room (telegramMsgId included when available)
        io.to(room).emit('chat:message', msg);

        // Auto-drop feed-worthy messages to the hangout feed (non-blocking)
        setImmediate(() => {
          const SocialPostService = require('../../services/socialPostService');
          SocialPostService.autoDropToFeed(msg, gid, io).catch(() => {});
        });

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

      // Rate limit: 1 typing event per 2s per user per group — silently drop if over-limit
      const redisTyping = getRedis();
      if (redisTyping) {
        try {
          const rlTypingKey = `ratelimit:hangout:typing:${user.id}:${gid}`;
          const exists = await redisTyping.set(rlTypingKey, '1', 'PX', 2000, 'NX');
          if (!exists) return; // already typed recently — drop
        } catch (_) { /* non-fatal */ }
      }

      // Verify membership before broadcasting typing indicator
      try {
        const { rows: typingMemberRows } = await query(
          'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND (is_banned=false OR is_banned IS NULL)',
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
        // Verify membership + ban status
        const { rows: memberRows } = await query(
          'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND (is_banned=false OR is_banned IS NULL)',
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

        if (deleteForAll && !isOwnMessage) {
          query(
            `INSERT INTO hangout_moderation_audit (group_id, actor_id, target_id, action, metadata)
             VALUES ($1, $2, $3, 'delete_message', $4)`,
            [gid, String(user.id), msg.user_id != null ? String(msg.user_id) : null, JSON.stringify({ messageId: msgId })]
          ).catch((auditErr) => logger.warn('auditModeration failed (socket)', { gid, auditErr: auditErr.message }));
        }

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

      // Rate limit: 10 reactions per 5s per user per message
      const redis = getRedis();
      if (redis) {
        try {
          const rlKey = `ratelimit:hangout:reaction:${user.id}:${msgId}`;
          const now = Date.now();
          const windowMs = 5000;
          const [, , count] = await redis.multi()
            .zadd(rlKey, now, `${now}`)
            .zremrangebyscore(rlKey, '-inf', now - windowMs)
            .zcard(rlKey)
            .expire(rlKey, 10)
            .exec();
          if (Array.isArray(count) ? count[1] > 10 : count > 10) {
            socket.emit('hangout:error', { message: 'You are reacting too fast', code: 'RATE_LIMITED' });
            return;
          }
        } catch (_) { /* non-fatal — proceed if Redis fails */ }
      }

      const pool = getPool ? getPool() : null;
      const client = pool ? await pool.connect() : null;
      try {
        if (!client) throw new Error('DB pool unavailable');

        // Membership + ban check
        const { rows: memberRows } = await client.query(
          'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND (is_banned=false OR is_banned IS NULL)',
          [gid, user.id]
        );
        if (memberRows.length === 0) return;

        const { rows: msgRows } = await client.query(
          `SELECT id FROM chat_messages WHERE id=$1 AND room='hangout:'||$2 AND is_deleted=false`,
          [msgId, gid]
        );
        if (msgRows.length === 0) return;

        // Atomic toggle inside a transaction with row-level lock
        await client.query('BEGIN');
        const { rows: existingRows } = await client.query(
          `SELECT id, user_id, emoji FROM chat_message_reactions WHERE message_id=$1 FOR UPDATE`,
          [msgId]
        );
        const myRow = existingRows.find(r => String(r.user_id) === String(user.id) && r.emoji === emojiStr);
        if (myRow) {
          await client.query(`DELETE FROM chat_message_reactions WHERE id=$1`, [myRow.id]);
        } else {
          const uniqueEmojis = new Set(existingRows.map(r => r.emoji));
          if (!uniqueEmojis.has(emojiStr) && uniqueEmojis.size >= 20) {
            await client.query('ROLLBACK');
            socket.emit('hangout:error', { message: 'Maximum emoji reactions reached for this message', code: 'REACTION_LIMIT' });
            return;
          }
          await client.query(
            `INSERT INTO chat_message_reactions (message_id, user_id, emoji) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
            [msgId, String(user.id), emojiStr]
          );
        }
        const { rows: aggRows } = await client.query(
          `SELECT emoji, COUNT(*)::int AS count, array_agg(user_id ORDER BY user_id) AS users
           FROM chat_message_reactions WHERE message_id=$1 GROUP BY emoji ORDER BY count DESC, emoji`,
          [msgId]
        );
        await client.query('COMMIT');

        const reactions = aggRows.map((r) => ({
          emoji: r.emoji,
          count: r.count,
          users: Array.isArray(r.users) ? r.users.map(String) : [],
        }));

        io.to(`hangout:${gid}`).emit('hangout:reaction:updated', { messageId: msgId, reactions });

        // ── Webapp → Telegram reaction bridge (fire-and-forget, up to top 3 emojis) ──
        setImmediate(async () => {
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
            const tgReaction = reactions.slice(0, 3).map(r => ({ type: 'emoji', emoji: r.emoji }));
            await bot.telegram.callApi('setMessageReaction', {
              chat_id: meta.telegramChatId,
              message_id: meta.telegramMsgId,
              reaction: tgReaction,
              is_big: false,
            });
          } catch (rxnBridgeErr) {
            logger.warn('[App→TG Bridge] reaction sync failed', { error: rxnBridgeErr.message, messageId: msgId });
          }
        });
      } catch (err) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        logger.error('hangout:reaction:toggle error', { userId: user.id, groupId: gid, messageId: msgId, error: err.message });
      } finally {
        if (client) client.release();
      }
    });

    // ── Hangout Read Receipt (per-message) ────────────────────────────────────

    socket.on('hangout:read:message', async ({ groupId, messageId } = {}) => {
      if (!groupId || !messageId) return;
      const gid   = parseInt(groupId,  10);
      const msgId = parseInt(messageId, 10);
      if (!Number.isFinite(gid) || !Number.isFinite(msgId)) return;

      try {
        // Membership + ban check before any update or broadcast
        const { rows: memberRows } = await query(
          'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND (is_banned=false OR is_banned IS NULL)',
          [gid, user.id]
        );
        if (memberRows.length === 0) return;

        const { rowCount } = await query(
          `UPDATE hangout_group_members
           SET last_read_message_id = GREATEST(COALESCE(last_read_message_id, 0), $1)
           WHERE group_id=$2 AND user_id=$3`,
          [msgId, gid, user.id]
        );

        // Only broadcast if the UPDATE actually matched a row
        if (rowCount > 0) {
          socket.to(`hangout:${gid}`).emit('hangout:read:update', {
            userId:            user.id,
            lastReadMessageId: msgId,
          });
        }
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
      // Validate trackUrl: must be https:// only (blocks SSRF and javascript: injection)
      const urlStr = String(trackUrl);
      if (!urlStr.startsWith('https://')) {
        socket.emit('hangout:error', { message: 'Invalid track URL', code: 'INVALID_TRACK_URL' });
        return;
      }
      try {
        const isMod = await isHangoutMod(user.id, gid);
        if (!isMod) { socket.emit('hangout:error', { message: 'Not a moderator', code: 'NOT_MOD' }); return; }
        const existingShuffle = hangoutMusicState.get(gid)?.shuffle || false;
        const state = {
          trackId: String(trackId),
          trackUrl: urlStr.slice(0, 500),
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

    // ── Cristina-in-call handlers ────────────────────────────────────────────

    // Anyone in the hangout room can (re-)attach Cristina. The call lifecycle
    // is what matters — startCall/endCall also attach/detach server-side.
    socket.on('hangout:cristina:attach', async ({ groupId } = {}) => {
      if (!groupId) return;
      const gid = parseInt(groupId, 10);
      if (!Number.isFinite(gid)) return;
      try {
        const member = await query(
          `SELECT 1 FROM hangout_group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
          [gid, user.id]
        );
        if (!member.rows.length) return;
        cristinaStartSession(io, gid);
        const s = hangoutCristinaState.get(gid);
        if (s?.latestTip) socket.emit('hangout:cristina:tip', s.latestTip);
        if (s?.latestVideo) socket.emit('hangout:cristina:video', { groupId: gid, video: s.latestVideo, at: s.latestVideo.at });
      } catch (err) { logger.error('hangout:cristina:attach error', err); }
    });

    // User asks Cristina a question during the call. Rate-limited per user.
    socket.on('hangout:cristina:ask', async ({ groupId, prompt } = {}) => {
      if (!groupId || typeof prompt !== 'string') return;
      const gid = parseInt(groupId, 10);
      if (!Number.isFinite(gid)) return;
      const cleanPrompt = prompt.trim();
      if (cleanPrompt.length < 2 || cleanPrompt.length > 400) {
        socket.emit('hangout:cristina:error', { message: 'Ask must be 2–400 characters.' });
        return;
      }
      try {
        const s = cristinaStartSession(io, gid);
        if (!s) return;
        const now = Date.now();
        const last = s.askCooldownByUser.get(user.id) || 0;
        if (now - last < CRISTINA_ASK_COOLDOWN_MS) {
          const waitSec = Math.ceil((CRISTINA_ASK_COOLDOWN_MS - (now - last)) / 1000);
          socket.emit('hangout:cristina:error', { message: `Slow down — wait ${waitSec}s before asking again.` });
          return;
        }
        s.askCooldownByUser.set(user.id, now);

        const CristinaFeed = require('../../services/cristinaFeedService');
        const reply = await CristinaFeed.generateCallReply({
          prompt: cleanPrompt,
          userName: user.firstName || user.username || 'friend',
        });
        if (!reply) {
          socket.emit('hangout:cristina:error', { message: "I couldn't come up with a reply — try again?" });
          return;
        }
        const payload = {
          groupId: gid,
          userId: user.id,
          userName: user.firstName || user.username || 'Anonymous',
          prompt: cleanPrompt,
          reply,
          at: Date.now(),
        };
        io.to(`hangout:${gid}`).emit('hangout:cristina:reply', payload);
        query(
          `UPDATE hangout_call_cristina_sessions SET ask_count = ask_count + 1 WHERE group_id = $1`,
          [gid]
        ).catch(() => {});
      } catch (err) {
        logger.error('hangout:cristina:ask error', err);
        socket.emit('hangout:cristina:error', { message: 'Cristina is unavailable right now.' });
      }
    });

    // Moderator plays a video (from Cristina's suggestion OR any URL) to
    // everyone in the hangout. Reuses the music-bar infrastructure pattern.
    socket.on('hangout:cristina:videoPlay', async ({ groupId, video } = {}) => {
      if (!groupId || !video || typeof video.url !== 'string') return;
      const gid = parseInt(groupId, 10);
      if (!Number.isFinite(gid)) return;
      try {
        const isMod = await isHangoutMod(user.id, gid);
        if (!isMod) { socket.emit('hangout:error', { message: 'Not a moderator', code: 'NOT_MOD' }); return; }
        const state = {
          id: String(video.id || `ext-${Date.now()}`).slice(0, 64),
          url: String(video.url).slice(0, 1000),
          title: String(video.title || 'Video').slice(0, 200),
          thumbUrl: video.thumbUrl ? String(video.thumbUrl).slice(0, 500) : null,
          startedAt: Date.now(),
          startedBy: user.firstName || user.username || 'Moderator',
        };
        io.to(`hangout:${gid}`).emit('hangout:cristina:videoState', state);
      } catch (err) { logger.error('hangout:cristina:videoPlay error', err); }
    });

    socket.on('hangout:cristina:videoStop', async ({ groupId } = {}) => {
      if (!groupId) return;
      const gid = parseInt(groupId, 10);
      if (!Number.isFinite(gid)) return;
      try {
        const isMod = await isHangoutMod(user.id, gid);
        if (!isMod) return;
        io.to(`hangout:${gid}`).emit('hangout:cristina:videoState', null);
      } catch (err) { logger.error('hangout:cristina:videoStop error', err); }
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

    socket.on('dm:send', async ({ recipientId, content, replyToId } = {}) => {
      if (!recipientId || !content || !content.trim()) return;
      if (content.length > 4000) { socket.emit('dm:error', { error: 'Message too long' }); return; }
      if (recipientId === user.id) return;

      try {
        // ── PG insert via DmService (handles blocks, privacy, thread upsert, push) ──
        const isAdmin = user.role === 'admin' || user.role === 'superadmin';
        const message = await DmService.sendMessage(
          user.id,
          recipientId,
          { content: content.trim(), replyToId: replyToId ? Number(replyToId) : null },
          { isAdmin }
        );

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
        const isAdminSocket = user.role === 'admin' || user.role === 'superadmin';
        if (!isAdminSocket && String(msg.sender_id) !== String(user.id)) {
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
        //
        // NOTE (HIGH-04): Subscription/ticket enforcement below applies ONLY to streams
        // that have a corresponding live_streams DB row (dbStream !== null). Streams
        // identified by a Restreamer channel slug or a Directus performer ID that have
        // no live_streams row are not covered by this gate. All monetized shows should
        // have a live_streams row created before going live.
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

        // CRIT-01: Ticket gate — if the stream is ticketed, the viewer must hold
        // a live_show_tickets row for this slot. Hosts and admins bypass the check.
        // Streams without a live_streams row (Restreamer/Directus-only) are not
        // covered here — see HIGH-04 note above.
        if (dbStream && dbStream.is_ticketed) {
          const userRole = (user.role || '').toLowerCase();
          const isAdminUser = userRole === 'admin' || userRole === 'superadmin';
          if (!isAdminUser && String(user.id) !== String(dbStream.host_id)) {
            try {
              const { rows: ticketRows } = await query(
                'SELECT 1 FROM live_show_tickets WHERE slot_id = $1 AND user_id = $2 LIMIT 1',
                [streamId, String(user.id)]
              );
              if (ticketRows.length === 0) {
                socket.emit('live:error', { message: 'A ticket is required to view this stream', code: 'ACCESS_DENIED', reason: 'ticket_required' });
                return;
              }
            } catch (ticketErr) {
              logger.error('live:join ticket check failed', { streamId, userId: user.id, error: ticketErr.message });
              socket.emit('live:error', { message: 'Ticket check unavailable. Please try again.', code: 'ACCESS_CHECK_FAILED' });
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
        // once in the viewer total.  SET NX with an 8-hour TTL acts as the gate;
        // if the key already exists the increment is skipped, but the TTL is
        // still refreshed so long-running streams never reset to 0 at hour 1.
        const joinKey = `live:joined:${streamId}:${user.id}`;
        const firstJoin = await redis.set(joinKey, '1', 'EX', 28800, 'NX');
        if (firstJoin === 'OK') {
          await redis.incr(`live:viewers:${streamId}`);
        } else {
          // Reconnect path: slide the dedup window forward so it doesn't expire
          // mid-stream and accidentally double-count on the next reconnect.
          await redis.expire(joinKey, 28800);
        }
        // Always refresh the viewer-count key TTL — keeps long streams alive.
        await redis.expire(`live:viewers:${streamId}`, 28800);
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

      // SOCK-L3: Per-user sliding-window rate limit — max 5 messages per 10 s.
      // Checked before content validation so the limit fires even on empty/long
      // payloads, preventing a client from burning through rate budget for free.
      try {
        const redis = getRedis();
        const rateKey = `live:chat:rate:${streamId}:${user.id}`;
        const count = await redis.incr(rateKey);
        if (count === 1) {
          await redis.expire(rateKey, 10);
        }
        if (count > 5) {
          socket.emit('live:error', { code: 'rate_limited', message: 'Slow down — max 5 messages per 10 seconds' });
          return;
        }
      } catch (rateErr) {
        // LOW-01: Deliberate fail-open on Redis outage.
        // Tradeoff: during a Redis failure, rate-limiting is bypassed and spam
        // is possible. The alternative — dropping all chat messages — is a worse
        // user experience for the majority of legitimate users. Redis outages are
        // rare and short-lived on this stack. Acceptable risk: prefer availability
        // over throttling enforcement during infrastructure incidents.
        logger.warn('live:message rate-limit check failed (Redis error)', { streamId, userId: user.id, error: rateErr.message });
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

      // Chat ban/mute check — streamId doubles as channel_ref for these streams
      try {
        const { rows: banRows } = await query(
          `SELECT action, mute_until FROM stream_chat_bans
            WHERE channel_ref = $1 AND banned_user_id = $2
              AND (mute_until IS NULL OR mute_until > NOW())`,
          [String(streamId), String(user.id)]
        );
        if (banRows.length > 0) {
          const ban = banRows[0];
          const banMsg = ban.action === 'mute'
            ? 'You are muted in this stream'
            : 'You are banned from this stream chat';
          socket.emit('live:error', { code: 'CHAT_BANNED', message: banMsg });
          return;
        }
      } catch (banCheckErr) {
        // Fail-open: Redis rate-limit is still in place; ban-check DB failure
        // should not silence all chat during an outage.
        logger.warn('live:message ban check failed (non-fatal)', { streamId, userId: user.id, error: banCheckErr.message });
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

    // ── Live Chat Moderation ─────────────────────────────────────────────────
    // Only the stream owner can ban or mute viewers from chat.
    // data: { targetUserId, channelRef, action: 'ban'|'mute'|'unban', durationMinutes? }
    socket.on('live:mod_action', async (data) => {
      const { targetUserId, channelRef, action, durationMinutes } = data || {};

      if (!targetUserId || !channelRef || !action) {
        socket.emit('live:error', { code: 'MOD_INVALID', message: 'targetUserId, channelRef, and action are required' });
        return;
      }
      if (!['ban', 'mute', 'unban'].includes(action)) {
        socket.emit('live:error', { code: 'MOD_INVALID', message: 'action must be ban, mute, or unban' });
        return;
      }
      if (!/^[a-zA-Z0-9-]+$/.test(String(channelRef))) {
        socket.emit('live:error', { code: 'MOD_INVALID', message: 'Invalid channelRef' });
        return;
      }

      try {
        // Verify the socket user is the owner of this channel
        const { rows: ownerRows } = await query(
          'SELECT live_channel, role FROM users WHERE id = $1',
          [String(user.id)]
        );
        const ownerUser = ownerRows[0];
        const isAdmin = ownerUser?.role === 'admin' || ownerUser?.role === 'superadmin';
        if (!isAdmin && ownerUser?.live_channel !== String(channelRef)) {
          socket.emit('live:error', { code: 'MOD_FORBIDDEN', message: 'You do not own this channel' });
          return;
        }

        // Prevent self-moderation
        if (String(targetUserId) === String(user.id)) {
          socket.emit('live:error', { code: 'MOD_INVALID', message: 'Cannot moderate yourself' });
          return;
        }

        if (action === 'unban') {
          await query(
            'DELETE FROM stream_chat_bans WHERE channel_ref = $1 AND banned_user_id = $2',
            [String(channelRef), String(targetUserId)]
          );
          socket.emit('live:mod_applied', { channelRef, targetUserId, action: 'unban' });
          logger.info('live:mod_action unban', { channelRef, targetUserId, byUserId: user.id });
          return;
        }

        let muteUntil = null;
        if (action === 'mute') {
          const minutes = parseInt(durationMinutes, 10);
          muteUntil = Number.isInteger(minutes) && minutes > 0
            ? new Date(Date.now() + minutes * 60 * 1000)
            : null; // null = permanent mute (treated like ban from chat)
        }

        await query(
          `INSERT INTO stream_chat_bans (channel_ref, banned_user_id, banned_by_user_id, action, mute_until)
               VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (channel_ref, banned_user_id)
           DO UPDATE SET action = EXCLUDED.action,
                         mute_until = EXCLUDED.mute_until,
                         banned_by_user_id = EXCLUDED.banned_by_user_id,
                         created_at = NOW()`,
          [String(channelRef), String(targetUserId), String(user.id), action, muteUntil]
        );

        // Notify the moderated user
        try {
          io.to(`user:${targetUserId}`).emit('live:mod_applied', {
            channelRef,
            action,
            muteUntil: muteUntil ? muteUntil.toISOString() : null,
            message: action === 'mute'
              ? `You have been muted in this stream${muteUntil ? ` until ${muteUntil.toUTCString()}` : ''}`
              : 'You have been banned from this stream chat',
          });
        } catch (emitErr) {
          logger.warn('live:mod_action: failed to notify target user', { targetUserId, error: emitErr.message });
        }

        // Confirm to the moderator
        socket.emit('live:mod_applied', { channelRef, targetUserId, action, muteUntil: muteUntil ? muteUntil.toISOString() : null });
        logger.info('live:mod_action applied', { channelRef, targetUserId, action, byUserId: user.id });
      } catch (err) {
        logger.error('live:mod_action error', { error: err.message, channelRef, targetUserId });
        socket.emit('live:error', { code: 'MOD_ERROR', message: 'Failed to apply moderation action' });
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

    socket.on('stream:start', async ({ channelRef, videoBitrate, audioBitrate, fps, title, description, tags, thumbnailDataUrl, thumbnailUrl } = {}) => {
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

            // Analytics: close session on unexpected FFmpeg exit
            if (socket.data.viewerSamplerInterval) {
              clearInterval(socket.data.viewerSamplerInterval);
              socket.data.viewerSamplerInterval = null;
            }
            const sid = socket.data.analyticsSessionId;
            if (sid) {
              socket.data.analyticsSessionId = null;
              const redis = getRedis();
              const endFn = async () => {
                const countRaw = redis ? await redis.get(`live:viewers:${channelRef}`).catch(() => null) : null;
                const peakViewers = parseInt(countRaw, 10) || 0;
                await streamAnalyticsService.endSession(sid, { peakViewers });
              };
              endFn().catch(e => logger.warn('streamAnalytics: endSession(ffmpeg close) error', { sid, error: e.message }));
            }
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
            // Prefer persistent thumbnailUrl (stored in DB via /api/webapp/live/thumbnail);
            // fall back to one-time thumbnailDataUrl for backward compatibility.
            const thumbToStore = (typeof thumbnailUrl === 'string' && thumbnailUrl.startsWith('/'))
              ? thumbnailUrl
              : (
                typeof thumbnailDataUrl === 'string' &&
                thumbnailDataUrl.startsWith('data:image/jpeg;base64,') &&
                thumbnailDataUrl.length < 200 * 1024
                  ? thumbnailDataUrl
                  : null
              );
            if (thumbToStore) {
              await redis.set(`stream:thumb:${channelRef}`, thumbToStore, 'EX', 43200);
            }
          }
        } catch (metaErr) {
          logger.warn('stream:start: failed to store metadata in Redis (non-fatal)', { channelRef, error: metaErr.message });
        }

        // SOCK-H4: Do not send rtmpTarget to the client — it exposes the internal
        // RTMP server address and stream key which are server-side concerns only.
        socket.emit('stream:started', { channelRef });

        // Analytics: open a session row and start a 30-second viewer sampler.
        setImmediate(async () => {
          try {
            const sessionId = await streamAnalyticsService.startSession(user.id, channelRef);
            socket.data.analyticsSessionId = sessionId;

            const redis = getRedis();
            socket.data.viewerSamplerInterval = setInterval(async () => {
              try {
                const sid = socket.data.analyticsSessionId;
                if (!sid) return;
                const countRaw = redis ? await redis.get(`live:viewers:${channelRef}`) : null;
                const count = parseInt(countRaw, 10) || 0;
                await streamAnalyticsService.sampleViewers(sid, count);
              } catch (sampleErr) {
                logger.warn('streamAnalytics: sampleViewers error', { error: sampleErr.message });
              }
            }, 30_000);

            // VOD recording: start capturing HLS to disk (non-blocking, non-fatal)
            try {
              const recordingId = await streamRecordingService.startRecording({
                sessionId,
                creatorId: user.id,
                channelRef,
              });
              socket.data.recordingId = recordingId;
              logger.info('streamRecording: attached to session', { recordingId, sessionId });
            } catch (recErr) {
              logger.warn('streamRecording: startRecording failed (non-fatal)', { userId: user.id, channelRef, error: recErr.message });
            }
          } catch (analyticsErr) {
            logger.warn('streamAnalytics: startSession error (non-fatal)', { userId: user.id, channelRef, error: analyticsErr.message });
          }
        });

        // Going-Live broadcast: fan-out Telegram DM + push to opted-in followers.
        // Runs in background (setImmediate) so it never blocks the stream-start path.
        setImmediate(() => {
          const { getBotInstance } = require('../core/bot');
          const { broadcastGoingLive } = require('../../services/goingLiveBroadcastService');
          const bot = getBotInstance();
          broadcastGoingLive(bot, user.id, channelRef).catch((err) => {
            logger.error('goingLiveBroadcast: unhandled rejection', { userId: user.id, channelRef, error: err.message });
          });
        });

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

    // ── Gap 3: Bitrate/FPS telemetry samples ────────────────────────────────
    // Rate-limited: ignore if a sample was already stored in the last 3 seconds.
    socket.on('stream:metrics', async ({ sessionId, kbps, fps, dropped, rtt } = {}) => {
      if (!socket.data.streamChannelRef) return; // must be live

      const now = Date.now();
      const lastSample = socket.data.lastMetricsSample || 0;
      if (now - lastSample < 3000) return; // rate-limit: 3 s per session
      socket.data.lastMetricsSample = now;

      // Basic validation — all fields optional but must be numbers when present
      const safeKbps    = Number.isFinite(Number(kbps))    ? Math.max(0, Math.round(Number(kbps)))    : null;
      const safeFps     = Number.isFinite(Number(fps))      ? Math.max(0, Number(fps))                 : null;
      const safeDropped = Number.isFinite(Number(dropped))  ? Math.max(0, Math.round(Number(dropped))) : null;
      const safeRtt     = Number.isFinite(Number(rtt))      ? Math.max(0, Math.round(Number(rtt)))     : null;
      const safeSession = typeof sessionId === 'string' ? sessionId.slice(0, 128) : String(socket.data.analyticsSessionId || '');

      if (!safeSession) return;

      try {
        await query(
          `INSERT INTO stream_metrics_samples (session_id, user_id, kbps, fps, dropped_frames, rtt_ms)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [safeSession, String(user.id), safeKbps, safeFps, safeDropped, safeRtt]
        );
      } catch (err) {
        logger.warn('stream:metrics insert error', { userId: user.id, err: err.message });
      }
    });

    socket.on('stream:stop', async () => {
      // Mark explicit stop so disconnect handler won't send the "went offline" DM
      const channelRefForStop = socket.data.streamChannelRef;
      if (channelRefForStop) {
        const redis = getRedis();
        redis.set(`pnp:live:offline-alert:${user.id}`, '1', 'NX', 'EX', 60).catch(() => {});
      }

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

        // Analytics: close session
        if (socket.data.viewerSamplerInterval) {
          clearInterval(socket.data.viewerSamplerInterval);
          socket.data.viewerSamplerInterval = null;
        }
        const sid = socket.data.analyticsSessionId;
        if (sid) {
          socket.data.analyticsSessionId = null;
          const redis = getRedis();
          const countRaw = redis ? await redis.get(`live:viewers:${channelRef}`).catch(() => null) : null;
          const peakViewers = parseInt(countRaw, 10) || 0;
          streamAnalyticsService.endSession(sid, { peakViewers }).catch(e =>
            logger.warn('streamAnalytics: endSession error', { sid, error: e.message })
          );
        }
        // VOD recording: stop ffmpeg
        if (socket.data.recordingId) {
          const rid = socket.data.recordingId;
          socket.data.recordingId = null;
          streamRecordingService.stopRecording(rid).catch((e) =>
            logger.warn('streamRecording: stopRecording error (stream:stop)', { rid, error: e.message })
          );
        }
      }
    });

    // ── BRB broadcast ───────────────────────────────────────────────────────
    // Emitted by the streamer's Studio when they toggle BRB mode.
    // Validates that the socket is the active streamer for their channel, then
    // broadcasts `live:brb` to all viewers in the live room.
    socket.on('stream:brb', ({ on } = {}) => {
      const channelRef = socket.data.streamChannelRef;
      if (!channelRef) {
        // Socket is not currently streaming — silently ignore
        return;
      }
      io.to(`live:${channelRef}`).emit('live:brb', { on: !!on });
    });

    socket.on('disconnect', async (reason) => {
      logger.info('Socket disconnected', {
        userId: String(user.id),
        socketId: socket.id,
        reason: reason || null,
        durationMs: Date.now() - connectedAt,
      });

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

        // Telegram DM: notify creator their stream went offline unexpectedly.
        // Dedup via Redis NX key set by stream:stop (TTL 60s) — don't fire if they stopped intentionally.
        setImmediate(async () => {
          try {
            const redis = getRedis();
            if (!redis) return;
            const dedupKey = `pnp:live:offline-alert:${user.id}`;
            // SET NX: only set if NOT already present (i.e. stream:stop didn't run)
            const set = await redis.set(dedupKey, '1', 'NX', 'EX', 300);
            if (!set) return; // explicit stop fired within 60s — skip DM
            // Fetch creator telegram_id
            const { rows } = await query('SELECT telegram_id FROM users WHERE id = $1', [String(user.id)]);
            const telegramId = rows[0]?.telegram_id;
            if (!telegramId) return;
            const PNPLiveNotificationService = require('../../services/pnpLiveNotificationService');
            await PNPLiveNotificationService.sendMessage(
              telegramId,
              '\u26a0\ufe0f Your stream went offline. Restart OBS to resume.',
              { parse_mode: 'Markdown' }
            );
            logger.info(`Offline DM sent to creator ${user.id} (channel: ${channelRef})`);
          } catch (dmErr) {
            logger.warn('Offline DM error', { userId: user.id, error: dmErr.message });
          }
        });
      }

      // Analytics: clear sampler and close any open session on disconnect
      if (socket.data.viewerSamplerInterval) {
        clearInterval(socket.data.viewerSamplerInterval);
        socket.data.viewerSamplerInterval = null;
      }
      if (socket.data.analyticsSessionId) {
        const sid = socket.data.analyticsSessionId;
        const channelRefForAnalytics = socket.data.streamChannelRef;
        socket.data.analyticsSessionId = null;
        const redis = getRedis();
        const countRaw = (redis && channelRefForAnalytics)
          ? await redis.get(`live:viewers:${channelRefForAnalytics}`).catch(() => null)
          : null;
        const peakViewers = parseInt(countRaw, 10) || 0;
        streamAnalyticsService.endSession(sid, { peakViewers }).catch(e =>
          logger.warn('streamAnalytics: endSession(disconnect) error', { sid, error: e.message })
        );
      }
      // VOD recording: stop ffmpeg on disconnect
      if (socket.data.recordingId) {
        const rid = socket.data.recordingId;
        socket.data.recordingId = null;
        streamRecordingService.stopRecording(rid).catch((e) =>
          logger.warn('streamRecording: stopRecording error (disconnect)', { rid, error: e.message })
        );
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

          // Main Stage: self-heal the spotlight queue on disconnect.
          // removeCammer uses LREM and is a no-op (returns 0) for users who were
          // never in the cammer queue, so unconditional calls are safe and cheap.
          // The previous isMainStageCammer flag was never set by the frontend
          // (the REST token flow doesn't emit the socket event), so the guard
          // silently defeated all disconnect cleanup. Removed in favour of always
          // calling removeCammer and relying on its idempotency.
          const _ms = getMainStageService();
          if (_ms && typeof _ms.removeCammer === 'function') {
            _ms.removeCammer(String(user.id)).catch(() => {});
          }

          // ── Redis presence: mark offline + notify DM partners ───────────────
          try { await DmService.setOffline(user.id); } catch (_) {}
          setImmediate(async () => {
            try {
              const { rows: dmPartnerRows } = await query(
                `SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS partner_id
                 FROM dm_threads WHERE user_a = $1 OR user_b = $1
                 ORDER BY last_message_at DESC LIMIT 50`,
                [user.id]
              );
              const lastSeen = new Date().toISOString();
              for (const r of dmPartnerRows) {
                io.to(`user:${r.partner_id}`).emit('presence:update', {
                  userId: String(user.id),
                  online: false,
                  lastSeen,
                });
              }
            } catch (_) {}
          });
        }
      }
    });
  });
}

module.exports = { initSocketIO };
