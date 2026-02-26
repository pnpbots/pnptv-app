const CommunityRoomService = require('../../services/communityRoomService');
const logger = require('../../../utils/logger');

/**
 * Get community room info and generate token
 * POST /api/community-room/join
 * Anyone can join - no moderator required
 */
const joinCommunityRoom = async (req, res) => {
  try {
    const { userId, displayName, email } = req.body;

    // Validate required fields
    if (!userId || !displayName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, displayName'
      });
    }

    // Check if user is a true moderator
    let isTrueModerator = false;
    try {
      const UserModel = require('../../../models/userModel');
      const user = await UserModel.getById(parseInt(userId));
      isTrueModerator = user && (user.role === 'admin' || user.role === 'superadmin');
    } catch (e) {
      // If user lookup fails, allow as guest
      logger.warn('Could not verify user role, allowing as guest', { userId });
      isTrueModerator = false;
    }

    // Get or create community room
    const room = await CommunityRoomService.getCommunityRoom();

    // IMPORTANT: For the 24/7 community room, ALL users need moderator token to join
    // The room is configured on 8x8 to require at least one moderator
    // We issue moderator tokens to all participants but restrict actual moderator actions via config
    // This allows the community room to function as a true open room
    const isModerator = true; // Always issue moderator token for community room access

    const token = await CommunityRoomService.generateCommunityToken(
      userId,
      displayName,
      email || '',
      isModerator
    );

    // Track user join (use true moderator role for tracking, even though we issue moderator token to all)
    CommunityRoomService.trackUserJoin(userId, displayName, isTrueModerator ? 'moderator' : 'member');

    logger.info('User joined community room (24/7 open)', {
      userId,
      displayName,
      isModerator,
      isGuest: !isModerator
    });

    res.json({
      success: true,
      token,
      domain: '8x8.vc',
      roomName: CommunityRoomService.COMMUNITY_ROOM_NAME,
      roomId: CommunityRoomService.COMMUNITY_ROOM_ID,
      isModerator: isTrueModerator, // Return true moderator status
      isTrueModerator, // Explicitly indicate if user is a true moderator
      isOpen24_7: true,
      room: {
        id: room.id,
        code: room.roomCode,
        name: room.roomName,
        maxParticipants: room.maxParticipants,
        isPersistent: true,
        isOpen24_7: true,
        description: 'PNPtv 24/7 Haus - Open to all members'
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
    const { userId, displayName, message } = req.body;

    if (!userId || !displayName || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, displayName, message'
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
    const { userId, targetUserId } = req.body;

    // Check if requester is moderator
    const UserModel = require('../../../models/userModel');
    const user = await UserModel.getById(parseInt(userId));
    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
      return res.status(403).json({
        success: false,
        error: 'Only moderators can perform this action'
      });
    }

    const success = CommunityRoomService.muteUser(targetUserId);

    if (success) {
      logger.info('User muted in community room', { userId, targetUserId });
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
    const { userId, targetUserId } = req.body;

    // Check if requester is moderator
    const UserModel = require('../../../models/userModel');
    const user = await UserModel.getById(parseInt(userId));
    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
      return res.status(403).json({
        success: false,
        error: 'Only moderators can perform this action'
      });
    }

    const success = CommunityRoomService.removeUser(targetUserId);

    if (success) {
      logger.info('User removed from community room', { userId, targetUserId });
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
    const { userId } = req.body;

    // Check if requester is moderator
    const UserModel = require('../../../models/userModel');
    const user = await UserModel.getById(parseInt(userId));
    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
      return res.status(403).json({
        success: false,
        error: 'Only moderators can perform this action'
      });
    }

    const count = CommunityRoomService.clearChatHistory();

    logger.info('Chat history cleared', { userId, messagesCleared: count });
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

module.exports = {
  joinCommunityRoom,
  getRoomOccupancy,
  getChatHistory,
  addMessage,
  getRoomStats,
  getLeaderboard,
  muteUser,
  removeUser,
  clearChat
};
