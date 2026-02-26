const jaasService = require('./jaasService');
const LiveStreamModel = require('../../models/liveStreamModel');
const User = require('../../models/userModel');
const logger = require('../../utils/logger');
const PermissionService = require('./permissionService');

/**
 * Streaming Service
 * Integrates JaaS (Jitsi as a Service) with live streaming functionality
 * Provides simple interface for hosts and viewers with chat
 */
class StreamingService {
    /**
     * Create a new live stream with JaaS
     */
    static async createStream(hostData) {
        try {
            const {
                hostId,
                hostTelegramId,
                hostName,
                title,
                description = '',
                isSubscribersOnly = false,
                allowedPlanTiers = [],
                category = 'other'
            } = hostData;

            // Validate host has permission
            const host = await User.getById(hostId);
            if (!host) {
                throw new Error('Host not found');
            }

            // Check if JaaS is configured
            if (!jaasService.isConfigured()) {
                throw new Error('JaaS is not configured. Please configure JAAS_APP_ID, JAAS_API_KEY_ID, and JAAS_PRIVATE_KEY');
            }

            // Generate unique room name
            const roomName = jaasService.generateRoomName('pnptv');

            // Generate host token (moderator)
            const hostConfig = jaasService.generateModeratorConfig(
                roomName,
                hostId,
                hostName,
                host.email || '',
                host.avatar || ''
            );

            // Create stream in database
            const stream = await LiveStreamModel.create({
                hostId,
                hostName,
                title,
                description,
                isPaid: false,
                price: 0,
                maxViewers: 10000, // JaaS can handle many viewers
                scheduledFor: null, // Start immediately
                category,
                tags: ['live', 'jaas', 'interactive'],
                allowComments: true,
                recordStream: false, // Can be configured later
                language: 'en'
            });

            // Save JaaS room name to the stream record for later joins
            await LiveStreamModel.updateChannelName(stream.streamId, roomName);

            logger.info('Live stream created with JaaS', {
                streamId: stream.streamId,
                roomName,
                hostId
            });

            return {
                stream,
                roomName,
                hostUrl: hostConfig.url,
                hostToken: hostConfig.token,
                streamId: stream.streamId
            };
        } catch (error) {
            logger.error('Error creating live stream:', error);
            throw error;
        }
    }

    /**
     * Get viewer access to a stream
     */
    static async joinStream(streamId, viewerData) {
        try {
            const { viewerId, viewerTelegramId, viewerName } = viewerData;

            // Get stream
            const stream = await LiveStreamModel.getById(streamId);
            if (!stream) {
                throw new Error('Stream not found');
            }

            // Check if stream is live
            if (stream.status !== 'live' && stream.status !== 'active') {
                throw new Error('Stream is not currently live');
            }

            // Get viewer user
            const viewer = await User.getById(viewerId);
            if (!viewer) {
                throw new Error('Viewer not found');
            }

            // Check if viewer has access
            const hasAccess = await this.checkViewerAccess(stream, viewer);
            if (!hasAccess.allowed) {
                throw new Error(hasAccess.reason || 'Access denied');
            }

            // Join stream (updates viewer count)
            const joinResult = await LiveStreamModel.joinStream(
                streamId,
                viewerId,
                viewerName
            );

            // Get JaaS room name from the stream's channel_name field
            // This was set when the stream was created with JaaS
            const roomName = stream.channelName;

            if (!roomName) {
                throw new Error('Stream room name not found. This stream may not be a JaaS stream.');
            }

            // Generate viewer token
            const viewerConfig = jaasService.generateViewerConfig(
                roomName,
                viewerId,
                viewerName,
                viewer.email || '',
                viewer.avatar || ''
            );

            logger.info('Viewer joined stream', {
                streamId,
                viewerId,
                viewerName
            });

            return {
                stream: joinResult.stream,
                viewerUrl: viewerConfig.url,
                viewerToken: viewerConfig.token,
                roomName
            };
        } catch (error) {
            logger.error('Error joining stream:', error);
            throw error;
        }
    }

    /**
     * Send chat message to stream
     */
    static async sendChatMessage(streamId, messageData) {
        try {
            const { userId, userName, text } = messageData;

            // Validate stream exists and is live
            const stream = await LiveStreamModel.getById(streamId);
            if (!stream) {
                throw new Error('Stream not found');
            }

            if (!stream.allowComments) {
                throw new Error('Chat is disabled for this stream');
            }

            // Add comment to stream
            const comment = await LiveStreamModel.addComment(
                streamId,
                userId,
                userName,
                text
            );

            logger.info('Chat message sent', {
                streamId,
                userId,
                commentId: comment.commentId
            });

            return comment;
        } catch (error) {
            logger.error('Error sending chat message:', error);
            throw error;
        }
    }

    /**
     * Get chat messages for stream
     */
    static async getChatMessages(streamId, limit = 50, before = null) {
        try {
            const comments = await LiveStreamModel.getComments(
                streamId,
                limit,
                before
            );

            return comments.map(comment => ({
                id: comment.commentId,
                userId: comment.userId,
                userName: comment.userName,
                text: comment.text,
                timestamp: comment.timestamp,
                likes: comment.likes
            }));
        } catch (error) {
            logger.error('Error getting chat messages:', error);
            throw error;
        }
    }

