const logger = require('../../../utils/logger');
const VideoCallModel = require('../../../models/videoCallModel');
const { buildJitsiHangoutsUrl } = require('../../utils/jitsiHangoutsWebApp');
const jaasService = require('../../services/jaasService');

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  return user;
};

// GET /api/webapp/hangouts/public
const listPublic = async (req, res) => {
  try {
    const calls = await VideoCallModel.getAllPublic();
    const rooms = calls.map(call => ({
      id: call.id,
      title: call.title,
      creatorName: call.creatorName,
      currentParticipants: call.currentParticipants,
      maxParticipants: call.maxParticipants,
      createdAt: call.createdAt,
    }));
    return res.json({ success: true, rooms });
  } catch (err) {
    logger.error('webapp listPublic hangouts error', err);
    return res.status(500).json({ error: 'Failed to load rooms' });
  }
};

// POST /api/webapp/hangouts/create
const createRoom = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { title, maxParticipants = 10, isPublic = true } = req.body;
  const creatorId = user.id;
  const creatorName = user.firstName || user.username || 'User';

  try {
    const call = await VideoCallModel.create({
      creatorId,
      creatorName,
      title: title ? String(title).trim().slice(0, 80) : null,
      maxParticipants: Math.min(Math.max(Number(maxParticipants) || 10, 2), 50),
      allowGuests: true,
      enforceCamera: false,
      isPublic: Boolean(isPublic),
    });

    let jitsiUrl = null;
    if (jaasService.isConfigured()) {
      try {
        jitsiUrl = buildJitsiHangoutsUrl({
          roomName: call.channelName,
          userId: creatorId,
          userName: creatorName,
          isModerator: true,
          callId: call.id,
          type: call.isPublic ? 'public' : 'private',
        });
      } catch (e) {
        logger.warn('Failed to generate Jitsi URL:', e.message);
      }
    }

    return res.json({
      success: true,
      id: call.id,
      room: call.channelName,
      jitsiUrl,
      platform: jitsiUrl ? 'jitsi' : null,
    });
  } catch (err) {
    logger.error('webapp createRoom hangouts error', err);
    return res.status(500).json({ error: 'Failed to create room' });
  }
};

// POST /api/webapp/hangouts/join/:callId
const joinRoom = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { callId } = req.params;
  const userId = user.id;
  const userName = user.firstName || user.username || 'User';

  try {
    const call = await VideoCallModel.getById(callId);
    if (!call) return res.status(404).json({ error: 'Room not found' });
    if (!call.isActive) return res.status(410).json({ error: 'Room is no longer active' });
    if (!call.isPublic) return res.status(403).json({ error: 'Room is private' });

    const joinResult = await VideoCallModel.joinCall(callId, userId, userName, false);
    const isModerator = joinResult.call.creatorId === userId;

    let jitsiUrl = null;
    if (jaasService.isConfigured()) {
      try {
        jitsiUrl = buildJitsiHangoutsUrl({
          roomName: joinResult.call.channelName,
          userId,
          userName,
          isModerator,
          callId: joinResult.call.id,
          type: 'public',
        });
      } catch (e) {
        logger.warn('Failed to generate Jitsi URL:', e.message);
      }
    }

    return res.json({
      success: true,
      id: joinResult.call.id,
      room: joinResult.call.channelName,
      jitsiUrl,
      platform: jitsiUrl ? 'jitsi' : null,
      isModerator,
    });
  } catch (err) {
    logger.error('webapp joinRoom hangouts error', err);
    if (err.message?.includes('full')) return res.status(409).json({ error: 'Room is full' });
    if (err.message?.includes('ended')) return res.status(410).json({ error: 'Room has ended' });
    return res.status(500).json({ error: 'Failed to join room' });
  }
};

// POST /api/webapp/hangouts/leave/:callId
const leaveRoom = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { callId } = req.params;
  try {
    await VideoCallModel.leaveCall(callId, user.id);
    return res.json({ success: true });
  } catch (err) {
    logger.error('webapp leaveRoom hangouts error', err);
    return res.status(500).json({ error: 'Failed to leave room' });
  }
};

// DELETE /api/webapp/hangouts/:callId
const endRoom = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { callId } = req.params;
  try {
    await VideoCallModel.endCall(callId, user.id);
    return res.json({ success: true });
  } catch (err) {
    logger.error('webapp endRoom hangouts error', err);
    if (err.message?.includes('creator')) return res.status(403).json({ error: 'Only the creator can end this room' });
    if (err.message?.includes('not found')) return res.status(404).json({ error: 'Room not found' });
    return res.status(500).json({ error: 'Failed to end room' });
  }
};

module.exports = { listPublic, createRoom, joinRoom, leaveRoom, endRoom };
