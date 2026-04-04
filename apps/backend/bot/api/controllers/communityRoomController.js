const CommunityRoomService = require('../../services/communityRoomService');
const jaasService = require('../../services/jaasService');
const logger = require('../../../utils/logger');
const { resolveUserId } = require('../../utils/helpers');
const EntitlementAccessService = require('../../services/entitlementAccessService');
const socketSingleton = require('../../services/socketSingleton');

/**
 * Get community room info and generate token
 * POST /api/community-room/join
 * Anyone can join - no moderator required
 */
const joinCommunityRoom = async (req, res) => {
  try {
    // Use session identity — never trust req.body.userId
    const sessionUser = req.session?.user;
    if (!sessionUser || !sessionUser.id) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const userId = sessionUser.id;
    const { displayName, email } = req.body;

    if (!displayName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: displayName'
      });
    }

    // Ban check — banned users cannot join any room
    const banned = await EntitlementAccessService.isBanned(userId);
    if (banned) {
      return res.status(403).json({
        success: false,
        error: 'Account suspended',
        code: 'ACCOUNT_SUSPENDED'
      });
    }

    // Resolve tier-based permissions
    const permissions = await CommunityRoomService.resolvePermissionsForTier(userId);

    // Get or create community room
    const room = await CommunityRoomService.getCommunityRoom();

    // Build full avatar URL for occupancy display
    const photoPath = sessionUser.photoUrl || sessionUser.photo_file_id || '';
    let avatarUrl = '';
    if (photoPath) {
      if (photoPath.startsWith('http')) {
        avatarUrl = photoPath;
      } else {
        const base = (process.env.BOT_WEBHOOK_DOMAIN || 'https://pnptv.app').replace(/\/$/, '');
        avatarUrl = base + (photoPath.startsWith('/') ? photoPath : '/' + photoPath);
      }
    }

    // Track user join with tier info + avatar
    CommunityRoomService.trackUserJoin(
      userId,
      displayName,
      permissions.isModerator ? 'moderator' : 'member',
      permissions.role,
      avatarUrl
    );

    // Generate tier-specific JaaS JWT
    const token = await CommunityRoomService.generateCommunityToken(
      userId,
      displayName,
      '',
      permissions,
      sessionUser.photoUrl || ''
    );

    const meetingUrl = jaasService.generateMeetingUrl(CommunityRoomService.COMMUNITY_ROOM_NAME, token);

    // Get current stage state to include in join response
    const stageState = await CommunityRoomService.getStageState();

    logger.info('User joined community room (24/7 open)', {
      userId,
      displayName,
      tier: permissions.role,
      isModerator: permissions.isModerator,
    });

    res.json({
      success: true,
      token,
      meetingUrl,
      domain: '8x8.vc',
      roomName: CommunityRoomService.COMMUNITY_ROOM_NAME,
      roomId: CommunityRoomService.COMMUNITY_ROOM_ID,
      isModerator: permissions.isModerator,
      isTrueModerator: permissions.isModerator,
      isOpen24_7: true,
      permissions: {
        role: permissions.role,
        canToggleAudio: permissions.canToggleAudio,
        canToggleVideo: permissions.canToggleVideo,
        canScreenshare: permissions.enableScreensharing,
        canClipMoment: permissions.canClip,
        canKnockToSpeak: permissions.canKnock,
        isModerator: permissions.isModerator,
      },
      stageState: {
        mode: stageState.mode,
        master: stageState.master,
      },
      room: {
        id: room.id,
        code: room.roomCode,
        name: room.roomName,
        maxParticipants: room.maxParticipants,
        isPersistent: true,
        isOpen24_7: true,
        description: 'PNPtv 24/7 Main Stage - Open to all members'
      }
    });
  } catch (error) {
    logger.error('Error joining community room:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to join community room'
    });
  }
};

/**
 * Get room occupancy and presence data
 * GET /api/community-room/occupancy
 */
const getRoomOccupancy = async (req, res) => {
  try {
    const occupancy = CommunityRoomService.getRoomOccupancy();

    res.json({
      success: true,
      occupancy
    });
  } catch (error) {
    logger.error('Error getting room occupancy:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get room occupancy'
    });
  }
};

/**
 * Get chat history
 * GET /api/community-room/chat-history?limit=50
 */
const getChatHistory = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const history = CommunityRoomService.getChatHistory(limit);

    res.json({
      success: true,
      messages: history,
      count: history.length
    });
  } catch (error) {
    logger.error('Error getting chat history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get chat history'
    });
  }
};

/**
 * Add message to history
 * POST /api/community-room/message
 */
const addMessage = async (req, res) => {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser || !sessionUser.id) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const userId = sessionUser.id;
    const { displayName, message } = req.body;

    if (!displayName || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: displayName, message'
      });
    }

    const msg = CommunityRoomService.addMessage(userId, displayName, message);

    res.json({
      success: true,
      message: msg
    });
  } catch (error) {
    logger.error('Error adding message:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add message'
    });
  }
};

/**
 * Get room statistics
 * GET /api/community-room/stats
 */
