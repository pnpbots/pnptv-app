/**
 * Broadcast Service
 * Handles broadcast creation, scheduling, and delivery with S3 media support
 */

const { getPool } = require('../../config/postgres');
const logger = require('../../utils/logger');
const userService = require('./userService');
const { v4: uuidv4 } = require('uuid');

class BroadcastService {
  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getTelegramRetryAfterSeconds(error) {
    return error?.parameters?.retry_after
      || error?.response?.parameters?.retry_after
      || error?.response?.parameters?.retryAfter
      || null;
  }

  classifyTelegramSendError(error) {
    const description = error?.response?.description || error?.description || error?.message || '';
    const lower = description.toLowerCase();

    if (error?.code === 429 || lower.includes('too many requests')) {
      return { status: 'retry', reason: 'rate_limited', description };
    }
    if (lower.includes('bot was blocked') || lower.includes('blocked by the user')) {
      return { status: 'blocked', reason: 'blocked', description };
    }
    if (lower.includes('user is deactivated') || lower.includes('deactivated user')) {
      return { status: 'deactivated', reason: 'deactivated', description };
    }
    if (lower.includes('chat not found')) {
      return { status: 'failed', reason: 'chat_not_found', description };
    }
    return { status: 'failed', reason: 'unknown', description };
  }
  /**
   * Create a new broadcast
   * @param {Object} broadcastData - Broadcast configuration
   * @returns {Promise<Object>} Created broadcast
   */
  async createBroadcast(broadcastData) {
    const {
      adminId,
      adminUsername,
      title,
      messageEn,
      messageEs,
      targetType = 'all',
      mediaType = null,
      mediaUrl = null,
      mediaFileId = null,
      scheduledAt = null,
      timezone = 'UTC',
      includeFilters = {},
      excludeUserIds = [],
    } = broadcastData;

    const query = `
      INSERT INTO broadcasts (
        broadcast_id, admin_id, admin_username, title,
        message_en, message_es, target_type,
        media_type, media_url, media_file_id,
        scheduled_at, timezone, include_filters, exclude_user_ids,
        status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      ) RETURNING *
    `;

    const broadcastId = uuidv4();
    const status = scheduledAt ? 'scheduled' : 'pending';

    try {
      const result = await getPool().query(query, [
        broadcastId,
        adminId,
        adminUsername,
        title,
        messageEn,
        messageEs,
        targetType,
        mediaType,
        mediaUrl,
        mediaFileId,
        scheduledAt,
        timezone,
        JSON.stringify(includeFilters),
        excludeUserIds,
        status,
      ]);

      logger.info(`Broadcast created: ${broadcastId} by ${adminUsername}`);
      return result.rows[0];
    } catch (error) {
      logger.error('Error creating broadcast:', error);
      throw error;
    }
  }

