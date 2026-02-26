const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/postgres');
const { cache } = require('../config/redis');
const logger = require('../utils/logger');

const TABLE_CONTENT = 'paid_content';
const TABLE_PURCHASES = 'content_purchases';

class PaidContentModel {
  /**
   * Format content row
   */
  static _formatContent(row) {
    if (!row) return null;
    return {
      id: row.id,
      creatorId: row.creator_id,
      title: row.title,
      description: row.description,
      contentType: row.content_type,
      contentUrl: row.content_url,
      thumbnailUrl: row.thumbnail_url,
      priceUsd: parseFloat(row.price_usd),
      priceCop: parseFloat(row.price_cop),
      isExclusive: row.is_exclusive,
      viewCount: row.view_count || 0,
      purchaseCount: row.purchase_count || 0,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Format purchase row
   */
  static _formatPurchase(row) {
    if (!row) return null;
    return {
      id: row.id,
      contentId: row.content_id,
      userId: row.user_id,
      creatorId: row.creator_id,
      amountUsd: parseFloat(row.amount_usd),
      amountCop: parseFloat(row.amount_cop),
      paymentId: row.payment_id,
      status: row.status,
      purchasedAt: row.purchased_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Create paid content
   */
  static async createContent(contentData) {
    try {
      const id = uuidv4();
      const timestamp = new Date();

      const result = await query(
        `INSERT INTO ${TABLE_CONTENT} (id, creator_id, title, description, content_type, content_url, thumbnail_url, price_usd, price_cop, is_exclusive, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          id,
          contentData.creatorId,
          contentData.title,
          contentData.description || null,
          contentData.contentType,
          contentData.contentUrl,
          contentData.thumbnailUrl || null,
          contentData.priceUsd || 0,
          contentData.priceCop || 0,
          contentData.isExclusive || false,
          contentData.isActive !== false,
          timestamp,
          timestamp,
        ]
      );

      await cache.del(`creator:content:${contentData.creatorId}`);
      logger.info('Paid content created', {
        id,
        creatorId: contentData.creatorId,
        title: contentData.title,
      });

      return this._formatContent(result.rows[0]);
    } catch (error) {
      logger.error('Error creating paid content:', error);
      throw error;
    }
  }

  /**
   * Get content by ID
   */
  static async getContentById(contentId) {
    try {
      const cacheKey = `content:${contentId}`;
      const cached = await cache.get(cacheKey);
      if (cached) return JSON.parse(cached);

      const result = await query(
        `SELECT * FROM ${TABLE_CONTENT} WHERE id = $1`,
        [contentId]
      );

      const content = this._formatContent(result.rows[0]);
      if (content) {
        await cache.setex(cacheKey, 600, JSON.stringify(content));
      }
      return content;
    } catch (error) {
      logger.error('Error getting content by id:', error);
      throw error;
    }
  }

  /**
   * Get all content by creator
   */
  static async getContentByCreator(creatorId, isActive = true) {
    try {
      const cacheKey = `creator:content:${creatorId}`;
      const cached = await cache.get(cacheKey);
      if (cached) return JSON.parse(cached);

      const result = await query(
        `SELECT * FROM ${TABLE_CONTENT}
         WHERE creator_id = $1 ${isActive ? 'AND is_active = TRUE' : ''}
         ORDER BY created_at DESC`,
        [creatorId]
      );

      const contents = result.rows.map(row => this._formatContent(row));
      if (contents.length > 0) {
        await cache.setex(cacheKey, 600, JSON.stringify(contents));
      }
      return contents;
    } catch (error) {
      logger.error('Error getting content by creator:', error);
      throw error;
    }
  }

  /**
   * Create content purchase
   */
  static async createPurchase(purchaseData) {
    try {
      const id = uuidv4();
      const timestamp = new Date();

      // Start transaction
      await query('BEGIN');

      try {
        // Create purchase record
        const result = await query(
          `INSERT INTO ${TABLE_PURCHASES} (id, content_id, user_id, creator_id, amount_usd, amount_cop, payment_id, status, purchased_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [
            id,
            purchaseData.contentId,
            purchaseData.userId,
            purchaseData.creatorId,
            purchaseData.amountUsd || 0,
            purchaseData.amountCop || 0,
            purchaseData.paymentId || null,
            purchaseData.status || 'pending',
            purchaseData.status === 'completed' ? timestamp : null,
            timestamp,
            timestamp,
          ]
        );

        // Increment purchase count
        await query(
          `UPDATE ${TABLE_CONTENT}
           SET purchase_count = purchase_count + 1, updated_at = NOW()
           WHERE id = $1`,
          [purchaseData.contentId]
        );

        await query('COMMIT');

        logger.info('Content purchase created', {
          id,
          contentId: purchaseData.contentId,
          userId: purchaseData.userId,
        });

        return this._formatPurchase(result.rows[0]);
      } catch (error) {
        await query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      logger.error('Error creating content purchase:', error);
      throw error;
    }
  }

  /**
   * Get purchase by ID
   */
  static async getPurchaseById(purchaseId) {
    try {
      const result = await query(
        `SELECT * FROM ${TABLE_PURCHASES} WHERE id = $1`,
        [purchaseId]
      );

      return this._formatPurchase(result.rows[0]);
    } catch (error) {
      logger.error('Error getting purchase by id:', error);
      throw error;
    }
  }

  /**
   * Check if user has access to content
   */
  static async hasAccessToContent(userId, contentId) {
    try {
      const result = await query(
        `SELECT id FROM ${TABLE_PURCHASES}
         WHERE user_id = $1 AND content_id = $2 AND status = 'completed'
         LIMIT 1`,
        [userId, contentId]
      );

      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error checking content access:', error);
      throw error;
    }
  }

  /**
   * Get user's purchased content
   */
  static async getPurchasedContent(userId) {
    try {
      const result = await query(
        `SELECT DISTINCT pc.*, c.title, c.content_type, c.thumbnail_url
         FROM ${TABLE_PURCHASES} pc
         JOIN ${TABLE_CONTENT} c ON pc.content_id = c.id
         WHERE pc.user_id = $1 AND pc.status = 'completed'
         ORDER BY pc.purchased_at DESC`,
        [userId]
      );

      return result.rows.map(row => this._formatPurchase(row));
    } catch (error) {
      logger.error('Error getting purchased content:', error);
      throw error;
    }
  }

  /**
   * Get creator's purchase statistics
   */
  static async getCreatorStats(creatorId) {
    try {
      const result = await query(
        `SELECT
           COUNT(DISTINCT cp.id) as total_purchases,
           COUNT(DISTINCT cp.user_id) as unique_buyers,
           SUM(cp.amount_usd) as total_revenue_usd,
           SUM(cp.amount_cop) as total_revenue_cop,
           COUNT(c.id) as total_content_items
         FROM ${TABLE_PURCHASES} cp
         RIGHT JOIN ${TABLE_CONTENT} c ON cp.content_id = c.id AND cp.status = 'completed'
         WHERE c.creator_id = $1`,
        [creatorId]
      );

      const row = result.rows[0];
      return {
        totalPurchases: parseInt(row.total_purchases) || 0,
        uniqueBuyers: parseInt(row.unique_buyers) || 0,
        totalRevenueUsd: parseFloat(row.total_revenue_usd) || 0,
        totalRevenueCop: parseFloat(row.total_revenue_cop) || 0,
        totalContentItems: parseInt(row.total_content_items) || 0,
      };
    } catch (error) {
      logger.error('Error getting creator stats:', error);
      throw error;
    }
  }

  /**
   * Update content
   */
  static async updateContent(contentId, updates) {
    try {
      const setClause = [];
      const values = [contentId];
      let paramIndex = 2;

      Object.entries(updates).forEach(([key, value]) => {
        const column = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        setClause.push(`${column} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      });

      setClause.push(`updated_at = NOW()`);

      const result = await query(
        `UPDATE ${TABLE_CONTENT}
         SET ${setClause.join(', ')}
         WHERE id = $1
         RETURNING *`,
        values
      );

      const content = this._formatContent(result.rows[0]);
      if (content) {
        await cache.del(`content:${contentId}`);
        await cache.del(`creator:content:${content.creatorId}`);
      }

      logger.info('Content updated', { contentId });
      return content;
    } catch (error) {
      logger.error('Error updating content:', error);
      throw error;
    }
  }

  /**
   * Mark purchase as completed
   */
  static async completePurchase(purchaseId) {
    try {
      const result = await query(
        `UPDATE ${TABLE_PURCHASES}
         SET status = 'completed', purchased_at = NOW(), updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [purchaseId]
      );

      logger.info('Purchase completed', { purchaseId });
      return this._formatPurchase(result.rows[0]);
    } catch (error) {
      logger.error('Error completing purchase:', error);
      throw error;
    }
  }

  /**
   * Increment view count
   */
  static async incrementViewCount(contentId) {
    try {
      await query(
        `UPDATE ${TABLE_CONTENT}
         SET view_count = view_count + 1, updated_at = NOW()
         WHERE id = $1`,
        [contentId]
      );

      await cache.del(`content:${contentId}`);
      logger.info('Content view count incremented', { contentId });
    } catch (error) {
      logger.error('Error incrementing view count:', error);
      throw error;
    }
  }
}

module.exports = PaidContentModel;
