'use strict';

/**
 * livekitStreamController.js
 *
 * REST endpoints for LiveKit-based live streaming.
 * Replaces the Restreamer proxy for browser streaming and adds WebRTC viewer tokens.
 */

const logger = require('../../../utils/logger');
const { getPool } = require('../../../config/postgres');
const livekitStreamService = require('../../services/livekitStreamService');

/**
 * GET /api/webapp/live/webrtc/config
 *
 * Returns the LiveKit WebSocket URL, streamer token, and room info
 * for the authenticated user's assigned channel.
 * The frontend uses this to connect via livekit-client SDK.
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

    // Ensure the room exists
    await livekitStreamService.ensureStreamRoom(channelRef);

    // Generate a publisher token
    const token = await livekitStreamService.generateStreamerToken(
      channelRef, user.id, displayName, photoUrl
    );

    return res.json({
      success: true,
      token,
      wsUrl: livekitStreamService.LIVEKIT_WS_URL,
      roomName: livekitStreamService.toRoomName(channelRef),
      channelRef,
    });
  } catch (err) {
    logger.error('getStreamerConfig error', err);
    return res.status(500).json({ success: false, error: 'Failed to configure stream' });
  }
};

/**
 * GET /api/webapp/live/webrtc/viewer-token/:channelRef
 *
 * Returns a subscribe-only LiveKit token for viewing a live stream.
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

    const token = await livekitStreamService.generateViewerToken(
      channelRef, user.id, displayName
    );

    return res.json({
      success: true,
      token,
      wsUrl: livekitStreamService.LIVEKIT_WS_URL,
      roomName: livekitStreamService.toRoomName(channelRef),
    });
  } catch (err) {
    logger.error('getViewerToken error', err);
    return res.status(500).json({ success: false, error: 'Failed to generate viewer token' });
  }
};

/**
 * GET /api/webapp/live/webrtc/streams
 *
 * Lists active LiveKit live streams with participant counts.
 * Enriches with user info from the database.
 */
const listStreams = async (req, res) => {
  try {
    const streams = await livekitStreamService.listActiveStreams();

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

    const enriched = streams.map(s => {
      const u = userMap[s.channelRef];
      return {
        id: s.channelRef,
        channelRef: s.channelRef,
        name: u
          ? ([u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'Streamer')
          : 'Live Stream',
        description: u?.bio || '',
        isLive: s.isLive,
        viewerCount: Math.max(0, s.participantCount - 1), // subtract the streamer
        userId: u?.id || null,
        photoUrl: u?.photo_file_id || null,
        // No hlsUrl — WebRTC only (HLS fallback handled by LiveKit automatically)
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
 */
const getStreamStatus = async (req, res) => {
  const { channelRef } = req.params;
  if (!channelRef || !/^[a-zA-Z0-9\-_]+$/.test(channelRef)) {
    return res.status(400).json({ success: false, error: 'Invalid channel reference' });
  }

  try {
    const status = await livekitStreamService.getStreamStatus(channelRef);
    if (!status) {
      return res.json({ success: true, isLive: false, participantCount: 0 });
    }
    return res.json({ success: true, ...status });
  } catch (err) {
    logger.error('getStreamStatus error', err);
    return res.json({ success: true, isLive: false, participantCount: 0 });
  }
};

/**
 * POST /api/webapp/live/webrtc/end
 *
 * End the current user's live stream (delete the LiveKit room).
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

    await livekitStreamService.endStream(channelRef);
    return res.json({ success: true });
  } catch (err) {
    logger.error('endStream error', err);
    return res.status(500).json({ success: false, error: 'Failed to end stream' });
  }
};

module.exports = {
  getStreamerConfig,
  getViewerToken,
  listStreams,
  getStreamStatus,
  endStream,
};
