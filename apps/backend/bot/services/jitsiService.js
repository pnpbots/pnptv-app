const JitsiRoomModel = require('../../models/jitsiRoomModel');
const User = require('../../models/userModel');
const logger = require('../../utils/logger');
const PermissionService = require('./permissionService');
const pool = require('../../config/postgres');

/**
 * Jitsi Service
 * Handles Jitsi room creation, management, and tier-based access control
 */
class JitsiService {
    // Default Jitsi domain
    static DEFAULT_DOMAIN = 'meet.jit.si';

    // Tier descriptions for users
    static TIER_INFO = {
        mini: {
            name: 'Mini',
            nameEs: 'Mini',
            maxParticipants: 10,
            icon: '🏠',
            description: 'Small room for up to 10 participants',
            descriptionEs: 'Sala pequeña para hasta 10 participantes'
        },
        medium: {
            name: 'Medium',
            nameEs: 'Mediana',
            maxParticipants: 50,
            icon: '🏢',
            description: 'Medium room for up to 50 participants',
            descriptionEs: 'Sala mediana para hasta 50 participantes'
        },
        unlimited: {
            name: 'Unlimited',
            nameEs: 'Ilimitada',
            maxParticipants: 1000,
            icon: '🌐',
            description: 'Large room with unlimited participants',
            descriptionEs: 'Sala grande con participantes ilimitados'
        }
    };


    /**
     * Create a new Jitsi room
     * @param {Object} params - Room creation parameters
     * @returns {Promise<Object>} Created room with join URL
     */
    static async createRoom(params) {
        const {
            userId,
            telegramId,
            displayName,
            tier = 'mini',
            title,
            description,
            isPublic = true,
            password,
            telegramGroupId
        } = params;

        try {
            // Get user and their plan
            const user = await User.getById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            // Determine plan tier
            const planTier = this.getPlanTier(user);

            // Check if user can create this room tier
            const canCreate = await JitsiRoomModel.canUserCreateRoom(userId, planTier, tier);
            if (!canCreate.allowed) {
                throw new Error(canCreate.reason);
            }

            // Create the room
            const room = await JitsiRoomModel.create({
                hostUserId: userId,
                hostName: displayName || user.username || `User ${telegramId}`,
                hostTelegramId: telegramId,
                tier,
                title: title || `${this.TIER_INFO[tier].name} Room`,
                description,
                isPublic,
                requiresPassword: !!password,
                roomPassword: password,
                telegramGroupId,
                jitsiDomain: this.DEFAULT_DOMAIN
            });

            // Record usage
            await JitsiRoomModel.recordUsage(userId, tier);

            // Generate join URL
            const joinUrl = this.generateJoinUrl(room);
            const hostUrl = this.generateHostUrl(room);

            logger.info(`Jitsi room created: ${room.room_code} (${tier}) by ${userId}`);

            return {
                room,
                joinUrl,
                hostUrl,
                roomCode: room.room_code,
                roomsRemaining: canCreate.roomsRemaining - 1
            };
        } catch (error) {
            logger.error('Error in JitsiService.createRoom:', error);
            throw error;
        }
    }

    /**
     * Get user's Jitsi room tier based on the new three-tier system.
     * Returns 'unlimited' (admin), 'medium' (prime), 'mini' (member), or null (free — cannot start calls).
     */
    static getPlanTier(user) {
        if (!user) return null;
        const role = user.role || '';
        if (role === 'admin' || role === 'superadmin') return 'unlimited';
        const tier = (user.tier || 'free').toLowerCase();
        if (tier === 'prime') return 'medium';
        if (tier === 'member') return 'mini';
        return null; // free users can't start calls
    }

    /**
     * Generate Jitsi join URL
     */
    static generateJoinUrl(room) {
        const baseUrl = `https://${room.jitsi_domain || this.DEFAULT_DOMAIN}`;
        let url = `${baseUrl}/${room.room_name}`;

        // Add configuration parameters
        const params = new URLSearchParams();

        if (room.settings) {
            let settings;
            try {
                settings = typeof room.settings === 'string'
                    ? JSON.parse(room.settings)
                    : room.settings;
            } catch (err) {
                logger.warn('Error parsing Jitsi room settings:', err);
                settings = {};
            }

            if (settings.start_with_audio_muted) {
                params.append('config.startWithAudioMuted', 'true');
            }
            if (settings.start_with_video_muted) {
                params.append('config.startWithVideoMuted', 'true');
            }
            if (settings.enable_prejoin_page) {
                params.append('config.prejoinPageEnabled', 'true');
            }
        }

        const queryString = params.toString();
        return queryString ? `${url}#${queryString}` : url;
    }

    /**
     * Generate host URL with moderator privileges
     */
    static generateHostUrl(room) {
        // For basic Jitsi Meet, the first person to join becomes moderator
        // For more control, you'd need to set up JWT authentication
        return this.generateJoinUrl(room);
    }

    /**
     * Get room by code
     */
    static async getRoom(roomCode) {
        return await JitsiRoomModel.getByRoomCode(roomCode);
    }

