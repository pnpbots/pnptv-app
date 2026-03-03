const logger = require('../../../utils/logger');
const { query } = require('../../../config/postgres');
const AdminDashboardService = require('../../../services/adminDashboardService');
const VideoCallModel = require('../../../models/videoCallModel');
const SocialPostService = require('../../services/socialPostService');

// Note: Admin guard is now handled by JWT middleware (verifyAdminJWT in routes.js)
// req.user is populated by the middleware and contains user data

/**
 * GET /api/webapp/admin/stats
 * Get admin dashboard stats
 */
const getStats = async (req, res) => {
  const user = req.user;

  try {
    const stats = await AdminDashboardService.getDashboardOverview();
    if (!stats) {
      return res.status(500).json({ error: 'Failed to load stats' });
    }
    logger.info('Admin accessed dashboard stats', { adminId: user.id });
    return res.json({ success: true, stats });
  } catch (error) {
    logger.error('Error getting admin stats:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/webapp/admin/users
 * List users with pagination and search
 */
const listUsers = async (req, res) => {
  const user = req.user;

  try {
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const search = (req.query.search || '').trim();
    const limit = 20;
    const offset = (page - 1) * limit;

    let countQuery = 'SELECT COUNT(*) as count FROM users WHERE is_active = true';
    let dataQuery = `SELECT id, username, email, role, tier, subscription_status, created_at
                     FROM users WHERE is_active = true`;
    const params = [];

    if (search) {
      const searchTerm = `%${search}%`;
      countQuery += ' AND (username ILIKE $1 OR email ILIKE $1)';
      dataQuery += ' AND (username ILIKE $1 OR email ILIKE $1)';
      params.push(searchTerm);
    }

    dataQuery += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const [countResult, dataResult] = await Promise.all([
      query(countQuery, search ? [params[0]] : []),
      query(dataQuery, params),
    ]);

    const total = parseInt(countResult.rows[0]?.count || 0);
    const totalPages = Math.ceil(total / limit);

    logger.info('Admin listed users', { adminId: user.id, search, page });
    return res.json({
      success: true,
      users: dataResult.rows,
      pagination: { page, limit, total, totalPages },
    });
  } catch (error) {
    logger.error('Error listing admin users:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/webapp/admin/users/:id
 * Get user details
 */
const getUser = async (req, res) => {
  const user = req.user;

  try {
    const { id: userId } = req.params;
    const result = await query(
      `SELECT id, username, email, first_name, last_name, bio, role, tier,
              subscription_status, subscription_plan, plan_expiry, created_at,
              last_payment_date, phone_number FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    logger.info('Admin viewed user details', { adminId: user.id, userId });
    return res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    logger.error('Error getting admin user:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * PUT /api/webapp/admin/users/:id
 * Update user details
 */
const updateUser = async (req, res) => {
  const user = req.user;

  try {
    const { id: userId } = req.params;
    const { username, email, subscriptionStatus, subscriptionPlan } = req.body;

    const updates = {};
    const queryParts = [];
    const values = [userId];
    let paramIndex = 2;

    if (username !== undefined) {
      queryParts.push(`username = $${paramIndex++}`);
      values.push(username);
    }
    if (email !== undefined) {
      queryParts.push(`email = $${paramIndex++}`);
      values.push(email);
    }
    if (subscriptionStatus !== undefined) {
      queryParts.push(`subscription_status = $${paramIndex++}`);
      values.push(subscriptionStatus);
      // Keep tier in sync: active subscription = prime tier
      queryParts.push(`tier = $${paramIndex++}`);
      values.push(subscriptionStatus === 'active' ? 'prime' : 'free');
    }
    if (subscriptionPlan !== undefined) {
      queryParts.push(`subscription_plan = $${paramIndex++}`);
      values.push(subscriptionPlan);
    }

    if (queryParts.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    queryParts.push(`updated_at = NOW()`);
    const updateQuery = `UPDATE users SET ${queryParts.join(', ')} WHERE id = $1`;

    await query(updateQuery, values);

    logger.info('Admin updated user', { adminId: user.id, userId, updates: req.body });

    const result = await query(
      `SELECT id, username, email, first_name, last_name, subscription_status FROM users WHERE id = $1`,
      [userId]
    );

    return res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    logger.error('Error updating admin user:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/webapp/admin/users/:id/ban
 * Ban or unban user
 */
const banUser = async (req, res) => {
  const user = req.user;

  try {
    const { id: userId } = req.params;
    const { ban, reason = '' } = req.body;

    const newTier = ban ? 'banned' : 'free';
    await query('UPDATE users SET tier = $1, updated_at = NOW() WHERE id = $2', [newTier, userId]);

    logger.info(`Admin ${ban ? 'banned' : 'unbanned'} user`, {
      adminId: user.id,
      userId,
      reason,
    });

    const result = await query('SELECT id, username, email, tier FROM users WHERE id = $1', [userId]);

    return res.json({ success: true, user: result.rows[0], action: ban ? 'banned' : 'unbanned' });
  } catch (error) {
    logger.error('Error banning user:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/webapp/admin/posts
 * List recent social posts
 */
const listPosts = async (req, res) => {
  const user = req.user;

  try {
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const result = await SocialPostService.adminListPosts(page, 20);

    logger.info('Admin listed posts', { adminId: user.id, page });
    return res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Error listing admin posts:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * DELETE /api/webapp/admin/posts/:id
 * Delete a post (admin — no ownership check)
 */
const deletePost = async (req, res) => {
  const user = req.user;

  try {
    const { id: postId } = req.params;
    const deleted = await SocialPostService.deletePost(postId, null, true);

    if (!deleted) return res.status(404).json({ error: 'Post not found' });

    logger.info('Admin deleted post', { adminId: user.id, postId });
    return res.json({ success: true, message: 'Post deleted' });
  } catch (error) {
    logger.error('Error deleting post:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/webapp/admin/hangouts
 * List active hangout rooms
 */
const listHangouts = async (req, res) => {
  const user = req.user;

  try {
    const calls = await VideoCallModel.getAllPublic();
    const hangouts = calls.map(call => ({
      id: call.id,
      title: call.title,
      creatorId: call.creatorId,
      creatorName: call.creatorName,
      currentParticipants: call.currentParticipants,
      maxParticipants: call.maxParticipants,
      isPublic: call.isPublic,
      createdAt: call.createdAt,
    }));

    logger.info('Admin listed hangouts', { adminId: user.id, count: hangouts.length });
    return res.json({ success: true, hangouts });
  } catch (error) {
    logger.error('Error listing hangouts:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * DELETE /api/webapp/admin/hangouts/:id
 * End/delete a hangout room
 */
const endHangout = async (req, res) => {
  const user = req.user;

  try {
    const { id: callId } = req.params;

    await query('UPDATE video_calls SET status = $1, ended_at = NOW() WHERE id = $2', ['ended', callId]);

    logger.info('Admin ended hangout', { adminId: user.id, callId });
    return res.json({ success: true, message: 'Hangout ended' });
  } catch (error) {
    logger.error('Error ending hangout:', error);
    return res.status(500).json({ error: error.message });
  }
};

// ==========================================
// Bulk User Update
// ==========================================

/**
 * POST /api/webapp/admin/users/bulk-update
 * Apply a single action to multiple users at once.
 */
const bulkUpdateUsers = async (req, res) => {
  const admin = req.user;

  try {
    const { userIds, action, planId, expiry } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'userIds must be a non-empty array' });
    }

    const validActions = ['upgrade', 'downgrade', 'ban', 'unban'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ error: `Invalid action. Must be one of: ${validActions.join(', ')}` });
    }

    let updated = 0;
    let failed = 0;
    const errors = [];

    for (const userId of userIds) {
      try {
        if (action === 'upgrade') {
          if (!planId) {
            errors.push({ userId, error: 'planId is required for upgrade action' });
            failed++;
            continue;
          }
          const expiryValue = expiry ? new Date(expiry) : null;
          await query(
            `UPDATE users
             SET tier = 'prime',
                 subscription_status = 'active',
                 subscription_plan = $2,
                 plan_expiry = $3,
                 updated_at = NOW()
             WHERE id = $1`,
            [userId, planId, expiryValue]
          );
        } else if (action === 'downgrade') {
          await query(
            `UPDATE users
             SET tier = 'free',
                 subscription_status = 'free',
                 subscription_plan = NULL,
                 plan_expiry = NULL,
                 updated_at = NOW()
             WHERE id = $1`,
            [userId]
          );
        } else if (action === 'ban') {
          await query(
            `UPDATE users SET tier = 'banned', updated_at = NOW() WHERE id = $1`,
            [userId]
          );
        } else if (action === 'unban') {
          await query(
            `UPDATE users SET tier = 'free', updated_at = NOW() WHERE id = $1`,
            [userId]
          );
        }
        updated++;
      } catch (userError) {
        logger.error('bulkUpdateUsers: error processing user', { userId, action, error: userError.message });
        errors.push({ userId, error: userError.message });
        failed++;
      }
    }

    logger.info('Admin bulk updated users', { adminId: admin.id, action, updated, failed });
    return res.json({ success: true, updated, failed, errors });
  } catch (error) {
    logger.error('Error in bulkUpdateUsers:', error);
    return res.status(500).json({ error: error.message });
  }
};

// ==========================================
// Plan Management
// ==========================================

const Plan = require('../../../models/planModel');

/**
 * GET /api/webapp/admin/plans
 * List all plans including promotional plans.
 */
const listPlans = async (req, res) => {
  const admin = req.user;
  try {
    const plans = await Plan.getAdminPlans();
    logger.info('Admin listed plans', { adminId: admin.id, count: plans.length });
    return res.json({ success: true, plans });
  } catch (error) {
    logger.error('Error listing plans:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/webapp/admin/plans
 * Create a new plan.
 */
const createPlan = async (req, res) => {
  const admin = req.user;
  try {
    const { id: planId, ...rest } = req.body;
    if (!planId) {
      return res.status(400).json({ error: 'Plan id is required' });
    }
    const plan = await Plan.createOrUpdate(planId, req.body);
    logger.info('Admin created plan', { adminId: admin.id, planId });
    return res.status(201).json({ success: true, plan });
  } catch (error) {
    logger.error('Error creating plan:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * PUT /api/webapp/admin/plans/:id
 * Update an existing plan.
 */
const updatePlan = async (req, res) => {
  const admin = req.user;
  try {
    const { id: planId } = req.params;
    const plan = await Plan.createOrUpdate(planId, { ...req.body, id: planId });
    logger.info('Admin updated plan', { adminId: admin.id, planId });
    return res.json({ success: true, plan });
  } catch (error) {
    logger.error('Error updating plan:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * DELETE /api/webapp/admin/plans/:id
 * Delete a plan.
 */
const deletePlan = async (req, res) => {
  const admin = req.user;
  try {
    const { id: planId } = req.params;
    const deleted = await Plan.delete(planId);
    if (!deleted) {
      return res.status(500).json({ error: 'Failed to delete plan' });
    }
    logger.info('Admin deleted plan', { adminId: admin.id, planId });
    return res.json({ success: true, message: 'Plan deleted' });
  } catch (error) {
    logger.error('Error deleting plan:', error);
    return res.status(500).json({ error: error.message });
  }
};

// ==========================================
// Push Notifications (Admin broadcast)
// ==========================================

/**
 * POST /api/webapp/admin/notifications/push
 * Send a push notification to all users, a tier, or specific users.
 * Also persists a system notification row for in-app display.
 */
const sendPushNotification = async (req, res) => {
  const admin = req.user;

  try {
    const { title, body, url, targetType, tier, userIds } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'body is required' });
    }

    const validTargetTypes = ['all', 'tier', 'users'];
    if (!validTargetTypes.includes(targetType)) {
      return res.status(400).json({ error: `Invalid targetType. Must be one of: ${validTargetTypes.join(', ')}` });
    }
    if (targetType === 'tier' && !tier) {
      return res.status(400).json({ error: 'tier is required when targetType is "tier"' });
    }
    if (targetType === 'users' && (!Array.isArray(userIds) || userIds.length === 0)) {
      return res.status(400).json({ error: 'userIds must be a non-empty array when targetType is "users"' });
    }

    const PushNotificationService = require('../../../services/pushNotificationService');
    const payload = { title, body, url };

    let sent = 0;
    if (targetType === 'all') {
      sent = await PushNotificationService.sendToAll(payload);
    } else if (targetType === 'tier') {
      sent = await PushNotificationService.sendToTier(tier, payload);
    } else if (targetType === 'users') {
      sent = await PushNotificationService.sendToUsers(userIds, payload);
    }

    // Persist system notification for in-app display
    // We insert one notification per targeted user. For 'all' and 'tier' we skip
    // per-user rows to avoid mass inserts — a single global record is stored with
    // actor_id = admin, target_user_id = admin (system record marker).
    const notificationMessage = url ? `${body} — ${url}` : body;
    await query(
      `INSERT INTO notifications
         (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT DO NOTHING`,
      [
        'system_push',
        'announcements',
        'high',
        admin.id,
        admin.id,
        'admin_broadcast',
        `push_${Date.now()}`,
        notificationMessage,
        JSON.stringify({ title, body, url, targetType, tier: tier || null, sentCount: sent }),
      ]
    );

    logger.info('Admin sent push notification', { adminId: admin.id, targetType, tier, sent });
    return res.json({ success: true, sent, message: 'Notification sent' });
  } catch (error) {
    logger.error('Error sending push notification:', error);
    return res.status(500).json({ error: error.message });
  }
};

// ==========================================
// Push Subscription (public user endpoints)
// ==========================================

/**
 * POST /api/webapp/push/subscribe
 * Save or update a browser push subscription for the authenticated user.
 */
const subscribePush = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { endpoint, keys } = req.body;

    if (!endpoint || !keys || !keys.auth || !keys.p256dh) {
      return res.status(400).json({ error: 'endpoint and keys (auth, p256dh) are required' });
    }

    await query(
      `INSERT INTO push_subscriptions (user_id, endpoint, auth, p256dh, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, endpoint) DO UPDATE
         SET auth = EXCLUDED.auth,
             p256dh = EXCLUDED.p256dh`,
      [userId, endpoint, keys.auth, keys.p256dh]
    );

    return res.json({ success: true });
  } catch (error) {
    logger.error('Error subscribing push:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * DELETE /api/webapp/push/unsubscribe
 * Remove a browser push subscription for the authenticated user.
 */
const unsubscribePush = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { endpoint } = req.body;

    if (!endpoint) {
      return res.status(400).json({ error: 'endpoint is required' });
    }

    await query(
      'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
      [userId, endpoint]
    );

    return res.json({ success: true });
  } catch (error) {
    logger.error('Error unsubscribing push:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/webapp/push/vapid-key
 * Return the VAPID public key so the frontend can create a PushSubscription.
 */
const getVapidKey = async (req, res) => {
  return res.json({ success: true, publicKey: process.env.VAPID_PUBLIC_KEY || '' });
};

module.exports = {
  getStats,
  listUsers,
  getUser,
  updateUser,
  banUser,
  listPosts,
  deletePost,
  listHangouts,
  endHangout,
  // Bulk operations
  bulkUpdateUsers,
  // Plan management
  listPlans,
  createPlan,
  updatePlan,
  deletePlan,
  // Admin push broadcast
  sendPushNotification,
  // User push subscription
  subscribePush,
  unsubscribePush,
  getVapidKey,
};
