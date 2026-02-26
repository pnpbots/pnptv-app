/**
 * Video Call Model
 * Handles 10-person video calls for PRIME members
 */

const { query, getClient } = require('../config/postgres');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const agoraTokenService = require('../services/agora/agoraTokenService');

class VideoCallModel {
  /**
   * Create a new video call
   * @param {Object} callData - Call configuration
   * @returns {Promise<Object>} Created call with tokens
   */
  static async create(callData) {
    try {
      const {
        creatorId,
        creatorName,
        title = null,
        maxParticipants = 10,
        enforceCamera = true,
        allowGuests = true,
        isPublic = false,
        recordingEnabled = false,
      } = callData;

      if (!creatorId || !creatorName) {
        throw new Error('Missing required fields: creatorId or creatorName');
      }

      const callId = uuidv4();
      const channelName = `call_${callId.replace(/-/g, '').substring(0, 16)}`;

      // Insert into database
      const result = await query(
        `INSERT INTO video_calls (
          id, creator_id, creator_name, channel_name, title,
          max_participants, enforce_camera, allow_guests, is_public,
          recording_enabled, current_participants, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, true)
        RETURNING *`,
        [
          callId,
          String(creatorId),
          creatorName,
          channelName,
          title,
          maxParticipants,
          enforceCamera,
          allowGuests,
          isPublic,
          recordingEnabled,
        ]
      );

      const call = this._mapCallFromDb(result.rows[0]);

      // Generate host tokens
      const tokens = agoraTokenService.generateVideoCallTokens(
        channelName,
        creatorId,
        true // isHost
      );

      // Register channel
      await this.registerChannel(channelName, call.id, maxParticipants);

      logger.info('Video call created', { callId, creatorId, channelName });

      return {
        ...call,
        ...tokens,
      };
    } catch (error) {
      logger.error('Error creating video call:', error);
      throw error;
    }
  }

