'use strict';

/**
 * jaasStreamController.js
 *
 * REST endpoints for JaaS-based live streaming.
 * Powered by JaaS (8x8.vc).
 * Route paths are unchanged so existing frontend integrations continue to work.
 */

const logger = require('../../../utils/logger');
const { getPool } = require('../../../config/postgres');
const jaasStreamService = require('../../services/jaasStreamService');

// Lazy-load tokenService so a load failure degrades only the heartbeat
// endpoint rather than crashing the entire controller at require time.
let _tokenService = null;
function getTokenService() {
  if (!_tokenService) {
    try {
      _tokenService = require('../../services/tokenService');
    } catch (e) {
      logger.error('[jaasStreamController] tokenService failed to load — streamHeartbeat will be unavailable:', e.message);
      _tokenService = null;
    }
  }
  return _tokenService;
}

/**
 * GET /api/webapp/live/webrtc/config
 *
 * Returns the JaaS meeting URL, streamer token, room name, and domain
 * for the authenticated user's assigned channel.
 * The frontend uses this to embed a JaaS (Jitsi) room as moderator.
 */
const getStreamerConfig = async (req, res) => {
  const user = req.session.user;
  if (!['model', 'creator', 'admin', 'superadmin'].includes(user.role)) {
    return res.status(403).json({ success: false, error: 'Creator or admin access required' });
  }

  try {
    const { rows } = await getPool().query(
      'SELECT live_channel, first_name, last_name, username, photo_file_id FROM users WHERE id = $1',
      [user.id]
    );
    const channelRef = rows[0]?.live_channel;
    if (!channelRef) {
      return res.status(404).json({
        success: false,
        error: 'No streaming channel assigned. Contact an admin to get a channel.',
      });
    }

    const displayName = [rows[0].first_name, rows[0].last_name].filter(Boolean).join(' ')
      || rows[0].username || 'Streamer';
    const photoUrl = rows[0].photo_file_id || '';

    // Register the channel in the Redis active-rooms set
    await jaasStreamService.ensureStreamRoom(channelRef);

    // Signal streaming active in Redis (used by auto-chat controller)
    try {
      const { getRedis } = require('../../../config/redis');
      const redis = getRedis();
      if (redis) {
        await redis.set(`streaming:active:${user.id}`, '1', 'EX', 86400);
      }
    } catch (redisErr) {
      logger.warn('Failed to set streaming:active flag in Redis', { userId: user.id, error: redisErr.message });
    }

    // Generate a JaaS moderator token (streamer / publisher role)
    const token = await jaasStreamService.generateStreamerToken(
      channelRef, user.id, displayName, photoUrl
    );

    const roomName = jaasStreamService.toRoomName(channelRef);
    const meetingUrl = jaasStreamService.toMeetingUrl(roomName, token);

    return res.json({
      success: true,
      token,
      meetingUrl,
      roomName,
      channelRef,
      domain: jaasStreamService.JAAS_DOMAIN,
      appId: jaasStreamService.JAAS_APP_ID,
    });
  } catch (err) {
    logger.error('getStreamerConfig error', err);
    return res.status(500).json({ success: false, error: 'Failed to configure stream' });
  }
};

/**
 * GET /api/webapp/live/webrtc/viewer-token/:channelRef
 *
 * Returns a subscriber-only JaaS token for viewing a live stream.
 */
const getViewerToken = async (req, res) => {
  const user = req.session.user;
  const { channelRef } = req.params;

  if (!channelRef || !/^[a-zA-Z0-9\-_]+$/.test(channelRef)) {
    return res.status(400).json({ success: false, error: 'Invalid channel reference' });
  }

  try {
    const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ')
      || user.username || 'Viewer';

    const token = await jaasStreamService.generateViewerToken(
      channelRef, user.id, displayName
    );

    if (!token) {
      return res.status(402).json({
        success: false,
        error: 'Minimum 10 tokens required to join a stream. Please top up your tokens to watch.',
      });
    }

    const roomName = jaasStreamService.toRoomName(channelRef);
    const meetingUrl = jaasStreamService.toMeetingUrl(roomName, token);

    return res.json({
      success: true,
      token,
      meetingUrl,
      roomName,
      domain: jaasStreamService.JAAS_DOMAIN,
      appId: jaasStreamService.JAAS_APP_ID,
    });
  } catch (err) {
    logger.error('getViewerToken error', err);
    return res.status(500).json({ success: false, error: 'Failed to generate viewer token' });
  }
};

/**
 * GET /api/webapp/live/webrtc/streams
 *
 * Lists active JaaS live streams tracked in Redis.
 * Enriches with user info from the database.
 */
