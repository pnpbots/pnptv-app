const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');
const DmService = require('../../bot/services/dmService');

// Check if a photo path is a valid web URL (not a Telegram file ID)
const isValidPhotoUrl = (p) => p && typeof p === 'string' && (p.startsWith('/') || p.startsWith('http'));

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
        u.first_name,
        u.photo_file_id
      FROM dm_threads dt
      JOIN users u ON (
        CASE
          WHEN dt.user_a = $1 THEN dt.user_b
          ELSE dt.user_a
        END = u.id
      )
      WHERE dt.user_a = $1 OR dt.user_b = $1
      ORDER BY dt.last_message_at DESC
      LIMIT 100`,
      [userId]
    );

    res.json({
      success: true,
      threads: result.rows.map(row => ({
        userId: row.other_user_id,
        username: row.username,
        firstName: row.first_name,
        photoUrl: isValidPhotoUrl(row.photo_file_id) ? row.photo_file_id : null,
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
        dm.media_url,
        dm.media_type,
        dm.media_mime,
        dm.media_thumb_url,
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

    // Mark thread as read
    await DmService.markAsRead(userId, otherUserId);

    res.json({
      success: true,
      messages: result.rows.reverse().map(row => ({
        id: row.id,
        senderId: row.sender_id,
        recipientId: row.recipient_id,
        content: row.content || null,
        mediaUrl: row.media_url || null,
        mediaType: row.media_type || null,
        mediaMime: row.media_mime || null,
        mediaThumbUrl: row.media_thumb_url || null,
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

    // Pre-validation: fail fast before touching DmService.
    // These checks exist at the service layer too, but enforcing them here
    // gives callers clean 400 responses instead of generic 500s when the
    // service throws and also caps payload size at the API boundary.
    if (!recipientId || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({
        success: false,
        error: 'recipientId and content are required'
      });
    }
    if (content.length > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Message too long (max 1000 characters)'
      });
    }
    if (String(recipientId) === String(userId)) {
      return res.status(400).json({
        success: false,
        error: 'Cannot message yourself'
      });
    }

    const senderRole = req.session?.user?.role || '';
    const isAdminSender = senderRole === 'admin' || senderRole === 'superadmin';

    try {
      const message = await DmService.sendMessage(userId, recipientId, { content }, { isAdmin: isAdminSender });

      const responseMessage = {
        id: message.id,
        senderId: message.sender_id,
        recipientId: message.recipient_id,
        content: message.content || null,
        mediaUrl: message.media_url || null,
        mediaType: message.media_type || null,
        mediaMime: message.media_mime || null,
        mediaThumbUrl: message.media_thumb_url || null,
        isRead: message.is_read,
        createdAt: message.created_at,
        isMine: true
      };

      // Emit real-time Socket.IO event to recipient
      const io = req.app.get('io');
      if (io) {
        io.to(`user:${recipientId}`).emit('dm:received', {
          ...responseMessage,
          isMine: false,
          sender: {
            id: userId,
            username: req.session?.user?.username,
            firstName: req.session?.user?.firstName || req.session?.user?.first_name,
            photoUrl: req.session?.user?.photoUrl || req.session?.user?.photo_url,
          }
        });
      }

      logger.info(`User ${userId} sent DM to ${recipientId}`);

      res.json({
        success: true,
        message: responseMessage,
        remaining: req.dmLimit?.remaining ?? null
      });
    } catch (dmError) {
      if (dmError.statusCode) {
        return res.status(dmError.statusCode).json({
          success: false,
          error: dmError.message,
          code: dmError.code
        });
      }
      throw dmError;
    }

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

    const success = await DmService.deleteMessage(userId, messageId);

    if (!success) {
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

    await DmService.markAsRead(userId, otherUserId);

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

module.exports = {
  getThreads,
  getMessages,
  sendMessage,
  deleteMessage,
  markThreadAsRead
};