  /**
   * Create a recurring broadcast with schedule
   * @param {Object} broadcastData - Broadcast configuration with recurrence settings
   * @returns {Promise<Object>} Created broadcast with schedule
   */
  async createRecurringBroadcast(broadcastData) {
    const {
      adminId,
      adminUsername,
      title,
      messageEn,
      messageEs,
      targetType = 'all',
      mediaType = null,
      mediaUrl = null,
      mediaFileId = null,
      scheduledAt,
      timezone = 'UTC',
      isRecurring = true,
      recurrencePattern = 'daily',
      cronExpression = null,
      recurrenceEndDate = null,
      maxOccurrences = null,
      includeFilters = {},
      excludeUserIds = [],
    } = broadcastData;

    const broadcastId = uuidv4();
    const scheduleId = uuidv4();

    try {
      // Start transaction
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');

        // Create broadcast record
        const broadcastQuery = `
          INSERT INTO broadcasts (
            broadcast_id, admin_id, admin_username, title,
            message_en, message_es, target_type,
            media_type, media_url, media_file_id,
            scheduled_at, timezone, include_filters, exclude_user_ids,
            status
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
          ) RETURNING *
        `;

        const broadcastResult = await client.query(broadcastQuery, [
          broadcastId,
          adminId,
          adminUsername,
          title,
          messageEn,
          messageEs,
          targetType,
          mediaType,
          mediaUrl,
          mediaFileId,
          scheduledAt,
          timezone,
          JSON.stringify(includeFilters),
          excludeUserIds,
          'scheduled',
        ]);

        // Create schedule record
        const scheduleQuery = `
          INSERT INTO broadcast_schedules (
            schedule_id, broadcast_id, scheduled_for, timezone,
            is_recurring, recurrence_pattern, cron_expression,
            recurrence_end_date, max_occurrences, next_execution_at, status
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
          ) RETURNING *
        `;

        const scheduleResult = await client.query(scheduleQuery, [
          scheduleId,
          broadcastId,
          scheduledAt,
          timezone,
          isRecurring,
          recurrencePattern,
          cronExpression,
          recurrenceEndDate,
          maxOccurrences,
          scheduledAt, // next_execution_at starts as the scheduled time
          'scheduled',
        ]);

        await client.query('COMMIT');

        logger.info(`Recurring broadcast created: ${broadcastId} with schedule ${scheduleId}`, {
          pattern: recurrencePattern,
          maxOccurrences,
          adminUsername,
        });

        return {
          ...broadcastResult.rows[0],
          schedule: scheduleResult.rows[0],
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error creating recurring broadcast:', error);
      throw error;
    }
  }

  /**
   * Get pending recurring broadcast schedules
   * @returns {Promise<Array>} List of pending recurring schedules
   */
  async getPendingRecurringSchedules() {
    const query = `
      SELECT
        bs.*,
        b.broadcast_id
      FROM broadcast_schedules bs
      JOIN broadcasts b ON bs.broadcast_id = b.broadcast_id
      WHERE bs.status = 'scheduled'
        AND bs.next_execution_at <= CURRENT_TIMESTAMP
      ORDER BY bs.next_execution_at ASC
    `;

    try {
      const result = await getPool().query(query);
      return result.rows;
    } catch (error) {
      logger.error('Error getting pending recurring schedules:', error);
      throw error;
    }
  }

  /**
   * Update schedule after execution
   * @param {string} scheduleId - Schedule ID
   * @param {Date} nextExecution - Next execution time (null if completed)
   * @param {string} status - New status
   */
  async updateScheduleExecution(scheduleId, nextExecution, status = 'scheduled') {
    const query = `
      UPDATE broadcast_schedules
      SET
        executed_at = CURRENT_TIMESTAMP,
        current_occurrence = current_occurrence + 1,
        next_execution_at = $1,
        status = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE schedule_id = $3
      RETURNING *
    `;

    try {
      const result = await getPool().query(query, [nextExecution, status, scheduleId]);
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating schedule execution:', error);
      throw error;
    }
  }

  /**
   * Calculate next execution time for recurring schedule
   * @param {Object} schedule - Schedule record
   * @returns {Date|null} Next execution time or null if limit reached
   */
  calculateNextExecution(schedule) {
    const {
      recurrence_pattern,
      cron_expression,
      recurrence_end_date,
      max_occurrences,
      current_occurrence,
      next_execution_at,
    } = schedule;

    // Check if max occurrences reached
    if (max_occurrences && current_occurrence >= max_occurrences) {
      return null;
    }

    const lastExecution = new Date(next_execution_at);
    let nextExecution;

    switch (recurrence_pattern) {
      case 'daily':
        nextExecution = new Date(lastExecution);
        nextExecution.setDate(nextExecution.getDate() + 1);
        break;

      case 'weekly':
        nextExecution = new Date(lastExecution);
        nextExecution.setDate(nextExecution.getDate() + 7);
        break;

      case 'monthly':
        nextExecution = new Date(lastExecution);
        nextExecution.setMonth(nextExecution.getMonth() + 1);
        break;

      case 'custom':
        // Custom cron expressions - use cron-parser if available
        try {
          const cronParser = require('cron-parser');
          const interval = cronParser.parseExpression(cron_expression, {
            currentDate: lastExecution,
          });
          nextExecution = interval.next().toDate();
        } catch (error) {
          logger.warn('Custom cron pattern parsing failed:', error.message);
          return null;
        }
        break;

      default:
        return null;
    }

    // Check if end date exceeded
    if (recurrence_end_date) {
      const endDate = new Date(recurrence_end_date);
      if (nextExecution > endDate) {
        return null;
      }
    }

    return nextExecution;
  }

  /**
   * Get all scheduled broadcasts (including recurring)
   * @param {number} limit - Number of results
   * @param {number} offset - Offset for pagination
   * @returns {Promise<Array>} List of scheduled broadcasts with their schedules
   */
  async getScheduledBroadcasts(limit = 50, offset = 0) {
    const query = `
      SELECT
        b.*,
        bs.schedule_id,
        bs.is_recurring,
        bs.recurrence_pattern,
        bs.next_execution_at,
        bs.current_occurrence,
        bs.max_occurrences,
        bs.status as schedule_status
      FROM broadcasts b
      LEFT JOIN broadcast_schedules bs ON b.broadcast_id = bs.broadcast_id
      WHERE b.status IN ('scheduled', 'pending')
      ORDER BY COALESCE(bs.next_execution_at, b.scheduled_at) ASC
      LIMIT $1 OFFSET $2
    `;

    try {
      const result = await getPool().query(query, [limit, offset]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting scheduled broadcasts:', error);
      throw error;
    }
  }

  /**
   * Cancel a recurring schedule
   * @param {string} scheduleId - Schedule ID
   * @param {string} cancelledBy - User who cancelled
   * @returns {Promise<Object>} Updated schedule
   */
  async cancelSchedule(scheduleId, cancelledBy) {
    const query = `
      UPDATE broadcast_schedules
      SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
      WHERE schedule_id = $1
      RETURNING *
    `;

    try {
      const result = await getPool().query(query, [scheduleId]);
      if (result.rows.length === 0) {
        throw new Error('Schedule not found');
      }
      logger.info(`Schedule ${scheduleId} cancelled by ${cancelledBy}`);
      return result.rows[0];
    } catch (error) {
      logger.error('Error cancelling schedule:', error);
      throw error;
    }
  }



  /**
   * Get target users for broadcast based on target type and filters
   * @param {string} targetType - Target audience type
   * @param {Array} excludeUserIds - User IDs to exclude
   * @returns {Promise<Array>} List of target users
   */
  async getTargetUsers(targetType, excludeUserIds = [], includeFilters = {}) {
    try {
      const filters = typeof includeFilters === 'string'
        ? (() => { try { return JSON.parse(includeFilters); } catch (e) { return {}; } })()
        : (includeFilters || {});

      if (targetType === 'payment_incomplete') {
        const sinceDays = filters.paymentIncompleteDays ?? null;
        const params = [];
        let query = `
          WITH latest_payments AS (
            SELECT DISTINCT ON (p.user_id) p.user_id, p.status, p.created_at
            FROM payments p
            ${sinceDays ? 'WHERE p.created_at >= NOW() - ($1 || \' days\')::interval' : ''}
            ORDER BY p.user_id, p.created_at DESC
          )
          SELECT u.id, u.language, u.subscription_status
          FROM users u
          INNER JOIN latest_payments lp ON lp.user_id = u.id
          WHERE lp.status IN ('pending', 'processing', 'failed', 'cancelled', 'expired')
        `;

        if (sinceDays) {
          params.push(Number(sinceDays));
        }

        if (excludeUserIds.length > 0) {
          const offset = params.length;
          query += ` AND u.id NOT IN (${excludeUserIds.map((_, i) => `$${offset + i + 1}`).join(',')})`;
          params.push(...excludeUserIds);
        }

        query += " AND u.id != '1087968824'";

        const result = await getPool().query(query, params);
        logger.info(`Found ${result.rows.length} target users for broadcast (type: ${targetType})`);
        return result.rows;
      }

      let query = 'SELECT id, language, subscription_status FROM users WHERE 1=1';
      const params = [];

      // Filter by target type
      if (targetType === 'premium') {
        query += ' AND LOWER(COALESCE(subscription_status, \'\')) IN ($1, $2, $3)';
        params.push('active', 'prime', 'trial');
      } else if (targetType === 'free') {
        query += ' AND (subscription_status IS NULL OR LOWER(subscription_status) = $1)';
        params.push('free');
      } else if (targetType === 'churned') {
        query += ' AND LOWER(subscription_status) = $1';
        params.push('churned');
      }

      // Exclude specific users
      if (excludeUserIds.length > 0) {
        query += ` AND id NOT IN (${excludeUserIds.map((_, i) => `$${params.length + i + 1}`).join(',')})`;
        params.push(...excludeUserIds);
      }

      // Exclude bots (known bot IDs)
      query += " AND id != '1087968824'"; // GroupAnonymousBot

      const result = await getPool().query(query, params);

      logger.info(`Found ${result.rows.length} target users for broadcast (type: ${targetType})`);
      return result.rows;
    } catch (error) {
      logger.error('Error getting target users:', error);
      throw error;
    }
  }

  /**
   * Send broadcast to users
   * @param {Object} bot - Telegram bot instance
   * @param {string} broadcastId - Broadcast ID
   * @returns {Promise<Object>} Broadcast results
   */
  async sendBroadcast(bot, broadcastId) {
    try {
      // Get broadcast details
      const broadcastQuery = 'SELECT * FROM broadcasts WHERE broadcast_id = $1';
      const broadcastResult = await getPool().query(broadcastQuery, [broadcastId]);

      if (broadcastResult.rows.length === 0) {
        throw new Error(`Broadcast not found: ${broadcastId}`);
      }

      const broadcast = broadcastResult.rows[0];

      // Check if broadcast is already being processed or completed (idempotency check)
      if (broadcast.status === 'sending' || broadcast.status === 'completed') {
        logger.warn(`Broadcast ${broadcastId} is already ${broadcast.status}, skipping duplicate execution`);
        return {
          total: broadcast.total_recipients || 0,
          sent: broadcast.sent_count || 0,
          failed: broadcast.failed_count || 0,
          blocked: broadcast.blocked_count || 0,
          deactivated: broadcast.deactivated_count || 0,
          errors: broadcast.error_count || 0,
          duplicate: true,
        };
      }

      // Update status to sending
      await getPool().query(
        'UPDATE broadcasts SET status = $1, started_at = CURRENT_TIMESTAMP WHERE broadcast_id = $2',
        ['sending', broadcastId]
      );

      // Get target users
      const targetUsers = await this.getTargetUsers(
        broadcast.target_type,
        broadcast.exclude_user_ids || [],
        broadcast.include_filters || {}
      );

      const stats = {
        total: targetUsers.length,
        sent: 0,
        failed: 0,
        blocked: 0,
        deactivated: 0,
        errors: 0,
      };

      // Update total recipients
      await getPool().query(
        'UPDATE broadcasts SET total_recipients = $1 WHERE broadcast_id = $2',
        [stats.total, broadcastId]
      );

      logger.info(`Starting broadcast ${broadcastId} to ${stats.total} users`);

      const perRecipientDelayMs = parseInt(process.env.BROADCAST_SEND_DELAY_MS || '80', 10);
      const progressUpdateEvery = parseInt(process.env.BROADCAST_PROGRESS_EVERY || '10', 10);
      const cancellationCheckEvery = parseInt(process.env.BROADCAST_CANCELLATION_CHECK_EVERY || '25', 10);

      // Send to each user
      for (let index = 0; index < targetUsers.length; index++) {
        const user = targetUsers[index];
        try {
          // Allow cancelling mid-flight
          if (index % cancellationCheckEvery === 0) {
            const current = await this.getBroadcastById(broadcastId);
            if (current?.status === 'cancelled') {
              logger.warn(`Broadcast ${broadcastId} cancelled during send loop, stopping early`);
              break;
            }
          }

          const message = user.language === 'es' ? broadcast.message_es : broadcast.message_en;

          // Send based on media type
          let messageId = null;
          const attemptSend = async () => {
            if (broadcast.media_type && broadcast.media_url) {
              return this.sendMediaMessage(
                bot,
                user.id,
                broadcast.media_type,
                broadcast.media_url,
                message,
                broadcast.s3_key
              );
            }
            const result = await bot.telegram.sendMessage(user.id, message, { parse_mode: 'Markdown' });
            return result.message_id;
          };

          try {
            messageId = await attemptSend();
          } catch (error) {
            const classification = this.classifyTelegramSendError(error);
            if (classification.status === 'retry') {
              const retryAfterSeconds = this.getTelegramRetryAfterSeconds(error);
              const waitMs = Math.min(Math.max(retryAfterSeconds ? retryAfterSeconds * 1000 : 1500, 1000), 120000);
              logger.warn(`Rate limited, waiting ${Math.round(waitMs / 1000)}s then retrying user ${user.id}`);
              await this.sleep(waitMs);
              messageId = await attemptSend();
            } else {
              throw error;
            }
          }

          // Record successful delivery
          await this.recordRecipient(broadcastId, user.id, 'sent', {
            messageId,
            language: user.language,
            subscriptionTier: user.subscription_status,
          });

          stats.sent++;

          // Small delay to avoid rate limiting
          await this.sleep(perRecipientDelayMs);
        } catch (error) {
          const classification = this.classifyTelegramSendError(error);
          const status = classification.status === 'retry' ? 'failed' : classification.status;
          if (status === 'blocked') stats.blocked++;
          else if (status === 'deactivated') stats.deactivated++;
          else stats.errors++;
          stats.failed++;

          // Record failed delivery
          await this.recordRecipient(broadcastId, user.id, status, {
            errorCode: error.code,
            errorMessage: classification.description || error.message,
            language: user.language,
            subscriptionTier: user.subscription_status,
          });

          logger.warn(`Failed to send to user ${user.id}: ${classification.description || error.message}`);
        }

        // Update progress
        if (index % progressUpdateEvery === 0 || index === targetUsers.length - 1) {
          const progress = ((stats.sent + stats.failed) / stats.total) * 100;
          await getPool().query(
            'UPDATE broadcasts SET sent_count = $1, failed_count = $2, blocked_count = $3, deactivated_count = $4, error_count = $5, progress_percentage = $6 WHERE broadcast_id = $7',
            [stats.sent, stats.failed, stats.blocked, stats.deactivated, stats.errors, progress.toFixed(2), broadcastId]
          );
        }
      }

      // Mark broadcast as completed (or keep cancelled)
      const finalBroadcast = await this.getBroadcastById(broadcastId);
      if (finalBroadcast?.status !== 'cancelled') {
        await getPool().query(
          'UPDATE broadcasts SET status = $1, completed_at = CURRENT_TIMESTAMP WHERE broadcast_id = $2',
          ['completed', broadcastId]
        );
      }

      logger.info(`Broadcast ${broadcastId} completed: ${stats.sent} sent, ${stats.failed} failed`);

      return stats;
    } catch (error) {
      // Mark broadcast as failed
      await getPool().query(
        'UPDATE broadcasts SET status = $1 WHERE broadcast_id = $2',
        ['failed', broadcastId]
      );

      logger.error(`Error sending broadcast ${broadcastId}:`, error);
      throw error;
    }
  }

  /**
   * Send media message (photo, video, document, audio, voice)
   * @param {Object} bot - Telegram bot instance
   * @param {string} userId - User ID
   * @param {string} mediaType - Media type
   * @param {string} mediaUrl - Media URL (S3 URL or Telegram file_id)
   * @param {string} caption - Message caption
   * @param {string} s3Key - S3 key (optional, for generating presigned URLs)
   * @param {Object} sendOptions - Additional send options (optional)
   * @returns {Promise<number>} Message ID
   */
  async sendMediaMessage(bot, userId, mediaType, mediaUrl, caption, s3Key = null, sendOptions = {}) {
    const options = {
      caption,
      parse_mode: 'Markdown',
      ...sendOptions
    };

    let result;
    let urlToSend = mediaUrl;
    switch (mediaType) {
      case 'photo':
        result = await bot.telegram.sendPhoto(userId, urlToSend, options);
        break;
      case 'video':
        result = await bot.telegram.sendVideo(userId, urlToSend, options);
        break;
      case 'document':
        result = await bot.telegram.sendDocument(userId, urlToSend, options);
        break;
      case 'audio':
        result = await bot.telegram.sendAudio(userId, urlToSend, options);
        break;
      case 'voice':
        result = await bot.telegram.sendVoice(userId, urlToSend, options);
        break;
      default:
        throw new Error(`Unsupported media type: ${mediaType}`);
    }

    return result.message_id;
  }

  /**
   * Record broadcast recipient delivery status
   * @param {string} broadcastId - Broadcast ID
   * @param {string} userId - User ID
   * @param {string} status - Delivery status
   * @param {Object} metadata - Additional metadata
   */
  async recordRecipient(broadcastId, userId, status, metadata = {}) {
    const query = `
      INSERT INTO broadcast_recipients (
        broadcast_id, user_id, status, message_id,
        language, subscription_tier, error_code, error_message, sent_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (broadcast_id, user_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        message_id = EXCLUDED.message_id,
        sent_at = EXCLUDED.sent_at,
        error_code = EXCLUDED.error_code,
        error_message = EXCLUDED.error_message
    `;

    try {
      await getPool().query(query, [
        broadcastId,
        userId,
        status,
        metadata.messageId || null,
        metadata.language || 'en',
        metadata.subscriptionTier || 'free',
        metadata.errorCode || null,
        metadata.errorMessage || null,
        status === 'sent' ? new Date() : null,
      ]);
    } catch (error) {
      logger.error('Error recording recipient:', error);
    }
  }

  /**
   * Get broadcast by ID
   * @param {string} broadcastId - Broadcast ID
   * @returns {Promise<Object>} Broadcast data
   */
  async getBroadcastById(broadcastId) {
    const query = 'SELECT * FROM broadcasts WHERE broadcast_id = $1';

    try {
      const result = await getPool().query(query, [broadcastId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting broadcast:', error);
      throw error;
    }
  }

  /**
   * Get broadcast statistics
   * @param {string} broadcastId - Broadcast ID
   * @returns {Promise<Object>} Broadcast statistics
   */
  async getBroadcastStats(broadcastId) {
    const query = `
      SELECT
        b.*,
        COUNT(br.id) as total_tracked,
        COUNT(CASE WHEN br.status = 'sent' THEN 1 END) as recipients_sent,
        COUNT(CASE WHEN br.status = 'failed' THEN 1 END) as recipients_failed,
        COUNT(CASE WHEN br.status = 'blocked' THEN 1 END) as recipients_blocked
      FROM broadcasts b
      LEFT JOIN broadcast_recipients br ON b.broadcast_id = br.broadcast_id
      WHERE b.broadcast_id = $1
      GROUP BY b.broadcast_id
    `;

    try {
      const result = await getPool().query(query, [broadcastId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting broadcast stats:', error);
      throw error;
    }
  }

  /**
   * Get all broadcasts (with pagination)
   * @param {number} limit - Number of results
   * @param {number} offset - Offset for pagination
   * @param {string} status - Filter by status
   * @returns {Promise<Array>} List of broadcasts
   */
  async getAllBroadcasts(limit = 50, offset = 0, status = null) {
    let query = 'SELECT * FROM broadcasts';
    const params = [];

    if (status) {
      query += ' WHERE status = $1';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    try {
      const result = await getPool().query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error getting broadcasts:', error);
      throw error;
    }
  }

  /**
   * Cancel a scheduled broadcast
   * @param {string} broadcastId - Broadcast ID
   * @param {string} cancelledBy - User who cancelled
   * @param {string} reason - Cancellation reason
   */
  async cancelBroadcast(broadcastId, cancelledBy, reason = null) {
    const query = `
      UPDATE broadcasts
      SET status = 'cancelled',
          cancelled_at = CURRENT_TIMESTAMP,
          cancelled_by = $1,
          cancellation_reason = $2
      WHERE broadcast_id = $3 AND status IN ('pending', 'scheduled')
      RETURNING *
    `;

    try {
      const result = await getPool().query(query, [cancelledBy, reason, broadcastId]);

      if (result.rows.length === 0) {
        throw new Error('Broadcast not found or cannot be cancelled');
      }

      logger.info(`Broadcast ${broadcastId} cancelled by ${cancelledBy}`);
      return result.rows[0];
    } catch (error) {
      logger.error('Error cancelling broadcast:', error);
      throw error;
    }
  }

  /**
   * Get pending scheduled broadcasts (for scheduler to process)
   * @returns {Promise<Array>} List of pending broadcasts
   */
  async getPendingScheduledBroadcasts() {
    const query = `
      SELECT * FROM broadcasts
      WHERE status = 'scheduled'
        AND scheduled_at <= CURRENT_TIMESTAMP
      ORDER BY scheduled_at ASC
    `;

    try {
      const result = await getPool().query(query);
      return result.rows;
    } catch (error) {
      logger.error('Error getting pending scheduled broadcasts:', error);
      throw error;
    }
  }

  /**
   * Process retry queue for failed broadcasts
   * @param {Object} bot - Telegraf bot instance
   * @returns {Promise<Object>} Processing results
   */
  async processRetryQueue(bot) {
    const query = `
      SELECT * FROM broadcast_recipients
      WHERE status = 'failed'
        AND retry_count < 3
        AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'
      ORDER BY created_at ASC
      LIMIT 10
    `;

    try {
      const result = await getPool().query(query);
      const failedRecipients = result.rows;
      
      let processed = 0;
      let succeeded = 0;
      let failed = 0;

      for (const recipient of failedRecipients) {
        try {
          // Get broadcast details
          const broadcastQuery = `
            SELECT * FROM broadcasts WHERE broadcast_id = $1
          `;
          const broadcastResult = await getPool().query(broadcastQuery, [recipient.broadcast_id]);
          
          if (broadcastResult.rows.length === 0) {
            // Broadcast doesn't exist, mark as failed
            await this._updateRecipientStatus(recipient.id, 'failed', {
              error_code: 'BROADCAST_NOT_FOUND'
            });
            failed++;
            continue;
          }

          const broadcast = broadcastResult.rows[0];
          const userId = recipient.user_id;
          
          // Try to send the broadcast again
          const sendOptions = {
            parse_mode: 'Markdown',
            disable_web_page_preview: true
          };

          let messageId;
          if (broadcast.media_type && broadcast.media_file_id) {
            // Media broadcast
            messageId = await this._sendMediaBroadcast(bot, userId, broadcast, sendOptions);
          } else {
            // Text-only broadcast
            const text = broadcast.message_en || broadcast.message_es;
            const sentMessage = await bot.telegram.sendMessage(userId, text, sendOptions);
            messageId = sentMessage.message_id;
          }

          // Update status to succeeded
          await this._updateRecipientStatus(recipient.id, 'succeeded', {
            message_id: messageId,
            retry_count: recipient.retry_count + 1
          });
          succeeded++;
          
        } catch (error) {
          logger.warn(`Retry failed for recipient ${recipient.id}: ${error.message}`);
          
          // Update status with error
          await this._updateRecipientStatus(recipient.id, 'failed', {
            error_code: 'RETRY_FAILED',
            error_message: error.message,
            retry_count: recipient.retry_count + 1
          });
          failed++;
        }
        
        processed++;
        await this.sleep(100); // Rate limiting
      }

      return { processed, succeeded, failed };
      
    } catch (error) {
      logger.error('Error processing retry queue:', error);
      throw error;
    }
  }

  /**
   * Update recipient status in database
   * @param {string} recipientId - Recipient ID
   * @param {string} status - New status
   * @param {Object} updates - Additional updates
   */
  async _updateRecipientStatus(recipientId, status, updates = {}) {
    const updateQuery = `
      UPDATE broadcast_recipients
      SET 
        status = $1,
        updated_at = CURRENT_TIMESTAMP,
        ${Object.keys(updates).map((key, i) => `${key} = $${i + 2}`).join(', ')}
      WHERE id = $${Object.keys(updates).length + 2}
    `;

    const params = [status, ...Object.values(updates), recipientId];
    await getPool().query(updateQuery, params);
  }
}

module.exports = BroadcastService;