    /**
     * End a live stream
     */
    static async endStream(streamId, hostId) {
        try {
            await LiveStreamModel.endStream(streamId, hostId);

            logger.info('Stream ended', { streamId, hostId });

            return { success: true };
        } catch (error) {
            logger.error('Error ending stream:', error);
            throw error;
        }
    }

    /**
     * Get active streams
     */
    static async getActiveStreams(limit = 20) {
        try {
            const streams = await LiveStreamModel.getActiveStreams(limit);

            return streams.map(stream => ({
                streamId: stream.streamId,
                hostName: stream.hostName,
                title: stream.title,
                description: stream.description,
                category: stream.category,
                thumbnailUrl: stream.thumbnailUrl,
                currentViewers: stream.currentViewers,
                startedAt: stream.startedAt,
                isPaid: stream.isPaid,
                price: stream.price
            }));
        } catch (error) {
            logger.error('Error getting active streams:', error);
            throw error;
        }
    }

    /**
     * Get streams by host
     */
    static async getHostStreams(hostId, limit = 20) {
        try {
            const streams = await LiveStreamModel.getByHostId(hostId, limit);

            return streams.map(stream => ({
                streamId: stream.streamId,
                title: stream.title,
                status: stream.status,
                currentViewers: stream.currentViewers,
                totalViews: stream.totalViews,
                peakViewers: stream.peakViewers,
                totalComments: stream.totalComments,
                likes: stream.likes,
                startedAt: stream.startedAt,
                endedAt: stream.endedAt,
                duration: stream.duration,
                createdAt: stream.createdAt
            }));
        } catch (error) {
            logger.error('Error getting host streams:', error);
            throw error;
        }
    }

    /**
     * Get stream statistics
     */
    static async getStreamStatistics(streamId) {
        try {
            const stream = await LiveStreamModel.getById(streamId);
            if (!stream) {
                throw new Error('Stream not found');
            }

            return {
                streamId: stream.streamId,
                title: stream.title,
                status: stream.status,
                currentViewers: stream.currentViewers,
                peakViewers: stream.peakViewers,
                totalViews: stream.totalViews,
                totalComments: stream.totalComments,
                likes: stream.likes,
                duration: stream.duration,
                startedAt: stream.startedAt,
                endedAt: stream.endedAt
            };
        } catch (error) {
            logger.error('Error getting stream statistics:', error);
            throw error;
        }
    }

    /**
     * Start a scheduled stream
     */
    static async startStream(streamId, hostId) {
        try {
            await LiveStreamModel.startStream(streamId, hostId);

            logger.info('Stream started', { streamId, hostId });

            return { success: true };
        } catch (error) {
            logger.error('Error starting stream:', error);
            throw error;
        }
    }

    /**
     * Check if viewer has access to stream
     * Admins always have access
     */
    static async checkViewerAccess(stream, viewer) {
        try {
            // Admins always have full access
            if (viewer.telegramId && (PermissionService.isEnvSuperAdmin(viewer.telegramId) || PermissionService.isEnvAdmin(viewer.telegramId))) {
                return { allowed: true };
            }
            
            // If stream is public and not subscribers-only, allow access
            if (!stream.isPaid && !stream.isSubscribersOnly) {
                return { allowed: true };
            }

            // Check subscription status
            if (viewer.subscriptionStatus !== 'active' && viewer.subscriptionStatus !== 'trial') {
                return {
                    allowed: false,
                    reason: 'You need an active subscription to view this stream'
                };
            }

            // Check plan tier if restricted
            if (stream.allowedPlanTiers && stream.allowedPlanTiers.length > 0) {
                const userPlanTier = this.getUserPlanTier(viewer);
                if (!stream.allowedPlanTiers.includes(userPlanTier)) {
                    return {
                        allowed: false,
                        reason: 'Your plan does not have access to this stream. Upgrade to view.'
                    };
                }
            }

            return { allowed: true };
        } catch (error) {
            logger.error('Error checking viewer access:', error);
            return { allowed: false, reason: 'Error checking access' };
        }
    }

    /**
     * Get user plan tier
     */
    static getUserPlanTier(user) {
        const planTierMap = {
            'trial_week': 'Basic',
            'trial-week': 'Basic',
            'pnp_member': 'PNP',
            'pnp-member': 'PNP',
            'crystal_member': 'Crystal',
            'crystal-member': 'Crystal',
            'diamond_member': 'Diamond',
            'diamond-member': 'Diamond',
            'lifetime_pass': 'Premium',
            'lifetime-pass': 'Premium'
        };

        return planTierMap[user.planId] || 'Basic';
    }

    /**
     * Subscribe to streamer notifications
     */
    static async subscribeToStreamer(userId, streamerId) {
        try {
            await LiveStreamModel.subscribeToStreamer(userId, streamerId);
            logger.info('User subscribed to streamer', { userId, streamerId });
            return { success: true };
        } catch (error) {
            logger.error('Error subscribing to streamer:', error);
            throw error;
        }
    }

    /**
     * Check if user is subscribed to streamer
     */
    static async isSubscribedToStreamer(userId, streamerId) {
        try {
            return await LiveStreamModel.isSubscribedToStreamer(userId, streamerId);
        } catch (error) {
            logger.error('Error checking subscription:', error);
            return false;
        }
    }
}

module.exports = StreamingService;
