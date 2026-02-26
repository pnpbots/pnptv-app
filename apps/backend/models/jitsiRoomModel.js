const pool = require('../config/postgres');
const logger = require('../utils/logger');
const { generateRoomCode } = require('../utils/helpers');

/**
 * Jitsi Room Model
 * Handles all database operations for Jitsi tiered call rooms
 *
 * Tiers:
 * - mini: max 10 participants
 * - medium: max 50 participants
 * - unlimited: no participant limit
 */
class JitsiRoomModel {
    // Tier configuration
    static TIERS = {
        mini: { name: 'Mini', maxParticipants: 10, icon: '🏠' },
        medium: { name: 'Medium', maxParticipants: 50, icon: '🏢' },
        unlimited: { name: 'Unlimited', maxParticipants: 1000, icon: '🌐' }
    };

    /**
     * Create a new Jitsi room
     * @param {Object} roomData - Room configuration
     * @returns {Promise<Object>} Created room
     */
    static async create(roomData) {
        const {
            hostUserId,
            hostName,
            hostTelegramId,
            tier = 'mini',
            title = 'PNP.tv Jitsi Room',
            description,
            scheduledStartTime,
            scheduledDuration = 120, // Default: 2 hours
            settings = {},
            isPublic = true,
            requiresPassword = false,
            roomPassword,
            telegramGroupId,
            jitsiDomain = 'meet.jit.si'
        } = roomData;

        try {
            const roomCode = await this.generateUniqueRoomCode();
            const roomName = `pnptv-${roomCode.toLowerCase().replace(/-/g, '')}`;
            const maxParticipants = this.TIERS[tier]?.maxParticipants || 10;

            const defaultSettings = {
                start_with_audio_muted: true,
                start_with_video_muted: false,
                enable_lobby: true,
                enable_recording: false,
                enable_chat: true,
                enable_screen_share: true,
                require_display_name: true,
                enable_prejoin_page: true,
                ...settings
            };

            const query = `
                INSERT INTO jitsi_rooms (
                    room_code,
                    room_name,
                    host_user_id,
                    host_name,
                    host_telegram_id,
                    tier,
                    max_participants,
                    title,
                    description,
                    jitsi_domain,
                    scheduled_start_time,
                    scheduled_duration,
                    settings,
                    is_public,
                    requires_password,
                    room_password,
                    telegram_group_id,
                    status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                RETURNING *
            `;

            const values = [
                roomCode,
                roomName,
                hostUserId,
                hostName,
                hostTelegramId,
                tier,
                maxParticipants,
                title,
                description,
                jitsiDomain,
                scheduledStartTime,
                scheduledDuration,
                JSON.stringify(defaultSettings),
                isPublic,
                requiresPassword,
                roomPassword,
                telegramGroupId,
                scheduledStartTime ? 'scheduled' : 'active'
            ];

            const result = await pool.query(query, values);
            logger.info(`Jitsi room created: ${roomCode} (${tier}) by user ${hostUserId}`);

            return result.rows[0];
        } catch (error) {
            logger.error('Error creating Jitsi room:', error);
            throw error;
        }
    }

    /**
     * Generate a unique room code
     * @returns {Promise<string>} Unique room code
     */
    static async generateUniqueRoomCode() {
        let roomCode;
        let isUnique = false;
        let attempts = 0;
        const maxAttempts = 10;

        while (!isUnique && attempts < maxAttempts) {
            roomCode = generateRoomCode();
            const existing = await this.getByRoomCode(roomCode);
            if (!existing) {
                isUnique = true;
            }
            attempts++;
        }

        if (!isUnique) {
            throw new Error('Failed to generate unique room code');
        }

        return roomCode;
    }

    /**
     * Get room by ID
     */
    static async getById(roomId) {
        try {
            const query = 'SELECT * FROM jitsi_rooms WHERE id = $1';
            const result = await pool.query(query, [roomId]);
            return result.rows[0] || null;
        } catch (error) {
            logger.error('Error getting Jitsi room by ID:', error);
            throw error;
        }
    }

