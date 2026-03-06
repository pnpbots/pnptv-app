const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');

/**
 * Notifications Controller — reads from the unified `notifications` table.
 */

/**
 * GET /api/webapp/notifications?limit=50&offset=0&category=social
 */
async function getNotifications(req, res) {
  try {
    const userId = req.session?.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    const category = req.query.category || null;

    const params = [userId, limit, offset];
    let categoryFilter = '';
    if (category) {
      categoryFilter = 'AND n.category = $4';
      params.push(category);
    }

    const { rows } = await query(
      `SELECT n.id, n.type, n.category, n.priority,
              n.actor_id, n.target_user_id, n.entity_type, n.entity_id,
              n.message, n.metadata, n.is_read, n.created_at,
              u.username AS actor_username,
              u.first_name AS actor_first_name,
              u.photo_file_id AS actor_photo_url
       FROM notifications n
       LEFT JOIN users u ON n.actor_id = u.id
       WHERE n.target_user_id = $1 ${categoryFilter}
       ORDER BY n.created_at DESC
       LIMIT $2 OFFSET $3`,
      params
    );

    const countParams = [userId];
    let countCategoryFilter = '';
    if (category) {
      countCategoryFilter = 'AND category = $2';
      countParams.push(category);
    }

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total FROM notifications WHERE target_user_id = $1 ${countCategoryFilter}`,
      countParams
    );

    const totalCount = countRows[0]?.total || 0;
    const unreadCounts = await getUnreadCounts(userId);

    res.json({
      success: true,
      notifications: rows.map(formatNotification),
      count: rows.length,
      totalCount,
      unreadCounts,
      hasMore: offset + limit < totalCount,
    });
  } catch (error) {
    logger.error('Get notifications error:', error);
    res.status(500).json({ success: false, error: 'Failed to get notifications' });
  }
}

/**
 * Internal: get unread counts grouped by category.
 */
async function getUnreadCounts(userId) {
  try {
    const { rows } = await query(
      `SELECT category, COUNT(*)::int AS count
       FROM notifications
       WHERE target_user_id = $1 AND is_read = FALSE
       GROUP BY category`,
      [userId]
    );

    const counts = { social: 0, messaging: 0, hangouts: 0, commerce: 0, system: 0, total: 0 };
    for (const row of rows) {
      counts[row.category] = row.count;
      counts.total += row.count;
    }
    return counts;
  } catch (error) {
    logger.error('Get unread counts error:', error);
    return { social: 0, messaging: 0, hangouts: 0, commerce: 0, system: 0, total: 0 };
  }
}

/**
 * GET /api/webapp/notifications/counts
 */
async function getNotificationCounts(req, res) {
  try {
    const userId = req.session?.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const counts = await getUnreadCounts(userId);
    res.json({ success: true, counts });
  } catch (error) {
    logger.error('Get notification counts error:', error);
    res.status(500).json({ success: false, error: 'Failed to get notification counts' });
  }
}

/**
 * PUT /api/webapp/notifications/mark-read
 * Body: { notificationIds?: number[], category?: string, all?: boolean }
 */
async function markAsRead(req, res) {
  try {
    const userId = req.session?.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const { notificationIds, category, type } = req.body;

    if (Array.isArray(notificationIds) && notificationIds.length > 0) {
      await query(
        `UPDATE notifications SET is_read = TRUE
         WHERE target_user_id = $1 AND id = ANY($2::bigint[])`,
        [userId, notificationIds]
      );
    } else if (category) {
      await query(
        `UPDATE notifications SET is_read = TRUE
         WHERE target_user_id = $1 AND category = $2 AND is_read = FALSE`,
        [userId, category]
      );
    } else {
      // Mark all as read (default, or type='all')
      await query(
        `UPDATE notifications SET is_read = TRUE
         WHERE target_user_id = $1 AND is_read = FALSE`,
        [userId]
      );
    }

    res.json({ success: true, message: 'Notifications marked as read' });
  } catch (error) {
    logger.error('Mark notifications as read error:', error);
    res.status(500).json({ success: false, error: 'Failed to mark notifications as read' });
  }
}

function formatNotification(row) {
  const meta = row.metadata || {};
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    priority: row.priority,
    actorId: row.actor_id,
    actorUsername: row.actor_username,
    actorFirstName: row.actor_first_name,
    actorPhotoUrl: row.actor_photo_url,
    entityType: row.entity_type,
    entityId: row.entity_id,
    message: row.message,
    metadata: row.metadata,
    postId: meta.postId ?? meta.post_id ?? null,
    groupId: meta.groupId ?? meta.group_id ?? null,
    groupName: meta.groupName ?? meta.group_name ?? null,
    content: meta.content ?? null,
    isRead: row.is_read,
    createdAt: row.created_at,
  };
}

module.exports = {
  getNotifications,
  getNotificationCounts,
  markAsRead,
};