    /**
     * Get user's rooms
     */
    static async getUserRooms(userId, options = {}) {
        return await JitsiRoomModel.getByHostUserId(userId, options);
    }

    /**
     * Check if a user is a member of a room (has joined at any point).
     * Used to gate access to private room details.
     * @param {number|string} roomId - jitsi_rooms.id
     * @param {number|string} userId - users.id
     * @returns {Promise<boolean>}
     */
    static async isRoomMember(roomId, userId) {
        try {
            const result = await pool.query(
                'SELECT 1 FROM jitsi_participants WHERE room_id = $1 AND user_id = $2 LIMIT 1',
                [roomId, String(userId)]
            );
            return result.rows.length > 0;
        } catch (error) {
            logger.error('Error checking room membership:', error);
            return false;
        }
    }

    /**
     * Get active rooms
     */
    static async getActiveRooms(tier = null) {
        if (tier) {
            return await JitsiRoomModel.getActiveRoomsByTier(tier);
        }
        return await JitsiRoomModel.getActiveRooms();
    }

    /**
     * End a room
     */
    static async endRoom(roomId, userId) {
        const room = await JitsiRoomModel.getById(roomId);

        if (!room) {
            throw new Error('Room not found');
        }

        if (room.host_user_id !== userId) {
            throw new Error('Only the host can end the room');
        }

        return await JitsiRoomModel.endRoom(roomId);
    }

    /**
     * Get available tiers for a user based on their plan
     * Admins get all tiers with unlimited usage
     */
    static async getAvailableTiers(userId) {
        // Admins get all tiers with unlimited usage
        if (PermissionService.isEnvSuperAdmin(userId) || PermissionService.isEnvAdmin(userId)) {
            return Object.keys(this.TIER_INFO).map(tier => ({
                tier,
                info: this.TIER_INFO[tier],
                maxRoomsPerDay: 999,
                roomsUsed: 0,
                roomsRemaining: 999,
                maxDuration: 999,
                canRecord: true,
                canSetPassword: true,
                canCreatePrivate: true
            }));
        }
        
        const user = await User.getById(userId);
        if (!user) {
            return [];
        }

        const planTier = this.getPlanTier(user);
        if (!planTier) {
            return [];
        }

        const tierAccess = await JitsiRoomModel.getTierAccess(planTier);
        const usage = await JitsiRoomModel.getUserDailyUsage(userId);

        // Map tier access with current usage
        return tierAccess.map(access => {
            const usageForTier = usage.find(u => u.tier === access.allowed_room_tier);
            const roomsUsed = parseInt(usageForTier?.rooms_created || 0);

            return {
                tier: access.allowed_room_tier,
                info: this.TIER_INFO[access.allowed_room_tier],
                maxRoomsPerDay: access.max_rooms_per_day,
                roomsUsed,
                roomsRemaining: Math.max(0, access.max_rooms_per_day - roomsUsed),
                maxDuration: access.max_duration_minutes,
                canRecord: access.can_record,
                canSetPassword: access.can_set_password,
                canCreatePrivate: access.can_create_private
            };
        });
    }

    /**
     * Check if user has premium access
     * Admins always have premium access
     */
    static async hasPremiumAccess(userId) {
        // Admins always have premium access
        if (PermissionService.isEnvSuperAdmin(userId) || PermissionService.isEnvAdmin(userId)) {
            return true;
        }
        
        const user = await User.getById(userId);
        if (!user) return false;

        return (user.tier || '').toLowerCase() === 'prime';
    }

    /**
     * Get room statistics
     */
    static async getRoomStats(roomId) {
        const room = await JitsiRoomModel.getById(roomId);
        if (!room) return null;

        return {
            roomCode: room.room_code,
            tier: room.tier,
            tierInfo: this.TIER_INFO[room.tier],
            status: room.status,
            currentParticipants: room.current_participants,
            totalParticipants: room.total_participants,
            peakParticipants: room.peak_participants,
            duration: room.total_duration,
            createdAt: room.created_at
        };
    }

    /**
     * Join a room (track participant)
     */
    static async joinRoom(roomCode, participantData) {
        const room = await JitsiRoomModel.getByRoomCode(roomCode);
        if (!room) {
            throw new Error('Room not found');
        }

        if (room.status === 'ended') {
            throw new Error('This room has ended');
        }

        // Check participant limit
        if (room.current_participants >= room.max_participants) {
            throw new Error(`Room is full (${room.max_participants} max)`);
        }

        // Check password if required
        if (room.requires_password && participantData.password !== room.room_password) {
            throw new Error('Invalid room password');
        }

        // Add participant
        await JitsiRoomModel.addParticipant(room.id, participantData);

        return {
            room,
            joinUrl: this.generateJoinUrl(room)
        };
    }

    /**
     * Get rooms for a Telegram group
     */
    static async getGroupRooms(groupId, options = {}) {
        return await JitsiRoomModel.getByTelegramGroup(groupId, options);
    }
}

module.exports = JitsiService;
