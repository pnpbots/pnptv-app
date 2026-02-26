const logger = require('../../../utils/logger');
const { query } = require('../../../config/postgres');
const AdminDashboardService = require('../../../services/adminDashboardService');
const VideoCallModel = require('../../../models/videoCallModel');

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
    let dataQuery = `SELECT id, username, email, role, status, subscription_status, created_at
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
      `SELECT id, username, email, first_name, last_name, bio, role, status,
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

    const newStatus = ban ? 'banned' : 'active';
    await query('UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2', [newStatus, userId]);

    logger.info(`Admin ${ban ? 'banned' : 'unbanned'} user`, {
      adminId: user.id,
      userId,
      reason,
    });

    const result = await query('SELECT id, username, email, status FROM users WHERE id = $1', [userId]);

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
    const limit = 20;
    const offset = (page - 1) * limit;

    const result = await query(
      `SELECT p.id, p.user_id, p.content, p.created_at, u.username, u.first_name,
              (SELECT COUNT(*) FROM social_likes WHERE post_id = p.id) as likes,
              (SELECT COUNT(*) FROM social_replies WHERE post_id = p.id) as replies
       FROM social_posts p
       JOIN users u ON p.user_id = u.id
       WHERE p.deleted = false
       ORDER BY p.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await query(`SELECT COUNT(*) as count FROM social_posts WHERE deleted = false`);
    const total = parseInt(countResult.rows[0]?.count || 0);
    const totalPages = Math.ceil(total / limit);

    logger.info('Admin listed posts', { adminId: user.id, page });
    return res.json({
      success: true,
      posts: result.rows,
      pagination: { page, limit, total, totalPages },
    });
  } catch (error) {
    logger.error('Error listing admin posts:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * DELETE /api/webapp/admin/posts/:id
 * Delete a post
 */
const deletePost = async (req, res) => {
  const user = req.user;

  try {
    const { id: postId } = req.params;

    await query('UPDATE social_posts SET deleted = true, updated_at = NOW() WHERE id = $1', [postId]);

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
};