    /**
     * Get room by room code
     */
    static async getByRoomCode(roomCode) {
        try {
            const query = 'SELECT * FROM jitsi_rooms WHERE room_code = $1';
            const result = await pool.query(query, [roomCode.toUpperCase()]);
            return result.rows[0] || null;
        } catch (error) {
            logger.error('Error getting Jitsi room by code:', error);
            throw error;
        }
    }

    /**
     * Get rooms by host user ID
     */
    static async getByHostUserId(hostUserId, options = {}) {
        const { status, tier, limit = 50, offset = 0 } = options;

        try {
            let query = 'SELECT * FROM jitsi_rooms WHERE host_user_id = $1 AND deleted_at IS NULL';
            const values = [hostUserId];
            let paramCount = 1;

            if (status) {
                paramCount++;
                query += ` AND status = $${paramCount}`;
                values.push(status);
            }

            if (tier) {
                paramCount++;
                query += ` AND tier = $${paramCount}`;
                values.push(tier);
            }

            query += ' ORDER BY created_at DESC';
            query += ` LIMIT $${++paramCount} OFFSET $${++paramCount}`;
            values.push(limit, offset);

            const result = await pool.query(query, values);
            return result.rows;
        } catch (error) {
            logger.error('Error getting Jitsi rooms by host:', error);
            throw error;
        }
    }

    /**
     * Get active rooms
     */
    static async getActiveRooms(limit = 100) {
        try {
            const query = `
                SELECT * FROM active_jitsi_rooms
                ORDER BY created_at DESC
                LIMIT $1
            `;
            const result = await pool.query(query, [limit]);
            return result.rows;
        } catch (error) {
            logger.error('Error getting active Jitsi rooms:', error);
            throw error;
        }
    }

    /**
     * Get active rooms by tier
     */
    static async getActiveRoomsByTier(tier, limit = 50) {
        try {
            const query = `
                SELECT * FROM jitsi_rooms
                WHERE tier = $1 AND status = 'active' AND deleted_at IS NULL
                ORDER BY created_at DESC
                LIMIT $2
            `;
            const result = await pool.query(query, [tier, limit]);
            return result.rows;
        } catch (error) {
            logger.error('Error getting active Jitsi rooms by tier:', error);
            throw error;
        }
    }

    /**
     * Update room
     */
    static async update(roomId, updates) {
        try {
            const allowedFields = [
                'title', 'description', 'settings', 'is_public',
                'requires_password', 'room_password', 'status', 'is_active',
                'current_participants', 'total_participants', 'peak_participants',
                'total_duration', 'actual_start_time', 'actual_end_time'
            ];

            const fields = [];
            const values = [];
            let paramCount = 1;

            for (const [key, value] of Object.entries(updates)) {
                if (allowedFields.includes(key)) {
                    fields.push(`${key} = $${paramCount}`);
                    values.push(key === 'settings' ? JSON.stringify(value) : value);
                    paramCount++;
                }
            }

            if (fields.length === 0) {
                throw new Error('No valid fields to update');
            }

            values.push(roomId);
            const query = `
                UPDATE jitsi_rooms
                SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
                WHERE id = $${paramCount}
                RETURNING *
            `;

            const result = await pool.query(query, values);
            return result.rows[0];
        } catch (error) {
            logger.error('Error updating Jitsi room:', error);
            throw error;
        }
    }

    /**
     * Start a room
     */
    static async startRoom(roomId) {
        try {
            const query = `
                UPDATE jitsi_rooms
                SET status = 'active',
                    actual_start_time = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
                RETURNING *
            `;
            const result = await pool.query(query, [roomId]);
            return result.rows[0];
        } catch (error) {
            logger.error('Error starting Jitsi room:', error);
            throw error;
        }
    }

