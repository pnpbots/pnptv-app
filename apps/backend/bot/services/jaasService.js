const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../../utils/logger');

/**
 * JaaS (Jitsi as a Service) Service
 * Handles JWT token generation for authenticated Jitsi sessions with live streaming
 */
class JaaSService {
    constructor() {
        // JaaS Configuration from environment variables
        this.appId = process.env.JAAS_APP_ID;
        this.apiKeyId = process.env.JAAS_API_KEY_ID; // kid

        // Load private key from environment - support both file path and inline key
        let privateKey = null;

        if (process.env.JAAS_PRIVATE_KEY_PATH) {
            try {
                const keyPath = path.resolve(process.env.JAAS_PRIVATE_KEY_PATH);
                privateKey = fs.readFileSync(keyPath, 'utf8');
                logger.info('Loaded JaaS private key from file:', { path: keyPath });
            } catch (err) {
                logger.error('Failed to load JaaS private key from file:', {
                    path: process.env.JAAS_PRIVATE_KEY_PATH,
                    error: err.message
                });
            }
        } else if (process.env.JAAS_PRIVATE_KEY) {
            privateKey = process.env.JAAS_PRIVATE_KEY;
            // Try to fix escaped newlines if present
            if (typeof privateKey === 'string' && privateKey.includes('\\n')) {
                privateKey = privateKey.replace(/\\n/g, '\n');
            }
        }

        this.privateKey = privateKey;

        // Validate configuration
        if (!this.appId || !this.apiKeyId || !this.privateKey) {
            logger.warn('JaaS not configured. Set JAAS_APP_ID, JAAS_API_KEY_ID, and either JAAS_PRIVATE_KEY or JAAS_PRIVATE_KEY_PATH');
        } else {
            logger.info('JaaS configuration loaded successfully', {
                appId: this.appId.substring(0, 20) + '...',
                apiKeyId: this.apiKeyId.substring(0, 20) + '...'
            });
        }
    }

    /**
     * Check if JaaS is properly configured
     */
    isConfigured() {
        return !!(this.appId && this.apiKeyId && this.privateKey);
    }

    /**
     * Generate JWT token for JaaS authentication
     * @param {Object} options - Token generation options
     * @returns {string} JWT token
     */
    generateToken(options = {}) {
        if (!this.isConfigured()) {
            throw new Error('JaaS is not properly configured. Check environment variables.');
        }

        const {
            roomName,
            userId = uuidv4(),
            userName = 'Guest',
            userEmail = '',
            userAvatar = '',
            isModerator = false,
            enableLivestreaming = false,
            enableRecording = false,
            enableTranscription = false,
            expiresIn = '2h'
        } = options;

        if (!roomName) {
            throw new Error('Room name is required for JWT generation');
        }

        // JWT Header
        const header = {
            alg: 'RS256',
            typ: 'JWT',
            kid: this.apiKeyId
        };

        // Current time
        const now = Math.floor(Date.now() / 1000);
        const exp = Math.floor(Date.now() / 1000) + this.parseExpiresIn(expiresIn);

        // JWT Payload
        const payload = {
            // Standard claims
            aud: 'jitsi',
            iss: 'chat',
            sub: this.appId,
            exp,
            nbf: now,

            // Room configuration
            room: roomName,

            // User context
            context: {
                user: {
                    id: userId,
                    name: userName,
                    email: userEmail,
                    avatar: userAvatar,
                    moderator: isModerator ? 'true' : 'false',
                    'hidden-from-recorder': 'false'
                },
                features: {
                    livestreaming: enableLivestreaming,
                    recording: enableRecording,
                    transcription: enableTranscription,
                    'outbound-call': false,
                    'sip-outbound-call': false
                }
            }
        };

        try {
            // Sign the token with private key
            const token = jwt.sign(payload, this.privateKey, {
                algorithm: 'RS256',
                header
            });

            logger.info(`Generated JaaS JWT for room: ${roomName}, user: ${userName}, moderator: ${isModerator}`);
            return token;
        } catch (error) {
            logger.error('Error generating JaaS JWT:', error);
            throw new Error('Failed to generate authentication token');
        }
    }

    /**
     * Generate moderator token (for streamers/hosts)
     */
    generateModeratorToken(roomName, userId, userName, userEmail = '', userAvatar = '') {
        // For PNPtv Haus (community room), disable recording to ensure privacy
        const isCommunitRoom = roomName && roomName.includes('haus');
        return this.generateToken({
            roomName,
            userId,
            userName,
            userEmail,
            userAvatar,
            isModerator: true,
            enableLivestreaming: false,
            enableRecording: isCommunitRoom ? false : false, // NO RECORDING - Privacy First
            enableTranscription: false,
            expiresIn: '4h'
        });
    }

