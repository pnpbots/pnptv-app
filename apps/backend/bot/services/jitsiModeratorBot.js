const { EventEmitter } = require('events');
const axios = require('axios');
const logger = require('../../utils/logger');

/**
 * Jitsi Moderator Bot Service
 * Manages automated moderation for Jitsi rooms via XMPP
 * Supports: muting users, kicking disruptive users, room messaging
 */
class JitsiModeratorBot extends EventEmitter {
    constructor(config = {}) {
        super();

        // Configuration
        this.jitsiDomain = config.jitsiDomain || 'meet.jit.si';
        this.mucDomain = config.mucDomain || 'conference.jit.si';
        this.botNickname = config.botNickname || 'ModeratorBot';
        this.botPassword = config.botPassword || process.env.JITSI_BOT_PASSWORD;

        // Connection state
        this.rooms = new Map(); // Track bot instances per room
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = config.maxReconnectAttempts || 5;
        this.reconnectDelay = config.reconnectDelay || 5000;

        // Rate limiting for actions
        this.actionCooldowns = new Map();
        this.cooldownDuration = config.cooldownDuration || 1000; // ms between actions

        // Moderation config
        this.autoModeration = config.autoModeration !== false;
        this.bannedWords = config.bannedWords || [];
        this.muteThreshold = config.muteThreshold || 3; // Mutes after N violations
        this.kickThreshold = config.kickThreshold || 5; // Kicks after N violations

        logger.info('JitsiModeratorBot initialized');
    }

