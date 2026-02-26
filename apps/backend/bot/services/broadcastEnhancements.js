/**
 * Broadcast System Enhancements
 * Advanced features for the broadcast system including:
 * - User preferences and opt-out management
 * - Advanced targeting and segmentation
 * - Broadcast analytics and engagement tracking
 * - A/B testing framework
 * - Pause/resume functionality
 * - Automatic retry with exponential backoff
 */

const { getPool } = require('../../config/postgres');
const logger = require('../../utils/logger');
const { v4: uuidv4 } = require('uuid');

class BroadcastEnhancements {
  /**
   * USER PREFERENCE MANAGEMENT
   */

  /**
   * Check if user has opted out of broadcasts
   * @param {number} userId - Telegram user ID
   * @returns {Promise<boolean>} Whether user is opted out
   */
  async isUserOptedOut(userId) {
    const query = `
      SELECT is_opted_out FROM user_broadcast_preferences
      WHERE user_id = $1
    `;
    try {
      const result = await getPool().query(query, [userId]);
      return result.rows.length > 0 ? result.rows[0].is_opted_out : false;
    } catch (error) {
      logger.error(`Error checking opt-out status for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Set user broadcast preference
   * @param {number} userId - Telegram user ID
   * @param {boolean} optedOut - Opt-out status
   * @param {string} reason - Reason for opt-out (optional)
   */
  async setUserBroadcastPreference(userId, optedOut, reason = null) {
    const query = `
      INSERT INTO user_broadcast_preferences (user_id, is_opted_out, opted_out_reason, opted_out_at)
      VALUES ($1, $2, $3, $2 ? CURRENT_TIMESTAMP : NULL)
      ON CONFLICT (user_id)
      DO UPDATE SET is_opted_out = $2, opted_out_reason = $3, opted_out_at = $2 ? CURRENT_TIMESTAMP : NULL
    `;
    try {
      await getPool().query(query, [userId, optedOut, reason]);
      logger.info(`User ${userId} broadcast preference updated: ${optedOut ? 'opted out' : 'opted in'}`);
    } catch (error) {
      logger.error(`Error setting broadcast preference for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get user's broadcast frequency preference
   * @param {number} userId - Telegram user ID
   * @returns {Promise<string>} Frequency preference: 'high', 'medium', 'low', 'none'
   */
  async getUserBroadcastFrequency(userId) {
    const query = `
      SELECT max_broadcasts_per_week, broadcasts_received_week FROM user_broadcast_preferences
      WHERE user_id = $1
    `;
    try {
      const result = await getPool().query(query, [userId]);
      if (result.rows.length > 0) {
        return {
          max_per_week: result.rows[0].max_broadcasts_per_week,
          received_this_week: result.rows[0].broadcasts_received_week
        };
      }
      return { max_per_week: 7, received_this_week: 0 };
    } catch (error) {
      logger.error(`Error getting frequency preference for user ${userId}:`, error);
      return { max_per_week: 7, received_this_week: 0 };
    }
  }

  /**
   * Record a broadcast being sent to user (for frequency tracking)
   * @param {number} userId - User ID
   * @returns {Promise<void>}
   */
  async recordBroadcastFrequency(userId) {
    const query = `
      UPDATE user_broadcast_preferences
      SET broadcasts_received_week = broadcasts_received_week + 1,
          last_broadcast_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
    `;
    try {
      await getPool().query(query, [userId]);
    } catch (error) {
      logger.error(`Error recording broadcast frequency for user ${userId}:`, error);
    }
  }

  /**
   * Check if user exceeds frequency limits
   * @param {number} userId - User ID
   * @returns {Promise<boolean>} Whether frequency limit is exceeded
   */
  async exceedsFrequencyLimit(userId) {
    const query = `
      SELECT broadcasts_received_week, max_broadcasts_per_week
      FROM user_broadcast_preferences
      WHERE user_id = $1
    `;
    try {
      const result = await getPool().query(query, [userId]);
      if (result.rows.length === 0) return false;

      const { broadcasts_received_week, max_broadcasts_per_week } = result.rows[0];
      return broadcasts_received_week >= max_broadcasts_per_week;
    } catch (error) {
      logger.error(`Error checking frequency limit for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * ADVANCED TARGETING & SEGMENTATION
   */

  /**
   * Create user segment based on criteria
   * @param {Object} criteria - Segmentation criteria
   * @returns {Promise<string>} Segment ID
   */
  async createUserSegment(criteria) {
    const {
      name,
      description,
      filters = {},
      createdByAdminId,
    } = criteria;

    const segmentId = uuidv4();
    const query = `
      INSERT INTO user_segments (segment_id, name, description, filters, created_by_admin_id, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING segment_id
    `;

    try {
      const result = await getPool().query(query, [
        segmentId,
        name,
        description,
        JSON.stringify(filters),
        createdByAdminId,
      ]);
      logger.info(`Segment created: ${segmentId} - ${name}`);
      return segmentId;
    } catch (error) {
      logger.error('Error creating segment:', error);
      throw error;
    }
  }

  /**
   * Get users matching segment criteria
   * @param {string} segmentId - Segment ID
   * @returns {Promise<Array>} User IDs matching segment
   */
  async getUsersInSegment(segmentId) {
    const query = `
      SELECT segment_id, filters FROM user_segments WHERE segment_id = $1
    `;
    try {
      const segmentResult = await getPool().query(query, [segmentId]);
      if (segmentResult.rows.length === 0) {
        throw new Error(`Segment ${segmentId} not found`);
      }

      const filters = segmentResult.rows[0].filters;
      return this._applySegmentFilters(filters);
    } catch (error) {
      logger.error(`Error getting users in segment ${segmentId}:`, error);
      throw error;
    }
  }

  /**
   * Apply segment filters to get matching users
   * @private
   */
  async _applySegmentFilters(filters) {
    let query = 'SELECT user_id FROM users WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    // Activity level
    if (filters.activityLevel) {
      query += ` AND activity_score >= $${paramIndex}`;
      params.push(filters.activityLevel);
      paramIndex++;
    }

    // Subscription tier
    if (filters.subscriptionTiers && filters.subscriptionTiers.length > 0) {
      query += ` AND subscription_tier = ANY($${paramIndex})`;
      params.push(filters.subscriptionTiers);
      paramIndex++;
    }

    // Geographic location
    if (filters.countries && filters.countries.length > 0) {
      query += ` AND country = ANY($${paramIndex})`;
      params.push(filters.countries);
      paramIndex++;
    }

    // Registration date range
    if (filters.registeredAfter) {
      query += ` AND created_at >= $${paramIndex}`;
      params.push(filters.registeredAfter);
      paramIndex++;
    }

    if (filters.registeredBefore) {
      query += ` AND created_at <= $${paramIndex}`;
      params.push(filters.registeredBefore);
      paramIndex++;
    }

    // Language preference
    if (filters.languages && filters.languages.length > 0) {
      query += ` AND language = ANY($${paramIndex})`;
      params.push(filters.languages);
      paramIndex++;
    }

    try {
      const result = await getPool().query(query, params);
      return result.rows.map(row => row.user_id);
    } catch (error) {
      logger.error('Error applying segment filters:', error);
      throw error;
    }
  }

  /**
   * BROADCAST ANALYTICS & ENGAGEMENT TRACKING
   */

  /**
   * Record broadcast engagement event
   * @param {string} broadcastId - Broadcast ID
   * @param {number} userId - User ID
   * @param {string} eventType - 'opened', 'clicked', 'replied', 'shared'
   * @param {Object} metadata - Additional event data
   */
  async recordEngagementEvent(broadcastId, userId, eventType, metadata = {}) {
    const query = `
      INSERT INTO broadcast_engagement (broadcast_id, user_id, event_type, metadata, timestamp)
      VALUES ($1, $2, $3, $4, NOW())
    `;
    try {
      await getPool().query(query, [
        broadcastId,
        userId,
        eventType,
        JSON.stringify(metadata),
      ]);
    } catch (error) {
      logger.error(`Error recording engagement event:`, error);
    }
  }

  /**
   * Get broadcast analytics
   * @param {string} broadcastId - Broadcast ID
   * @returns {Promise<Object>} Analytics data
   */
  async getBroadcastAnalytics(broadcastId) {
    const query = `
      SELECT
        b.id as broadcast_id,
        b.total_recipients,
        b.sent_count,
        b.failed_count,
        b.blocked_count,
        ROUND((b.sent_count::float / b.total_recipients * 100)::numeric, 2) as delivery_rate,
        (SELECT COUNT(*) FROM broadcast_engagement WHERE broadcast_id = $1 AND event_type = 'opened') as opened_count,
        (SELECT COUNT(*) FROM broadcast_engagement WHERE broadcast_id = $1 AND event_type = 'clicked') as clicked_count,
        (SELECT COUNT(*) FROM broadcast_engagement WHERE broadcast_id = $1 AND event_type = 'replied') as replied_count,
        (SELECT ROUND((COUNT(*)::float / b.sent_count * 100)::numeric, 2) FROM broadcast_engagement WHERE broadcast_id = $1 AND event_type IN ('opened', 'clicked', 'replied')) as engagement_rate,
        b.created_at,
        b.completed_at,
        EXTRACT(EPOCH FROM (b.completed_at - b.created_at)) as execution_time_seconds
      FROM broadcasts b
      WHERE b.id = $1
    `;

    try {
      const result = await getPool().query(query, [broadcastId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error(`Error getting analytics for broadcast ${broadcastId}:`, error);
      throw error;
    }
  }

  /**
   * Get top performing broadcasts
   * @param {number} limit - Number of broadcasts to return
   * @returns {Promise<Array>} Top performing broadcasts
   */
  async getTopPerformingBroadcasts(limit = 10) {
    const query = `
      SELECT
        b.id as broadcast_id,
        b.title,
        b.sent_count,
        ROUND((b.sent_count::float / NULLIF(b.total_recipients, 0) * 100)::numeric, 2) as delivery_rate,
        COUNT(DISTINCT CASE WHEN be.event_type IN ('opened', 'clicked', 'replied') THEN be.user_id END) as engaged_users,
        ROUND((COUNT(DISTINCT CASE WHEN be.event_type IN ('opened', 'clicked', 'replied') THEN be.user_id END)::float / NULLIF(b.sent_count, 0) * 100)::numeric, 2) as engagement_rate,
        b.created_at
      FROM broadcasts b
      LEFT JOIN broadcast_engagement be ON b.id = be.broadcast_id
      WHERE b.status = 'completed'
      GROUP BY b.id, b.title, b.sent_count, b.total_recipients, b.created_at
      ORDER BY engagement_rate DESC NULLS LAST
      LIMIT $1
    `;

    try {
      const result = await getPool().query(query, [limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting top performing broadcasts:', error);
      throw error;
    }
  }

  /**
   * A/B TESTING FRAMEWORK
   */

  /**
   * Create A/B test for broadcast
   * @param {Object} testData - A/B test configuration
   * @returns {Promise<string>} Test ID
   */
  async createABTest(testData) {
    const {
      broadcastId,
      variantA,
      variantB,
      testSize = 0.5, // 50% split
      metrics = ['delivery_rate', 'engagement_rate'],
    } = testData;

    const testId = uuidv4();
    const query = `
      INSERT INTO broadcast_ab_tests (test_id, broadcast_id, variant_a, variant_b, test_size, metrics, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW())
      RETURNING test_id
    `;

    try {
      const result = await getPool().query(query, [
        testId,
        broadcastId,
        JSON.stringify(variantA),
        JSON.stringify(variantB),
        testSize,
        JSON.stringify(metrics),
      ]);
      logger.info(`A/B test created: ${testId}`);
      return testId;
    } catch (error) {
      logger.error('Error creating A/B test:', error);
      throw error;
    }
  }

  /**
   * Get A/B test results
   * @param {string} testId - Test ID
   * @returns {Promise<Object>} Test results with statistical significance
   */
  async getABTestResults(testId) {
    const query = `
      SELECT
        test_id,
        broadcast_id,
        status,
        (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id IN (SELECT broadcast_id FROM broadcast_ab_tests WHERE test_id = $1) AND variant = 'a') as variant_a_sent,
        (SELECT COUNT(*) FROM broadcast_engagement WHERE broadcast_id IN (SELECT broadcast_id FROM broadcast_ab_tests WHERE test_id = $1) AND variant = 'a') as variant_a_engaged,
        (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id IN (SELECT broadcast_id FROM broadcast_ab_tests WHERE test_id = $1) AND variant = 'b') as variant_b_sent,
        (SELECT COUNT(*) FROM broadcast_engagement WHERE broadcast_id IN (SELECT broadcast_id FROM broadcast_ab_tests WHERE test_id = $1) AND variant = 'b') as variant_b_engaged,
        created_at
      FROM broadcast_ab_tests
      WHERE test_id = $1
    `;

    try {
      const result = await getPool().query(query, [testId]);
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        testId,
        variantA: {
          sent: row.variant_a_sent,
          engaged: row.variant_a_engaged,
          engagementRate: row.variant_a_sent > 0 ? (row.variant_a_engaged / row.variant_a_sent * 100).toFixed(2) : 0,
        },
        variantB: {
          sent: row.variant_b_sent,
          engaged: row.variant_b_engaged,
          engagementRate: row.variant_b_sent > 0 ? (row.variant_b_engaged / row.variant_b_sent * 100).toFixed(2) : 0,
        },
        winner: this._determineWinner(row),
      };
    } catch (error) {
      logger.error(`Error getting A/B test results for ${testId}:`, error);
      throw error;
    }
  }

  /**
   * Determine A/B test winner with statistical significance
   * @private
   */
  _determineWinner(testData) {
    if (testData.variant_a_sent === 0 || testData.variant_b_sent === 0) {
      return 'insufficient_data';
    }

    const rateA = testData.variant_a_engaged / testData.variant_a_sent;
    const rateB = testData.variant_b_engaged / testData.variant_b_sent;
    const diff = Math.abs(rateA - rateB);

    // Simple Chi-square approximation
    if (diff > 0.05) { // >5% difference
      return rateA > rateB ? 'variant_a' : 'variant_b';
    }
    return 'no_significant_difference';
  }

  /**
   * PAUSE/RESUME FUNCTIONALITY
   */

  /**
   * Pause a broadcast in progress
   * @param {string} broadcastId - Broadcast ID
   */
  async pauseBroadcast(broadcastId) {
    const query = `
      UPDATE broadcasts
      SET status = 'paused', paused_at = NOW()
      WHERE broadcast_id = $1 AND status = 'sending'
      RETURNING broadcast_id
    `;

    try {
      const result = await getPool().query(query, [broadcastId]);
      if (result.rows.length === 0) {
        throw new Error(`Cannot pause broadcast ${broadcastId} - not in sending state`);
      }
      logger.info(`Broadcast paused: ${broadcastId}`);
      return result.rows[0];
    } catch (error) {
      logger.error(`Error pausing broadcast ${broadcastId}:`, error);
      throw error;
    }
  }

  /**
   * Resume a paused broadcast
   * @param {string} broadcastId - Broadcast ID
   */
  async resumeBroadcast(broadcastId) {
    const query = `
      UPDATE broadcasts
      SET status = 'sending', paused_at = NULL, resumed_at = NOW()
      WHERE broadcast_id = $1 AND status = 'paused'
      RETURNING broadcast_id
    `;

    try {
      const result = await getPool().query(query, [broadcastId]);
      if (result.rows.length === 0) {
        throw new Error(`Cannot resume broadcast ${broadcastId} - not in paused state`);
      }
      logger.info(`Broadcast resumed: ${broadcastId}`);
      return result.rows[0];
    } catch (error) {
      logger.error(`Error resuming broadcast ${broadcastId}:`, error);
      throw error;
    }
  }

  /**
   * AUTOMATIC RETRY WITH EXPONENTIAL BACKOFF
   */

  /**
   * Queue failed broadcast message for retry
   * @param {string} broadcastId - Broadcast ID
   * @param {number} userId - User ID
   * @param {Object} retryOptions - Retry configuration
   */
  async queueForRetry(broadcastId, userId, error = null, retryOptions = {}) {
    const {
      maxRetries = 5,
      initialDelay = 60, // 60 seconds
      backoffMultiplier = 2.0,
    } = retryOptions;

    const query = `
      INSERT INTO broadcast_retry_queue
        (broadcast_id, user_id, attempt_number, max_attempts, retry_delay_seconds,
         backoff_multiplier, last_error_code, last_error_message, status, next_retry_at)
      VALUES ($1, $2, 1, $3, $4, $5, $6, $7, 'pending', NOW() + interval '1 second' * $4)
      ON CONFLICT (broadcast_id, user_id)
      DO UPDATE SET
        attempt_number = broadcast_retry_queue.attempt_number + 1,
        retry_delay_seconds = $4 * POWER($5, broadcast_retry_queue.attempt_number),
        next_retry_at = NOW() + interval '1 second' * ($4 * POWER($5, broadcast_retry_queue.attempt_number)),
        last_error_code = $6,
        last_error_message = $7,
        error_history = jsonb_insert(
          COALESCE(broadcast_retry_queue.error_history, '[]'::jsonb),
          '{-1}',
          jsonb_build_object('timestamp', NOW(), 'message', $7, 'code', $6)
        )
      WHERE broadcast_retry_queue.attempt_number < $3
    `;

    try {
      const errorCode = error?.code || 'UNKNOWN_ERROR';
      const errorMessage = error?.message || 'Unknown error';
      await getPool().query(query, [
        broadcastId,
        userId,
        maxRetries,
        initialDelay,
        backoffMultiplier,
        errorCode,
        errorMessage
      ]);
      logger.info(`Queued for retry: broadcast=${broadcastId}, user=${userId}`);
    } catch (error) {
      logger.error(`Error queueing retry:`, error);
    }
  }

  /**
   * Get retries due for processing
   * @returns {Promise<Array>} Retries ready to be processed
   */
  async getRetriesDue() {
    const query = `
      SELECT *
      FROM broadcast_retry_queue
      WHERE status = 'pending'
      AND next_retry_at <= NOW()
      AND attempt_number < max_attempts
      ORDER BY next_retry_at ASC
      LIMIT 100
    `;

    try {
      const result = await getPool().query(query);
      return result.rows;
    } catch (error) {
      logger.error('Error getting retries due:', error);
      throw error;
    }
  }

  /**
   * Mark retry as successful
   * @param {string} retryId - Retry queue ID
   */
  async markRetrySuccessful(retryId) {
    const query = `
      UPDATE broadcast_retry_queue
      SET status = 'succeeded'
      WHERE retry_id = $1
    `;

    try {
      await getPool().query(query, [retryId]);
      logger.info(`Retry ${retryId} marked as successful`);
    } catch (error) {
      logger.error(`Error marking retry successful:`, error);
    }
  }

  /**
   * Mark retry as failed and update for next attempt
   * @param {string} retryId - Retry queue ID
   * @param {string} errorMessage - Error message
   * @param {number} nextAttempt - Next attempt number
   * @param {number} nextDelay - Delay in seconds until next attempt
   */
  async markRetryFailed(retryId, errorMessage, nextAttempt, nextDelay = null) {
    try {
      const row = await getPool().query(
        'SELECT * FROM broadcast_retry_queue WHERE retry_id = $1',
        [retryId]
      );

      if (row.rows.length === 0) {
        throw new Error(`Retry ${retryId} not found`);
      }

      const retry = row.rows[0];
      const actualDelay = nextDelay || (retry.retry_delay_seconds * Math.pow(retry.backoff_multiplier, nextAttempt));

      if (nextAttempt >= retry.max_attempts) {
        // Max retries exceeded
        const query = `
          UPDATE broadcast_retry_queue
          SET status = 'failed', error_history = jsonb_insert(
            COALESCE(error_history, '[]'::jsonb),
            '{-1}',
            jsonb_build_object('timestamp', NOW(), 'message', $2, 'attempt', $3)
          )
          WHERE retry_id = $1
        `;
        await getPool().query(query, [retryId, errorMessage, nextAttempt]);
        logger.info(`Retry ${retryId} max attempts exceeded`);
      } else {
        // Schedule next retry
        const query = `
          UPDATE broadcast_retry_queue
          SET status = 'pending',
              attempt_number = $2,
              next_retry_at = NOW() + interval '1 second' * $3,
              last_error_message = $4,
              error_history = jsonb_insert(
                COALESCE(error_history, '[]'::jsonb),
                '{-1}',
                jsonb_build_object('timestamp', NOW(), 'message', $4, 'attempt', $2)
              )
          WHERE retry_id = $1
        `;
        await getPool().query(query, [retryId, nextAttempt, actualDelay, errorMessage]);
        logger.info(`Retry ${retryId} scheduled for next attempt in ${actualDelay} seconds`);
      }
    } catch (error) {
      logger.error(`Error marking retry failed:`, error);
    }
  }
}

module.exports = new BroadcastEnhancements();