    /**
     * Generate viewer token (for subscribers/viewers)
     */
    generateViewerToken(roomName, userId, userName, userEmail = '', userAvatar = '') {
        return this.generateToken({
            roomName,
            userId,
            userName,
            userEmail,
            userAvatar,
            isModerator: false,
            enableLivestreaming: false,
            enableRecording: false,
            enableTranscription: false,
            expiresIn: '2h'
        });
    }

    /**
     * Generate PNP Live room configuration for private shows
     * @param {string} roomName - Room name
     * @param {number} bookingId - Booking ID
     * @param {string} modelName - Model name
     * @returns {Object} Room configuration with tokens
     */
    generatePNPLiveRoom(roomName, bookingId, modelName) {
        // Generate tokens for both model (moderator) and client (viewer)
        const modelToken = this.generateToken({
            roomName,
            userId: `model-${bookingId}`,
            userName: `${modelName} (Model)`,
            isModerator: true,
            enableLivestreaming: false,
            enableRecording: false, // NO RECORDING - Privacy First
            enableTranscription: false, // Model doesn't see transcription
            expiresIn: '4h'
        });

        const clientToken = this.generateToken({
            roomName,
            userId: `client-${bookingId}`,
            userName: `Client`,
            isModerator: false,
            enableLivestreaming: false,
            enableRecording: false,
            enableTranscription: true, // Client gets Spanish->English transcription
            expiresIn: '2h'
        });

        return {
            roomName,
            modelUrl: this.generateMeetingUrl(roomName, modelToken),
            clientUrl: this.generateMeetingUrl(roomName, clientToken),
            tokens: {
                model: modelToken,
                client: clientToken
            }
        };
    }

    /**
     * Generate PNP Live model token with enhanced features
     */
    generatePNPLiveModelToken(roomName, userId, userName, userEmail = '', userAvatar = '') {
        return this.generateToken({
            roomName,
            userId,
            userName,
            userEmail,
            userAvatar,
            isModerator: true,
            enableLivestreaming: false,
            enableRecording: false,
            enableTranscription: false,
            expiresIn: '4h'
        });
    }

    /**
     * Generate PNP Live client token with transcription
     */
    generatePNPLiveClientToken(roomName, userId, userName, userEmail = '', userAvatar = '') {
        return this.generateToken({
            roomName,
            userId,
            userName,
            userEmail,
            userAvatar,
            isModerator: false,
            enableLivestreaming: false,
            enableRecording: false,
            enableTranscription: true, // Enable Spanish->English transcription for client
            expiresIn: '2h'
        });
    }

    /**
     * Generate Jitsi Meet URL with JWT token
     */
    generateMeetingUrl(roomName, token) {
        // JaaS uses the format: https://{tenant}.8x8.vc/{room}
        // Extract tenant from appId (format: vpaas-magic-cookie-{appid})
        const tenant = this.appId;
        return `https://8x8.vc/${tenant}/${roomName}?jwt=${token}`;
    }

    /**
     * Generate complete meeting configuration for moderator
     */
    generateModeratorConfig(roomName, userId, userName, userEmail = '', userAvatar = '') {
        const token = this.generateModeratorToken(roomName, userId, userName, userEmail, userAvatar);
        const url = this.generateMeetingUrl(roomName, token);

        return {
            roomName,
            token,
            url,
            role: 'moderator',
            features: {
                livestreaming: false,
                recording: false,
                chat: true,
                raiseHand: true,
                reactions: true
            }
        };
    }

    /**
     * Generate complete meeting configuration for viewer
     */
    generateViewerConfig(roomName, userId, userName, userEmail = '', userAvatar = '') {
        const token = this.generateViewerToken(roomName, userId, userName, userEmail, userAvatar);
        const url = this.generateMeetingUrl(roomName, token);

        return {
            roomName,
            token,
            url,
            role: 'viewer',
            features: {
                livestreaming: false,
                recording: false,
                chat: true,
                raiseHand: true,
                reactions: true
            }
        };
    }

    /**
     * Parse expiresIn string to seconds
     */
    parseExpiresIn(expiresIn) {
        if (typeof expiresIn === 'number') {
            return expiresIn;
        }

        const units = {
            s: 1,
            m: 60,
            h: 3600,
            d: 86400
        };

        const match = expiresIn.match(/^(\d+)([smhd])$/);
        if (!match) {
            throw new Error('Invalid expiresIn format. Use format like "2h", "30m", "1d"');
        }

        const [, value, unit] = match;
        return parseInt(value) * units[unit];
    }

    /**
     * Validate room name format
     */
    validateRoomName(roomName) {
        // Room name should be alphanumeric with hyphens/underscores
        const regex = /^[a-zA-Z0-9_-]+$/;
        return regex.test(roomName);
    }

    /**
     * Generate unique room name
     */
    generateRoomName(prefix = 'stream') {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        return `${prefix}-${timestamp}-${random}`;
    }
}

module.exports = new JaaSService();