    /**
     * End a room
     */
    static async endRoom(roomId) {
        try {
            const room = await this.getById(roomId);
            if (!room) throw new Error('Room not found');

            const startTime = room.actual_start_time || room.created_at;
            const durationMs = new Date() - new Date(startTime);
            const durationMinutes = Math.round(durationMs / 1000 / 60);

            const query = `
                UPDATE jitsi_rooms
                SET status = 'ended',
                    actual_end_time = CURRENT_TIMESTAMP,
                    total_duration = $1,
                    is_active = false,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
                RETURNING *
            `;

            const result = await pool.query(query, [durationMinutes, roomId]);
            logger.info(`Jitsi room ended: ${roomId}, duration: ${durationMinutes} minutes`);

            return result.rows[0];
        } catch (error) {
            logger.error('Error ending Jitsi room:', error);
            throw error;
        }
    }

    /**
     * Delete room (soft delete)
     */
    static async delete(roomId) {
        try {
            const query = `
                UPDATE jitsi_rooms
                SET deleted_at = CURRENT_TIMESTAMP, is_active = false
                WHERE id = $1
            `;
            await pool.query(query, [roomId]);
            return true;
        } catch (error) {
            logger.error('Error deleting Jitsi room:', error);
            throw error;
        }
    }

    /**
     * Hard delete room (only when empty)
     * @param {number} roomId - Room ID
     * @param {string} hostUserId - Host user ID for authorization
     * @returns {Promise<Object>} Deleted room data
     */
    static async hardDelete(roomId, hostUserId) {
        try {
            // Get room and verify host
            const room = await this.getById(roomId);
            if (!room) {
                throw new Error('Room not found');
            }

            if (room.host_user_id !== String(hostUserId)) {
                throw new Error('Only the host can delete this room');
            }

            // Check if room has active participants
            const participantsQuery = `
                SELECT COUNT(*) as count FROM jitsi_participants
                WHERE room_id = $1 AND leave_time IS NULL
            `;
            const participantsResult = await pool.query(participantsQuery, [roomId]);
            const activeParticipants = parseInt(participantsResult.rows[0].count);

            if (activeParticipants > 0) {
                throw new Error('Cannot delete room with active participants. Please wait for all participants to leave.');
            }

            // Delete all participant records
            await pool.query('DELETE FROM jitsi_participants WHERE room_id = $1', [roomId]);

            // Hard delete the room
            const deleteQuery = `
                DELETE FROM jitsi_rooms
                WHERE id = $1
                RETURNING *
            `;
            const result = await pool.query(deleteQuery, [roomId]);

            logger.info(`Jitsi room hard deleted: ${roomId} by host ${hostUserId}`);
            return result.rows[0];
        } catch (error) {
            logger.error('Error hard deleting Jitsi room:', error);
            throw error;
        }
    }

    /**
     * Update participant count
     */
    static async updateParticipantCount(roomId, count) {
        try {
            const query = `
                UPDATE jitsi_rooms
                SET current_participants = $1,
                    peak_participants = GREATEST(peak_participants, $1),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
            `;
            await pool.query(query, [count, roomId]);
        } catch (error) {
            logger.error('Error updating participant count:', error);
            throw error;
        }
    }

    /**
     * Add participant
     */
    static async addParticipant(roomId, participantData) {
        const { userId, telegramId, displayName, isModerator = false, isHost = false } = participantData;

        try {
            const query = `
                INSERT INTO jitsi_participants (room_id, user_id, telegram_id, display_name, is_moderator, is_host)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *
            `;
            const result = await pool.query(query, [roomId, userId, telegramId, displayName, isModerator, isHost]);

            // Update room participant count
            await pool.query(`
                UPDATE jitsi_rooms
                SET total_participants = total_participants + 1,
                    current_participants = current_participants + 1,
                    peak_participants = GREATEST(peak_participants, current_participants + 1)
                WHERE id = $1
            `, [roomId]);

            return result.rows[0];
        } catch (error) {
            logger.error('Error adding participant:', error);
            throw error;
        }
    }

