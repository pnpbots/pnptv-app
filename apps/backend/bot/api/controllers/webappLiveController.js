const LiveStreamModel = require('../../../models/liveStreamModel');
const logger = require('../../../utils/logger');

// Agora stub — reads from env; token generation not available without SDK
const agoraTokenService = {
  appId: process.env.AGORA_APP_ID || null,
  generateViewerToken: () => null,
};

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  return user;
};

// GET /api/webapp/live/streams
const listStreams = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  try {
    const streams = await LiveStreamModel.getActiveStreams(20);
    return res.json({ success: true, streams });
  } catch (err) {
    logger.error('webapp listStreams error', err);
    return res.status(500).json({ error: 'Failed to load streams' });
  }
};

// POST /api/webapp/live/start
const startStream = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { title, category } = req.body;
  try {
    const stream = await LiveStreamModel.create({
      hostId: user.id,
      hostName: user.firstName || user.first_name || user.username || 'Host',
      title: title ? String(title).trim().slice(0, 100) : `${user.firstName || user.first_name || user.username || 'Host'}'s Stream`,
      category: category || 'other',
      status: 'active',
      isPublic: true,
    });
    return res.json({
      success: true,
      streamId: stream.streamId || String(stream.dbId),
      channelName: stream.channelName,
      hostToken: stream.hostToken,
      appId: agoraTokenService.appId,
    });
  } catch (err) {
    logger.error('webapp startStream error', err);
    return res.status(500).json({ error: 'Failed to start stream' });
  }
};

// GET /api/webapp/live/streams/:streamId/join
const joinStream = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { streamId } = req.params;
  try {
    const stream = await LiveStreamModel.getById(streamId);
    if (!stream) return res.status(404).json({ error: 'Stream not found' });
    if (stream.status !== 'active') return res.status(410).json({ error: 'Stream is not live' });

    const viewerToken = agoraTokenService.generateViewerToken(stream.channelName, user.id);
    await LiveStreamModel.joinStream(streamId, user.id, user.firstName || user.first_name || user.username || 'Viewer').catch(() => {});

    return res.json({
      success: true,
      streamId,
      channelName: stream.channelName,
      viewerToken,
      appId: agoraTokenService.appId,
      title: stream.title,
      hostName: stream.hostName,
      currentViewers: stream.currentViewers,
    });
  } catch (err) {
    logger.error('webapp joinStream error', err);
    return res.status(500).json({ error: 'Failed to join stream' });
  }
};

// POST /api/webapp/live/streams/:streamId/end
const endStream = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { streamId } = req.params;
  try {
    await LiveStreamModel.endStream(streamId, user.id);
    return res.json({ success: true });
  } catch (err) {
    logger.error('webapp endStream error', err);
    if (err.message === 'Unauthorized') return res.status(403).json({ error: 'Only the host can end this stream' });
    return res.status(500).json({ error: 'Failed to end stream' });
  }
};

// POST /api/webapp/live/streams/:streamId/leave
const leaveStream = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { streamId } = req.params;
  try {
    await LiveStreamModel.leaveStream(streamId, user.id).catch(() => {});
    return res.json({ success: true });
  } catch (err) {
    logger.error('webapp leaveStream error', err);
    return res.status(500).json({ error: 'Failed to leave stream' });
  }
};

module.exports = { listStreams, startStream, joinStream, endStream, leaveStream };
