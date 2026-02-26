/**
 * Room WebSocket Service
 * Manages real-time updates for main rooms and video calls
 * Features:
 * - Live participant count updates
 * - Room status changes (full, available, etc.)
 * - User join/leave notifications
 * - Broadcast to all connected clients
 */

const logger = require('../../utils/logger');

class RoomWebSocketService {
  constructor() {
    this.clients = new Map(); // roomId => Set of WebSocket clients
    this.userRooms = new Map(); // userId => Set of room IDs
    this.roomStates = new Map(); // roomId => { count, isFull, lastUpdate }
  }

  /**
   * Register a client for a specific room
   * @param {string} roomId - Room ID
   * @param {string} userId - User ID
   * @param {WebSocket} socket - WebSocket connection
   */
  registerClient(roomId, userId, socket) {
    try {
      // Add client to room
      if (!this.clients.has(roomId)) {
        this.clients.set(roomId, new Set());
      }
      this.clients.get(roomId).add(socket);

      // Track user's rooms
      if (!this.userRooms.has(userId)) {
        this.userRooms.set(userId, new Set());
      }
      this.userRooms.get(userId).add(roomId);

      // Setup handlers
      socket.on('close', () => this.unregisterClient(roomId, userId, socket));
      socket.on('error', (error) => {
        logger.error('WebSocket error:', error);
        this.unregisterClient(roomId, userId, socket);
      });

      logger.info('WebSocket client registered', { roomId, userId });

      return true;
    } catch (error) {
      logger.error('Error registering WebSocket client:', error);
      return false;
    }
  }

  /**
   * Unregister a client from a room
   * @param {string} roomId - Room ID
   * @param {string} userId - User ID
   * @param {WebSocket} socket - WebSocket connection
   */
  unregisterClient(roomId, userId, socket) {
    try {
      if (this.clients.has(roomId)) {
        this.clients.get(roomId).delete(socket);
        if (this.clients.get(roomId).size === 0) {
          this.clients.delete(roomId);
        }
      }

      if (this.userRooms.has(userId)) {
        this.userRooms.get(userId).delete(roomId);
        if (this.userRooms.get(userId).size === 0) {
          this.userRooms.delete(userId);
        }
      }

      logger.info('WebSocket client unregistered', { roomId, userId });
    } catch (error) {
      logger.error('Error unregistering WebSocket client:', error);
    }
  }

  /**
   * Broadcast room status update to all connected clients
   * @param {number} roomId - Room ID
   * @param {Object} update - Status update {currentParticipants, maxParticipants, isFull, event}
   */
  broadcastRoomUpdate(roomId, update) {
    try {
      if (!this.clients.has(roomId)) {
        return; // No clients in this room
      }

      const message = {
        type: 'ROOM_UPDATE',
        roomId,
        timestamp: new Date().toISOString(),
        ...update,
      };

      const messageJson = JSON.stringify(message);
      const failedClients = [];

      for (const socket of this.clients.get(roomId)) {
        try {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(messageJson);
          }
        } catch (error) {
          logger.error('Error sending WebSocket message:', error);
          failedClients.push(socket);
        }
      }

      // Clean up failed connections
      failedClients.forEach(socket => {
        this.clients.get(roomId).delete(socket);
      });

      logger.debug('Room update broadcasted', { roomId, clientCount: this.clients.get(roomId)?.size || 0 });
    } catch (error) {
      logger.error('Error broadcasting room update:', error);
    }
  }

  /**
   * Notify about participant join
   * @param {number} roomId - Room ID
   * @param {string} participantName - Name of participant
   * @param {number} currentCount - Current participant count
   * @param {number} maxCount - Max participants
   */
  notifyParticipantJoin(roomId, participantName, currentCount, maxCount) {
    this.broadcastRoomUpdate(roomId, {
      event: 'USER_JOINED',
      participantName,
      currentParticipants: currentCount,
      maxParticipants: maxCount,
      isFull: currentCount >= maxCount,
      availableSlots: maxCount - currentCount,
    });
  }

  /**
   * Notify about participant leave
   * @param {number} roomId - Room ID
   * @param {string} participantName - Name of participant
   * @param {number} currentCount - Current participant count
   * @param {number} maxCount - Max participants
   */
  notifyParticipantLeave(roomId, participantName, currentCount, maxCount) {
    this.broadcastRoomUpdate(roomId, {
      event: 'USER_LEFT',
      participantName,
      currentParticipants: currentCount,
      maxParticipants: maxCount,
      isFull: currentCount >= maxCount,
      availableSlots: maxCount - currentCount,
    });
  }

  /**
   * Notify about room status change
   * @param {number} roomId - Room ID
   * @param {string} status - Room status (FULL, AVAILABLE, OFFLINE)
   * @param {number} currentCount - Current participant count
   * @param {number} maxCount - Max participants
   */
  notifyRoomStatusChange(roomId, status, currentCount, maxCount) {
    this.broadcastRoomUpdate(roomId, {
      event: 'ROOM_STATUS_CHANGED',
      status,
      currentParticipants: currentCount,
      maxParticipants: maxCount,
      isFull: status === 'FULL',
      availableSlots: maxCount - currentCount,
    });
  }

  /**
   * Broadcast participant count update
   * @param {number} roomId - Room ID
   * @param {number} currentCount - Current participant count
   * @param {number} maxCount - Max participants
   */
  broadcastParticipantCount(roomId, currentCount, maxCount) {
    this.broadcastRoomUpdate(roomId, {
      event: 'PARTICIPANT_COUNT_UPDATED',
      currentParticipants: currentCount,
      maxParticipants: maxCount,
      isFull: currentCount >= maxCount,
      availableSlots: maxCount - currentCount,
    });
  }

  /**
   * Get connected clients count for a room
   * @param {number} roomId - Room ID
   * @returns {number} Number of connected clients
   */
  getClientCount(roomId) {
    return this.clients.get(roomId)?.size || 0;
  }

  /**
   * Get all rooms with active connections
   * @returns {Array<number>} Array of room IDs
   */
  getActiveRooms() {
    return Array.from(this.clients.keys());
  }

  /**
   * Disconnect all clients in a room
   * @param {number} roomId - Room ID
   */
  disconnectRoom(roomId) {
    try {
      if (this.clients.has(roomId)) {
        for (const socket of this.clients.get(roomId)) {
          if (socket.readyState === WebSocket.OPEN) {
            socket.close(1000, 'Room closed');
          }
        }
        this.clients.delete(roomId);
      }
      logger.info('Room disconnected', { roomId });
    } catch (error) {
      logger.error('Error disconnecting room:', error);
    }
  }

  /**
   * Get service statistics
   * @returns {Object} Stats object
   */
  getStats() {
    return {
      totalRoomsWithClients: this.clients.size,
      totalConnections: Array.from(this.clients.values()).reduce((sum, set) => sum + set.size, 0),
      totalUsersTracked: this.userRooms.size,
      activeRooms: this.getActiveRooms(),
    };
  }
}

// Singleton instance
const instance = new RoomWebSocketService();

module.exports = instance;
