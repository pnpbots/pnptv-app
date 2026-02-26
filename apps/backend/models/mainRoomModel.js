/**
 * Main Room Model
 * Handles 3 permanent 50-person community rooms
 */

const { query, getClient } = require('../config/postgres');
const logger = require('../utils/logger');
const agoraTokenService = require('../services/agora/agoraTokenService');

class MainRoomModel {
  /**
   * Get room by ID
   * @param {number} roomId - Room ID (1, 2, or 3)
   * @returns {Promise<Object|null>} Room data or null
   */
  static async getById(roomId) {
    try {
      const result = await query(
        'SELECT * FROM main_rooms WHERE id = $1',
        [roomId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this._mapRoomFromDb(result.rows[0]);
    } catch (error) {
      logger.error('Error getting room:', error);
      throw error;
    }
  }

  /**
   * Get all rooms
   * @returns {Promise<Array>} All rooms
   */
  static async getAll() {
    try {
      const result = await query(
        'SELECT * FROM main_rooms ORDER BY id ASC'
      );

      return result.rows.map(row => this._mapRoomFromDb(row));
    } catch (error) {
      logger.error('Error getting rooms:', error);
      throw error;
    }
  }

  /**
   * Join a room
   * @param {number} roomId - Room ID
   * @param {string} userId - User ID
   * @param {string} userName - User name
   * @param {boolean} asPublisher - Join as publisher (can broadcast)
   * @returns {Promise<Object>} Tokens and room info
   */
  static async joinRoom(roomId, userId, userName, asPublisher = false) {
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // Get room with lock
      const roomResult = await client.query(
        'SELECT * FROM main_rooms WHERE id = $1 FOR UPDATE',
        [roomId]
      );

      if (roomResult.rows.length === 0) {
        throw new Error('Room not found');
      }

      const room = this._mapRoomFromDb(roomResult.rows[0]);

      if (!room.isActive) {
        throw new Error('Room is not active');
      }

      // Check capacity for publishers
      if (asPublisher && room.currentParticipants >= room.maxParticipants) {
        throw new Error('Room is full (50/50 publishers)');
      }

      // Check if already in room
      const existingParticipant = await client.query(
        `SELECT id, is_publisher FROM room_participants
         WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL`,
        [roomId, String(userId)]
      );

      if (existingParticipant.rows.length > 0) {
        // Already in room
        const currentRole = existingParticipant.rows[0].is_publisher;

        // If requesting upgrade to publisher
        if (asPublisher && !currentRole) {
          if (room.currentParticipants >= room.maxParticipants) {
            throw new Error('Room is full - cannot upgrade to publisher');
          }

          // Upgrade to publisher
          await client.query(
            `UPDATE room_participants
             SET is_publisher = true
             WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL`,
            [roomId, String(userId)]
          );

          // Log event
          await this.logRoomEvent(roomId, 'PUBLISH_GRANTED', null, userId);
        }

        await client.query('COMMIT');

        // Generate tokens
        const tokens = agoraTokenService.generateMainRoomTokens(
          room.channelName,
          userId,
          asPublisher
        );

        return {
          room,
          ...tokens,
          alreadyJoined: true,
          upgraded: asPublisher && !currentRole,
        };
      }

      // Add new participant
      await client.query(
        `INSERT INTO room_participants (
          room_id, user_id, user_name, is_publisher, joined_at
        ) VALUES ($1, $2, $3, $4, NOW())`,
        [roomId, String(userId), userName, asPublisher]
      );

      // Increment participant counter
      await client.query(
        `UPDATE main_rooms SET current_participants = current_participants + 1 WHERE id = $1`,
        [roomId]
      );

      // Log event
      await this.logRoomEvent(
        roomId,
        asPublisher ? 'USER_JOINED_PUBLISHER' : 'USER_JOINED_VIEWER',
        null,
        userId
      );

      await client.query('COMMIT');

      // Generate tokens
      const tokens = agoraTokenService.generateMainRoomTokens(
        room.channelName,
        userId,
        asPublisher
      );

      logger.info('User joined room', { roomId, userId, asPublisher });

      return {
        room,
        ...tokens,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error joining room:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Leave a room
   * @param {number} roomId - Room ID
   * @param {string} userId - User ID
   * @returns {Promise<void>}
   */
  static async leaveRoom(roomId, userId) {
    try {
      const result = await query(
        `UPDATE room_participants
         SET left_at = NOW(),
             total_duration_seconds = EXTRACT(EPOCH FROM (NOW() - joined_at))::INTEGER
         WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL
         RETURNING id`,
        [roomId, String(userId)]
      );

      if (result.rows.length > 0) {
        // Decrement participant counter (ensure it doesn't go below 0)
        await query(
          `UPDATE main_rooms SET current_participants = GREATEST(current_participants - 1, 0) WHERE id = $1`,
          [roomId]
        );
        // Log event
        await this.logRoomEvent(roomId, 'USER_LEFT', null, userId);
        logger.info('User left room', { roomId, userId });
      }
    } catch (error) {
      logger.error('Error leaving room:', error);
      throw error;
    }
  }

  /**
   * Get room participants
   * @param {number} roomId - Room ID
   * @param {boolean} publishersOnly - Only get publishers
   * @returns {Promise<Array>} Participants
   */
  static async getParticipants(roomId, publishersOnly = false) {
    try {
      let sql = `
        SELECT * FROM room_participants
        WHERE room_id = $1 AND left_at IS NULL
      `;

      if (publishersOnly) {
        sql += ' AND is_publisher = true';
      }

      sql += ' ORDER BY joined_at ASC';

      const result = await query(sql, [roomId]);

      return result.rows.map(row => ({
        userId: row.user_id,
        userName: row.user_name,
        isPublisher: row.is_publisher,
        isModerator: row.is_moderator,
        joinedAt: row.joined_at,
      }));
    } catch (error) {
      logger.error('Error getting participants:', error);
      throw error;
    }
  }

  /**
   * Kick participant (moderator only)
   * @param {number} roomId - Room ID
   * @param {string} participantUserId - User ID to kick
   * @param {string} moderatorUserId - Moderator user ID
   * @returns {Promise<void>}
   */
  static async kickParticipant(roomId, participantUserId, moderatorUserId) {
    try {
      // In production, verify moderatorUserId has permissions
      // For now, bot users and admins can kick

      const result = await query(
        `UPDATE room_participants
         SET left_at = NOW(),
             total_duration_seconds = EXTRACT(EPOCH FROM (NOW() - joined_at))::INTEGER
         WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL
         RETURNING id`,
        [roomId, String(participantUserId)]
      );

      if (result.rows.length > 0) {
        // Decrement participant counter
        await query(
          `UPDATE main_rooms SET current_participants = GREATEST(current_participants - 1, 0) WHERE id = $1`,
          [roomId]
        );
      }

      // Log event
      await this.logRoomEvent(roomId, 'USER_KICKED', moderatorUserId, participantUserId);

      logger.info('Participant kicked from room', { roomId, participantUserId, moderatorUserId });
    } catch (error) {
      logger.error('Error kicking participant:', error);
      throw error;
    }
  }

  /**
   * Mute participant (moderator only)
   * @param {number} roomId - Room ID
   * @param {string} participantUserId - User ID to mute
   * @param {string} moderatorUserId - Moderator user ID
   * @param {string} mediaType - 'audio' or 'video'
   * @returns {Promise<void>}
   */
  static async muteParticipant(roomId, participantUserId, moderatorUserId, mediaType = 'audio') {
    try {
      // Log event
      await this.logRoomEvent(
        roomId,
        mediaType === 'video' ? 'USER_VIDEO_MUTED' : 'USER_AUDIO_MUTED',
        moderatorUserId,
        participantUserId
      );

      logger.info('Participant muted in room', { roomId, participantUserId, moderatorUserId, mediaType });

      return {
        type: 'MUTE_USER',
        targetUserId: participantUserId,
        mediaType,
      };
    } catch (error) {
      logger.error('Error muting participant:', error);
      throw error;
    }
  }

  /**
   * Set spotlight (change main view)
   * @param {number} roomId - Room ID
   * @param {string} participantUserId - User ID to spotlight
   * @param {string} moderatorUserId - Moderator user ID
   * @returns {Promise<Object>} Spotlight command
   */
  static async setSpotlight(roomId, participantUserId, moderatorUserId) {
    try {
      // Log event
      await this.logRoomEvent(roomId, 'SPOTLIGHT_SET', moderatorUserId, participantUserId);

      logger.info('Spotlight set in room', { roomId, participantUserId, moderatorUserId });

      return {
        type: 'SET_SPOTLIGHT',
        userId: participantUserId,
      };
    } catch (error) {
      logger.error('Error setting spotlight:', error);
      throw error;
    }
  }

  /**
   * Log room event
   * @param {number} roomId - Room ID
   * @param {string} eventType - Event type
   * @param {string} initiatorUserId - Who initiated the event
   * @param {string} targetUserId - Who was affected
   * @param {Object} metadata - Additional data
   * @returns {Promise<void>}
   */
  static async logRoomEvent(roomId, eventType, initiatorUserId, targetUserId, metadata = {}) {
    try {
      await query(
        `INSERT INTO room_events (
          room_id, event_type, initiator_user_id, target_user_id, metadata
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          roomId,
          eventType,
          initiatorUserId ? String(initiatorUserId) : null,
          targetUserId ? String(targetUserId) : null,
          JSON.stringify(metadata),
        ]
      );
    } catch (error) {
      logger.error('Error logging room event:', error);
      // Non-critical, don't throw
    }
  }

  /**
   * Get room events (for admin/debugging)
   * @param {number} roomId - Room ID
   * @param {number} limit - Max events to return
   * @returns {Promise<Array>} Events
   */
  static async getEvents(roomId, limit = 100) {
    try {
      const result = await query(
        `SELECT * FROM room_events
         WHERE room_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [roomId, limit]
      );

      return result.rows.map(row => ({
        eventType: row.event_type,
        initiatorUserId: row.initiator_user_id,
        targetUserId: row.target_user_id,
        metadata: row.metadata,
        createdAt: row.created_at,
      }));
    } catch (error) {
      logger.error('Error getting room events:', error);
      throw error;
    }
  }

  /**
   * Update room settings (admin only)
   * @param {number} roomId - Room ID
   * @param {Object} settings - Settings to update
   * @returns {Promise<void>}
   */
  static async updateSettings(roomId, settings) {
    try {
      const {
        name,
        description,
        maxParticipants,
        enforceCamera,
        autoApprovePublisher,
      } = settings;

      const fields = [];
      const values = [roomId];
      let paramCount = 2;

      if (name !== undefined) {
        fields.push(`name = $${paramCount}`);
        values.push(name);
        paramCount++;
      }

      if (description !== undefined) {
        fields.push(`description = $${paramCount}`);
        values.push(description);
        paramCount++;
      }

      if (maxParticipants !== undefined) {
        fields.push(`max_participants = $${paramCount}`);
        values.push(maxParticipants);
        paramCount++;
      }

      if (enforceCamera !== undefined) {
        fields.push(`enforce_camera = $${paramCount}`);
        values.push(enforceCamera);
        paramCount++;
      }

      if (autoApprovePublisher !== undefined) {
        fields.push(`auto_approve_publisher = $${paramCount}`);
        values.push(autoApprovePublisher);
        paramCount++;
      }

      if (fields.length === 0) {
        return;
      }

      fields.push('updated_at = NOW()');

      await query(
        `UPDATE main_rooms SET ${fields.join(', ')} WHERE id = $1`,
        values
      );

      logger.info('Room settings updated', { roomId, settings });
    } catch (error) {
      logger.error('Error updating room settings:', error);
      throw error;
    }
  }

  /**
   * Delete a main room (only when empty)
   * @param {number} roomId - Room ID
   * @returns {Promise<Object>} Deleted room data
   */
  static async deleteRoom(roomId) {
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // Get room with lock
      const roomResult = await client.query(
        'SELECT * FROM main_rooms WHERE id = $1 FOR UPDATE',
        [roomId]
      );

      if (roomResult.rows.length === 0) {
        throw new Error('Room not found');
      }

      const room = roomResult.rows[0];

      // Check if room has active participants
      const participantsResult = await client.query(
        `SELECT COUNT(*) as count FROM room_participants
         WHERE room_id = $1 AND left_at IS NULL`,
        [roomId]
      );

      const activeParticipants = parseInt(participantsResult.rows[0].count);

      if (activeParticipants > 0) {
        throw new Error('Cannot delete room with active participants. Please wait for all participants to leave.');
      }

      // Delete all room participants
      await client.query(
        'DELETE FROM room_participants WHERE room_id = $1',
        [roomId]
      );

      // Delete all room events
      await client.query(
        'DELETE FROM room_events WHERE room_id = $1',
        [roomId]
      );

      // Delete the room
      const deleteResult = await client.query(
        'DELETE FROM main_rooms WHERE id = $1 RETURNING *',
        [roomId]
      );

      await client.query('COMMIT');

      logger.info('Main room deleted', { roomId });

      return this._mapRoomFromDb(deleteResult.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error deleting room:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Map database row to room object
   * @private
   */
  static _mapRoomFromDb(row) {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      channelName: row.channel_name,
      botUserId: row.bot_user_id,
      maxParticipants: row.max_participants,
      currentParticipants: row.current_participants || 0,
      isActive: row.is_active,
      enforceCamera: row.enforce_camera,
      autoApprovePublisher: row.auto_approve_publisher,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

module.exports = MainRoomModel;
