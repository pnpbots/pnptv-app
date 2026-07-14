const express = require('express');
const authGuard = require('../middleware/authGuard');
const roleGuard = require('../middleware/roleGuard');
const { query } = require('../../../config/postgres');
const { sendNotificationViaTelegram } = require('../../../services/notificationBotDelivery');
const PermissionService = require('../../../services/permissionService');
const CreatorService = require('../../../services/creatorService');
const logger = require('../../../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(authGuard);

// Post count thresholds by tier
const REQUIRED_POSTS = { PRIME: 10, member: 20, free: 50 };

/**
 * GET /api/casting/status
 * Returns user's casting eligibility and existing application status
 */
router.get('/status', async (req, res) => {
  try {
    const userId = String(req.session.user.id);

    // Get user's tier, photo, and post count in parallel
    const [userResult, postResult, appResult] = await Promise.all([
      query('SELECT tier, photo_file_id FROM users WHERE id = $1', [userId]),
      query('SELECT COUNT(*)::int AS count FROM social_posts WHERE user_id = $1 AND is_deleted = false', [userId]),
      query('SELECT id, status, created_at FROM casting_applications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId]),
    ]);

    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const tier = user.tier || 'free';
    const hasPhoto = !!user.photo_file_id;
    const postCount = postResult.rows[0]?.count || 0;
    const requiredPosts = REQUIRED_POSTS[tier] || REQUIRED_POSTS.free;
    const eligible = hasPhoto && postCount >= requiredPosts;

    const existingApp = appResult.rows[0] || null;

    return res.json({
      success: true,
      eligible,
      hasPhoto,
      postCount,
      requiredPosts,
      tier,
      application: existingApp ? { id: existingApp.id, status: existingApp.status, createdAt: existingApp.created_at } : null,
    });
  } catch (err) {
    logger.error('Casting status error:', err);
    return res.status(500).json({ success: false, error: 'Failed to check casting status' });
  }
});

/**
 * POST /api/casting/apply
 * Submit a casting application
 */
router.post('/apply', async (req, res) => {
  try {
    const userId = String(req.session.user.id);

    // Check eligibility server-side
    const [userResult, postResult, existingResult] = await Promise.all([
      query('SELECT tier, photo_file_id, username, first_name FROM users WHERE id = $1', [userId]),
      query('SELECT COUNT(*)::int AS count FROM social_posts WHERE user_id = $1 AND is_deleted = false', [userId]),
      query("SELECT id, status FROM casting_applications WHERE user_id = $1 AND status = 'pending' LIMIT 1", [userId]),
    ]);

    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    // Already has pending application
    if (existingResult.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'You already have a pending application' });
    }

    const tier = user.tier || 'free';
    const hasPhoto = !!user.photo_file_id;
    const postCount = postResult.rows[0]?.count || 0;
    const requiredPosts = REQUIRED_POSTS[tier] || REQUIRED_POSTS.free;

    if (!hasPhoto) {
      return res.status(400).json({ success: false, error: 'Profile picture required' });
    }
    if (postCount < requiredPosts) {
      return res.status(400).json({ success: false, error: `You need at least ${requiredPosts} posts (you have ${postCount})` });
    }

    // Create application
    const { rows } = await query(
      'INSERT INTO casting_applications (user_id) VALUES ($1) RETURNING id, status, created_at',
      [userId]
    );

    const app = rows[0];
    const displayName = user.username || user.first_name || userId;

    // Notify all admins via Telegram
    try {
      const admins = await PermissionService.getAllAdmins();
      for (const admin of admins) {
        await sendNotificationViaTelegram(admin.id, {
          type: 'system',
          message: `New casting application from @${displayName} (${tier}, ${postCount} posts). Review in admin panel.`,
          entityType: 'casting',
          entityId: app.id,
        });
      }
    } catch (notifErr) {
      logger.warn('Failed to notify admins about casting application:', notifErr.message);
    }

    logger.info(`Casting application submitted by ${displayName} (${userId}), tier=${tier}, posts=${postCount}`);

    return res.json({
      success: true,
      application: { id: app.id, status: app.status, createdAt: app.created_at },
    });
  } catch (err) {
    logger.error('Casting apply error:', err);
    return res.status(500).json({ success: false, error: 'Failed to submit application' });
  }
});

