const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');

/**
 * Notifications Controller
 * Aggregates notifications from various sources
 */

/**
 * Get user notifications (aggregated from various tables)
 * GET /api/webapp/notifications?limit=50&offset=0
 */
async function getNotifications(req, res) {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    const notifications = [];

    // 1. New social post likes
    const likes = await query(
      `SELECT
        spl.id,
        spl.created_at,
        spl.user_id AS actor_id,
        u.username AS actor_username,
        u.first_name AS actor_first_name,
        u.photo_file_id AS actor_photo_url,
        sp.id AS post_id,
        'like' AS type
      FROM social_post_likes spl
      JOIN social_posts sp ON spl.post_id = sp.id
      JOIN users u ON spl.user_id = u.id
      WHERE sp.user_id = $1
        AND spl.user_id != $1
      ORDER BY spl.created_at DESC
      LIMIT 20`,
      [userId]
    );

    likes.rows.forEach(row => {
      notifications.push({
        id: `like_${row.id}`,
        type: 'like',
        actorId: row.actor_id,
        actorUsername: row.actor_username,
        actorFirstName: row.actor_first_name,
        actorPhotoUrl: row.actor_photo_url,
        postId: row.post_id,
        createdAt: row.created_at,
        message: `${row.actor_first_name} liked your post`
      });
    });

    // 2. New direct messages (unread)
    const messages = await query(
      `SELECT
        dm.id,
        dm.created_at,
        dm.sender_id AS actor_id,
        u.username AS actor_username,
        u.first_name AS actor_first_name,
        u.photo_file_id AS actor_photo_url,
        dm.content,
        'message' AS type
      FROM direct_messages dm
      JOIN users u ON dm.sender_id = u.id
      WHERE dm.recipient_id = $1
        AND dm.is_read = false
        AND dm.is_deleted = false
      ORDER BY dm.created_at DESC
      LIMIT 20`,
      [userId]
    );

    messages.rows.forEach(row => {
      notifications.push({
        id: `message_${row.id}`,
        type: 'message',
        actorId: row.actor_id,
        actorUsername: row.actor_username,
        actorFirstName: row.actor_first_name,
        actorPhotoUrl: row.actor_photo_url,
        content: row.content.substring(0, 100),
        createdAt: row.created_at,
        message: `${row.actor_first_name} sent you a message`
      });
    });

    // 3. New hangout group messages
    const groupMessages = await query(
      `SELECT
        cm.id,
        cm.created_at,
        cm.user_id AS actor_id,
        u.username AS actor_username,
        u.first_name AS actor_first_name,
        u.photo_file_id AS actor_photo_url,
        cm.group_id,
        hg.name AS group_name,
        cm.message AS content,
        'group_message' AS type
      FROM chat_messages cm
      JOIN users u ON cm.user_id = u.id
      JOIN hangout_groups hg ON cm.group_id = hg.id
      JOIN hangout_group_members hgm ON hg.id = hgm.group_id
      WHERE hgm.user_id = $1
        AND cm.user_id != $1
        AND cm.created_at > NOW() - INTERVAL '7 days'
      ORDER BY cm.created_at DESC
      LIMIT 20`,
      [userId]
    );

    groupMessages.rows.forEach(row => {
      notifications.push({
        id: `group_message_${row.id}`,
        type: 'group_message',
        actorId: row.actor_id,
        actorUsername: row.actor_username,
        actorFirstName: row.actor_first_name,
        actorPhotoUrl: row.actor_photo_url,
        groupId: row.group_id,
        groupName: row.group_name,
        content: row.content.substring(0, 100),
        createdAt: row.created_at,
        message: `${row.actor_first_name} messaged in ${row.group_name}`
      });
    });

    // Sort all notifications by created_at DESC
    notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Apply pagination
    const paginatedNotifications = notifications.slice(offset, offset + limit);

    // Get unread counts
    const unreadCounts = await getUnreadCounts(userId);

    res.json({
      success: true,
      notifications: paginatedNotifications,
      count: paginatedNotifications.length,
      totalCount: notifications.length,
      unreadCounts,
      hasMore: offset + limit < notifications.length
    });

  } catch (error) {
    logger.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get notifications'
    });
  }
}

/**
 * Get unread counts for various notification types
 * GET /api/webapp/notifications/counts
 */
async function getUnreadCounts(userId) {
  try {
    // DM unread count
    const dmResult = await query(
      `SELECT COALESCE(SUM(
        CASE
          WHEN user_a = $1 THEN unread_for_a
          ELSE unread_for_b
        END
      ), 0) AS count
      FROM dm_threads
      WHERE user_a = $1 OR user_b = $1`,
      [userId]
    );

    // Social post likes (last 7 days, not viewed)
    const likesResult = await query(
      `SELECT COUNT(*) AS count
      FROM social_post_likes spl
      JOIN social_posts sp ON spl.post_id = sp.id
      WHERE sp.user_id = $1
        AND spl.user_id != $1
        AND spl.created_at > NOW() - INTERVAL '7 days'`,
      [userId]
    );

    return {
      messages: parseInt(dmResult.rows[0]?.count || 0),
      likes: parseInt(likesResult.rows[0]?.count || 0),
      total: parseInt(dmResult.rows[0]?.count || 0) + parseInt(likesResult.rows[0]?.count || 0)
    };

  } catch (error) {
    logger.error('Get unread counts error:', error);
    return {
      messages: 0,
      likes: 0,
      total: 0
    };
  }
}

/**
 * Get just the unread counts
 * GET /api/webapp/notifications/counts
 */
async function getNotificationCounts(req, res) {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    const counts = await getUnreadCounts(userId);

    res.json({
      success: true,
      counts
    });

  } catch (error) {
    logger.error('Get notification counts error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get notification counts'
    });
  }
}

/**
 * Mark notifications as read (clears unread counts)
 * PUT /api/webapp/notifications/mark-read
 * Body: { type?: 'messages' | 'likes' | 'all' }
 */
async function markAsRead(req, res) {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    const { type = 'all' } = req.body;

    // Mark DMs as read
    if (type === 'messages' || type === 'all') {
      await query(
        `UPDATE direct_messages
        SET is_read = true
        WHERE recipient_id = $1 AND is_read = false`,
        [userId]
      );

      // Reset unread counts in all threads
      await query(
        `UPDATE dm_threads
        SET unread_for_a = 0
        WHERE user_a = $1`,
        [userId]
      );

      await query(
        `UPDATE dm_threads
        SET unread_for_b = 0
        WHERE user_b = $1`,
        [userId]
      );
    }

    // Note: For likes, we don't have a read/unread field currently
    // This would require adding a notifications_viewed table to track viewed likes

    res.json({
      success: true,
      message: 'Notifications marked as read'
    });

  } catch (error) {
    logger.error('Mark notifications as read error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark notifications as read'
    });
  }
}

module.exports = {
  getNotifications,
  getNotificationCounts,
  markAsRead
};
