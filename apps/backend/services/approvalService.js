const { query } = require('../config/postgres');
const logger = require('../utils/logger');
const ACCESS_CONTROL_CONFIG = require('../config/accessControlConfig');

/**
 * Approval Service
 * Manages post approval queue for restricted topics
 */
class ApprovalService {
  /**
   * Add post to approval queue
   * @param {Object} params - Post parameters
   * @returns {Promise<string>} Approval ID
   */
  static async addToQueue({
    userId,
    messageId,
    topicId,
    chatId,
    messageText,
    hasMedia,
    mediaType,
  }) {
    try {
      const result = await query(
        `INSERT INTO approval_queue
         (user_id, message_id, topic_id, chat_id, message_text, has_media, media_type, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW())
         RETURNING id`,
        [
          userId.toString(),
          messageId,
          topicId,
          chatId.toString(),
          messageText || null,
          hasMedia || false,
          mediaType || null,
        ]
      );

      const approvalId = result.rows[0].id;
      logger.info('Post added to approval queue', { approvalId, userId, topicId });

      return approvalId.toString();
    } catch (error) {
      logger.error('Error adding to approval queue:', error);
      throw error;
    }
  }

  /**
   * Approve a post
   * @param {string} approvalId - Approval ID
   * @param {string} approvedBy - Admin user ID
   * @returns {Promise<Object>} Approved post data
   */
  static async approvePost(approvalId, approvedBy) {
    try {
      const result = await query(
        `UPDATE approval_queue
         SET status = 'approved', approved_by = $2, approved_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [approvalId, approvedBy.toString()]
      );

      if (result.rows.length === 0) {
        throw new Error('Approval not found');
      }

      const post = result.rows[0];
      logger.info('Post approved', { approvalId, approvedBy, userId: post.user_id });

      return this.convertRowToCamelCase(post);
    } catch (error) {
      logger.error('Error approving post:', error);
      throw error;
    }
  }

  /**
   * Reject a post
   * @param {string} approvalId - Approval ID
   * @param {string} rejectedBy - Admin user ID
   * @param {string} reason - Rejection reason
   * @returns {Promise<Object>} Rejected post data
   */
  static async rejectPost(approvalId, rejectedBy, reason) {
    try {
      const result = await query(
        `UPDATE approval_queue
         SET status = 'rejected', approved_by = $2, approved_at = NOW(), rejection_reason = $3
         WHERE id = $1
         RETURNING *`,
        [approvalId, rejectedBy.toString(), reason]
      );

      if (result.rows.length === 0) {
        throw new Error('Approval not found');
      }

      const post = result.rows[0];
      logger.info('Post rejected', { approvalId, rejectedBy, userId: post.user_id, reason });

      return this.convertRowToCamelCase(post);
    } catch (error) {
      logger.error('Error rejecting post:', error);
      throw error;
    }
  }

  /**
   * Get pending posts for a topic
   * @param {number} topicId - Topic ID
   * @returns {Promise<Array>} Pending posts
   */
  static async getPendingPosts(topicId) {
    try {
      const result = await query(
        `SELECT * FROM approval_queue
         WHERE topic_id = $1 AND status = 'pending'
         ORDER BY created_at ASC`,
        [topicId]
      );

      return result.rows.map(row => this.convertRowToCamelCase(row));
    } catch (error) {
      logger.error('Error getting pending posts:', error);
      return [];
    }
  }

  /**
   * Get all pending posts
   * @returns {Promise<Array>} Pending posts
   */
  static async getAllPending() {
    try {
      const result = await query(
        `SELECT * FROM approval_queue
         WHERE status = 'pending'
         ORDER BY created_at ASC`
      );

      return result.rows.map(row => this.convertRowToCamelCase(row));
    } catch (error) {
      logger.error('Error getting all pending posts:', error);
      return [];
    }
  }

  /**
   * Get post by approval ID
   * @param {string} approvalId - Approval ID
   * @returns {Promise<Object|null>} Post data
   */
  static async getById(approvalId) {
    try {
      const result = await query(
        'SELECT * FROM approval_queue WHERE id = $1',
        [approvalId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.convertRowToCamelCase(result.rows[0]);
    } catch (error) {
      logger.error('Error getting approval by ID:', error);
      return null;
    }
  }

  /**
   * Clean up old pending posts
   * @param {number} ageMs - Age in milliseconds
   * @returns {Promise<number>} Number of posts cleaned up
   */
  static async cleanupOld(ageMs = ACCESS_CONTROL_CONFIG.APPROVAL.pendingTimeout) {
    try {
      const cutoffDate = new Date(Date.now() - ageMs);

      const result = await query(
        `DELETE FROM approval_queue
         WHERE status = 'pending' AND created_at < $1`,
        [cutoffDate]
      );

      logger.info('Old pending posts cleaned up', { count: result.rowCount });
      return result.rowCount;
    } catch (error) {
      logger.error('Error cleaning up old posts:', error);
      return 0;
    }
  }

  /**
   * Get approval statistics
   * @returns {Promise<Object>} Stats
   */
  static async getStats() {
    try {
      const result = await query(
        `SELECT
           status,
           COUNT(*) as count
         FROM approval_queue
         GROUP BY status`
      );

      const stats = {
        pending: 0,
        approved: 0,
        rejected: 0,
      };

      result.rows.forEach(row => {
        stats[row.status] = parseInt(row.count);
      });

      return stats;
    } catch (error) {
      logger.error('Error getting approval stats:', error);
      return null;
    }
  }

  /**
   * Convert database row to camelCase
   */
  static convertRowToCamelCase(row) {
    if (!row) return row;

    return {
      id: row.id,
      userId: row.user_id,
      messageId: row.message_id,
      topicId: row.topic_id,
      chatId: row.chat_id,
      messageText: row.message_text,
      hasMedia: row.has_media,
      mediaType: row.media_type,
      status: row.status,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      rejectionReason: row.rejection_reason,
      createdAt: row.created_at,
    };
  }

  /**
   * Initialize database tables
   */
  static async initializeTables() {
    try {
      // Create approval_queue table
      await query(`
        CREATE TABLE IF NOT EXISTS approval_queue (
          id SERIAL PRIMARY KEY,
          user_id VARCHAR(255) NOT NULL,
          message_id BIGINT NOT NULL,
          topic_id INTEGER NOT NULL,
          chat_id VARCHAR(255) NOT NULL,
          message_text TEXT,
          has_media BOOLEAN DEFAULT false,
          media_type VARCHAR(50),
          status VARCHAR(20) DEFAULT 'pending',
          approved_by VARCHAR(255),
          approved_at TIMESTAMP,
          rejection_reason TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      // Create indexes
      await query('CREATE INDEX IF NOT EXISTS idx_approval_queue_user_id ON approval_queue(user_id)');
      await query('CREATE INDEX IF NOT EXISTS idx_approval_queue_topic_id ON approval_queue(topic_id)');
      await query('CREATE INDEX IF NOT EXISTS idx_approval_queue_status ON approval_queue(status)');
      await query('CREATE INDEX IF NOT EXISTS idx_approval_queue_created_at ON approval_queue(created_at)');

      logger.info('Approval service tables initialized');
    } catch (error) {
      logger.error('Error initializing approval tables:', error);
      throw error;
    }
  }
}

module.exports = ApprovalService;