const getRoomStats = async (req, res) => {
  try {
    const stats = CommunityRoomService.getRoomStats();

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    logger.error('Error getting room stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get room statistics'
    });
  }
};

/**
 * Get activity leaderboard
 * GET /api/community-room/leaderboard?limit=10
 */
const getLeaderboard = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const leaderboard = CommunityRoomService.getActivityLeaderboard(limit);

    res.json({
      success: true,
      leaderboard,
      count: leaderboard.length
    });
  } catch (error) {
    logger.error('Error getting leaderboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get leaderboard'
    });
  }
};

/**
 * Moderator: Mute user
 * POST /api/community-room/moderation/mute
 */
const muteUser = async (req, res) => {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser || !sessionUser.id) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const targetUserId = await resolveUserId(req.body.targetUserId);
    if (!targetUserId) return res.status(400).json({ success: false, error: 'targetUserId required' });

    const UserModel = require('../../../models/userModel');
    const user = await UserModel.getById(sessionUser.id);
    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
      return res.status(403).json({
        success: false,
        error: 'Only moderators can perform this action'
      });
    }

    const success = CommunityRoomService.muteUser(targetUserId);

    if (success) {
      logger.info('User muted in community room', { userId: sessionUser.id, targetUserId });
      res.json({ success: true });
    } else {
      res.status(404).json({
        success: false,
        error: 'User not found in community room'
      });
    }
  } catch (error) {
    logger.error('Error muting user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mute user'
    });
  }
};

/**
 * Moderator: Remove user
 * POST /api/community-room/moderation/remove
 */
const removeUser = async (req, res) => {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser || !sessionUser.id) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const targetUserId = await resolveUserId(req.body.targetUserId);
    if (!targetUserId) return res.status(400).json({ success: false, error: 'targetUserId required' });

    const UserModel = require('../../../models/userModel');
    const user = await UserModel.getById(sessionUser.id);
    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
      return res.status(403).json({
        success: false,
        error: 'Only moderators can perform this action'
      });
    }

    const success = CommunityRoomService.removeUser(targetUserId);

    if (success) {
      logger.info('User removed from community room', { userId: sessionUser.id, targetUserId });
      res.json({ success: true });
    } else {
      res.status(404).json({
        success: false,
        error: 'User not found in community room'
      });
    }
  } catch (error) {
    logger.error('Error removing user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove user'
    });
  }
};

/**
 * Moderator: Clear chat history
 * POST /api/community-room/moderation/clear-chat
 */
const clearChat = async (req, res) => {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser || !sessionUser.id) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const UserModel = require('../../../models/userModel');
    const user = await UserModel.getById(sessionUser.id);
    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
      return res.status(403).json({
        success: false,
        error: 'Only moderators can perform this action'
      });
    }

    const count = CommunityRoomService.clearChatHistory();

    logger.info('Chat history cleared', { userId: sessionUser.id, messagesCleared: count });
    res.json({
      success: true,
      messagesCleared: count
    });
  } catch (error) {
    logger.error('Error clearing chat:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear chat'
    });
  }
};

/**
 * Get current stage state (mode, master, occupancy)
 * GET /api/community-room/stage-state
 */
const getStageState = async (req, res) => {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser || !sessionUser.id) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const state = await CommunityRoomService.getStageState();

    res.json({
      success: true,
      stageState: { mode: state.mode, master: state.master },
      occupancy: state.occupancy,
    });
  } catch (error) {
    logger.error('Error getting stage state:', error);
    res.status(500).json({ success: false, error: 'Failed to get stage state' });
  }
};

/**
 * Set stage mode (admin-only)
 * POST /api/community-room/stage-mode
 * Body: { mode: 'ambient' | 'dj-live' | 'community', displayName?: string }
 */
const setStageMode = async (req, res) => {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser || !sessionUser.id) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const userId = sessionUser.id;

    const UserModel = require('../../../models/userModel');
    const user = await UserModel.getById(userId);
    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const { mode, displayName } = req.body;
    const validModes = ['ambient', 'dj-live', 'community'];
    if (!mode || !validModes.includes(mode)) {
      return res.status(400).json({
        success: false,
        error: `mode must be one of: ${validModes.join(', ')}`
      });
    }

    const masterInfo = mode === 'dj-live'
      ? { userId, displayName: displayName || sessionUser.firstName || 'Admin', startedAt: Date.now() }
      : null;

    await CommunityRoomService.setStageMode(mode, masterInfo);

    const io = socketSingleton.get();
    if (io) {
      io.to('mainstage').emit('mainstage:mode-changed', { mode, master: masterInfo });
    }

    logger.info('Stage mode changed', { userId, mode });
    res.json({ success: true, mode, master: masterInfo });
  } catch (error) {
    logger.error('Error setting stage mode:', error);
    res.status(500).json({ success: false, error: 'Failed to set stage mode' });
  }
};

/**
 * Submit a knock-to-speak request (member-tier required)
 * POST /api/community-room/knock
 */
