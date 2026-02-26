/**
 * Main Room Controller
 * Handles 3 permanent 50-person community hangout rooms
 *
 * Endpoints:
 * - GET /api/rooms - List all main rooms
 * - GET /api/rooms/:roomId - Get room details
 * - POST /api/rooms/:roomId/join - Join as viewer or publisher
 * - POST /api/rooms/:roomId/leave - Leave room
 * - GET /api/rooms/:roomId/participants - List room participants
 * - GET /api/rooms/:roomId/events - Get room events (admin)
 * - POST /api/rooms/:roomId/kick - Kick participant (admin)
 * - POST /api/rooms/:roomId/mute - Mute participant (admin)
 * - POST /api/rooms/:roomId/spotlight - Set spotlight (admin)
 */

const MainRoomModel = require('../../../models/mainRoomModel');
const UserModel = require('../../../models/userModel');
const agoraTokenService = require('../../../services/agora/agoraTokenService');
const logger = require('../../../utils/logger');
const { getRateLimitInfo, consumeRateLimit } = require('../../services/rateLimitGranular');
const { resolveTelegramUser } = require('../../services/telegramWebAppAuth');

class MainRoomController {
  /**
   * GET /api/rooms - List all main rooms with participant counts
   */
  static async listRooms(req, res) {
    try {
      const rooms = await MainRoomModel.getAll();

      const roomsWithStatus = await Promise.all(rooms.map(async (room) => {
        const participants = await MainRoomModel.getParticipants(room.id);
        const publishers = participants.filter(p => p.isPublisher).length;

        return {
          id: room.id,
          name: room.name,
          description: room.description,
          currentParticipants: room.currentParticipants,
          maxParticipants: room.maxParticipants,
          publishers: publishers,
          viewers: room.currentParticipants - publishers,
          isFull: room.currentParticipants >= room.maxParticipants,
          isActive: room.isActive,
          createdAt: room.createdAt,
          updatedAt: room.updatedAt,
        };
      }));

      return res.status(200).json({
        success: true,
        rooms: roomsWithStatus,
        count: roomsWithStatus.length,
      });
    } catch (error) {
      logger.error('Error listing rooms:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to load rooms',
      });
    }
  }

  /**
   * GET /api/rooms/:roomId - Get room details
   */
  static async getRoom(req, res) {
    try {
      const { roomId } = req.params;
      const room = await MainRoomModel.getById(parseInt(roomId));

      if (!room) {
        return res.status(404).json({
          success: false,
          error: 'Room not found',
        });
      }

      const participants = await MainRoomModel.getParticipants(room.id);
      const publishers = participants.filter(p => p.isPublisher);

      return res.status(200).json({
        success: true,
        id: room.id,
        name: room.name,
        description: room.description,
        channelName: room.channelName,
        currentParticipants: room.currentParticipants,
        maxParticipants: room.maxParticipants,
        publishers: publishers.length,
        viewers: room.currentParticipants - publishers.length,
        isFull: room.currentParticipants >= room.maxParticipants,
        isActive: room.isActive,
        enforceCamera: room.enforceCamera,
        autoApprovePublisher: room.autoApprovePublisher,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt,
      });
    } catch (error) {
      logger.error('Error getting room:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to load room',
      });
    }
  }

  /**
   * POST /api/rooms/:roomId/join - Join room as viewer or publisher
   */
  static async joinRoom(req, res) {
    try {
      const { roomId } = req.params;
      const { asPublisher } = req.body;

      // Authenticate user
      const auth = resolveTelegramUser(req);
      if (!auth.ok) {
        return res.status(401).json({
          success: false,
          error: 'Telegram authentication failed',
          reason: auth.reason,
        });
      }

      const userId = auth.user?.id;
      const userName = auth.user?.firstName || auth.user?.username || 'User';

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'Missing userId',
        });
      }

      // Verify user exists and is active
      const user = await UserModel.findByTelegramId(userId);
      if (!user) {
        return res.status(403).json({
          success: false,
          error: 'User not registered in system',
        });
      }

      if (!user.is_active) {
        return res.status(403).json({
          success: false,
          error: 'User account is deactivated',
        });
      }

      // Get room
      const room = await MainRoomModel.getById(parseInt(roomId));
      if (!room) {
        return res.status(404).json({
          success: false,
          error: 'Room not found',
        });
      }

      if (!room.isActive) {
        return res.status(410).json({
          success: false,
          error: 'Room is not active',
        });
      }

      // Check rate limiting
      const allowed = await consumeRateLimit(String(userId), 'room_join');
      if (!allowed) {
        const rateLimitInfo = await getRateLimitInfo(String(userId), 'room_join');
        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded for room joins',
          retryAfter: rateLimitInfo?.resetIn || 300,
        });
      }

      // Join room
      const joinResult = await MainRoomModel.joinRoom(
        room.id,
        String(userId),
        userName,
        asPublisher || false
      );

      // Generate tokens
      const tokens = agoraTokenService.generateMainRoomTokens(
        room.channelName,
        userId,
        asPublisher || false
      );

      return res.status(200).json({
        success: true,
        roomId: room.id,
        room: room.channelName,
        token: tokens.token,
        uid: tokens.uid,
        appId: process.env.AGORA_APP_ID,
        platform: 'agora',
        currentParticipants: joinResult.currentParticipants,
        maxParticipants: room.maxParticipants,
        isPublisher: asPublisher || false,
        alreadyJoined: joinResult.alreadyJoined,
        upgraded: joinResult.upgraded,
      });
    } catch (error) {
      logger.error('Error joining room:', error);

      if (error.message.includes('full')) {
        return res.status(409).json({
          success: false,
          error: 'Room is full',
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Failed to join room',
      });
    }
  }

  /**
   * POST /api/rooms/:roomId/leave - Leave room
   */
  static async leaveRoom(req, res) {
    try {
      const { roomId } = req.params;

      // Authenticate user
      const auth = resolveTelegramUser(req);
      if (!auth.ok) {
        return res.status(401).json({
          success: false,
          error: 'Telegram authentication failed',
        });
      }

      const userId = auth.user?.id;
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'Missing userId',
        });
      }

      // Leave room
      await MainRoomModel.leaveRoom(parseInt(roomId), String(userId));

      return res.status(200).json({
        success: true,
        message: 'Left room successfully',
      });
    } catch (error) {
      logger.error('Error leaving room:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to leave room',
      });
    }
  }

  /**
   * GET /api/rooms/:roomId/participants - List room participants
   */
  static async getParticipants(req, res) {
    try {
      const { roomId } = req.params;
      const { publishersOnly } = req.query;

      const room = await MainRoomModel.getById(parseInt(roomId));
      if (!room) {
        return res.status(404).json({
          success: false,
          error: 'Room not found',
        });
      }

      const participants = await MainRoomModel.getParticipants(
        room.id,
        publishersOnly === 'true'
      );

      return res.status(200).json({
        success: true,
        roomId: room.id,
        participants: participants,
        count: participants.length,
        publisherCount: participants.filter(p => p.isPublisher).length,
      });
    } catch (error) {
      logger.error('Error getting participants:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to load participants',
      });
    }
  }

  /**
   * GET /api/rooms/:roomId/events - Get room events (admin only)
   */
  static async getEvents(req, res) {
    try {
      const { roomId } = req.params;
      const { limit } = req.query;

      // Check admin permissions
      const auth = resolveTelegramUser(req);
      if (!auth.ok || !await this._isAdmin(auth.user?.id)) {
        return res.status(403).json({
          success: false,
          error: 'Admin access required',
        });
      }

      const room = await MainRoomModel.getById(parseInt(roomId));
      if (!room) {
        return res.status(404).json({
          success: false,
          error: 'Room not found',
        });
      }

      const events = await MainRoomModel.getEvents(room.id, parseInt(limit) || 100);

      return res.status(200).json({
        success: true,
        roomId: room.id,
        events: events,
        count: events.length,
      });
    } catch (error) {
      logger.error('Error getting room events:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to load events',
      });
    }
  }

  /**
   * POST /api/rooms/:roomId/kick - Kick participant (admin only)
   */
  static async kickParticipant(req, res) {
    try {
      const { roomId } = req.params;
      const { participantUserId } = req.body;

      if (!participantUserId) {
        return res.status(400).json({
          success: false,
          error: 'Missing participantUserId',
        });
      }

      // Check admin permissions
      const auth = resolveTelegramUser(req);
      if (!auth.ok || !await this._isAdmin(auth.user?.id)) {
        return res.status(403).json({
          success: false,
          error: 'Admin access required',
        });
      }

      const room = await MainRoomModel.getById(parseInt(roomId));
      if (!room) {
        return res.status(404).json({
          success: false,
          error: 'Room not found',
        });
      }

      // Kick participant
      await MainRoomModel.kickParticipant(
        room.id,
        String(participantUserId),
        String(auth.user?.id)
      );

      logger.info('Participant kicked', {
        roomId: room.id,
        participantUserId,
        adminId: auth.user?.id,
      });

      return res.status(200).json({
        success: true,
        message: 'Participant kicked successfully',
      });
    } catch (error) {
      logger.error('Error kicking participant:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to kick participant',
      });
    }
  }

  /**
   * POST /api/rooms/:roomId/mute - Mute participant (admin only)
   */
  static async muteParticipant(req, res) {
    try {
      const { roomId } = req.params;
      const { participantUserId, mediaType } = req.body;

      if (!participantUserId || !mediaType) {
        return res.status(400).json({
          success: false,
          error: 'Missing participantUserId or mediaType',
        });
      }

      // Check admin permissions
      const auth = resolveTelegramUser(req);
      if (!auth.ok || !await this._isAdmin(auth.user?.id)) {
        return res.status(403).json({
          success: false,
          error: 'Admin access required',
        });
      }

      const room = await MainRoomModel.getById(parseInt(roomId));
      if (!room) {
        return res.status(404).json({
          success: false,
          error: 'Room not found',
        });
      }

      // Mute participant
      await MainRoomModel.muteParticipant(
        room.id,
        String(participantUserId),
        String(auth.user?.id),
        mediaType
      );

      return res.status(200).json({
        success: true,
        message: `Participant ${mediaType} muted`,
      });
    } catch (error) {
      logger.error('Error muting participant:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to mute participant',
      });
    }
  }

  /**
   * POST /api/rooms/:roomId/spotlight - Set spotlight (admin only)
   */
  static async setSpotlight(req, res) {
    try {
      const { roomId } = req.params;
      const { participantUserId } = req.body;

      if (!participantUserId) {
        return res.status(400).json({
          success: false,
          error: 'Missing participantUserId',
        });
      }

      // Check admin permissions
      const auth = resolveTelegramUser(req);
      if (!auth.ok || !await this._isAdmin(auth.user?.id)) {
        return res.status(403).json({
          success: false,
          error: 'Admin access required',
        });
      }

      const room = await MainRoomModel.getById(parseInt(roomId));
      if (!room) {
        return res.status(404).json({
          success: false,
          error: 'Room not found',
        });
      }

      // Set spotlight
      await MainRoomModel.setSpotlight(
        room.id,
        String(participantUserId),
        String(auth.user?.id)
      );

      return res.status(200).json({
        success: true,
        message: 'Spotlight set successfully',
      });
    } catch (error) {
      logger.error('Error setting spotlight:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to set spotlight',
      });
    }
  }

  /**
   * Helper: Check if user is admin
   * @private
   */
  static async _isAdmin(userId) {
    if (!userId) return false;

    const adminIds = (process.env.ADMIN_USER_IDS || '').split(',');
    return adminIds.includes(String(userId));
  }
}

module.exports = MainRoomController;
