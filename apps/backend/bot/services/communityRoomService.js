const logger = require('../../utils/logger');
const JaasService = require('./jaasService');

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
   * Generate a token for the community room
   */
  async generateCommunityToken(userId, displayName, email = '', isModerator = false) {
    try {
      if (isModerator) {
        return JaasService.generateModeratorToken(
          this.COMMUNITY_ROOM_NAME,
          userId,
          displayName,
          email,
          ''
        );
      } else {
        return JaasService.generateViewerToken(
          this.COMMUNITY_ROOM_NAME,
          userId,
          displayName,
          email,
          ''
        );
      }
    } catch (error) {
      logger.error('Error generating community token:', error);
      throw error;
    }
  }

  /**
   * Track user joining the community room
   */
  trackUserJoin(userId, displayName, role = 'member') {
    this.activeUsers.set(userId, {
      userId,
      displayName,
      role,
      joinedAt: new Date(),
      isActive: true
    });

    logger.info('User joined community room', {
      userId,
      displayName,
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
