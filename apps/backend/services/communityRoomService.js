const logger = require('../utils/logger');
const JaasService = require('./jaasService');
const { getRedis } = require('../config/redis');
const EntitlementAccessService = require('./entitlementAccessService');

/**
 * PNPtv Haus Service
 * Manages the 24/7 persistent community video room
 */
class CommunityRoomService {
  constructor() {
    this.COMMUNITY_ROOM_ID = 'pnptv-haus-24-7';
    this.COMMUNITY_ROOM_NAME = 'pnptv-haus';
    this.activeUsers = new Map(); // userId -> { userName, joinedAt, role }
    this.messageHistory = []; // Store last 100 messages
    this.MAX_MESSAGES = 100;
  }

  /**
   * Get or create the community room
   * 24/7 open room - no moderator required to start or join
   */
  async getCommunityRoom() {
    try {
      // Return room info without database dependency
      const room = {
        id: this.COMMUNITY_ROOM_ID,
        code: this.COMMUNITY_ROOM_ID,
        roomCode: this.COMMUNITY_ROOM_ID,
        roomName: this.COMMUNITY_ROOM_NAME,
        name: this.COMMUNITY_ROOM_NAME,
        createdBy: 'system',
        tier: 'unlimited',
        maxParticipants: 1000,
        isPublic: true,
        isPersistent: true,
        isOpen24_7: true,
        moderatorRequired: false,
        description: 'PNPtv 24/7 Haus - Open to all, anyone can join and start calls',
        settings: {
          chatEnabled: true,
          recordingEnabled: false, // RECORDING DISABLED - Privacy & Security First
          moderationEnabled: false, // Room moderation disabled - open access
          allowScreenShare: true,
          requireModerator: false, // No moderator required to start
          allowGuestAccess: true, // Guests can join without authentication
          isPrivate: true, // Private, encrypted conversations
          endToEndEncryption: true // E2E encryption enabled
        }
      };

      logger.info('Community room accessed (24/7 open)', { roomId: this.COMMUNITY_ROOM_ID });
      return room;
    } catch (error) {
      logger.error('Error getting community room:', error);
      throw error;
    }
  }

  /**
   * Generate a token for the community room.
   * Accepts a permissions object from resolvePermissionsForTier() to produce
   * tier-specific JaaS JWTs.
   */
  async generateCommunityToken(userId, displayName, email = '', permissions = {}, avatar = '') {
    try {
      const {
        isModerator = false,
        enableScreensharing = false,
        enableLivestreaming = false,
        expiresIn = '30m',
      } = permissions;

      return JaasService.generateToken({
        roomName: this.COMMUNITY_ROOM_NAME,
        userId,
        userName: displayName,
        userEmail: email,
        userAvatar: avatar,
        isModerator,
        enableLivestreaming: false,
        enableRecording: false,
        enableScreensharing,
        expiresIn,
      });
    } catch (error) {
      logger.error('Error generating community token:', error);
      throw error;
    }
  }

  /**
   * Track user joining the community room
   */
  trackUserJoin(userId, displayName, role = 'member', tier = 'free', avatarUrl = '') {
    this.activeUsers.set(userId, {
      userId,
      displayName,
      role,
      tier,
      avatarUrl,
      joinedAt: new Date(),
      isActive: true
    });

    logger.info('User joined community room', {
      userId,
      displayName,
      tier,
      totalActive: this.activeUsers.size
    });
  }

  /**
   * Track user leaving the community room
   */
  trackUserLeave(userId) {
    this.activeUsers.delete(userId);

    logger.info('User left community room', {
      userId,
      totalActive: this.activeUsers.size
    });
  }

  /**
   * Get current room occupancy
   */
  getRoomOccupancy() {
    return {
      activeUsers: this.activeUsers.size,
      users: Array.from(this.activeUsers.values()),
      timestamp: new Date(),
      roomId: this.COMMUNITY_ROOM_ID,
      maxCapacity: 1000,
      utilizationPercent: Math.round((this.activeUsers.size / 1000) * 100)
    };
  }

