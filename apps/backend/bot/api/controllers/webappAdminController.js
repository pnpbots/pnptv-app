const logger = require('../../../utils/logger');
const { query, getClient } = require('../../../config/postgres');
const { cache } = require('../../../config/redis');
const AdminDashboardService = require('../../../services/adminDashboardService');
const VideoCallModel = require('../../../models/videoCallModel');
const SocialPostService = require('../../services/socialPostService');

// Escape LIKE/ILIKE metacharacters so user input cannot widen search patterns
const escapeLike = (str) => str.replace(/[%_\\]/g, '\\$&');

// Note: Admin guard is now handled by JWT middleware (verifyAdminJWT in routes.js)
// req.user is populated by the middleware and contains user data

/**
 * GET /api/webapp/admin/stats
 * Get admin dashboard stats
 */
const getStats = async (req, res) => {
  const user = req.user;

  try {
    const raw = await AdminDashboardService.getDashboardOverview();
    if (!raw) {
      return res.status(500).json({ error: 'Failed to load stats' });
    }

    // Transform nested backend response to flat frontend AdminStats interface.
    // All numeric PG columns arrive as strings; Date columns arrive as Date objects.
    // We normalise every value to the correct primitive type so the frontend never
    // receives [object Object] or NaN in place of a number/string.
    const toNum = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
    const toInt = (v) => { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; };
    // Serialize a PG Date (or ISO string) to a stable YYYY-MM-DD date string so
    // the frontend always gets a plain string, never a Date object.
    const toDateStr = (v) => {
      if (!v) return null;
      if (v instanceof Date) return v.toISOString().split('T')[0];
      return String(v).split('T')[0];
    };

    const stats = {
      totalRevenue: toNum(raw.payments?.total_revenue),
      activeSubscribers: toInt(raw.membership?.totals?.active_subscribers),
      totalUsers: toInt(raw.membership?.totals?.total_active_users),
      churnedUsers: toInt(raw.membership?.totals?.churned_users),
      monthlyRevenue: toNum(raw.revenue?.monthly?.monthly_revenue),
      dailyRevenue: (raw.revenue?.daily || []).map(d => ({
        date: toDateStr(d.payment_day),
        amount: toNum(d.daily_revenue),
      })),
      membershipBreakdown: (raw.membership?.byStatus || []).reduce((acc, row) => {
        acc[row.subscription_status] = toInt(row.count);
        return acc;
      }, {}),
      topPaymentMethods: (raw.topMethods || []).map(m => ({
        method: String(m.payment_method || ''),
        transactions: toInt(m.transaction_count),
        revenue: toNum(m.total_revenue),
        successRate: toNum(m.success_rate),
      })),
      recentTransactions: (raw.recentTransactions || []).map(t => ({
        date: t.payment_date instanceof Date ? t.payment_date.toISOString() : String(t.payment_date || ''),
        userId: String(t.user_id || ''),
        username: t.username || t.first_name || `User ${t.user_id}`,
        amount: toNum(t.amount),
        status: String(t.status || ''),
        method: String(t.payment_method || t.last_payment_method || ''),
      })),
    };

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
    const tierFilter = (req.query.tier || '').trim();
    const statusFilter = (req.query.status || '').trim();
    const planFilter = (req.query.plan || '').trim();
    const roleFilter = (req.query.role || '').trim();
    const limit = 20;
    const offset = (page - 1) * limit;

    let countQuery = 'SELECT COUNT(*) as count FROM users WHERE is_active = true';
    let dataQuery = `SELECT id, username, email, first_name, last_name, role, tier,
                            subscription_status, plan_id AS subscription_plan, plan_expiry, created_at
                     FROM users WHERE is_active = true`;
    const params = [];
    const countParams = [];

    if (search) {
      const searchTerm = `%${escapeLike(search)}%`;
      const idx1 = params.length + 1;
      const idx2 = params.length + 2;
      const searchClause = ` AND (username ILIKE $${idx1} ESCAPE '\\' OR email ILIKE $${idx1} ESCAPE '\\' OR first_name ILIKE $${idx1} ESCAPE '\\' OR last_name ILIKE $${idx1} ESCAPE '\\' OR id::text = $${idx2})`;
      countQuery += searchClause;
      dataQuery += searchClause;
      params.push(searchTerm, search);
      countParams.push(searchTerm, search);
    }

    if (tierFilter) {
      const idx = params.length + 1;
      const clause = ` AND tier = $${idx}`;
      countQuery += clause;
      dataQuery += clause;
      params.push(tierFilter);
      countParams.push(tierFilter);
    }

    if (statusFilter) {
      const idx = params.length + 1;
      const clause = ` AND subscription_status = $${idx}`;
      countQuery += clause;
      dataQuery += clause;
      params.push(statusFilter);
      countParams.push(statusFilter);
    }

    if (planFilter) {
      const idx = params.length + 1;
      let clause;
      if (planFilter === '__none__') {
        clause = ' AND (plan_id IS NULL OR plan_id = \'\')';
      } else {
        clause = ` AND plan_id = $${idx}`;
        params.push(planFilter);
        countParams.push(planFilter);
      }
      countQuery += clause;
      dataQuery += clause;
    }

    if (roleFilter) {
      const idx = params.length + 1;
      const clause = ` AND role = $${idx}`;
      countQuery += clause;
      dataQuery += clause;
      params.push(roleFilter);
      countParams.push(roleFilter);
    }

    dataQuery += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const [countResult, dataResult] = await Promise.all([
      query(countQuery, countParams),
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
              subscription_status, plan_id AS subscription_plan, plan_expiry, created_at,
              last_payment_date,
              creator_status, creator_type, creator_price_usd, live_channel
         FROM users WHERE id = $1`,
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

  // Canonical allowed values — must match DB CHECK constraints and tier vocabulary
  const VALID_TIERS = ['free', 'member', 'PRIME', 'banned'];
  const VALID_STATUSES = ['free', 'active', 'churned', 'expired'];

  try {
    const { id: userId } = req.params;
    const { username, email, subscriptionStatus, subscriptionPlan, tier, planExpiry } = req.body;

    // Server-side whitelist validation — provides clean 400s instead of raw Postgres constraint errors
    if (tier !== undefined && !VALID_TIERS.includes(tier)) {
      return res.status(400).json({ error: `Invalid tier. Must be one of: ${VALID_TIERS.join(', ')}` });
    }
    if (subscriptionStatus !== undefined && !VALID_STATUSES.includes(subscriptionStatus)) {
      return res.status(400).json({ error: `Invalid subscriptionStatus. Must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    // Validate subscriptionPlan against the active plans in the DB to prevent
    // arbitrary plan_id injection (e.g. pointing a user at a non-existent or
    // inactive plan that could grant unintended entitlements downstream).
    if (subscriptionPlan !== undefined && subscriptionPlan !== null) {
      const planCheck = await query(
        'SELECT id FROM plans WHERE id = $1 AND active = true',
        [subscriptionPlan]
      );
      if (planCheck.rows.length === 0) {
        return res.status(400).json({ error: `Invalid subscriptionPlan: plan '${subscriptionPlan}' does not exist or is inactive` });
      }
    }

    // Validate planExpiry — must be a parseable date string or null/empty.
    // Reject strings that produce an Invalid Date (e.g. garbage input) so
    // we never write NaN/Invalid Date to the DB timestamp column.
    if (planExpiry !== undefined && planExpiry !== null && planExpiry !== '') {
      const parsed = new Date(planExpiry);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'Invalid planExpiry: must be a valid ISO date string or null' });
      }
    }

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
      // Admin-set emails are trusted — mark verified so the user isn't blocked on login
      queryParts.push(`email_verified = true`);
    }
    if (subscriptionStatus !== undefined) {
      queryParts.push(`subscription_status = $${paramIndex++}`);
      values.push(subscriptionStatus);
    }
    if (tier !== undefined) {
      queryParts.push(`tier = $${paramIndex++}`);
      values.push(tier);
    }
    if (subscriptionPlan !== undefined) {
      queryParts.push(`plan_id = $${paramIndex++}`);
      values.push(subscriptionPlan);
    }
    if (planExpiry !== undefined) {
      queryParts.push(`plan_expiry = $${paramIndex++}`);
      // Empty string is treated as null (clear the expiry)
      values.push(planExpiry ? new Date(planExpiry) : null);
    }

    if (queryParts.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    queryParts.push(`updated_at = NOW()`);
    const updateQuery = `UPDATE users SET ${queryParts.join(', ')} WHERE id = $1`;

    await query(updateQuery, values);

    // Invalidate Redis user cache so subsequent reads reflect the update immediately
    const { cache } = require('../../../config/redis');
    await cache.del(`user:${userId}`);

    logger.info('Admin updated user', { adminId: user.id, userId, updates: req.body });

    const result = await query(
      `SELECT id, username, email, first_name, last_name, role, tier,
              subscription_status, plan_id AS subscription_plan, plan_expiry FROM users WHERE id = $1`,
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

    if (ban) {
      // Full ban: revoke tier, role, creator status, subscription
      await query(
        `UPDATE users SET tier = 'banned', role = 'user', creator_status = 'none',
         subscription_status = 'expired', updated_at = NOW() WHERE id = $1`,
        [userId]
      );

      // Invalidate Redis user cache immediately
      const { cache } = require('../../../config/redis');
      await cache.del(`user:${userId}`);

      // Destroy all active sessions so the user is kicked out immediately.
      // IMPORTANT: ioredis keyPrefix is prepended automatically to every key command,
      // so we must NOT include the prefix in the scan pattern here.
      // If keyPrefix = 'pnpapp:' then redis.keys('sess:*') scans 'pnpapp:sess:*' in Redis.
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
    } else {
      // Unban: restore to free tier.
      // Use 'churned' for subscription_status rather than 'free' — the user existed before the ban
      // and 'churned' correctly reflects an ex-subscriber. An admin can manually re-upgrade if needed.
      // (Setting to 'free' was wrong: it permanently cleared prior subscription state even for paid users.)
      await query(
        `UPDATE users SET tier = 'free', subscription_status = 'churned', updated_at = NOW() WHERE id = $1`,
        [userId]
      );

      // Invalidate Redis user cache
      const { cache } = require('../../../config/redis');
      await cache.del(`user:${userId}`);
    }

    logger.info(`Admin ${ban ? 'banned' : 'unbanned'} user`, {
      adminId: user.id,
      userId,
      reason,
    });

    const result = await query(
      `SELECT id, username, email, tier, role, creator_status, subscription_status, plan_id AS subscription_plan, plan_expiry FROM users WHERE id = $1`,
      [userId]
    );

    return res.json({ success: true, user: result.rows[0], action: ban ? 'banned' : 'unbanned' });
  } catch (error) {
    logger.error('Error banning user:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * DELETE /api/webapp/admin/users/:id
 * Soft-delete a user: set deleted_at, clear PII, destroy sessions.
 * Superadmin-only to prevent accidental mass deletions.
 */
const deleteUser = async (req, res) => {
  const admin = req.user;

  try {
    const { id: userId } = req.params;

    // Prevent admins from deleting themselves
    if (String(admin.id) === String(userId)) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    // Prevent deleting other admins/superadmins
    const targetCheck = await query('SELECT id, username, role FROM users WHERE id = $1', [userId]);
    if (targetCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const target = targetCheck.rows[0];
    if (target.role === 'admin' || target.role === 'superadmin') {
      return res.status(403).json({ error: 'Cannot delete admin users. Remove their admin role first.' });
    }

    // Soft-delete: mark as deleted, clear PII, revoke access
    await query(
      `UPDATE users SET
         deleted_at = NOW(),
         is_deleted = true,
         is_active = false,
         tier = 'banned',
         subscription_status = 'expired',
         role = 'user',
         creator_status = 'none',
         email = NULL,
         bio = NULL,
         photo_file_id = NULL,
         plan_id = NULL,
         updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );

    // Destroy all active sessions
    try {
      const redis = require('../../../config/redis').client;
      const keys = await redis.keys('sess:*');
      for (const key of keys) {
        const val = await redis.get(key);
        if (val && val.includes(userId.toString())) {
          await redis.del(key);
        }
      }
    } catch (sessErr) {
      logger.warn('Failed to destroy sessions for deleted user', { userId, error: sessErr.message });
    }

    // Invalidate Redis user cache
    await cache.del(`user:${userId}`);

    logger.info('Admin deleted user', { adminId: admin.id, userId, username: target.username });

    return res.json({ success: true, message: `User ${target.username || userId} has been deleted` });
  } catch (error) {
    logger.error('Error deleting user:', error);
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

    // Map snake_case DB columns to camelCase frontend interface
    const posts = (result.posts || []).map(p => ({
      id: p.id,
      authorId: p.user_id,
      authorUsername: p.username,
      authorFirstName: p.first_name,
      authorPhotoUrl: p.photo_file_id || null,
      content: p.content,
      mediaUrl: p.media_url,
      mediaType: p.media_type,
      likesCount: p.likes_count,
      repliesCount: p.replies_count,
      createdAt: p.created_at,
    }));

    logger.info('Admin listed posts', { adminId: user.id, page });
    return res.json({ success: true, posts, pagination: result.pagination });
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
 * List all hangout groups with member counts and creator info
 */
const listHangouts = async (req, res) => {
  const user = req.user;

  try {
    const result = await query(`
      SELECT g.id, g.name, g.description, g.creator_id, g.is_public, g.max_members, g.created_at,
             u.first_name AS creator_first_name, u.username AS creator_username,
             (SELECT count(*) FROM hangout_group_members m WHERE m.group_id = g.id) AS member_count
      FROM hangout_groups g
      LEFT JOIN users u ON u.id::text = g.creator_id::text
      ORDER BY g.created_at DESC
    `);

    const hangouts = result.rows.map(row => ({
      id: row.id,
      title: row.name || 'Untitled Room',
      description: row.description || '',
      creatorId: row.creator_id,
      creatorName: row.creator_first_name || row.creator_username || 'System',
      currentParticipants: parseInt(row.member_count, 10) || 0,
      maxParticipants: row.max_members || 200,
      isPublic: row.is_public,
      createdAt: row.created_at,
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
 * Delete a hangout group and its members
 */
const endHangout = async (req, res) => {
  const user = req.user;
  const { id } = req.params;
  const client = await getClient();

  try {
    await client.query('BEGIN');
    // End active calls before deleting
    await client.query(`UPDATE video_calls SET is_active=false, ended_at=NOW() WHERE group_id=$1 AND is_active=true`, [id]);
    await client.query(`UPDATE hangout_video_calls SET status='ended', ended_at=NOW() WHERE group_id=$1 AND status='active'`, [id]);
    // Clean up participants, members, join requests, then the group
    await client.query('DELETE FROM hangout_call_participants WHERE call_id IN (SELECT id FROM hangout_video_calls WHERE group_id = $1)', [id]);
    await client.query('DELETE FROM hangout_video_calls WHERE group_id = $1', [id]);
    await client.query('DELETE FROM hangout_join_requests WHERE group_id = $1', [id]);
    await client.query('DELETE FROM hangout_group_members WHERE group_id = $1', [id]);
    await client.query('DELETE FROM hangout_groups WHERE id = $1', [id]);
    await client.query('COMMIT');

    logger.info('Admin deleted hangout group', { adminId: user.id, groupId: id });
    return res.json({ success: true, message: 'Hangout group deleted' });
  } catch (error) {
    await client.query('ROLLBACK').catch(rbErr => logger.error('ROLLBACK failed in endHangout:', rbErr));
    logger.error('Error deleting hangout group:', error);
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
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

    const validActions = ['upgrade', 'downgrade', 'ban', 'unban', 'delete'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ error: `Invalid action. Must be one of: ${validActions.join(', ')}` });
    }

    // Prevent bulk-deleting admin users
    if (action === 'delete') {
      const adminCheck = await query(
        `SELECT id FROM users WHERE id = ANY($1::text[]) AND role IN ('admin', 'superadmin')`,
        [userIds]
      );
      if (adminCheck.rows.length > 0) {
        return res.status(403).json({ error: 'Cannot delete admin users. Remove their admin role first.' });
      }
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
          const planResult = await query('SELECT tier FROM plans WHERE id = $1', [planId]);
          const targetTier = planResult.rows[0]?.tier || 'PRIME';
          await query(
            `UPDATE users
             SET tier = $4,
                 subscription_status = 'active',
                 plan_id = $2,
                 plan_expiry = $3,
                 updated_at = NOW()
             WHERE id = $1`,
            [userId, planId, expiryValue, targetTier]
          );
        } else if (action === 'downgrade') {
          await query(
            `UPDATE users
             SET tier = 'free',
                 subscription_status = 'free',
                 plan_id = NULL,
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
        } else if (action === 'delete') {
          await query(
            `UPDATE users SET
               deleted_at = NOW(), is_deleted = true, is_active = false,
               tier = 'banned', subscription_status = 'expired',
               role = 'user', creator_status = 'none',
               email = NULL, bio = NULL, photo_file_id = NULL, plan_id = NULL,
               updated_at = NOW()
             WHERE id = $1`,
            [userId]
          );
          await cache.del(`user:${userId}`);
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
 * Create a new plan. If id is omitted, it is auto-generated from name.
 * Accepts optional addOns array to wire plan_add_ons and auto-derive tier/features/description.
 */
const createPlan = async (req, res) => {
  const admin = req.user;
  try {
    const { id: rawId, addOns, ...planData } = req.body;

    if (!planData.name && !planData.display_name) {
      return res.status(400).json({ error: 'Plan name is required' });
    }

    // planId may be empty — createOrUpdate will slugify the name if so
    const planId = rawId && String(rawId).trim() ? String(rawId).trim() : null;

    const plan = await Plan.createOrUpdate(planId, planData, addOns);
    logger.info('Admin created plan', { adminId: admin.id, planId: plan.id });
    return res.status(201).json({ success: true, plan });
  } catch (error) {
    logger.error('Error creating plan:', error);
    const status = error.status || 500;
    return res.status(status).json({ error: error.message });
  }
};

/**
 * PUT /api/webapp/admin/plans/:id
 * Update an existing plan.
 * Accepts optional addOns array to atomically replace plan_add_ons and
 * re-derive tier/features/description. If addOns is omitted, existing
 * plan_add_ons mappings are preserved.
 */
const updatePlan = async (req, res) => {
  const admin = req.user;
  try {
    const { id: planId } = req.params;
    const { addOns, ...planData } = req.body;

    // Only forward addOns when the caller explicitly sent the field
    const resolvedAddOns = Object.prototype.hasOwnProperty.call(req.body, 'addOns')
      ? addOns
      : undefined;

    const plan = await Plan.createOrUpdate(planId, { ...planData, id: planId }, resolvedAddOns);
    logger.info('Admin updated plan', { adminId: admin.id, planId });
    return res.json({ success: true, plan });
  } catch (error) {
    logger.error('Error updating plan:', error);
    const status = error.status || 500;
    return res.status(status).json({ error: error.message });
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
    // FK constraint: plan has existing payments referencing it
    if (error.code === '23503') {
      return res.status(409).json({ error: 'Cannot delete plan — it has existing payments. Deactivate it instead.' });
    }
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
    const { title, body, url, targetType, tier, userIds, channels } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'body is required' });
    }
    if (title.trim().length > 100) {
      return res.status(400).json({ error: 'title must be ≤ 100 characters' });
    }
    if (body.trim().length > 500) {
      return res.status(400).json({ error: 'body must be ≤ 500 characters' });
    }
    if (url !== undefined && url !== null && url !== '') {
      const urlStr = String(url);
      if (!urlStr.startsWith('/') && !urlStr.startsWith('https://')) {
        return res.status(400).json({ error: 'url must be a relative path starting with / or an absolute https:// URL' });
      }
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
    if (targetType === 'users' && Array.isArray(userIds) && userIds.length > 500) {
      return res.status(400).json({ error: 'userIds must contain ≤ 500 entries' });
    }

    // Determine which channels to use — default to all three if not specified
    const activeChannels = Array.isArray(channels) && channels.length > 0
      ? channels
      : ['push', 'bot', 'email'];

    const doPush = activeChannels.includes('push');
    const doBot = activeChannels.includes('bot');
    const doEmail = activeChannels.includes('email');

    // ── Push channel ──────────────────────────────────────────────────────────
    const PushNotificationService = require('../../services/pushNotificationService');
    const pushPayload = { title, body, url };

    let sent = 0;
    if (doPush) {
      if (targetType === 'all') {
        sent = await PushNotificationService.sendToAll(pushPayload);
      } else if (targetType === 'tier') {
        sent = await PushNotificationService.sendToTier(tier, pushPayload);
      } else if (targetType === 'users') {
        sent = await PushNotificationService.sendToUsers(userIds, pushPayload);
      }
    }

    // ── Resolve target users for bot DM + email channels ─────────────────────
    let targetUsers = [];
    if (doBot || doEmail) {
      let usersResult;
      if (targetType === 'all') {
        usersResult = await query(
          `SELECT id, email, telegram, first_name, username FROM users WHERE deleted_at IS NULL AND tier != 'banned'`
        );
      } else if (targetType === 'tier') {
        // Match users whose active subscription plan matches the requested tier label.
        // The `tier` column on users is populated by the subscription system.
        usersResult = await query(
          `SELECT id, email, telegram, first_name, username
             FROM users
            WHERE deleted_at IS NULL
              AND tier != 'banned'
              AND tier = $1`,
          [tier]
        );
      } else {
        // 'users' — explicit numeric IDs from the admin form
        const numericIds = userIds.map(Number).filter((n) => !isNaN(n) && n > 0);
        if (numericIds.length > 0) {
          usersResult = await query(
            `SELECT id, email, telegram, first_name, username
               FROM users
              WHERE id = ANY($1::int[])
                AND deleted_at IS NULL
                AND tier != 'banned'`,
            [numericIds]
          );
        } else {
          usersResult = { rows: [] };
        }
      }
      targetUsers = usersResult.rows;
    }

    // ── Bot DM channel ────────────────────────────────────────────────────────
    let botDmSent = 0;
    if (doBot && targetUsers.length > 0) {
      const { sendNotificationViaTelegram } = require('../../services/notificationBotDelivery');
      const usersWithTelegram = targetUsers.filter((u) => u.telegram);

      // Fire-and-forget: send all DMs concurrently, count fulfilled
      const dmResults = await Promise.allSettled(
        usersWithTelegram.map((u) =>
          sendNotificationViaTelegram(u.id, {
            type: 'announcement',
            message: title ? `${title}\n\n${body}` : body,
          })
        )
      );
      botDmSent = dmResults.filter((r) => r.status === 'fulfilled').length;
    }

    // ── Email channel ─────────────────────────────────────────────────────────
    let emailSent = 0;
    if (doEmail && targetUsers.length > 0) {
      const emailService = require('../../../services/emailService');
      const usersWithEmail = targetUsers.filter((u) => u.email);

      const appUrl = process.env.APP_PUBLIC_URL || 'https://app.pnptv.app';
      const actionUrl = url
        ? (url.startsWith('http') ? url : `${appUrl}${url}`)
        : appUrl;

      // Build a simple, readable HTML body for the broadcast email
      const htmlBody = `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
          <h2 style="margin:0 0 12px;color:#1a1a2e">${title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h2>
          <p style="margin:0 0 20px;color:#444;line-height:1.6">${body.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>
          <a href="${actionUrl}" style="display:inline-block;padding:10px 20px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:6px">Open PNPtv!</a>
          <p style="margin:24px 0 0;font-size:12px;color:#999">You received this message as a PNPtv! member.</p>
        </div>`.trim();

      const emailResults = await Promise.allSettled(
        usersWithEmail.map((u) =>
          emailService.send({
            to: u.email,
            subject: title,
            html: htmlBody,
          }).catch((err) => {
            logger.warn('[sendPushNotification] Email send failed', { userId: u.id, error: err.message });
          })
        )
      );
      emailSent = emailResults.filter((r) => r.status === 'fulfilled').length;
    }

    // ── Persist in-app notification rows for all target users ─────────────────
    // When bot/email channels are active, targetUsers is already resolved above.
    // When only push is active we still need the user list for in-app delivery.
    let inAppTargetUsers = targetUsers;
    if (inAppTargetUsers.length === 0) {
      let usersResult;
      if (targetType === 'all') {
        usersResult = await query(
          `SELECT id FROM users WHERE deleted_at IS NULL AND tier != 'banned'`
        );
      } else if (targetType === 'tier') {
        usersResult = await query(
          `SELECT id FROM users WHERE deleted_at IS NULL AND tier != 'banned' AND tier = $1`,
          [tier]
        );
      } else {
        const numericIds = (userIds || []).map(Number).filter((n) => !isNaN(n) && n > 0);
        if (numericIds.length > 0) {
          usersResult = await query(
            `SELECT id FROM users WHERE id = ANY($1::int[]) AND deleted_at IS NULL AND tier != 'banned'`,
            [numericIds]
          );
        } else {
          usersResult = { rows: [] };
        }
      }
      inAppTargetUsers = usersResult.rows;
    }

    const NotificationEmitter = require('../../services/notificationEmitter');
    const notificationMessage = url ? `${body} — ${url}` : body;
    const broadcastEntityId = `push_${Date.now()}`;

    if (inAppTargetUsers.length > 0) {
      const recipientIds = inAppTargetUsers.map((u) => u.id);
      await NotificationEmitter.emitToMany(recipientIds, {
        type: 'system_push',
        category: 'announcements',
        priority: 'high',
        actorId: admin.id,
        entityType: 'broadcast',
        entityId: broadcastEntityId,
        message: notificationMessage,
        metadata: {
          title,
          body,
          url,
          targetType,
          tier: tier || null,
          channels: activeChannels,
          sentCount: sent,
          botDmSent,
          emailSent,
        },
      });
    }

    logger.info('Admin sent broadcast notification', {
      adminId: admin.id,
      targetType,
      tier,
      channels: activeChannels,
      sent,
      botDmSent,
      emailSent,
    });

    return res.json({
      success: true,
      sent,
      botDmSent,
      emailSent,
      message: 'Notification sent',
    });
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
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key || !key.trim()) {
    return res.status(503).json({ success: false, error: 'Push notifications not configured' });
  }
  return res.json({ success: true, publicKey: key });
};

/**
 * GET /api/webapp/admin/demographics
 * User population demographics + feature engagement + strategy insights
 */
const getDemographics = async (req, res) => {
  try {
    const toInt = (v) => { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; };

    const [
      tierRows,
      languageRows,
      locationRows,
      signupRows,
      activityRows,
      featureRows,
      subscriptionTypeRows,
      xpRows,
      retentionRows,
    ] = await Promise.all([
      // Tier distribution
      query(`SELECT tier, COUNT(*) as cnt FROM users GROUP BY tier ORDER BY cnt DESC`),

      // Language distribution (top 10)
      query(`SELECT COALESCE(language, 'unknown') as lang, COUNT(*) as cnt FROM users GROUP BY lang ORDER BY cnt DESC LIMIT 10`),

      // Location/region distribution
      query(`SELECT COALESCE(location_name, 'Unknown') as region, COUNT(*) as cnt FROM users WHERE location_name IS NOT NULL AND location_name != '' GROUP BY region ORDER BY cnt DESC LIMIT 12`),

      // Signup trend — new users per day last 30 days
      query(`SELECT DATE_TRUNC('day', created_at)::DATE as day, COUNT(*) as cnt FROM users WHERE created_at >= NOW() - INTERVAL '30 days' GROUP BY day ORDER BY day ASC`),

      // Activity cohorts
      query(`SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN last_active >= NOW() - INTERVAL '1 day' THEN 1 END) as active_1d,
        COUNT(CASE WHEN last_active >= NOW() - INTERVAL '7 days' THEN 1 END) as active_7d,
        COUNT(CASE WHEN last_active >= NOW() - INTERVAL '30 days' THEN 1 END) as active_30d,
        COUNT(CASE WHEN last_active >= NOW() - INTERVAL '90 days' THEN 1 END) as active_90d,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as new_7d,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as new_30d,
        COUNT(CASE WHEN age_verified = true THEN 1 END) as age_verified,
        COUNT(CASE WHEN terms_accepted = true THEN 1 END) as terms_accepted,
        COUNT(CASE WHEN location_lat IS NOT NULL THEN 1 END) as with_location,
        COUNT(CASE WHEN bio IS NOT NULL AND bio != '' THEN 1 END) as with_bio,
        COUNT(CASE WHEN photo_file_id IS NOT NULL THEN 1 END) as with_photo,
        ROUND(AVG(COALESCE(xp, 0)), 1) as avg_xp,
        MAX(COALESCE(xp, 0)) as max_xp
      FROM users`),

      // Feature engagement counts — tables that are guaranteed to exist
      query(`SELECT
        (SELECT COUNT(*) FROM social_posts) as posts,
        (SELECT COUNT(*) FROM social_post_likes) as post_likes,
        (SELECT COUNT(*) FROM direct_messages) as dms,
        (SELECT COUNT(*) FROM chat_messages) as chat_msgs,
        (SELECT COUNT(*) FROM hangout_groups) as hangouts,
        (SELECT COUNT(*) FROM hangout_group_members) as hangout_members,
        (SELECT COUNT(*) FROM live_streams) as streams,
        (SELECT COUNT(*) FROM notifications) as notifications_sent,
        (SELECT COUNT(*) FROM user_follows) as follows,
        (SELECT COUNT(*) FROM push_subscriptions) as push_subs,
        (SELECT COUNT(*) FROM x_accounts) as x_linked,
        (SELECT COUNT(*) FROM user_pds_mapping) as bluesky_linked
      `),

      // Subscription type
      query(`SELECT COALESCE(subscription_type, 'one_time') as sub_type, COUNT(*) as cnt FROM users GROUP BY sub_type ORDER BY cnt DESC`),

      // XP distribution buckets
      query(`SELECT
        COUNT(CASE WHEN xp = 0 THEN 1 END) as xp_zero,
        COUNT(CASE WHEN xp BETWEEN 1 AND 50 THEN 1 END) as xp_low,
        COUNT(CASE WHEN xp BETWEEN 51 AND 200 THEN 1 END) as xp_mid,
        COUNT(CASE WHEN xp BETWEEN 201 AND 500 THEN 1 END) as xp_high,
        COUNT(CASE WHEN xp > 500 THEN 1 END) as xp_super
      FROM users`),

      // 30-day retention: users who signed up 30-60 days ago and were active in last 30 days
      query(`SELECT
        COUNT(*) as cohort_size,
        COUNT(CASE WHEN last_active >= NOW() - INTERVAL '30 days' THEN 1 END) as retained
      FROM users WHERE created_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days'`),
    ]);

    // These 3 tables have no migration and may not exist on a fresh deploy.
    // Run each in its own try/catch so a missing table never crashes the whole endpoint.
    let mediaPlays = 0;
    let mediaFavorites = 0;
    let tips = 0;
    try {
      const r = await query(`SELECT COUNT(*) as cnt FROM media_play_history`);
      mediaPlays = toInt(r.rows[0]?.cnt);
    } catch (_) { /* table absent — default stays 0 */ }
    try {
      const r = await query(`SELECT COUNT(*) as cnt FROM media_favorites`);
      mediaFavorites = toInt(r.rows[0]?.cnt);
    } catch (_) { /* table absent — default stays 0 */ }
    try {
      const r = await query(`SELECT COUNT(*) as cnt FROM pnp_tips`);
      tips = toInt(r.rows[0]?.cnt);
    } catch (_) { /* table absent — default stays 0 */ }

    const activity = activityRows.rows[0] || {};
    const features = featureRows.rows[0] || {};
    const xp = xpRows.rows[0] || {};
    const retention = retentionRows.rows[0] || {};
    const total = toInt(activity.total) || 1;

    // Compute strategy insights
    const insights = [];
    const spanishPct = Math.round(toInt(languageRows.rows.find(r => r.lang === 'es')?.cnt) / total * 100);
    if (spanishPct >= 15) {
      insights.push({ type: 'opportunity', title: 'Spanish Audience', body: `${spanishPct}% of users are Spanish-speaking. Prioritize bilingual content, onboarding, and creator outreach in Spanish.` });
    }
    const freePct = Math.round(toInt(tierRows.rows.find(r => r.tier === 'free')?.cnt) / total * 100);
    if (freePct >= 10) {
      insights.push({ type: 'conversion', title: 'Free-to-Paid Gap', body: `${freePct}% of users are on the free tier. Improve conversion with targeted upsell flows, limited-time promos, and Lifetime100 visibility.` });
    }
    const socialEngagement = toInt(features.posts) + toInt(features.post_likes) + toInt(features.follows);
    if (socialEngagement < total * 0.1) {
      insights.push({ type: 'engagement', title: 'Social Feed Underused', body: 'Post volume is low relative to user base. Encourage creators to post regularly and promote content reactions.' });
    }
    const dmPct = toInt(features.dms) / total;
    if (dmPct < 0.5) {
      insights.push({ type: 'engagement', title: 'DM Feature Underutilized', body: 'Direct messaging is low. Surface the DM inbox more prominently and prompt users to connect after matching.' });
    }
    const withBioPct = Math.round(toInt(activity.with_bio) / total * 100);
    if (withBioPct < 40) {
      insights.push({ type: 'onboarding', title: 'Profile Completion Low', body: `Only ${withBioPct}% of users have a bio. A profile completion nudge or gamified XP reward can drive this up significantly.` });
    }
    const retentionRate = toInt(retention.cohort_size) > 0 ? Math.round(toInt(retention.retained) / toInt(retention.cohort_size) * 100) : null;
    if (retentionRate !== null && retentionRate < 30) {
      insights.push({ type: 'retention', title: 'Retention Needs Work', body: `30-day retention is ${retentionRate}%. Focus on habit-forming features: daily content drops, push notifications, and social prompts.` });
    }
    if (toInt(features.push_subs) < total * 0.2) {
      insights.push({ type: 'engagement', title: 'Push Opt-in Low', body: `Only ${Math.round(toInt(features.push_subs) / total * 100)}% opted into push notifications. A well-timed permission prompt can boost re-engagement significantly.` });
    }
    if (insights.length === 0) {
      insights.push({ type: 'success', title: 'Strong Platform Health', body: 'All key engagement and demographic indicators are within healthy ranges. Keep up the momentum.' });
    }

    return res.json({
      success: true,
      demographics: {
        tiers: tierRows.rows.map(r => ({ label: r.tier || 'unknown', count: toInt(r.cnt) })),
        languages: languageRows.rows.map(r => ({ label: r.lang, count: toInt(r.cnt) })),
        locations: locationRows.rows.map(r => ({ label: r.region, count: toInt(r.cnt) })),
        signupTrend: signupRows.rows.map(r => ({ day: String(r.day).slice(0, 10), count: toInt(r.cnt) })),
        subscriptionTypes: subscriptionTypeRows.rows.map(r => ({ label: r.sub_type, count: toInt(r.cnt) })),
        activity: {
          total: toInt(activity.total),
          active1d: toInt(activity.active_1d),
          active7d: toInt(activity.active_7d),
          active30d: toInt(activity.active_30d),
          active90d: toInt(activity.active_90d),
          new7d: toInt(activity.new_7d),
          new30d: toInt(activity.new_30d),
          ageVerified: toInt(activity.age_verified),
          termsAccepted: toInt(activity.terms_accepted),
          withBio: toInt(activity.with_bio),
          withPhoto: toInt(activity.with_photo),
          withLocation: toInt(activity.with_location),
          avgXp: parseFloat(activity.avg_xp) || 0,
        },
        xpBuckets: [
          { label: 'No XP', count: toInt(xp.xp_zero) },
          { label: '1–50', count: toInt(xp.xp_low) },
          { label: '51–200', count: toInt(xp.xp_mid) },
          { label: '201–500', count: toInt(xp.xp_high) },
          { label: '500+', count: toInt(xp.xp_super) },
        ],
        retention: {
          cohortSize: toInt(retention.cohort_size),
          retained: toInt(retention.retained),
          rate: retentionRate,
        },
        features: {
          posts: toInt(features.posts),
          postLikes: toInt(features.post_likes),
          dms: toInt(features.dms),
          chatMessages: toInt(features.chat_msgs),
          hangouts: toInt(features.hangouts),
          hangoutMembers: toInt(features.hangout_members),
          streams: toInt(features.streams),
          notificationsSent: toInt(features.notifications_sent),
          follows: toInt(features.follows),
          mediaPlays,
          mediaFavorites,
          tips,
          pushSubscribers: toInt(features.push_subs),
          xLinked: toInt(features.x_linked),
          blueskyLinked: toInt(features.bluesky_linked),
        },
        insights,
      },
    });
  } catch (error) {
    logger.error('getDemographics error:', error);
    return res.status(500).json({ error: 'Failed to load demographics' });
  }
};

// ==========================================
// Entitlement Management
// ==========================================

const EntitlementModel = require('../../../models/entitlementModel');

const SUPERADMIN_IDS = (process.env.SUPERADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

/**
 * GET /api/webapp/admin/add-ons
 * List all add-on types.
 */
const listAddOns = async (req, res) => {
  try {
    const addOns = await EntitlementModel.getAllAddOns();
    return res.json({ success: true, addOns });
  } catch (error) {
    logger.error('listAddOns error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /api/webapp/admin/plans/:planId/add-ons
 * Get plan_add_ons for a specific plan.
 */
const getPlanAddOns = async (req, res) => {
  try {
    const addOns = await EntitlementModel.getPlanAddOns(req.params.planId);
    return res.json({ success: true, addOns });
  } catch (error) {
    logger.error('getPlanAddOns error:', error);
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message });
  }
};

/**
 * PUT /api/webapp/admin/plans/:planId/add-ons
 * Replace all plan_add_ons for a plan.
 */
const setPlanAddOns = async (req, res) => {
  try {
    const { addOns } = req.body;
    if (!Array.isArray(addOns)) {
      return res.status(400).json({ success: false, error: 'addOns must be an array' });
    }
    const planId = req.params.planId;
    const result = await EntitlementModel.setPlanAddOns(planId, addOns);
    await cache.del('plans:all');
    await cache.del(`plan:${planId}`);
    logger.info('Admin set plan add-ons', { adminId: req.user?.id, planId, count: addOns.length });
    return res.json({ success: true, addOns: result });
  } catch (error) {
    logger.error('setPlanAddOns error:', error);
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message });
  }
};

/**
 * GET /api/webapp/admin/users/:userId/entitlements
 * Get a user's entitlements and recent audit log.
 */
const getUserEntitlements = async (req, res) => {
  try {
    const [entitlements, auditResult] = await Promise.all([
      EntitlementModel.getUserEntitlements(req.params.userId),
      EntitlementModel.getAuditLog(req.params.userId, { limit: 50 }),
    ]);
    return res.json({ success: true, entitlements, auditLog: auditResult.rows });
  } catch (error) {
    logger.error('getUserEntitlements error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/webapp/admin/users/:userId/entitlements
 * Grant an entitlement to a user.
 */
const MAX_GRANT_DAYS = 3650;

const grantUserEntitlement = async (req, res) => {
  try {
    const { addOnId, durationDays, isLifetime, reason } = req.body;
    if (!addOnId) {
      return res.status(400).json({ success: false, error: 'addOnId is required' });
    }
    if (!isLifetime) {
      const parsedDays = durationDays ? parseInt(durationDays, 10) : 30;
      if (!parsedDays || parsedDays < 1 || parsedDays > MAX_GRANT_DAYS) {
        return res.status(400).json({ success: false, error: `durationDays must be between 1 and ${MAX_GRANT_DAYS}` });
      }
    }
    const row = await EntitlementModel.grantEntitlement(
      req.params.userId,
      String(addOnId),
      {
        isLifetime: !!isLifetime,
        durationDays: durationDays ? parseInt(durationDays, 10) : 30,
        source: 'admin',
        actorId: String(req.user?.id ?? 'admin'),
        reason: reason || '',
      }
    );
    logger.info('Admin granted entitlement', { adminId: req.user?.id, userId: req.params.userId, addOnId });
    return res.json({ success: true, entitlement: row });
  } catch (error) {
    logger.error('grantUserEntitlement error:', error);
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message });
  }
};

/**
 * DELETE /api/webapp/admin/users/:userId/entitlements/:addOnId
 * Revoke a user's entitlement. Lifetime revocation requires superadmin.
 */
const revokeUserEntitlement = async (req, res) => {
  try {
    const adminId = String(req.user?.id ?? '');
    const isSuperadmin = SUPERADMIN_IDS.includes(adminId) || req.user?.role === 'superadmin';

    const row = await EntitlementModel.revokeEntitlement(
      req.params.userId,
      req.params.addOnId,
      { isSuperadmin, revokedBy: adminId, reason: req.body?.reason || '' }
    );
    logger.info('Admin revoked entitlement', { adminId, userId: req.params.userId, addOnId: req.params.addOnId });
    return res.json({ success: true, revoked: row });
  } catch (error) {
    logger.error('revokeUserEntitlement error:', error);
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message });
  }
};

/**
 * PUT /api/webapp/admin/users/:userId/entitlements/:addOnId/extend
 * Extend an entitlement's expiry.
 */
const MAX_EXTEND_DAYS = 3650;

const extendUserEntitlement = async (req, res) => {
  try {
    const { extraDays, reason } = req.body;
    const days = parseInt(extraDays, 10);
    if (!days || days < 1 || days > MAX_EXTEND_DAYS) {
      return res.status(400).json({ success: false, error: `extraDays must be between 1 and ${MAX_EXTEND_DAYS}` });
    }
    const row = await EntitlementModel.extendEntitlement(
      req.params.userId,
      req.params.addOnId,
      days,
      { extendedBy: String(req.user?.id ?? 'admin'), reason: reason || '' }
    );
    logger.info('Admin extended entitlement', { adminId: req.user?.id, userId: req.params.userId, addOnId: req.params.addOnId, days });
    return res.json({ success: true, entitlement: row });
  } catch (error) {
    logger.error('extendUserEntitlement error:', error);
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message });
  }
};

/**
 * GET /api/webapp/my-entitlements
 * Return the logged-in user's active entitlements.
 */
const getMyEntitlements = async (req, res) => {
  try {
    const userId = String(req.user?.id ?? req.session?.user?.id ?? '');
    if (!userId) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const all = await EntitlementModel.getUserEntitlements(userId);
    // Filter to active only (lifetime OR non-consumed with valid expiry)
    const active = all.filter((e) =>
      !e.is_consumed &&
      (e.is_lifetime || e.expires_at == null || new Date(e.expires_at) > new Date())
    );
    return res.json({
      success: true,
      entitlements: active.map((e) => ({
        add_on_id: e.add_on_id,
        add_on_name: e.add_on_name,
        is_lifetime: e.is_lifetime,
        is_consumed: e.is_consumed,
        expires_at: e.expires_at,
      })),
    });
  } catch (error) {
    logger.error('getMyEntitlements error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// Creator / Live Performer Promotion
// ==========================================

const VALID_CREATOR_TYPES = ['performer', 'streamer', 'creator', 'dj', 'host'];

/**
 * POST /api/webapp/admin/users/:userId/make-creator
 * Cherry-pick promote a user to creator/model role and optionally assign a live channel.
 *
 * Body: { channelRef?: string, creatorType?: string, priceUsd?: number, grantMonetization?: boolean }
 */
const makeCreator = async (req, res) => {
  const admin = req.user;

  try {
    const { userId } = req.params;
    const {
      channelRef,
      creatorType,
      priceUsd,
      grantMonetization = true,
    } = req.body;

    // Validate optional inputs
    if (channelRef !== undefined && typeof channelRef !== 'string') {
      return res.status(400).json({ success: false, error: 'channelRef must be a string' });
    }
    if (channelRef && !/^[a-zA-Z0-9\-_]+$/.test(channelRef)) {
      return res.status(400).json({ success: false, error: 'channelRef contains invalid characters' });
    }
    if (creatorType !== undefined && !VALID_CREATOR_TYPES.includes(creatorType)) {
      return res.status(400).json({
        success: false,
        error: `creatorType must be one of: ${VALID_CREATOR_TYPES.join(', ')}`,
      });
    }
    if (priceUsd !== undefined) {
      const price = parseFloat(priceUsd);
      if (isNaN(price) || price < 0 || price > 9999.99) {
        return res.status(400).json({ success: false, error: 'priceUsd must be a number between 0 and 9999.99' });
      }
    }

    // Verify the target user exists
    const userCheck = await query('SELECT id, username FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // If a channelRef is being assigned, check it is not already taken by another user
    if (channelRef) {
      const channelCheck = await query(
        'SELECT id, username FROM users WHERE live_channel = $1 AND id != $2',
        [channelRef, userId]
      );
      if (channelCheck.rows.length > 0) {
        const taken = channelCheck.rows[0];
        return res.status(409).json({
          success: false,
          error: `Channel '${channelRef}' is already assigned to user @${taken.username || taken.id}`,
        });
      }
    }

    // Build the UPDATE statement dynamically so we only touch provided fields
    const setClauses = [
      'role = $2',
      'creator_status = $3',
      'creator_enabled_at = NOW()',
      'role_assigned_at = NOW()',
      'primary_role = $4',
      'updated_at = NOW()',
    ];
    const values = [userId, 'model', 'active', 'model'];
    let paramIdx = 5;

    if (creatorType !== undefined) {
      setClauses.push(`creator_type = $${paramIdx++}`);
      values.push(creatorType);
    }
    if (priceUsd !== undefined) {
      setClauses.push(`creator_price_usd = $${paramIdx++}`);
      values.push(parseFloat(priceUsd));
    }
    if (channelRef !== undefined) {
      setClauses.push(`live_channel = $${paramIdx++}`);
      values.push(channelRef);
    }

    const updateResult = await query(
      `UPDATE users
         SET ${setClauses.join(', ')}
       WHERE id = $1
       RETURNING id, username, role, creator_status, creator_type, creator_price_usd, live_channel`,
      values
    );

    const updatedUser = updateResult.rows[0];

    // Optionally grant the creator-subscription lifetime entitlement
    if (grantMonetization) {
      await EntitlementModel.grantEntitlement(
        String(userId),
        'creator-subscription',
        {
          isLifetime: true,
          durationDays: 0,
          source: 'admin',
          actorId: String(admin?.id ?? 'admin'),
          reason: 'creator promotion cherry-pick by admin',
        }
      );
    }

    // Audit log for the role promotion itself
    await EntitlementModel._auditLog({
      userId: String(userId),
      action: 'grant',
      actorId: String(admin?.id ?? 'admin'),
      actorType: 'admin',
      reason: 'cherry-pick creator promotion by admin',
      newValues: { role: 'model', creator_status: 'active', channelRef: channelRef || null },
    }).catch((auditErr) => {
      // Non-fatal — log but do not abort the request
      logger.warn('makeCreator: audit log write failed (non-fatal)', { error: auditErr.message });
    });

    // Invalidate Redis user cache
    await cache.del(`user:${userId}`);

    logger.info('Admin promoted user to creator', {
      adminId: admin?.id,
      userId,
      channelRef,
      creatorType,
      grantMonetization,
    });

    return res.json({ success: true, user: updatedUser });
  } catch (error) {
    logger.error('makeCreator error:', error);
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message });
  }
};

/**
 * DELETE /api/webapp/admin/users/:userId/make-creator
 * Revoke creator/model status from a user — reset to plain 'user' role.
 */
const revokeCreator = async (req, res) => {
  const admin = req.user;

  try {
    const { userId } = req.params;

    const userCheck = await query('SELECT id, username FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const updateResult = await query(
      `UPDATE users
         SET role = 'user',
             creator_status = 'none',
             creator_enabled_at = NULL,
             live_channel = NULL,
             creator_type = NULL,
             primary_role = NULL,
             role_assigned_at = NOW(),
             updated_at = NOW()
       WHERE id = $1
       RETURNING id, username, role, creator_status, creator_type, creator_price_usd, live_channel`,
      [userId]
    );

    const updatedUser = updateResult.rows[0];

    // Revoke the creator-subscription entitlement (if any)
    await query(
      `DELETE FROM user_entitlements WHERE user_id = $1 AND add_on_id = 'creator-subscription'`,
      [userId]
    ).catch((delErr) => {
      logger.warn('revokeCreator: failed to delete creator-subscription entitlement (non-fatal)', {
        error: delErr.message,
        userId,
      });
    });

    // Audit log
    await EntitlementModel._auditLog({
      userId: String(userId),
      action: 'revoke',
      actorId: String(admin?.id ?? 'admin'),
      actorType: 'admin',
      reason: 'creator status revoked by admin',
      oldValues: { role: 'model' },
      newValues: { role: 'user', creator_status: 'none' },
    }).catch((auditErr) => {
      logger.warn('revokeCreator: audit log write failed (non-fatal)', { error: auditErr.message });
    });

    // Invalidate Redis user cache
    await cache.del(`user:${userId}`);

    logger.info('Admin revoked creator status', { adminId: admin?.id, userId });

    return res.json({ success: true, user: updatedUser });
  } catch (error) {
    logger.error('revokeCreator error:', error);
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message });
  }
};

module.exports = {
  getStats,
  getDemographics,
  listUsers,
  getUser,
  updateUser,
  banUser,
  deleteUser,
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
  // Entitlement management
  listAddOns,
  getPlanAddOns,
  setPlanAddOns,
  getUserEntitlements,
  grantUserEntitlement,
  revokeUserEntitlement,
  extendUserEntitlement,
  getMyEntitlements,
  // Creator / Live Performer promotion
  makeCreator,
  revokeCreator,
};
