const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');

/**
 * Direct Messages Controller
 * Handles private messaging between users
 */

/**
 * Get user's DM threads (conversations)
 * GET /api/webapp/messages/threads
 */
async function getThreads(req, res) {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    // Get all threads where user is either user_a or user_b
    const result = await query(
      `SELECT
        CASE
          WHEN dt.user_a = $1 THEN dt.user_b
          ELSE dt.user_a
        END AS other_user_id,
        dt.last_message,
        dt.last_message_at,
        CASE
          WHEN dt.user_a = $1 THEN dt.unread_for_a
          ELSE dt.unread_for_b
        END AS unread_count,
        u.username,
        u."firstName",
        u."photoUrl"
      FROM dm_threads dt
      JOIN users u ON (
        CASE
          WHEN dt.user_a = $1 THEN dt.user_b
          ELSE dt.user_a
        END = u.id
      )
      WHERE dt.user_a = $1 OR dt.user_b = $1
      ORDER BY dt.last_message_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      threads: result.rows.map(row => ({
        userId: row.other_user_id,
        username: row.username,
        firstName: row.firstName,
        photoUrl: row.photoUrl,
        lastMessage: row.last_message,
        lastMessageAt: row.last_message_at,
        unreadCount: row.unread_count
      })),
      count: result.rows.length
    });

  } catch (error) {
    logger.error('Get DM threads error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get message threads'
    });
  }
}

/**
 * Get messages in a thread
 * GET /api/webapp/messages/thread/:otherUserId?limit=50&before=messageId
 */
async function getMessages(req, res) {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    const { otherUserId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before ? parseInt(req.query.before) : null;

    if (!otherUserId) {
      return res.status(400).json({
        success: false,
        error: 'otherUserId is required'
      });
    }

    // Build query with optional pagination
    let sql = `
      SELECT
        dm.id,
        dm.sender_id,
        dm.recipient_id,
        dm.content,
        dm.is_read,
        dm.is_deleted,
        dm.created_at
      FROM direct_messages dm
      WHERE ((dm.sender_id = $1 AND dm.recipient_id = $2)
          OR (dm.sender_id = $2 AND dm.recipient_id = $1))
        AND dm.is_deleted = false
    `;

    const params = [userId, otherUserId];

    if (before) {
      sql += ` AND dm.id < $${params.length + 1}`;
      params.push(before);
    }

    sql += ` ORDER BY dm.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await query(sql, params);

    // Mark messages as read (from other user to current user)
    await query(
      `UPDATE direct_messages
      SET is_read = true
      WHERE recipient_id = $1 AND sender_id = $2 AND is_read = false`,
      [userId, otherUserId]
    );

    // Update unread count in thread
    await updateThreadUnreadCount(userId, otherUserId);

    res.json({
      success: true,
      messages: result.rows.reverse().map(row => ({
        id: row.id,
        senderId: row.sender_id,
        recipientId: row.recipient_id,
        content: row.content,
        isRead: row.is_read,
        createdAt: row.created_at,
        isMine: row.sender_id === userId
      })),
      count: result.rows.length,
      hasMore: result.rows.length === limit
    });

  } catch (error) {
    logger.error('Get messages error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get messages'
    });
  }
}

/**
 * Send a message
 * POST /api/webapp/messages/send
 * Body: { recipientId, content }
 */