  /**
   * Add message to history
   */
  addMessage(userId, displayName, message, timestamp = new Date()) {
    const msg = {
      id: `${userId}-${timestamp.getTime()}`,
      userId,
      displayName,
      message,
      timestamp,
      type: 'text'
    };

    this.messageHistory.push(msg);

    // Keep only last 100 messages
    if (this.messageHistory.length > this.MAX_MESSAGES) {
      this.messageHistory.shift();
    }

    return msg;
  }

  /**
   * Get chat history
   */
  getChatHistory(limit = 50) {
    return this.messageHistory.slice(-limit);
  }

  /**
   * Get room statistics
   */
  getRoomStats() {
    return {
      roomId: this.COMMUNITY_ROOM_ID,
      totalActiveUsers: this.activeUsers.size,
      messageCount: this.messageHistory.length,
      uptime: process.uptime(),
      stats: {
        moderators: Array.from(this.activeUsers.values()).filter(u => u.role === 'moderator').length,
        members: Array.from(this.activeUsers.values()).filter(u => u.role === 'member').length,
        guests: Array.from(this.activeUsers.values()).filter(u => u.role === 'guest').length
      }
    };
  }

  /**
   * Mute/unmute user in community room (moderator action)
   */
  muteUser(userId) {
    const user = this.activeUsers.get(userId);
    if (user) {
      user.isMuted = true;
      logger.info('User muted in community room', { userId });
      return true;
    }
    return false;
  }

  /**
   * Remove user from community room (moderator action)
   */
  removeUser(userId) {
    const user = this.activeUsers.get(userId);
    if (user) {
      this.activeUsers.delete(userId);
      logger.info('User removed from community room', { userId });
      return true;
    }
    return false;
  }

  /**
   * Clear chat history
   */
  clearChatHistory() {
    const count = this.messageHistory.length;
    this.messageHistory = [];
    logger.info('Chat history cleared', { count });
    return count;
  }

  /**
   * Resolve Jitsi permissions for a given user based on their subscription tier.
   * Returns a permissions object used by generateCommunityToken() and the join response.
   */
  async resolvePermissionsForTier(userId) {
    try {
      const UserModel = require('../models/userModel');
      const user = await UserModel.getById(userId);
      const label = await EntitlementAccessService.getUserLabel(userId);
      const isAdmin = user && (user.role === 'admin' || user.role === 'superadmin');

      if (isAdmin) {
        return {
          role: 'admin',
          isModerator: true,
          enableScreensharing: true,
          enableLivestreaming: true,
          startAudioMuted: false,
          startVideoMuted: false,
          expiresIn: '4h',
          canClip: true,
          canKnock: false,
          canToggleAudio: true,
          canToggleVideo: true,
        };
      }

      if (label === 'PRIME') {
        return {
          role: 'prime',
          isModerator: false,
          enableScreensharing: true,
          enableLivestreaming: false,
          startAudioMuted: false,
          startVideoMuted: false,
          expiresIn: '30m',
          canClip: true,
          canKnock: false,
          canToggleAudio: true,
          canToggleVideo: true,
        };
      }

      if (label === 'BASIC') {
        return {
          role: 'member',
          isModerator: false,
          enableScreensharing: false,
          enableLivestreaming: false,
          startAudioMuted: true,
          startVideoMuted: true,
          expiresIn: '30m',
          canClip: false,
          canKnock: true,
          canToggleAudio: true,
          canToggleVideo: false,
        };
      }

      // FREE tier (default)
      return {
        role: 'free',
        isModerator: false,
        enableScreensharing: false,
        enableLivestreaming: false,
        startAudioMuted: true,
        startVideoMuted: true,
        expiresIn: '30m',
        canClip: false,
        canKnock: false,
        canToggleAudio: false,
        canToggleVideo: false,
      };
    } catch (error) {
      logger.error('Error resolving permissions for tier:', { userId, error: error.message });
      // Fail-safe: return free-tier permissions on error
      return {
        role: 'free',
        isModerator: false,
        enableScreensharing: false,
        enableLivestreaming: false,
        startAudioMuted: true,
        startVideoMuted: true,
        expiresIn: '30m',
        canClip: false,
        canKnock: false,
        canToggleAudio: false,
        canToggleVideo: false,
      };
    }
  }