/**
 * GET /api/casting/admin/list
 * Admin: list all casting applications with user details
 */
router.get('/admin/list', roleGuard('admin', 'superadmin'), async (req, res) => {
  try {
    const statusFilter = req.query.status;
    let sql = `
      SELECT ca.id, ca.user_id, ca.status, ca.admin_notes, ca.reviewed_by, ca.reviewed_at, ca.created_at,
             u.username, u.first_name, u.photo_file_id, u.tier,
             (SELECT COUNT(*)::int FROM social_posts WHERE user_id = ca.user_id AND is_deleted = false) AS post_count
      FROM casting_applications ca
      JOIN users u ON u.id = ca.user_id
    `;
    const params = [];
    if (statusFilter && ['pending', 'approved', 'rejected'].includes(statusFilter)) {
      params.push(statusFilter);
      sql += ` WHERE ca.status = $${params.length}`;
    }
    sql += ' ORDER BY ca.created_at DESC';

    const { rows } = await query(sql, params);

    // Status counts
    const countResult = await query(`
      SELECT status, COUNT(*)::int AS count
      FROM casting_applications
      GROUP BY status
    `);
    const statusCounts = {};
    for (const row of countResult.rows) {
      statusCounts[row.status] = row.count;
    }

    return res.json({ success: true, applications: rows, statusCounts });
  } catch (err) {
    logger.error('Casting admin list error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load casting applications' });
  }
});

/**
 * POST /api/casting/review
 * Admin approve/reject a casting application
 */
router.post('/review', roleGuard('admin', 'superadmin'), async (req, res) => {
  try {
    const { applicationId, decision, notes } = req.body;
    const reviewerId = String(req.session.user.id);

    if (!applicationId || !['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, error: 'applicationId and decision (approved/rejected) required' });
    }

    const { rows, rowCount } = await query(
      `UPDATE casting_applications
       SET status = $2, admin_notes = $3, reviewed_by = $4, reviewed_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING id, user_id, status`,
      [applicationId, decision, notes || null, reviewerId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Application not found or already reviewed' });
    }

    const app = rows[0];

    // On approval: promote user to creator + create performer record
    if (decision === 'approved') {
      // Get user details for performer record
      const { rows: userRows } = await query(
        'SELECT id, pnptv_id, username, first_name, photo_file_id, bio FROM users WHERE id = $1',
        [app.user_id]
      );
      const user = userRows[0];
      if (user) {
        const displayName = user.first_name || user.username || `Performer-${user.id}`;

        // Update user role and creator fields
        await query(
          `UPDATE users SET role = 'creator', creator_status = 'active', creator_type = 'live', creator_verified = true WHERE id = $1`,
          [app.user_id]
        );

        // Create performer record (skip if already exists)
        await query(
          `INSERT INTO performers (user_id, display_name, bio, photo_url, base_price, status, is_available)
           VALUES ($1, $2, $3, $4, 0, 'active', true)
           ON CONFLICT (user_id) DO NOTHING`,
          [app.user_id, displayName, user.bio || null, user.photo_file_id || null]
        );

        // Create streamer_settings (skip if already exists)
        if (user.pnptv_id) {
          await query(
            `INSERT INTO streamer_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
            [user.pnptv_id]
          );
        }

        // Grant lifetime pnp-member so the creator immediately has full platform access
        await CreatorService._grantCreatorMembership(app.user_id);

        logger.info(`User ${app.user_id} promoted to creator/performer via casting approval`);
      }
    }

    // Notify the applicant
    const statusMsg = decision === 'approved'
      ? 'Your PNP Live casting application has been approved! Welcome to the team. You can now go live from the Live page.'
      : 'Your PNP Live casting application was not approved at this time. Keep posting and try again later!';

    await sendNotificationViaTelegram(app.user_id, {
      type: 'system',
      message: statusMsg,
    });

    logger.info(`Casting application ${applicationId} ${decision} by admin ${reviewerId}`);

    return res.json({ success: true, application: { id: app.id, status: app.status } });
  } catch (err) {
    logger.error('Casting review error:', err);
    return res.status(500).json({ success: false, error: 'Failed to review application' });
  }
});

module.exports = router;