async function sendMessage(req, res) {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    const { recipientId, content } = req.body;

    if (!recipientId || !content) {
      return res.status(400).json({
        success: false,
        error: 'recipientId and content are required'
      });
    }

    // Validate content length
    if (content.length > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Message too long (max 1000 characters)'
      });
    }

    // Check if recipient exists
    const recipientCheck = await query(
      'SELECT id FROM users WHERE id = $1',
      [recipientId]
    );

    if (recipientCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Recipient not found'
      });
    }

    // Check if sender is blocked by recipient
    const blockCheck = await query(
      'SELECT id FROM blocked_users WHERE user_id = $1 AND blocked_user_id = $2',
      [recipientId, userId]
    );

    if (blockCheck.rows.length > 0) {
      return res.status(403).json({
        success: false,
        error: 'Cannot send message to this user'
      });
    }

    // Insert message
    const messageResult = await query(
      `INSERT INTO direct_messages (sender_id, recipient_id, content)
      VALUES ($1, $2, $3)
      RETURNING id, sender_id, recipient_id, content, is_read, created_at`,
      [userId, recipientId, content]
    );

    const message = messageResult.rows[0];

    // Upsert thread
    await upsertThread(userId, recipientId, content);

    const responseMessage = {
      id: message.id,
      senderId: message.sender_id,
      recipientId: message.recipient_id,
      content: message.content,
      isRead: message.is_read,
      createdAt: message.created_at,
      isMine: true
    };

    // Emit real-time Socket.IO event to recipient
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${recipientId}`).emit('dm:received', {
        ...message,
        sender: { id: userId }
      });
    }

    logger.info(`User ${userId} sent DM to ${recipientId}`);

    res.json({
      success: true,
      message: responseMessage
    });

  } catch (error) {
    logger.error('Send message error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send message'
    });
  }
}

/**
 * Delete a message
 * DELETE /api/webapp/messages/:messageId
 */
async function deleteMessage(req, res) {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    const { messageId } = req.params;

    // Only allow sender to delete their own messages
    const result = await query(
      `UPDATE direct_messages
      SET is_deleted = true
      WHERE id = $1 AND sender_id = $2
      RETURNING id`,
      [messageId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Message not found or not authorized'
      });
    }

    res.json({
      success: true,
      message: 'Message deleted'
    });

  } catch (error) {
    logger.error('Delete message error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete message'
    });
  }
}

/**
 * Mark thread as read
 * PUT /api/webapp/messages/thread/:otherUserId/read
 */
async function markThreadAsRead(req, res) {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    const { otherUserId } = req.params;

    // Mark all messages from other user as read
    await query(
      `UPDATE direct_messages
      SET is_read = true
      WHERE recipient_id = $1 AND sender_id = $2 AND is_read = false`,
      [userId, otherUserId]
    );

    // Update thread unread count
    await updateThreadUnreadCount(userId, otherUserId);

    res.json({
      success: true,
      message: 'Thread marked as read'
    });

  } catch (error) {
    logger.error('Mark thread as read error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark thread as read'
    });
  }
}

// Helper functions

/**
 * Upsert DM thread (create or update)
 */
async function upsertThread(userId, otherUserId, lastMessage) {
  // Ensure user_a < user_b (alphabetically)
  const [userA, userB] = userId < otherUserId ? [userId, otherUserId] : [otherUserId, userId];
  const incrementForA = userId === userA ? 'unread_for_b = unread_for_b + 1' : 'unread_for_a = unread_for_a + 1';

  const truncatedMessage = lastMessage.substring(0, 100);

  await query(
    `INSERT INTO dm_threads (user_a, user_b, last_message, last_message_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (user_a, user_b)
    DO UPDATE SET
      last_message = EXCLUDED.last_message,
      last_message_at = NOW(),
      ${incrementForA}`,
    [userA, userB, truncatedMessage]
  );
}

/**
 * Update unread count in thread
 */
async function updateThreadUnreadCount(userId, otherUserId) {
  const [userA, userB] = userId < otherUserId ? [userId, otherUserId] : [otherUserId, userId];
  const resetColumn = userId === userA ? 'unread_for_a = 0' : 'unread_for_b = 0';

  await query(
    `UPDATE dm_threads
    SET ${resetColumn}
    WHERE user_a = $1 AND user_b = $2`,
    [userA, userB]
  );
}

module.exports = {
  getThreads,
  getMessages,
  sendMessage,
  deleteMessage,
  markThreadAsRead
};