  /**
   * Get the current stage mode from Redis.
   * Defaults to 'ambient' if not set.
   */
  async getStageMode() {
    try {
      const redis = getRedis();
      const mode = await redis.get('mainstage:mode');
      return mode || 'ambient';
    } catch (error) {
      logger.error('Error getting stage mode:', error);
      return 'ambient';
    }
  }

  /**
   * Set the stage mode in Redis.
   * If mode is 'dj-live' and masterInfo is provided, also persists master data.
   * Clears master data when switching away from 'dj-live'.
   */
  async setStageMode(mode, masterInfo = null) {
    try {
      const redis = getRedis();
      await redis.set('mainstage:mode', mode);
      if (mode === 'dj-live' && masterInfo) {
        await redis.set('mainstage:master', JSON.stringify(masterInfo));
      } else {
        await redis.del('mainstage:master');
      }
      logger.info('Stage mode updated', { mode, hasMaster: !!masterInfo });
    } catch (error) {
      logger.error('Error setting stage mode:', error);
      throw error;
    }
  }

  /**
   * Get the current stage master (DJ/VJ info) from Redis.
   * Returns null if not set.
   */
  async getStageMaster() {
    try {
      const redis = getRedis();
      const raw = await redis.get('mainstage:master');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (error) {
      logger.error('Error getting stage master:', error);
      return null;
    }
  }

  /**
   * Get the full stage state: mode, master, and room occupancy.
   */
  async getStageState() {
    try {
      const [mode, master, occupancy] = await Promise.all([
        this.getStageMode(),
        this.getStageMaster(),
        this.getRoomOccupancy(),
      ]);
      return { mode, master, occupancy };
    } catch (error) {
      logger.error('Error getting stage state:', error);
      throw error;
    }
  }

  /**
   * Add a knock-to-speak request to the Redis queue.
   */
  async addKnockRequest(userId, displayName) {
    try {
      const redis = getRedis();
      const entry = JSON.stringify({ userId, displayName, requestedAt: Date.now() });
      await redis.rpush('mainstage:knock-queue', entry);
      logger.info('Knock request added', { userId, displayName });
    } catch (error) {
      logger.error('Error adding knock request:', error);
      throw error;
    }
  }

  /**
   * Get all pending knock-to-speak requests from Redis.
   */
  async getKnockQueue() {
    try {
      const redis = getRedis();
      const entries = await redis.lrange('mainstage:knock-queue', 0, -1);
      return entries.map(e => {
        try { return JSON.parse(e); } catch { return null; }
      }).filter(Boolean);
    } catch (error) {
      logger.error('Error getting knock queue:', error);
      return [];
    }
  }

  /**
   * Remove a specific user's knock request from the Redis queue.
   */
  async removeKnockRequest(userId) {
    try {
      const redis = getRedis();
      const entries = await redis.lrange('mainstage:knock-queue', 0, -1);
      for (const entry of entries) {
        try {
          const parsed = JSON.parse(entry);
          if (String(parsed.userId) === String(userId)) {
            await redis.lrem('mainstage:knock-queue', 1, entry);
            logger.info('Knock request removed', { userId });
            return;
          }
        } catch {
          // skip malformed entries
        }
      }
    } catch (error) {
      logger.error('Error removing knock request:', error);
      throw error;
    }
  }

  /**
   * Get leaderboard (most active users)
   */
  getActivityLeaderboard(limit = 10) {
    return Array.from(this.activeUsers.values())
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .slice(0, limit);
  }
}

// Export singleton instance
module.exports = new CommunityRoomService();