  /**
   * Get call by ID
   * @param {string} callId - Call ID
   * @returns {Promise<Object|null>} Call data or null
   */
  static async getById(callId) {
    try {
      const result = await query(
        'SELECT * FROM video_calls WHERE id = $1',
        [callId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this._mapCallFromDb(result.rows[0]);
    } catch (error) {
      logger.error('Error getting call:', error);
      throw error;
    }
  }

  /**
   * Join a call
   * @param {string} callId - Call ID
   * @param {string} userId - User ID
   * @param {string} userName - User name
   * @param {boolean} isGuest - Is guest user
   * @returns {Promise<Object>} Tokens and call info
   */
  static async joinCall(callId, userId, userName, isGuest = false) {
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // Get call with lock
      const callResult = await client.query(
        'SELECT * FROM video_calls WHERE id = $1 FOR UPDATE',
        [callId]
      );

      if (callResult.rows.length === 0) {
        throw new Error('Call not found');
      }

      const call = this._mapCallFromDb(callResult.rows[0]);

      if (!call.isActive) {
        throw new Error('Call has ended');
      }

      // Check if guests allowed
      if (isGuest && !call.allowGuests) {
        throw new Error('Guests are not allowed in this call');
      }

      // Check capacity
      if (call.currentParticipants >= call.maxParticipants) {
        throw new Error('Call is full');
      }

      // Check if already in call
      const existingParticipant = await client.query(
        `SELECT id FROM call_participants
         WHERE call_id = $1 AND user_id = $2 AND left_at IS NULL`,
        [callId, String(userId)]
      );

      if (existingParticipant.rows.length > 0) {
        // Already in call, just return tokens
        const tokens = agoraTokenService.generateVideoCallTokens(
          call.channelName,
          userId,
          false // Not host
        );

        await client.query('COMMIT');

        return {
          call,
          ...tokens,
          alreadyJoined: true,
        };
      }

      // Add participant
      await client.query(
        `INSERT INTO call_participants (
          call_id, user_id, user_name, is_guest, is_host, joined_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())`,
        [callId, String(userId), userName, isGuest, false]
      );

      // Increment participant counter
      await client.query(
        `UPDATE video_calls SET current_participants = current_participants + 1 WHERE id = $1`,
        [callId]
      );

      await client.query('COMMIT');

      // Generate tokens
      const tokens = agoraTokenService.generateVideoCallTokens(
        call.channelName,
        userId,
        false // Not host
      );

      logger.info('User joined call', { callId, userId, isGuest });

      return {
        call,
        ...tokens,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error joining call:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Leave a call
   * @param {string} callId - Call ID
   * @param {string} userId - User ID
   * @returns {Promise<void>}
   */
  static async leaveCall(callId, userId) {
    try {
      const result = await query(
        `UPDATE call_participants
         SET left_at = NOW(),
             total_duration_seconds = EXTRACT(EPOCH FROM (NOW() - joined_at))::INTEGER
         WHERE call_id = $1 AND user_id = $2 AND left_at IS NULL
         RETURNING id`,
        [callId, String(userId)]
      );

      if (result.rows.length > 0) {
        // Decrement participant counter (ensure it doesn't go below 0)
        await query(
          `UPDATE video_calls SET current_participants = GREATEST(current_participants - 1, 0) WHERE id = $1`,
          [callId]
        );
        logger.info('User left call', { callId, userId });
      }
    } catch (error) {
      logger.error('Error leaving call:', error);
      throw error;
    }
  }

  /**
   * End a call (by creator)
   * @param {string} callId - Call ID
   * @param {string} creatorId - Creator user ID
   * @returns {Promise<void>}
   */
  static async endCall(callId, creatorId) {
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // Get call
      const callResult = await client.query(
        'SELECT * FROM video_calls WHERE id = $1 FOR UPDATE',
        [callId]
      );

      if (callResult.rows.length === 0) {
        throw new Error('Call not found');
      }

      const call = callResult.rows[0];

      if (call.creator_id !== String(creatorId)) {
        throw new Error('Only the creator can end the call');
      }

      if (!call.is_active) {
        throw new Error('Call already ended');
      }

      // Calculate duration
      const duration = Math.floor(
        (Date.now() - new Date(call.created_at).getTime()) / 1000
      );

      // Update call (reset participant counter)
      await client.query(
        `UPDATE video_calls
         SET is_active = false,
             ended_at = NOW(),
             duration_seconds = $2,
             current_participants = 0
         WHERE id = $1`,
        [callId, duration]
      );

      // Mark all participants as left
      await client.query(
        `UPDATE call_participants
         SET left_at = NOW(),
             total_duration_seconds = EXTRACT(EPOCH FROM (NOW() - joined_at))::INTEGER
         WHERE call_id = $1 AND left_at IS NULL`,
        [callId]
      );

      // Deactivate channel
      await client.query(
        `UPDATE agora_channels
         SET is_active = false
         WHERE channel_name = $1`,
        [call.channel_name]
      );

      await client.query('COMMIT');

      logger.info('Call ended', { callId, creatorId, duration });
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error ending call:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get all public active calls
   * @returns {Promise<Array>} Public active calls
   */
  static async getAllPublic() {
    try {
      logger.info('Fetching public video calls from database');
      const result = await query(
        `SELECT * FROM video_calls
         WHERE is_public = true AND is_active = true
         ORDER BY created_at DESC
         LIMIT 50`
      );

      logger.info('Successfully fetched public video calls', { count: result.rows.length });
      return result.rows.map(row => this._mapCallFromDb(row));
    } catch (error) {
      logger.error('Error getting public calls:', error, {
        message: error.message,
        code: error.code,
        detail: error.detail
      });
      throw error;
    }
  }

  /**
   * Get active calls by creator
   * @param {string} creatorId - Creator user ID
   * @returns {Promise<Array>} Active calls
   */
  static async getActiveByCreator(creatorId) {
    try {
      const result = await query(
        `SELECT * FROM video_calls
         WHERE creator_id = $1 AND is_active = true
         ORDER BY created_at DESC`,
        [String(creatorId)]
      );

      return result.rows.map(row => this._mapCallFromDb(row));
    } catch (error) {
      logger.error('Error getting active calls:', error);
      throw error;
    }
  }

  /**
   * Get call participants
   * @param {string} callId - Call ID
   * @returns {Promise<Array>} Participants
   */
  static async getParticipants(callId) {
    try {
      const result = await query(
        `SELECT * FROM call_participants
         WHERE call_id = $1
         ORDER BY joined_at ASC`,
        [callId]
      );

      return result.rows.map(row => ({
        userId: row.user_id,
        userName: row.user_name,
        isGuest: row.is_guest,
        isHost: row.is_host,
        joinedAt: row.joined_at,
        leftAt: row.left_at,
        durationSeconds: row.total_duration_seconds,
      }));
    } catch (error) {
      logger.error('Error getting participants:', error);
      throw error;
    }
  }

  /**
   * Kick participant (host only)
   * @param {string} callId - Call ID
   * @param {string} participantUserId - User ID to kick
   * @param {string} hostUserId - Host user ID
   * @returns {Promise<void>}
   */
  static async kickParticipant(callId, participantUserId, hostUserId) {
    try {
      // Verify host
      const call = await this.getById(callId);
      if (call.creatorId !== String(hostUserId)) {
        throw new Error('Only the host can kick participants');
      }

      // Mark as kicked
      const result = await query(
        `UPDATE call_participants
         SET left_at = NOW(),
             was_kicked = true,
             total_duration_seconds = EXTRACT(EPOCH FROM (NOW() - joined_at))::INTEGER
         WHERE call_id = $1 AND user_id = $2 AND left_at IS NULL
         RETURNING id`,
        [callId, String(participantUserId)]
      );

      if (result.rows.length > 0) {
        // Decrement participant counter
        await query(
          `UPDATE video_calls SET current_participants = GREATEST(current_participants - 1, 0) WHERE id = $1`,
          [callId]
        );
      }

      logger.info('Participant kicked', { callId, participantUserId, hostUserId });
    } catch (error) {
      logger.error('Error kicking participant:', error);
      throw error;
    }
  }

  /**
   * Delete a call (only when empty)
   * @param {string} callId - Call ID
   * @param {string} creatorId - Creator user ID
   * @returns {Promise<Object>} Deleted call data
   */
  static async deleteCall(callId, creatorId) {
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // Get call with lock
      const callResult = await client.query(
        'SELECT * FROM video_calls WHERE id = $1 FOR UPDATE',
        [callId]
      );

      if (callResult.rows.length === 0) {
        throw new Error('Call not found');
      }

      const call = callResult.rows[0];

      if (call.creator_id !== String(creatorId)) {
        throw new Error('Only the creator can delete the call');
      }

      // Check if room is empty (no active participants)
      const participantsResult = await client.query(
        `SELECT COUNT(*) as count FROM call_participants
         WHERE call_id = $1 AND left_at IS NULL`,
        [callId]
      );

      const activeParticipants = parseInt(participantsResult.rows[0].count);

      if (activeParticipants > 0) {
        throw new Error('Cannot delete call with active participants. Please wait for all participants to leave.');
      }

      // Delete call participants (cascade)
      await client.query(
        'DELETE FROM call_participants WHERE call_id = $1',
        [callId]
      );

      // Delete the call
      const deleteResult = await client.query(
        'DELETE FROM video_calls WHERE id = $1 RETURNING *',
        [callId]
      );

      // Deactivate Agora channel
      await client.query(
        `UPDATE agora_channels
         SET is_active = false
         WHERE channel_name = $1`,
        [call.channel_name]
      );

      await client.query('COMMIT');

      logger.info('Call deleted', { callId, creatorId });

      return this._mapCallFromDb(deleteResult.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error deleting call:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Register Agora channel
   * @private
   */
  static async registerChannel(channelName, callId, maxParticipants) {
    try {
      await query(
        `INSERT INTO agora_channels (
          channel_name, channel_type, feature_name, created_by,
          max_participants, is_active, metadata
        ) VALUES ($1, 'call', 'hangouts', $2, $3, true, $4)`,
        [channelName, callId, maxParticipants, JSON.stringify({ callId })]
      );
    } catch (error) {
      logger.error('Error registering channel:', error);
      // Non-critical, don't throw
    }
  }

  /**
   * Map database row to call object
   * @private
   */
  static _mapCallFromDb(row) {
    return {
      id: row.id,
      creatorId: row.creator_id,
      creatorName: row.creator_name,
      channelName: row.channel_name,
      title: row.title,
      isActive: row.is_active,
      maxParticipants: row.max_participants,
      currentParticipants: row.current_participants || 0,
      enforceCamera: row.enforce_camera,
      allowGuests: row.allow_guests,
      isPublic: row.is_public,
      recordingEnabled: row.recording_enabled,
      recordingUrl: row.recording_url,
      createdAt: row.created_at,
      endedAt: row.ended_at,
      durationSeconds: row.duration_seconds,
    };
  }
}

module.exports = VideoCallModel;
