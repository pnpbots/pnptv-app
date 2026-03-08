const logger = require('../../../utils/logger');
const UserModel = require('../../../models/userModel');
const { query } = require('../../../utils/db');
const PermissionService = require('../../services/permissionService');
const supportRoutingService = require('../../services/supportRoutingService');

class AdminUserController {
  /**
   * Get user details
   * GET /api/admin/users/:userId
   */
  static async getUser(req, res) {
    try {
      const { userId } = req.params;
      const adminId = req.user?.id;

      // Verify admin permission
      const isAdmin = await PermissionService.isAdmin(adminId);
      if (!isAdmin) {
        return res.status(403).json({ success: false, error: 'Not authorized' });
      }

      const user = await UserModel.getById(userId);
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      logger.info('Admin viewed user details', { adminId, userId });
      return res.json({ success: true, user });
    } catch (error) {
      logger.error('Error getting user:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Update user details
   * PUT /api/admin/users/:userId
   */
  static async updateUser(req, res) {
    try {
      const { userId } = req.params;
      const adminId = req.user?.id;
      const { username, email, subscriptionStatus, isPrime, tier } = req.body;

      // Verify admin permission
      const isAdmin = await PermissionService.isAdmin(adminId);
      if (!isAdmin) {
        return res.status(403).json({ success: false, error: 'Not authorized' });
      }

      const user = await UserModel.getById(userId);
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      // Update profile fields (username, email)
      if (username !== undefined || email !== undefined) {
        const updates = {};
        if (username !== undefined) updates.username = username;
        if (email !== undefined) updates.email = email;

        await UserModel.updateProfile(userId, updates);
        logger.info('Admin updated user profile', { adminId, userId, updates });
      }

      // Update subscription status
      if (subscriptionStatus !== undefined) {
        // user.planId is the correct camelCase field from UserModel.mapRowToUser()
        // (user.subscription_plan_id does not exist — was a bug that silently set plan_id=NULL)
        await UserModel.updateSubscription(userId, {
          status: subscriptionStatus,
          planId: user.planId,
          expiry: user.planExpiry,
        });
        logger.info('Admin updated user subscription', { adminId, userId, subscriptionStatus });
      }

      // Update tier (PRIME/free) — also sync subscription_status for consistency
      if (isPrime !== undefined || tier !== undefined) {
        const newTier = isPrime ? 'PRIME' : 'free';
        const newStatus = isPrime ? 'active' : 'free';
        await query(
          'UPDATE users SET tier = $1, subscription_status = $2, updated_at = NOW() WHERE id = $3',
          [newTier, newStatus, userId.toString()]
        );
        await require('../../../config/redis').cache.del(`user:${userId}`);
        logger.info('Admin updated user tier', { adminId, userId, tier: newTier, subscriptionStatus: newStatus });
      }

      const updatedUser = await UserModel.getById(userId);
      return res.json({ success: true, user: updatedUser });
    } catch (error) {
      logger.error('Error updating user:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Ban or unban user
   * POST /api/admin/users/:userId/ban
   */
  static async toggleBan(req, res) {
    try {
      const { userId } = req.params;
      const { ban, reason } = req.body;
      const adminId = req.user?.id;

      // Verify admin permission
      const isAdmin = await PermissionService.isAdmin(adminId);
      if (!isAdmin) {
        return res.status(403).json({ success: false, error: 'Not authorized' });
      }

      const user = await UserModel.getById(userId);
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      // Update ban via tier column — full ban: revoke role, creator status, subscription, and sessions
      const newTier = ban === true ? 'banned' : ban === false ? 'free' : null;
      if (newTier) {
        if (ban) {
          await query(
            `UPDATE users SET tier = 'banned', role = 'user', creator_status = 'none',
             subscription_status = 'expired', updated_at = NOW() WHERE id = $1`,
            [userId.toString()]
          );
        } else {
          await query(
            'UPDATE users SET tier = $1, updated_at = NOW() WHERE id = $2',
            [newTier, userId.toString()]
          );
        }
        await require('../../../config/redis').cache.del(`user:${userId}`);

        // Destroy all active sessions for the banned user.
        // IMPORTANT: ioredis keyPrefix is prepended automatically, so do NOT include
        // the prefix in the scan pattern. redis.keys('sess:*') scans '{keyPrefix}sess:*' in Redis.
        if (ban) {
          try {
            const redis = require('../../../config/redis').client;
            const keys = await redis.keys('sess:*');
            for (const key of keys) {
              const val = await redis.get(key);
              if (val && val.includes(userId.toString())) {
                await redis.del(key);
              }
            }
            logger.info('Destroyed sessions for banned user', { userId, sessionsScanned: keys.length });
          } catch (sessErr) {
            logger.warn('Failed to destroy sessions for banned user', { userId, error: sessErr.message });
          }
        }

        const action = ban ? 'banned' : 'unbanned';
        logger.info(`Admin ${action} user`, {
          adminId,
          userId,
          reason: reason || 'No reason provided',
        });
      }

      const updatedUser = await UserModel.getById(userId);
      return res.json({ success: true, user: updatedUser, action: ban ? 'banned' : 'unbanned' });
    } catch (error) {
      logger.error('Error toggling user ban:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Send direct message to user via customer service topics
   * POST /api/admin/users/:userId/send-message
   */
  static async sendDirectMessage(req, res) {
    try {
      const { userId } = req.params;
      const { message, messageType = 'text' } = req.body;
      const adminId = req.user?.id;

      // Verify admin permission
      const isAdmin = await PermissionService.isAdmin(adminId);
      if (!isAdmin) {
        return res.status(403).json({ success: false, error: 'Not authorized' });
      }

      if (!message || !message.trim()) {
        return res.status(400).json({ success: false, error: 'Message cannot be empty' });
      }

      const user = await UserModel.getById(userId);
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      // Send message via customer service routing (supergroup topics)
      const messageNote = `📨 **Admin Direct Message**\nFrom: ${adminId}\nTo User: ${userId}\n\n${message}`;

      try {
        // Send via support routing to customer service group
        await supportRoutingService.sendToSupportGroup(
          messageNote,
          'admin_message',
          {
            id: adminId,
            first_name: 'Admin',
            username: 'admin',
          },
          messageType,
          null,
          { recipient_user_id: userId, recipient_username: user.username }
        );

        logger.info('Admin sent direct message to user', { adminId, userId, messageLength: message.length });
        return res.json({ success: true, message: 'Message sent successfully' });
      } catch (sendError) {
        logger.warn('Failed to send direct message via customer service:', sendError);
        // Even if it fails, don't fail the request
        return res.json({
          success: true,
          message: 'Message queued but delivery via customer service failed',
          warning: sendError.message,
        });
      }
    } catch (error) {
      logger.error('Error sending direct message:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Search users
   * GET /api/admin/users/search?query=...
   */
  static async searchUsers(req, res) {
    try {
      const { query: searchQuery } = req.query;
      const adminId = req.user?.id;

      // Verify admin permission
      const isAdmin = await PermissionService.isAdmin(adminId);
      if (!isAdmin) {
        return res.status(403).json({ success: false, error: 'Not authorized' });
      }

      if (!searchQuery || searchQuery.trim().length < 2) {
        return res.status(400).json({ success: false, error: 'Search query must be at least 2 characters' });
      }

      const searchTerm = `%${searchQuery}%`;
      const result = await query(
        `SELECT id, username, first_name, last_name, email, tier, subscription_status, created_at
         FROM users
         WHERE username ILIKE $1 OR email ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1
         LIMIT 20`,
        [searchTerm]
      );

      logger.info('Admin searched users', { adminId, searchQuery, resultsCount: result.rows.length });
      return res.json({ success: true, users: result.rows });
    } catch (error) {
      logger.error('Error searching users:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = AdminUserController;