    /**
     * Join a Jitsi room as moderator bot
     * @param {string} roomName - Jitsi room name
     * @param {Object} options - Room options
     * @returns {Promise<Object>} Room connection info
     */
    async joinRoom(roomName, options = {}) {
        try {
            if (!roomName) {
                throw new Error('Room name is required');
            }

            // Check if already in room
            if (this.rooms.has(roomName)) {
                logger.warn(`Bot already in room: ${roomName}`);
                return this.rooms.get(roomName);
            }

            const roomInstance = {
                name: roomName,
                domain: this.jitsiDomain,
                mucDomain: this.mucDomain,
                joinedAt: new Date(),
                participants: new Map(),
                violations: new Map(), // Track user violations
                moderatorPassword: options.moderatorPassword,
                autoModeration: options.autoModeration !== false,
                settings: options.settings || {},
                messageQueue: [],
                isProcessing: false
            };

            // Store room instance
            this.rooms.set(roomName, roomInstance);

            // Emit join event
            this.emit('room:joined', {
                room: roomName,
                timestamp: roomInstance.joinedAt
            });

            logger.info(`Bot joined room: ${roomName}`);

            return {
                success: true,
                room: roomName,
                roomInstance
            };
        } catch (error) {
            logger.error(`Error joining room ${roomName}:`, error);
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Leave a Jitsi room
     * @param {string} roomName - Jitsi room name
     */
    async leaveRoom(roomName) {
        try {
            if (!this.rooms.has(roomName)) {
                throw new Error(`Not in room: ${roomName}`);
            }

            const roomInstance = this.rooms.get(roomName);

            // Clear participants and violations
            roomInstance.participants.clear();
            roomInstance.violations.clear();
            roomInstance.messageQueue = [];

            // Remove room
            this.rooms.delete(roomName);

            this.emit('room:left', {
                room: roomName,
                leftAt: new Date()
            });

            logger.info(`Bot left room: ${roomName}`);
            return { success: true, room: roomName };
        } catch (error) {
            logger.error(`Error leaving room ${roomName}:`, error);
            throw error;
        }
    }

    /**
     * Mute a specific user or all participants
     * @param {string} roomName - Jitsi room name
     * @param {string} participant - Participant name/id (optional, null = mute all)
     * @param {string} type - 'audio', 'video', or 'both'
     */
    async muteParticipant(roomName, participant = null, type = 'audio') {
        try {
            if (!this.rooms.has(roomName)) {
                throw new Error(`Not in room: ${roomName}`);
            }

            const roomInstance = this.rooms.get(roomName);
            const action = {
                type: 'mute',
                target: participant || 'all',
                muteType: type,
                roomName,
                timestamp: new Date(),
                status: 'pending'
            };

            // Queue action
            roomInstance.messageQueue.push(action);

            // Execute action
            const result = await this.executeAction(roomInstance, action);

            this.emit('action:mute', {
                room: roomName,
                target: participant,
                type,
                result
            });

            logger.info(`Muted ${participant || 'all participants'} in ${roomName}`);
            return result;
        } catch (error) {
            logger.error(`Error muting in room ${roomName}:`, error);
            throw error;
        }
    }

    /**
     * Kick a participant from the room
     * @param {string} roomName - Jitsi room name
     * @param {string} participant - Participant name/id
     * @param {string} reason - Kick reason
     */
    async kickParticipant(roomName, participant, reason = '') {
        try {
            if (!this.rooms.has(roomName)) {
                throw new Error(`Not in room: ${roomName}`);
            }

            if (!participant) {
                throw new Error('Participant ID is required');
            }

            const roomInstance = this.rooms.get(roomName);

            const action = {
                type: 'kick',
                target: participant,
                reason,
                roomName,
                timestamp: new Date(),
                status: 'pending'
            };

            roomInstance.messageQueue.push(action);
            const result = await this.executeAction(roomInstance, action);

            // Remove from participants tracking
            roomInstance.participants.delete(participant);
            roomInstance.violations.delete(participant);

            this.emit('action:kick', {
                room: roomName,
                participant,
                reason,
                result
            });

            logger.info(`Kicked ${participant} from ${roomName}. Reason: ${reason}`);
            return result;
        } catch (error) {
            logger.error(`Error kicking participant in ${roomName}:`, error);
            throw error;
        }
    }

    /**
     * Send message to room
     * @param {string} roomName - Jitsi room name
     * @param {string} message - Message text
     * @param {string} targetParticipant - Optional specific participant
     */
    async sendMessage(roomName, message, targetParticipant = null) {
        try {
            if (!this.rooms.has(roomName)) {
                throw new Error(`Not in room: ${roomName}`);
            }

            if (!message) {
                throw new Error('Message is required');
            }

            const roomInstance = this.rooms.get(roomName);

            const action = {
                type: 'message',
                target: targetParticipant,
                message,
                roomName,
                timestamp: new Date(),
                status: 'pending'
            };

            roomInstance.messageQueue.push(action);
            const result = await this.executeAction(roomInstance, action);

            this.emit('action:message', {
                room: roomName,
                message,
                target: targetParticipant,
                result
            });

            logger.info(`Message sent to ${roomName}${targetParticipant ? ` (${targetParticipant})` : ''}`);
            return result;
        } catch (error) {
            logger.error(`Error sending message in ${roomName}:`, error);
            throw error;
        }
    }

    /**
     * Lock/unlock room
     * @param {string} roomName - Jitsi room name
     * @param {boolean} lock - Lock state
     */
    async lockRoom(roomName, lock = true) {
        try {
            if (!this.rooms.has(roomName)) {
                throw new Error(`Not in room: ${roomName}`);
            }

            const roomInstance = this.rooms.get(roomName);
            roomInstance.isLocked = lock;

            const action = {
                type: 'lock',
                lock,
                roomName,
                timestamp: new Date(),
                status: 'pending'
            };

            roomInstance.messageQueue.push(action);
            const result = await this.executeAction(roomInstance, action);

            this.emit('action:lock', {
                room: roomName,
                locked: lock,
                result
            });

            logger.info(`Room ${roomName} ${lock ? 'locked' : 'unlocked'}`);
            return result;
        } catch (error) {
            logger.error(`Error locking room ${roomName}:`, error);
            throw error;
        }
    }

    /**
     * Get room participants
     * @param {string} roomName - Jitsi room name
     */
    getParticipants(roomName) {
        if (!this.rooms.has(roomName)) {
            throw new Error(`Not in room: ${roomName}`);
        }

        const roomInstance = this.rooms.get(roomName);
        return Array.from(roomInstance.participants.values());
    }

    /**
     * Track participant join
     * @param {string} roomName - Jitsi room name
     * @param {Object} participant - Participant data
     */
    addParticipant(roomName, participant) {
        if (!this.rooms.has(roomName)) {
            throw new Error(`Not in room: ${roomName}`);
        }

        const roomInstance = this.rooms.get(roomName);
        roomInstance.participants.set(participant.id, {
            id: participant.id,
            name: participant.name || 'Unknown',
            joinedAt: new Date(),
            violations: 0,
            isMuted: false,
            muteReason: null
        });

        this.emit('participant:joined', {
            room: roomName,
            participant: participant.id,
            name: participant.name
        });

        logger.debug(`Participant ${participant.id} joined ${roomName}`);
    }

    /**
     * Track participant leave
     * @param {string} roomName - Jitsi room name
     * @param {string} participantId - Participant ID
     */
    removeParticipant(roomName, participantId) {
        if (!this.rooms.has(roomName)) {
            throw new Error(`Not in room: ${roomName}`);
        }

        const roomInstance = this.rooms.get(roomName);
        const participant = roomInstance.participants.get(participantId);

        if (participant) {
            roomInstance.participants.delete(participantId);
            this.emit('participant:left', {
                room: roomName,
                participant: participantId,
                name: participant.name
            });

            logger.debug(`Participant ${participantId} left ${roomName}`);
        }
    }

    /**
     * Record violation for participant (for auto-moderation)
     * @param {string} roomName - Jitsi room name
     * @param {string} participantId - Participant ID
     * @param {string} violationType - Type of violation
     */
    async recordViolation(roomName, participantId, violationType) {
        try {
            if (!this.rooms.has(roomName)) {
                throw new Error(`Not in room: ${roomName}`);
            }

            const roomInstance = this.rooms.get(roomName);

            // Increment violation count
            if (!roomInstance.violations.has(participantId)) {
                roomInstance.violations.set(participantId, 0);
            }
            let violationCount = roomInstance.violations.get(participantId) + 1;
            roomInstance.violations.set(participantId, violationCount);

            const participant = roomInstance.participants.get(participantId);
            const participantName = participant?.name || participantId;

            this.emit('violation:recorded', {
                room: roomName,
                participant: participantId,
                type: violationType,
                count: violationCount
            });

            // Auto-moderation: take action based on violation threshold
            if (this.autoModeration && roomInstance.autoModeration) {
                if (violationCount >= this.kickThreshold) {
                    // Kick participant
                    await this.kickParticipant(
                        roomName,
                        participantId,
                        `Removed for ${violationCount} violations`
                    );
                    logger.warn(`Auto-kicked ${participantName} for ${violationCount} violations`);
                } else if (violationCount >= this.muteThreshold) {
                    // Mute participant
                    await this.muteParticipant(roomName, participantId);
                    logger.warn(`Auto-muted ${participantName} (${violationCount} violations)`);
                }
            }

            logger.info(`Violation recorded for ${participantName} in ${roomName}: ${violationType} (${violationCount} total)`);

            return { participantId, violationCount };
        } catch (error) {
            logger.error(`Error recording violation in ${roomName}:`, error);
            throw error;
        }
    }

    /**
     * Get room statistics
     * @param {string} roomName - Jitsi room name
     */
    getRoomStats(roomName) {
        if (!this.rooms.has(roomName)) {
            throw new Error(`Not in room: ${roomName}`);
        }

        const roomInstance = this.rooms.get(roomName);
        const participants = Array.from(roomInstance.participants.values());

        return {
            room: roomName,
            participantCount: participants.length,
            participants,
            isLocked: roomInstance.isLocked || false,
            joinedAt: roomInstance.joinedAt,
            duration: Date.now() - roomInstance.joinedAt.getTime(),
            autoModerationEnabled: roomInstance.autoModeration,
            pendingActions: roomInstance.messageQueue.length,
            violations: Object.fromEntries(roomInstance.violations)
        };
    }

    /**
     * Get all active rooms
     */
    getActiveRooms() {
        return Array.from(this.rooms.keys()).map(roomName => ({
            name: roomName,
            stats: this.getRoomStats(roomName)
        }));
    }

    /**
     * Execute a queued action (internal method)
     * @private
     */
    async executeAction(roomInstance, action) {
        try {
            // Check rate limiting
            const cooldownKey = `${roomInstance.name}:${action.type}`;
            if (this.actionCooldowns.has(cooldownKey)) {
                const lastAction = this.actionCooldowns.get(cooldownKey);
                const timeSinceLastAction = Date.now() - lastAction;
                if (timeSinceLastAction < this.cooldownDuration) {
                    await new Promise(resolve =>
                        setTimeout(resolve, this.cooldownDuration - timeSinceLastAction)
                    );
                }
            }
            this.actionCooldowns.set(cooldownKey, Date.now());

            // Simulate action execution
            // In a real implementation, this would send XMPP commands
            action.status = 'completed';
            action.completedAt = new Date();

            return {
                success: true,
                action: action.type,
                target: action.target || 'all',
                room: roomInstance.name,
                timestamp: action.completedAt
            };
        } catch (error) {
            action.status = 'failed';
            action.error = error.message;
            throw error;
        }
    }

    /**
     * Check if bot is in a specific room
     * @param {string} roomName - Jitsi room name
     */
    isInRoom(roomName) {
        return this.rooms.has(roomName);
    }

    /**
     * Get connection status
     */
    getStatus() {
        return {
            isConnected: this.isConnected,
            activeRooms: this.rooms.size,
            rooms: Array.from(this.rooms.keys()),
            reconnectAttempts: this.reconnectAttempts
        };
    }

    /**
     * Disconnect bot from all rooms
     */
    async disconnect() {
        try {
            const roomNames = Array.from(this.rooms.keys());
            for (const roomName of roomNames) {
                await this.leaveRoom(roomName);
            }
            this.isConnected = false;
            logger.info('Bot disconnected from all rooms');
            return { success: true };
        } catch (error) {
            logger.error('Error disconnecting bot:', error);
            throw error;
        }
    }
}

module.exports = JitsiModeratorBot;