    /**
     * Remove participant
     */
    static async removeParticipant(participantId) {
        try {
            const query = `
                UPDATE jitsi_participants
                SET leave_time = CURRENT_TIMESTAMP,
                    duration = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - join_time)) / 60
                WHERE id = $1
                RETURNING room_id
            `;
            const result = await pool.query(query, [participantId]);

            if (result.rows[0]) {
                await pool.query(`
                    UPDATE jitsi_rooms
                    SET current_participants = GREATEST(0, current_participants - 1)
                    WHERE id = $1
                `, [result.rows[0].room_id]);
            }

            return true;
        } catch (error) {
            logger.error('Error removing participant:', error);
            throw error;
        }
    }

    /**
     * Get tier access for a plan
     */
    static async getTierAccess(planTier) {
        try {
            const query = `
                SELECT * FROM jitsi_tier_access
                WHERE plan_tier = $1
                ORDER BY allowed_room_tier
            `;
            const result = await pool.query(query, [planTier]);
            return result.rows;
        } catch (error) {
            logger.error('Error getting tier access:', error);
            throw error;
        }
    }

    /**
     * Check if user can create room of specific tier
     */
    static async canUserCreateRoom(userId, planTier, roomTier) {
        try {
            // Get tier access configuration
            const accessQuery = `
                SELECT * FROM jitsi_tier_access
                WHERE plan_tier = $1 AND allowed_room_tier = $2
            `;
            const accessResult = await pool.query(accessQuery, [planTier, roomTier]);

            if (accessResult.rows.length === 0) {
                return { allowed: false, reason: 'Your plan does not allow this room tier' };
            }

            const access = accessResult.rows[0];

            // Check daily usage
            const usageQuery = `
                SELECT COALESCE(SUM(rooms_created), 0) as rooms_today
                FROM jitsi_user_usage
                WHERE user_id = $1 AND date = CURRENT_DATE AND tier = $2
            `;
            const usageResult = await pool.query(usageQuery, [userId, roomTier]);
            const roomsToday = parseInt(usageResult.rows[0]?.rooms_today || 0);

            if (roomsToday >= access.max_rooms_per_day) {
                return {
                    allowed: false,
                    reason: `You've reached your daily limit of ${access.max_rooms_per_day} ${roomTier} rooms`
                };
            }

            return {
                allowed: true,
                access,
                roomsRemaining: access.max_rooms_per_day - roomsToday
            };
        } catch (error) {
            logger.error('Error checking room creation permission:', error);
            throw error;
        }
    }

    /**
     * Record room usage
     */
    static async recordUsage(userId, tier) {
        try {
            const query = `
                INSERT INTO jitsi_user_usage (user_id, date, tier, rooms_created)
                VALUES ($1, CURRENT_DATE, $2, 1)
                ON CONFLICT (user_id, date, tier)
                DO UPDATE SET
                    rooms_created = jitsi_user_usage.rooms_created + 1,
                    updated_at = CURRENT_TIMESTAMP
            `;
            await pool.query(query, [userId, tier]);
        } catch (error) {
            logger.error('Error recording usage:', error);
            throw error;
        }
    }

    /**
     * Get rooms for Telegram group
     */
    static async getByTelegramGroup(groupId, options = {}) {
        const { status, limit = 20 } = options;

        try {
            let query = `
                SELECT * FROM jitsi_rooms
                WHERE (telegram_group_id = $1 OR $1 = ANY(shared_in_groups))
                AND deleted_at IS NULL
            `;
            const values = [groupId];

            if (status) {
                query += ` AND status = $2`;
                values.push(status);
            }

            query += ' ORDER BY created_at DESC LIMIT $' + (values.length + 1);
            values.push(limit);

            const result = await pool.query(query, values);
            return result.rows;
        } catch (error) {
            logger.error('Error getting Jitsi rooms by telegram group:', error);
            throw error;
        }
    }

    /**
     * Get user's daily usage summary
     */
    static async getUserDailyUsage(userId) {
        try {
            const query = `
                SELECT tier, rooms_created, total_minutes
                FROM jitsi_user_usage
                WHERE user_id = $1 AND date = CURRENT_DATE
            `;
            const result = await pool.query(query, [userId]);
            return result.rows;
        } catch (error) {
            logger.error('Error getting user daily usage:', error);
            throw error;
        }
    }
}

module.exports = JitsiRoomModel;