const knockToSpeak = async (req, res) => {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser || !sessionUser.id) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const userId = sessionUser.id;
    const displayName = sessionUser.firstName || sessionUser.username || 'Member';

    // Member-tier or above required to knock
    const hasMembership = await EntitlementAccessService.hasEntitlement(userId, 'pnp-member');
    const UserModel = require('../../../models/userModel');
    const dbUser = await UserModel.getById(userId);
    const isAdmin = dbUser && (dbUser.role === 'admin' || dbUser.role === 'superadmin');

    if (!hasMembership && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Member subscription required to request speaking access',
        code: 'MEMBERSHIP_REQUIRED'
      });
    }

    await CommunityRoomService.addKnockRequest(userId, displayName);

    const io = socketSingleton.get();
    if (io) {
      io.to('mainstage').emit('mainstage:knock:new', { userId, displayName });
    }

    logger.info('Knock-to-speak request submitted', { userId, displayName });
    res.json({ success: true });
  } catch (error) {
    logger.error('Error submitting knock request:', error);
    res.status(500).json({ success: false, error: 'Failed to submit knock request' });
  }
};

/**
 * Approve a knock-to-speak request (admin-only)
 * POST /api/community-room/knock/approve
 * Body: { targetUserId }
 */
const approveKnock = async (req, res) => {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser || !sessionUser.id) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const UserModel = require('../../../models/userModel');
    const user = await UserModel.getById(sessionUser.id);
    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const targetUserId = await resolveUserId(req.body.targetUserId);
    if (!targetUserId) {
      return res.status(400).json({ success: false, error: 'targetUserId required' });
    }

    await CommunityRoomService.removeKnockRequest(targetUserId);

    const io = socketSingleton.get();
    if (io) {
      io.to(`user:${targetUserId}`).emit('mainstage:knock:approved');
      io.to('mainstage').emit('mainstage:knock:resolved', { targetUserId, action: 'approved' });
    }

    logger.info('Knock request approved', { adminId: sessionUser.id, targetUserId });
    res.json({ success: true });
  } catch (error) {
    logger.error('Error approving knock request:', error);
    res.status(500).json({ success: false, error: 'Failed to approve knock request' });
  }
};

/**
 * Deny a knock-to-speak request (admin-only)
 * POST /api/community-room/knock/deny
 * Body: { targetUserId }
 */
const denyKnock = async (req, res) => {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser || !sessionUser.id) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const UserModel = require('../../../models/userModel');
    const user = await UserModel.getById(sessionUser.id);
    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const targetUserId = await resolveUserId(req.body.targetUserId);
    if (!targetUserId) {
      return res.status(400).json({ success: false, error: 'targetUserId required' });
    }

    await CommunityRoomService.removeKnockRequest(targetUserId);

    const io = socketSingleton.get();
    if (io) {
      io.to(`user:${targetUserId}`).emit('mainstage:knock:denied');
      io.to('mainstage').emit('mainstage:knock:resolved', { targetUserId, action: 'denied' });
    }

    logger.info('Knock request denied', { adminId: sessionUser.id, targetUserId });
    res.json({ success: true });
  } catch (error) {
    logger.error('Error denying knock request:', error);
    res.status(500).json({ success: false, error: 'Failed to deny knock request' });
  }
};

/**
 * Drop a clip moment — creates a social post and notifies the room (prime+ only)
 * POST /api/community-room/clip
 * Body: { caption }
 */
const clipMoment = async (req, res) => {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser || !sessionUser.id) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const userId = sessionUser.id;

    const UserModel = require('../../../models/userModel');
    const dbUser = await UserModel.getById(userId);
    const isAdmin = dbUser && (dbUser.role === 'admin' || dbUser.role === 'superadmin');

    if (!isAdmin) {
      const label = await EntitlementAccessService.getUserLabel(userId);
      if (label !== 'PRIME') {
        return res.status(403).json({
          success: false,
          error: 'PRIME subscription required to drop clip moments',
          code: 'PRIME_REQUIRED'
        });
      }
    }

    const { caption } = req.body;
    if (!caption || !String(caption).trim()) {
      return res.status(400).json({ success: false, error: 'caption is required' });
    }

    const SocialPostService = require('../../services/socialPostService');
    const post = await SocialPostService.createPost(
      userId,
      `🔴 LIVE ON MAIN STAGE: ${String(caption).trim()}`,
      null,
      null,
      null,
      null,
      false,
      false,
      true
    );

    const displayName = sessionUser.firstName || sessionUser.username || 'Someone';
    const io = socketSingleton.get();
    if (io) {
      io.to('mainstage').emit('mainstage:clip-dropped', {
        userId,
        displayName,
        postId: post.id,
      });
    }

    logger.info('Clip moment dropped', { userId, postId: post.id });
    res.json({ success: true, postId: post.id });
  } catch (error) {
    logger.error('Error dropping clip moment:', error);
    res.status(500).json({ success: false, error: 'Failed to drop clip moment' });
  }
};

module.exports = {
  joinCommunityRoom,
  getRoomOccupancy,
  getChatHistory,
  addMessage,
  getRoomStats,
  getLeaderboard,
  muteUser,
  removeUser,
  clearChat,
  getStageState,
  setStageMode,
  knockToSpeak,
  approveKnock,
  denyKnock,
  clipMoment,
};
