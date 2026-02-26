const { getPool } = require('../config/postgres');
const logger = require('../utils/logger');

/**
 * Support Topic Model
 * Manages user support topics in the support group
 * Each user has a dedicated forum topic for their support conversations
 */
class SupportTopicModel {
  /**
   * Initialize support topics table
   */
  static async initTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS support_topics (
        user_id VARCHAR(255) PRIMARY KEY,
        thread_id INTEGER NOT NULL,
        thread_name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        message_count INTEGER DEFAULT 0,
        status VARCHAR(50) DEFAULT 'open',
        assigned_to VARCHAR(255),
        priority VARCHAR(20) DEFAULT 'medium',
        category VARCHAR(50),
        language VARCHAR(10),
        first_response_at TIMESTAMP,
        resolution_time TIMESTAMP,
        sla_breached BOOLEAN DEFAULT false,
        escalation_level INTEGER DEFAULT 0,
        last_agent_message_at TIMESTAMP,
        user_satisfaction INTEGER,
        feedback TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_support_topics_thread_id ON support_topics(thread_id);
      CREATE INDEX IF NOT EXISTS idx_support_topics_status ON support_topics(status);
      CREATE INDEX IF NOT EXISTS idx_support_topics_priority ON support_topics(priority);
      CREATE INDEX IF NOT EXISTS idx_support_topics_category ON support_topics(category);
      CREATE INDEX IF NOT EXISTS idx_support_topics_assigned_to ON support_topics(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_support_topics_language ON support_topics(language);
    `;

    try {
      await getPool().query(query);
      logger.info('Support topics table initialized');
    } catch (error) {
      logger.error('Error initializing support topics table:', error);
      throw error;
    }
  }

  /**
   * Get topic by user ID
   * @param {string} userId - Telegram user ID
   * @returns {Promise<Object|null>} Topic data or null
   */
  static async getByUserId(userId) {
    const query = 'SELECT * FROM support_topics WHERE user_id = $1';

    try {
      const result = await getPool().query(query, [userId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting topic by user ID:', error);
      throw error;
    }
  }

  /**
   * Get topic by thread ID
   * @param {number} threadId - Forum topic ID
   * @returns {Promise<Object|null>} Topic data or null
   */
  static async getByThreadId(threadId) {
    const query = 'SELECT * FROM support_topics WHERE thread_id = $1';

    try {
      const result = await getPool().query(query, [threadId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting topic by thread ID:', error);
      throw error;
    }
  }

  /**
   * Create new support topic entry
   * @param {Object} data - Topic data
   * @param {string} data.userId - Telegram user ID
   * @param {number} data.threadId - Forum topic ID
   * @param {string} data.threadName - Topic name
   * @returns {Promise<Object>} Created topic data
   */
  static async create({ userId, threadId, threadName }) {
    const query = `
      INSERT INTO support_topics (user_id, thread_id, thread_name, message_count)
      VALUES ($1, $2, $3, 1)
      RETURNING *
    `;

    try {
      const result = await getPool().query(query, [userId, threadId, threadName]);
      logger.info('Support topic created', { userId, threadId, threadName });
      return result.rows[0];
    } catch (error) {
      logger.error('Error creating support topic:', error);
      throw error;
    }
  }

  /**
   * Update topic's last message timestamp and increment message count
   * @param {string} userId - Telegram user ID
   * @returns {Promise<Object>} Updated topic data
   */
  static async updateLastMessage(userId) {
    const query = `
      UPDATE support_topics
      SET last_message_at = CURRENT_TIMESTAMP,
          message_count = message_count + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING *
    `;

    try {
      const result = await getPool().query(query, [userId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error updating last message:', error);
      throw error;
    }
  }

  /**
   * Update topic status
   * @param {string} userId - Telegram user ID
   * @param {string} status - New status (open, resolved, closed)
   * @returns {Promise<Object>} Updated topic data
   */
  static async updateStatus(userId, status) {
    const query = `
      UPDATE support_topics
      SET status = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING *
    `;

    try {
      const result = await getPool().query(query, [userId, status]);
      logger.info('Support topic status updated', { userId, status });
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error updating topic status:', error);
      throw error;
    }
  }

  /**
   * Update topic priority
   * @param {string} userId - Telegram user ID
   * @param {string} priority - Priority level (low, medium, high, critical)
   * @returns {Promise<Object>} Updated topic data
   */
  static async updatePriority(userId, priority) {
    const query = `
      UPDATE support_topics
      SET priority = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING *
    `;

    try {
      const result = await getPool().query(query, [userId, priority]);
      logger.info('Support topic priority updated', { userId, priority });
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error updating topic priority:', error);
      throw error;
    }
  }

  /**
   * Update topic category
   * @param {string} userId - Telegram user ID
   * @param {string} category - Category (billing, technical, general, etc.)
   * @returns {Promise<Object>} Updated topic data
   */
  static async updateCategory(userId, category) {
    const query = `
      UPDATE support_topics
      SET category = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING *
    `;

    try {
      const result = await getPool().query(query, [userId, category]);
      logger.info('Support topic category updated', { userId, category });
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error updating topic category:', error);
      throw error;
    }
  }

  /**
   * Update topic language
   * @param {string} userId - Telegram user ID
   * @param {string} language - Language code (es, en, etc.)
   * @returns {Promise<Object>} Updated topic data
   */
  static async updateLanguage(userId, language) {
    const query = `
      UPDATE support_topics
      SET language = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING *
    `;

    try {
      const result = await getPool().query(query, [userId, language]);
      logger.info('Support topic language updated', { userId, language });
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error updating topic language:', error);
      throw error;
    }
  }

  /**
   * Update first response timestamp
   * @param {string} userId - Telegram user ID
   * @returns {Promise<Object>} Updated topic data
   */
  static async updateFirstResponse(userId) {
    const query = `
      UPDATE support_topics
      SET first_response_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING *
    `;

    try {
      const result = await getPool().query(query, [userId]);
      logger.info('First response timestamp updated', { userId });
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error updating first response:', error);
      throw error;
    }
  }

  /**
   * Update resolution timestamp
   * @param {string} userId - Telegram user ID
   * @returns {Promise<Object>} Updated topic data
   */
  static async updateResolutionTime(userId) {
    const query = `
      UPDATE support_topics
      SET resolution_time = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING *
    `;

    try {
      const result = await getPool().query(query, [userId]);
      logger.info('Resolution timestamp updated', { userId });
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error updating resolution time:', error);
      throw error;
    }
  }

  /**
   * Update escalation level
   * @param {string} userId - Telegram user ID
   * @param {number} level - Escalation level
   * @returns {Promise<Object>} Updated topic data
   */
  static async updateEscalationLevel(userId, level) {
    const query = `
      UPDATE support_topics
      SET escalation_level = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING *
    `;

    try {
      const result = await getPool().query(query, [userId, level]);
      logger.info('Escalation level updated', { userId, level });
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error updating escalation level:', error);
      throw error;
    }
  }

  /**
   * Update last agent message timestamp
   * @param {string} userId - Telegram user ID
   * @returns {Promise<Object>} Updated topic data
   */
  static async updateLastAgentMessage(userId) {
    const query = `
      UPDATE support_topics
      SET last_agent_message_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING *
    `;

    try {
      const result = await getPool().query(query, [userId]);
      logger.info('Last agent message timestamp updated', { userId });
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error updating last agent message:', error);
      throw error;
    }
  }

  /**
   * Update user satisfaction rating
   * @param {string} userId - Telegram user ID
   * @param {number} rating - Satisfaction rating (1-5)
   * @param {string} feedback - Optional feedback text
   * @returns {Promise<Object>} Updated topic data
   */
  static async updateSatisfaction(userId, rating, feedback = null) {
    const query = `
      UPDATE support_topics
      SET user_satisfaction = $2,
          feedback = $3,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING *
    `;

    try {
      const result = await getPool().query(query, [userId, rating, feedback]);
      logger.info('User satisfaction updated', { userId, rating });
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error updating satisfaction:', error);
      throw error;
    }
  }

  /**
   * Update user satisfaction rating
   * @param {string} userId - Telegram user ID
   * @param {number} rating - Satisfaction rating (1-4)
   * @returns {Promise<Object>} Updated topic data
   */
  static async updateRating(ticketUserId, ratingUserId, rating) {
    const query = `
      INSERT INTO ticket_ratings (ticket_user_id, user_id, rating)
      VALUES ($1::varchar, $2::bigint, $3)
      RETURNING *
    `;

    try {
      const result = await getPool().query(query, [ticketUserId, ratingUserId, rating]);
      logger.info('User rating updated', { ticketUserId, ratingUserId, rating });
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error updating rating:', error);
      throw error;
    }
  }

  /**
   * Mark SLA as breached
   * @param {string} userId - Telegram user ID
   * @param {boolean} breached - SLA breach status
   * @returns {Promise<Object>} Updated topic data
   */
  static async updateSlaBreach(userId, breached) {
    const query = `
      UPDATE support_topics
      SET sla_breached = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING *
    `;

    try {
      const result = await getPool().query(query, [userId, breached]);
      logger.info('SLA breach status updated', { userId, breached });
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error updating SLA breach:', error);
      throw error;
    }
  }

  /**
   * Assign topic to support agent
   * @param {string} userId - Telegram user ID
   * @param {string} agentId - Support agent ID
   * @returns {Promise<Object>} Updated topic data
   */
  static async assignTo(userId, agentId) {
    const query = `
      UPDATE support_topics
      SET assigned_to = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING *
    `;

    try {
      const result = await getPool().query(query, [userId, agentId]);
      logger.info('Support topic assigned', { userId, agentId });
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error assigning topic:', error);
      throw error;
    }
  }

  /**
   * Get all open topics
   * @returns {Promise<Array>} Array of open topics
   */
  static async getOpenTopics() {
    const query = `
      SELECT * FROM support_topics
      WHERE status = 'open'
      ORDER BY last_message_at DESC
    `;

    try {
      const result = await getPool().query(query);
      return result.rows;
    } catch (error) {
      logger.error('Error getting open topics:', error);
      throw error;
    }
  }

  /**
   * Get topics assigned to specific agent
   * @param {string} agentId - Support agent ID
   * @returns {Promise<Array>} Array of assigned topics
   */
  static async getAssignedTopics(agentId) {
    const query = `
      SELECT * FROM support_topics
      WHERE assigned_to = $1 AND status = 'open'
      ORDER BY last_message_at DESC
    `;

    try {
      const result = await getPool().query(query, [agentId]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting assigned topics:', error);
      throw error;
    }
  }

  /**
   * Get topic statistics
   * @returns {Promise<Object>} Statistics object
   */
  static async getStatistics() {
    const query = `
      SELECT
        COUNT(*) as total_topics,
        COUNT(*) FILTER (WHERE status = 'open') as open_topics,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved_topics,
        COUNT(*) FILTER (WHERE status = 'closed') as closed_topics,
        SUM(message_count) as total_messages,
        AVG(message_count) as avg_messages_per_topic,
        COUNT(*) FILTER (WHERE priority = 'high') as high_priority,
        COUNT(*) FILTER (WHERE priority = 'critical') as critical_priority,
        COUNT(*) FILTER (WHERE sla_breached = true) as sla_breaches
      FROM support_topics
    `;

    try {
      const result = await getPool().query(query);
      return result.rows[0];
    } catch (error) {
      logger.error('Error getting topic statistics:', error);
      throw error;
    }
  }

  /**
   * Get topics by priority
   * @param {string} priority - Priority level
   * @returns {Promise<Array>} Array of topics with specified priority
   */
  static async getTopicsByPriority(priority) {
    const query = `
      SELECT * FROM support_topics
      WHERE priority = $1 AND status = 'open'
      ORDER BY 
        CASE WHEN priority = 'critical' THEN 1
             WHEN priority = 'high' THEN 2
             WHEN priority = 'medium' THEN 3
             ELSE 4 END,
        last_message_at ASC
    `;

    try {
      const result = await getPool().query(query, [priority]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting topics by priority:', error);
      throw error;
    }
  }

  /**
   * Get topics by category
   * @param {string} category - Category name
   * @returns {Promise<Array>} Array of topics with specified category
   */
  static async getTopicsByCategory(category) {
    const query = `
      SELECT * FROM support_topics
      WHERE category = $1 AND status = 'open'
      ORDER BY last_message_at DESC
    `;

    try {
      const result = await getPool().query(query, [category]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting topics by category:', error);
      throw error;
    }
  }

  /**
   * Get topics by language
   * @param {string} language - Language code
   * @returns {Promise<Array>} Array of topics with specified language
   */
  static async getTopicsByLanguage(language) {
    const query = `
      SELECT * FROM support_topics
      WHERE language = $1 AND status = 'open'
      ORDER BY last_message_at DESC
    `;

    try {
      const result = await getPool().query(query, [language]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting topics by language:', error);
      throw error;
    }
  }

  /**
   * Get topics with SLA breaches
   * @returns {Promise<Array>} Array of topics with SLA breaches
   */
  static async getSlaBreachedTopics() {
    const query = `
      SELECT * FROM support_topics
      WHERE sla_breached = true AND status = 'open'
      ORDER BY last_message_at DESC
    `;

    try {
      const result = await getPool().query(query);
      return result.rows;
    } catch (error) {
      logger.error('Error getting SLA breached topics:', error);
      throw error;
    }
  }

  /**
   * Get topics by escalation level
   * @param {number} level - Escalation level
   * @returns {Promise<Array>} Array of topics with specified escalation level
   */
  static async getTopicsByEscalationLevel(level) {
    const query = `
      SELECT * FROM support_topics
      WHERE escalation_level = $1 AND status = 'open'
      ORDER BY last_message_at DESC
    `;

    try {
      const result = await getPool().query(query, [level]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting topics by escalation level:', error);
      throw error;
    }
  }

  /**
   * Get topics needing first response
   * @returns {Promise<Array>} Array of topics without first response
   */
  static async getTopicsNeedingFirstResponse() {
    const query = `
      SELECT * FROM support_topics
      WHERE first_response_at IS NULL AND status = 'open'
      ORDER BY created_at ASC
    `;

    try {
      const result = await getPool().query(query);
      return result.rows;
    } catch (error) {
      logger.error('Error getting topics needing first response:', error);
      throw error;
    }
  }

  /**
   * Get agent performance statistics
   * @param {string} agentId - Agent ID
   * @returns {Promise<Object>} Agent performance statistics
   */
  static async getAgentPerformance(agentId) {
    const query = `
      SELECT
        COUNT(*) as total_tickets,
        COUNT(*) FILTER (WHERE status = 'closed') as closed_tickets,
        AVG(EXTRACT(EPOCH FROM (resolution_time - created_at))/3600) as avg_resolution_hours,
        AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/3600) as avg_first_response_hours,
        COUNT(*) FILTER (WHERE user_satisfaction >= 4) as satisfied_customers,
        COUNT(*) FILTER (WHERE sla_breached = true) as sla_breaches
      FROM support_topics
      WHERE assigned_to = $1
    `;

    try {
      const result = await getPool().query(query, [agentId]);
      return result.rows[0];
    } catch (error) {
      logger.error('Error getting agent performance:', error);
      throw error;
    }
  }

  /**
   * Search topics by user ID or username
   * @param {string} searchTerm - Search term (user ID or partial username)
   * @returns {Promise<Array>} Array of matching topics
   */
  static async searchTopics(searchTerm) {
    const query = `
      SELECT * FROM support_topics
      WHERE user_id LIKE $1 OR thread_name ILIKE $2
      ORDER BY last_message_at DESC
      LIMIT 20
    `;

    try {
      const result = await getPool().query(query, [`%${searchTerm}%`, `%${searchTerm}%`]);
      return result.rows;
    } catch (error) {
      logger.error('Error searching topics:', error);
      throw error;
    }
  }

  /**
   * Delete topic (admin only)
   * @param {string} userId - Telegram user ID
   * @returns {Promise<boolean>} Success status
   */
  static async delete(userId) {
    const query = 'DELETE FROM support_topics WHERE user_id = $1';

    try {
      await getPool().query(query, [userId]);
      logger.info('Support topic deleted', { userId });
      return true;
    } catch (error) {
      logger.error('Error deleting topic:', error);
      throw error;
    }
  }
}

module.exports = SupportTopicModel;
