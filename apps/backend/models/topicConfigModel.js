const { query } = require('../config/postgres');
const logger = require('../utils/logger');

/**
 * Topic Configuration Model
 * Manages topic-specific settings and permissions for Telegram forum topics
 */
class TopicConfigModel {
  /**
   * Initialize topic configuration tables
   */
  static async initTables() {
    const queries = [
      // Main topic configuration table
      `CREATE TABLE IF NOT EXISTS topic_configuration (
        topic_id BIGINT PRIMARY KEY,
        group_id BIGINT NOT NULL,
        topic_name VARCHAR(255) NOT NULL,

        -- Access Control
        can_post VARCHAR(50) DEFAULT 'all',
        can_reply VARCHAR(50) DEFAULT 'all',
        can_react VARCHAR(50) DEFAULT 'all',
        required_role VARCHAR(50) DEFAULT 'user',
        required_subscription VARCHAR(50) DEFAULT 'free',

        -- Content Rules
        media_required BOOLEAN DEFAULT FALSE,
        allow_text_only BOOLEAN DEFAULT TRUE,
        allow_caption BOOLEAN DEFAULT TRUE,
        allowed_media JSONB DEFAULT '["photo","video","animation"]',
        allow_stickers BOOLEAN DEFAULT TRUE,
        allow_documents BOOLEAN DEFAULT FALSE,

        -- Reply Handling
        allow_replies BOOLEAN DEFAULT TRUE,
        reply_must_quote BOOLEAN DEFAULT FALSE,
        allow_text_in_replies BOOLEAN DEFAULT TRUE,

        -- Moderation
        auto_moderate BOOLEAN DEFAULT FALSE,
        anti_spam_enabled BOOLEAN DEFAULT FALSE,
        anti_flood_enabled BOOLEAN DEFAULT FALSE,
        anti_links_enabled BOOLEAN DEFAULT FALSE,
        allow_commands BOOLEAN DEFAULT TRUE,

        -- Rate Limiting
        max_posts_per_hour INTEGER DEFAULT 100,
        max_replies_per_hour INTEGER DEFAULT 100,
        cooldown_between_posts INTEGER DEFAULT 0,

        -- Bot Behavior
        redirect_bot_responses BOOLEAN DEFAULT FALSE,
        auto_delete_enabled BOOLEAN DEFAULT FALSE,
        auto_delete_after INTEGER DEFAULT 300,
        override_global_deletion BOOLEAN DEFAULT FALSE,

        -- Notifications & Features
        notify_all_on_new_post BOOLEAN DEFAULT FALSE,
        auto_pin_admin_messages BOOLEAN DEFAULT FALSE,
        auto_pin_duration INTEGER DEFAULT 172800,

        -- Mirror Settings
        auto_mirror_enabled BOOLEAN DEFAULT FALSE,
        mirror_from_general BOOLEAN DEFAULT FALSE,
        mirror_format TEXT DEFAULT '📸 From: @{username}\n\n{caption}',

        -- Analytics
        enable_leaderboard BOOLEAN DEFAULT FALSE,
        track_reactions BOOLEAN DEFAULT FALSE,
        track_posts BOOLEAN DEFAULT FALSE,

        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,

      // Topic violations tracking
      `CREATE TABLE IF NOT EXISTS topic_violations (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        topic_id BIGINT NOT NULL,
        violation_type VARCHAR(100) NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,

      // Topic analytics (for leaderboard)
      `CREATE TABLE IF NOT EXISTS topic_analytics (
        id SERIAL PRIMARY KEY,
        topic_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        username VARCHAR(255),

        -- Post tracking
        total_posts INTEGER DEFAULT 0,
        total_media_shared INTEGER DEFAULT 0,

        -- Engagement tracking
        total_reactions_given INTEGER DEFAULT 0,
        total_reactions_received INTEGER DEFAULT 0,
        total_replies INTEGER DEFAULT 0,

        -- Most liked post
        most_liked_post_id BIGINT,
        most_liked_post_count INTEGER DEFAULT 0,

        last_post_at TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

        UNIQUE(topic_id, user_id)
      )`,

      // Indexes
      `CREATE INDEX IF NOT EXISTS idx_topic_config_group ON topic_configuration(group_id)`,
      `CREATE INDEX IF NOT EXISTS idx_violations_user_topic ON topic_violations(user_id, topic_id)`,
      `CREATE INDEX IF NOT EXISTS idx_violations_timestamp ON topic_violations(timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_topic ON topic_analytics(topic_id)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_user ON topic_analytics(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_posts ON topic_analytics(total_posts DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_reactions ON topic_analytics(total_reactions_given DESC)`
    ];

    try {
      for (const sql of queries) {
        await query(sql);
      }
      logger.info('Topic configuration tables initialized');
    } catch (error) {
      logger.error('Error initializing topic configuration tables:', error);
      throw error;
    }
  }

  /**
   * Get topic configuration by thread ID
   */
  static async getByThreadId(threadId) {
    const sql = 'SELECT * FROM topic_configuration WHERE topic_id = $1';

    try {
      const result = await query(sql, [threadId]);
      return result.rows[0] || null;
    } catch (error) {
      // If table doesn't exist, return null instead of throwing
      if (error.code === '42P01') {
        return null;
      }
      logger.error('Error getting topic config:', error);
      return null;
    }
  }

  /**
   * Alias for getByThreadId - used by TopicModerationService
   */
  static async getTopicConfig(topicId) {
    return this.getByThreadId(topicId);
  }

  /**
   * Alias for upsert - used by TopicModerationService
   */
  static async saveTopicConfig(config) {
    return this.upsert(config);
  }

  /**
   * Get all topic configurations for a group
   */
  static async getByGroupId(groupId) {
    const sql = 'SELECT * FROM topic_configuration WHERE group_id = $1';

    try {
      const result = await query(sql, [groupId]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting topic configs for group:', error);
      throw error;
    }
  }

  /**
   * Create or update topic configuration
   */
  static async upsert(config) {
    const sql = `
      INSERT INTO topic_configuration (
        topic_id, group_id, topic_name, can_post, can_reply, can_react,
        media_required, allow_text_only, allow_caption, allowed_media,
        allow_stickers, allow_replies, allow_text_in_replies,
        auto_moderate, anti_spam_enabled, max_posts_per_hour,
        redirect_bot_responses, auto_delete_enabled, auto_delete_after,
        notify_all_on_new_post, auto_pin_admin_messages, auto_pin_duration,
        auto_mirror_enabled, mirror_from_general, mirror_format,
        enable_leaderboard, track_reactions, track_posts
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28
      )
      ON CONFLICT (topic_id) DO UPDATE SET
        topic_name = EXCLUDED.topic_name,
        can_post = EXCLUDED.can_post,
        can_reply = EXCLUDED.can_reply,
        can_react = EXCLUDED.can_react,
        media_required = EXCLUDED.media_required,
        allow_text_only = EXCLUDED.allow_text_only,
        allow_caption = EXCLUDED.allow_caption,
        allowed_media = EXCLUDED.allowed_media,
        allow_stickers = EXCLUDED.allow_stickers,
        allow_replies = EXCLUDED.allow_replies,
        allow_text_in_replies = EXCLUDED.allow_text_in_replies,
        auto_moderate = EXCLUDED.auto_moderate,
        anti_spam_enabled = EXCLUDED.anti_spam_enabled,
        max_posts_per_hour = EXCLUDED.max_posts_per_hour,
        redirect_bot_responses = EXCLUDED.redirect_bot_responses,
        auto_delete_enabled = EXCLUDED.auto_delete_enabled,
        auto_delete_after = EXCLUDED.auto_delete_after,
        notify_all_on_new_post = EXCLUDED.notify_all_on_new_post,
        auto_pin_admin_messages = EXCLUDED.auto_pin_admin_messages,
        auto_pin_duration = EXCLUDED.auto_pin_duration,
        auto_mirror_enabled = EXCLUDED.auto_mirror_enabled,
        mirror_from_general = EXCLUDED.mirror_from_general,
        mirror_format = EXCLUDED.mirror_format,
        enable_leaderboard = EXCLUDED.enable_leaderboard,
        track_reactions = EXCLUDED.track_reactions,
        track_posts = EXCLUDED.track_posts,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const values = [
      config.topic_id,
      config.group_id,
      config.topic_name,
      config.can_post || 'all',
      config.can_reply || 'all',
      config.can_react || 'all',
      config.media_required || false,
      config.allow_text_only !== undefined ? config.allow_text_only : true,
      config.allow_caption !== undefined ? config.allow_caption : true,
      JSON.stringify(config.allowed_media || ['photo', 'video', 'animation']),
      config.allow_stickers !== undefined ? config.allow_stickers : true,
      config.allow_replies !== undefined ? config.allow_replies : true,
      config.allow_text_in_replies !== undefined ? config.allow_text_in_replies : true,
      config.auto_moderate || false,
      config.anti_spam_enabled || false,
      config.max_posts_per_hour || 100,
      config.redirect_bot_responses || false,
      config.auto_delete_enabled || false,
      config.auto_delete_after || 300,
      config.notify_all_on_new_post || false,
      config.auto_pin_admin_messages || false,
      config.auto_pin_duration || 172800,
      config.auto_mirror_enabled || false,
      config.mirror_from_general || false,
      config.mirror_format || '📸 From: @{username}\n\n{caption}',
      config.enable_leaderboard || false,
      config.track_reactions || false,
      config.track_posts || false
    ];

    try {
      const result = await query(sql, values);
      logger.info('Topic configuration saved', { topic_id: config.topic_id });
      return result.rows[0];
    } catch (error) {
      logger.error('Error saving topic configuration:', error);
      throw error;
    }
  }

  /**
   * Track user violation
   */
  static async trackViolation(userId, topicId, violationType) {
    const sql = `
      INSERT INTO topic_violations (user_id, topic_id, violation_type)
      VALUES ($1, $2, $3)
    `;

    try {
      await query(sql, [userId, topicId, violationType]);

      // Get violation count in last 24 hours
      const countSql = `
        SELECT COUNT(*) as count
        FROM topic_violations
        WHERE user_id = $1 AND topic_id = $2
        AND timestamp > NOW() - INTERVAL '24 hours'
      `;

      const result = await query(countSql, [userId, topicId]);
      return parseInt(result.rows[0].count);
    } catch (error) {
      logger.error('Error tracking violation:', error);
      throw error;
    }
  }

  /**
   * Get user violation count in last 24 hours
   */
  static async getViolationCount(userId, topicId) {
    const sql = `
      SELECT COUNT(*) as count
      FROM topic_violations
      WHERE user_id = $1 AND topic_id = $2
      AND timestamp > NOW() - INTERVAL '24 hours'
    `;

    try {
      const result = await query(sql, [userId, topicId]);
      return parseInt(result.rows[0].count);
    } catch (error) {
      logger.error('Error getting violation count:', error);
      return 0;
    }
  }

  /**
   * Update topic analytics
   */
  static async updateAnalytics(topicId, userId, username, data) {
    const sql = `
      INSERT INTO topic_analytics (
        topic_id, user_id, username,
        total_posts, total_media_shared, total_reactions_given,
        total_reactions_received, total_replies, last_post_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (topic_id, user_id) DO UPDATE SET
        username = EXCLUDED.username,
        total_posts = topic_analytics.total_posts + COALESCE($4, 0),
        total_media_shared = topic_analytics.total_media_shared + COALESCE($5, 0),
        total_reactions_given = topic_analytics.total_reactions_given + COALESCE($6, 0),
        total_reactions_received = topic_analytics.total_reactions_received + COALESCE($7, 0),
        total_replies = topic_analytics.total_replies + COALESCE($8, 0),
        last_post_at = NOW(),
        updated_at = NOW()
    `;

    const values = [
      topicId,
      userId,
      username,
      data.posts || 0,
      data.media || 0,
      data.reactions_given || 0,
      data.reactions_received || 0,
      data.replies || 0
    ];

    try {
      await query(sql, values);
    } catch (error) {
      logger.error('Error updating topic analytics:', error);
      throw error;
    }
  }

  /**
   * Get leaderboard for a topic
   */
  static async getLeaderboard(topicId, type = 'posts', limit = 10) {
    let orderBy = 'total_posts DESC';

    if (type === 'reactions_given') {
      orderBy = 'total_reactions_given DESC';
    } else if (type === 'reactions_received') {
      orderBy = 'total_reactions_received DESC';
    } else if (type === 'media') {
      orderBy = 'total_media_shared DESC';
    }

    const sql = `
      SELECT
        user_id,
        username,
        total_posts,
        total_media_shared,
        total_reactions_given,
        total_reactions_received,
        total_replies,
        last_post_at
      FROM topic_analytics
      WHERE topic_id = $1
      ORDER BY ${orderBy}
      LIMIT $2
    `;

    try {
      const result = await query(sql, [topicId, limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting leaderboard:', error);
      throw error;
    }
  }

  /**
   * Delete topic configuration
   */
  static async delete(topicId) {
    const sql = 'DELETE FROM topic_configuration WHERE topic_id = $1';

    try {
      await query(sql, [topicId]);
      logger.info('Topic configuration deleted', { topic_id: topicId });
      return true;
    } catch (error) {
      logger.error('Error deleting topic configuration:', error);
      throw error;
    }
  }
}

module.exports = TopicConfigModel;