const listStreams = async (req, res) => {
  try {
    const streams = await jaasStreamService.listActiveStreams();

    if (streams.length === 0) {
      return res.json({ success: true, streams: [] });
    }

    // Enrich with user info
    const channelRefs = streams.map(s => s.channelRef);
    const placeholders = channelRefs.map((_, i) => `$${i + 1}`).join(',');
    const { rows: users } = await getPool().query(
      `SELECT id, username, first_name, last_name, photo_file_id, bio, live_channel
       FROM users WHERE live_channel IN (${placeholders})`,
      channelRefs
    );

    const userMap = {};
    for (const u of users) {
      userMap[u.live_channel] = u;
    }

    // Fetch stream metadata and thumbnails from Redis (best-effort)
    const metaMap = {};
    const thumbMap = {};
    try {
      const { getRedis } = require('../../../config/redis');
      const redis = getRedis();
      if (redis && channelRefs.length > 0) {
        const metaKeys = channelRefs.map(ref => `stream:meta:${ref}`);
        const thumbKeys = channelRefs.map(ref => `stream:thumb:${ref}`);
        const [metaValues, thumbValues] = await Promise.all([
          redis.mget(...metaKeys),
          redis.mget(...thumbKeys),
        ]);
        channelRefs.forEach((ref, i) => {
          if (metaValues[i]) {
            try { metaMap[ref] = JSON.parse(metaValues[i]); } catch { /* ignore */ }
          }
          if (thumbValues[i]) {
            thumbMap[ref] = thumbValues[i];
          }
        });
      }
    } catch (redisErr) {
      logger.warn('listStreams: failed to fetch stream metadata from Redis (non-fatal)', { error: redisErr.message });
    }

    const enriched = streams.map(s => {
      const u = userMap[s.channelRef];
      const meta = metaMap[s.channelRef];
      const displayName = u
        ? ([u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'Streamer')
        : 'Live Stream';
      return {
        id: s.channelRef,
        channelRef: s.channelRef,
        // Stream title from Redis overrides performer display name when set
        name: meta && meta.title ? meta.title : displayName,
        description: (meta && meta.description) ? meta.description : (u && u.bio ? u.bio : ''),
        tags: (meta && Array.isArray(meta.tags)) ? meta.tags : [],
        thumbnailUrl: thumbMap[s.channelRef] || null,
        isLive: s.isLive,
        // JaaS does not expose server-side participant counts; frontend tracks
        // via its own participant-joined events after embedding.
        viewerCount: 0,
        userId: u?.id || null,
        photoUrl: u?.photo_file_id || null,
        roomName: s.roomName,
        domain: jaasStreamService.JAAS_DOMAIN,
        appId: jaasStreamService.JAAS_APP_ID,
      };
    });

    return res.json({ success: true, streams: enriched });
  } catch (err) {
    logger.error('listStreams error', err);
    return res.json({ success: true, streams: [] });
  }
};

/**
 * GET /api/webapp/live/webrtc/status/:channelRef
 *
 * Returns the live status of a specific channel.
 * Backed by Redis streaming:rooms set membership.
 */
const getStreamStatus = async (req, res) => {
  const { channelRef } = req.params;
  if (!channelRef || !/^[a-zA-Z0-9\-_]+$/.test(channelRef)) {
    return res.status(400).json({ success: false, error: 'Invalid channel reference' });
  }

  try {
    const status = await jaasStreamService.getStreamStatus(channelRef);
    if (!status) {
      return res.json({ success: true, isLive: false, participantCount: 0, streamerConnected: false });
    }
    return res.json({ success: true, ...status });
  } catch (err) {
    logger.error('getStreamStatus error', err);
    return res.json({ success: true, isLive: false, participantCount: 0, streamerConnected: false });
  }
};

/**
 * POST /api/webapp/live/webrtc/end
 *
 * End the current user's live stream.
 * Removes the channel from the Redis active-rooms set and clears the active flag.
 */
const endStream = async (req, res) => {
  const user = req.session.user;

  try {
    const { rows } = await getPool().query(
      'SELECT live_channel FROM users WHERE id = $1',
      [user.id]
    );
    const channelRef = rows[0]?.live_channel;
    if (!channelRef) {
      return res.status(404).json({ success: false, error: 'No channel assigned' });
    }

    await jaasStreamService.endStream(channelRef);

    // Signal streaming inactive in Redis
    try {
      const { getRedis } = require('../../../config/redis');
      const redis = getRedis();
      if (redis) {
        await redis.set(`streaming:active:${user.id}`, '0', 'EX', 86400);
      }
    } catch (redisErr) {
      logger.warn('Failed to clear streaming:active flag in Redis', { userId: user.id, error: redisErr.message });
    }

    return res.json({ success: true });
  } catch (err) {
    logger.error('endStream error', err);
    return res.status(500).json({ success: false, error: 'Failed to end stream' });
  }
};

/**
 * POST /api/webapp/live/webrtc/heartbeat
 *
 * Deducts viewer tokens on a recurring interval while the viewer is watching.
 * Business logic is unchanged — only the service layer backing changed.
 */
const streamHeartbeat = async (req, res) => {
  const user = req.session.user;
  const { channelRef } = req.body;

  if (!channelRef) {
    return res.status(400).json({ success: false, error: 'channelRef is required' });
  }

  try {
    const svc = getTokenService();
    if (!svc) {
      // tokenService unavailable — allow the heartbeat silently so the stream is not interrupted
      logger.warn('streamHeartbeat: tokenService unavailable, skipping token deduction', { userId: user.id, channelRef });
      return res.json({ success: true, newBalance: null });
    }

    const result = await svc.processStreamHeartbeat(user.id, channelRef);

    if (!result.success) {
      if (result.error === 'INSUFFICIENT_FUNDS') {
        return res.status(402).json({ success: false, error: 'Insufficient funds' });
      }
      if (result.error === 'STREAMER_NOT_FOUND') {
        return res.status(404).json({ success: false, error: 'Streamer not found' });
      }
      return res.status(500).json({ success: false, error: 'Heartbeat failed' });
    }

    return res.json({ success: true, newBalance: result.newBalance });
  } catch (err) {
    logger.error('streamHeartbeat error', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

module.exports = {
  getStreamerConfig,
  getViewerToken,
  listStreams,
  getStreamStatus,
  endStream,
  streamHeartbeat,
};
