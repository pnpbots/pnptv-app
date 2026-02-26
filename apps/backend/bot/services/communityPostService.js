/**
 * Community Post Service
 * Handles creation, scheduling, and delivery of community group posts
 */

const db = require('../../utils/db');
const logger = require('../../utils/logger');
const s3Service = require('../../utils/s3Service');
const { Markup } = require('telegraf');

class CommunityPostService {
  /**
   * Create a new community post
   * @param {Object} postData - Post data
   * @returns {Promise<Object>} Created post object
   */
  async createCommunityPost(postData) {
    try {
      const {
        adminId,
        adminUsername,
        title,
        messageEn,
        messageEs,
        mediaType = null,
        mediaUrl = null,
        s3Key = null,
        s3Bucket = null,
        telegramFileId = null,
        targetGroupIds = [],
        targetChannelIds = [],
        targetAllGroups = false,
        postToPrimeChannel = false,
        templateType = 'standard',
        buttonLayout = 'single_row',
        scheduledAt = null,
        timezone = 'UTC',
        isRecurring = false,
        recurrencePattern = null,
        cronExpression = null,
        recurrenceEndDate = null,
        maxOccurrences = null,
        status = 'draft',
        scheduledCount = 0,
      } = postData;

      const query = `
        INSERT INTO community_posts (
          admin_id, admin_username, title, message_en, message_es,
          media_type, media_url, s3_key, s3_bucket, telegram_file_id,
          target_group_ids, target_channel_ids, target_all_groups, post_to_prime_channel,
          formatted_template_type, button_layout,
          scheduled_at, timezone,
          is_recurring, recurrence_pattern, cron_expression, recurrence_end_date, max_occurrences,
          status, scheduled_count
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
        RETURNING *;
      `;

      const values = [
        adminId,
        adminUsername,
        title,
        messageEn,
        messageEs,
        mediaType,
        mediaUrl,
        s3Key,
        s3Bucket,
        telegramFileId,
        targetGroupIds,
        targetChannelIds,
        targetAllGroups,
        postToPrimeChannel,
        templateType,
        buttonLayout,
        scheduledAt,
        timezone,
        isRecurring,
        recurrencePattern,
        cronExpression,
        recurrenceEndDate,
        maxOccurrences,
        status,
        scheduledCount,
      ];

      const result = await db.query(query, values);
      logger.info('Community post created', { postId: result.rows[0].post_id });
      return result.rows[0];
    } catch (error) {
      logger.error('Error creating community post:', error);
      throw error;
    }
  }

  /**
   * Get all active community groups
   * @param {boolean} activeOnly - Only return active groups
   * @returns {Promise<Array>} Array of groups
   */
  async getCommunityGroups(activeOnly = true) {
    try {
      const query = activeOnly
        ? `SELECT * FROM community_groups WHERE is_active = true ORDER BY display_order ASC`
        : `SELECT * FROM community_groups ORDER BY display_order ASC`;

      const result = await db.query(query);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching community groups:', error);
      throw error;
    }
  }

  /**
   * Get community group by ID
   * @param {string} groupId - Group UUID
   * @returns {Promise<Object>} Group object
   */
  async getCommunityGroupById(groupId) {
    try {
      const query = `SELECT * FROM community_groups WHERE group_id = $1`;
      const result = await db.query(query, [groupId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error fetching community group:', error);
      throw error;
    }
  }

  /**
   * Add buttons to a post
   * @param {string} postId - Post UUID
   * @param {Array} buttons - Array of button objects
   * @returns {Promise<Array>} Created buttons
   */
  async addButtonsToPost(postId, buttons) {
    try {
      const query = `
        INSERT INTO community_post_buttons (
          post_id, button_type, button_label, target_url, icon_emoji, button_order
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *;
      `;

      const createdButtons = [];
      for (let i = 0; i < buttons.length; i++) {
        const button = buttons[i];
        const result = await db.query(query, [
          postId,
          button.buttonType,
          button.label,
          button.targetUrl || null,
          button.icon || null,
          i,
        ]);
        createdButtons.push(result.rows[0]);
      }

      logger.info('Buttons added to post', { postId, count: createdButtons.length });
      return createdButtons;
    } catch (error) {
      logger.error('Error adding buttons to post:', error);
      throw error;
    }
  }

  /**
   * Get buttons for a post
   * @param {string} postId - Post UUID
   * @returns {Promise<Array>} Array of buttons
   */
  async getButtonsForPost(postId) {
    try {
      const query = `
        SELECT * FROM community_post_buttons
        WHERE post_id = $1
        ORDER BY button_order ASC
      `;
      const result = await db.query(query, [postId]);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching buttons for post:', error);
      throw error;
    }
  }

  /**
   * Create schedules for a post
   * @param {string} postId - Post UUID
   * @param {Array} scheduledTimes - Array of timestamps
   * @param {Object} recurrenceConfig - Recurrence configuration
   * @returns {Promise<Array>} Created schedules
   */
  async schedulePost(postId, scheduledTimes = [], recurrenceConfig = {}) {
    try {
      const schedules = [];

      // If recurring, create single schedule with recurrence pattern
      if (recurrenceConfig.isRecurring && scheduledTimes.length > 0) {
        const query = `
          INSERT INTO community_post_schedules (
            post_id, scheduled_for, timezone,
            is_recurring, recurrence_pattern, cron_expression,
            status, execution_order
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *;
        `;

        for (let i = 0; i < scheduledTimes.length; i++) {
          const result = await db.query(query, [
            postId,
            scheduledTimes[i],
            recurrenceConfig.timezone || 'UTC',
            true,
            recurrenceConfig.recurrencePattern || 'daily',
            recurrenceConfig.cronExpression || null,
            'scheduled',
            i + 1,
          ]);
          schedules.push(result.rows[0]);
        }
      } else {
        // Non-recurring: create separate schedule for each time
        const query = `
          INSERT INTO community_post_schedules (
            post_id, scheduled_for, timezone,
            is_recurring, status, execution_order
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING *;
        `;

        for (let i = 0; i < scheduledTimes.length; i++) {
          const result = await db.query(query, [
            postId,
            scheduledTimes[i],
            recurrenceConfig.timezone || 'UTC',
            false,
            'scheduled',
            i + 1,
          ]);
          schedules.push(result.rows[0]);
        }
      }

      logger.info('Post scheduled', { postId, scheduleCount: schedules.length });
      return schedules;
    } catch (error) {
      logger.error('Error scheduling post:', error);
      throw error;
    }
  }

  /**
   * Get pending posts ready for execution
   * @returns {Promise<Array>} Array of pending posts
   */
  async getPendingPosts() {
    try {
      const query = `
        SELECT
          p.*,
          s.schedule_id,
          s.execution_order,
          s.next_execution_at
        FROM community_posts p
        JOIN community_post_schedules s ON p.post_id = s.post_id
        WHERE s.status = 'scheduled'
        AND s.scheduled_for <= NOW()
        AND p.status IN ('scheduled', 'sending')
        ORDER BY s.execution_order ASC
        LIMIT 10;
      `;

      const result = await db.query(query);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching pending posts:', error);
      throw error;
    }
  }

  /**
   * Get all scheduled posts with optional filters
   * @param {Object} filters - Optional filters (e.g., status, adminId, startDate, endDate, limit, offset)
   * @returns {Promise<Object>} Object with posts and total count
   */
  async getAllScheduledPosts(filters = {}) {
    try {
      const {
        status,
        adminId,
        startDate,
        endDate,
        limit = 20,
        offset = 0,
        sortBy = 'scheduled_at',
        sortOrder = 'DESC',
      } = filters;

      let whereClauses = [];
      let queryParams = [];
      let paramIndex = 1;

      if (status) {
        whereClauses.push(`p.status = $${paramIndex++}`);
        queryParams.push(status);
      }
      if (adminId) {
        whereClauses.push(`p.admin_id = $${paramIndex++}`);
        queryParams.push(adminId);
      }
      if (startDate) {
        whereClauses.push(`p.scheduled_at >= $${paramIndex++}`);
        queryParams.push(startDate);
      }
      if (endDate) {
        whereClauses.push(`p.scheduled_at <= $${paramIndex++}`);
        queryParams.push(endDate);
      }

      const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const postsQuery = `
        SELECT
          p.*,
          array_agg(jsonb_build_object(
            'schedule_id', s.schedule_id,
            'scheduled_for', s.scheduled_for,
            'status', s.status,
            'is_recurring', s.is_recurring,
            'recurrence_pattern', s.recurrence_pattern,
            'cron_expression', s.cron_expression,
            'execution_count', s.execution_count,
            'last_executed_at', s.last_executed_at,
            'next_execution_at', s.next_execution_at,
            'error_message', s.error_message
          )) as schedules,
          array_agg(jsonb_build_object(
            'button_id', b.button_id,
            'button_label', b.button_label,
            'button_type', b.button_type,
            'target_url', b.target_url,
            'icon_emoji', b.icon_emoji,
            'button_order', b.button_order
          )) FILTER (WHERE b.button_id IS NOT NULL) as buttons
        FROM community_posts p
        LEFT JOIN community_post_schedules s ON p.post_id = s.post_id
        LEFT JOIN community_post_buttons b ON p.post_id = b.post_id
        ${whereClause}
        GROUP BY p.post_id
        ORDER BY p.${sortBy} ${sortOrder}
        LIMIT $${paramIndex++} OFFSET $${paramIndex++};
      `;

      const countQuery = `
        SELECT COUNT(DISTINCT p.post_id)
        FROM community_posts p
        LEFT JOIN community_post_schedules s ON p.post_id = s.post_id
        ${whereClause};
      `;

      const postsResult = await db.query(postsQuery, [...queryParams, limit, offset]);
      const countResult = await db.query(countQuery, queryParams);

      return {
        posts: postsResult.rows.map(row => ({
          ...row,
          // Ensure buttons and schedules are arrays even if no joins found
          buttons: row.buttons[0] === null ? [] : row.buttons,
          schedules: row.schedules[0] === null ? [] : row.schedules,
        })),
        totalCount: parseInt(countResult.rows[0].count, 10),
      };
    } catch (error) {
      logger.error('Error fetching all scheduled posts:', error);
      throw error;
    }
  }

  /**
   * Update an existing community post
   * @param {string} postId - ID of the post to update
   * @param {Object} updateData - Data to update the post with
   * @returns {Promise<Object>} Updated post object
   */
  async updateCommunityPostDetails(postId, updateData) {
    try {
      const settableFields = [
        'title', 'message_en', 'message_es', 'media_type', 'media_url', 's3_key', 's3_bucket',
        'telegram_file_id', 'target_group_ids', 'target_channel_ids', 'target_all_groups',
        'post_to_prime_channel', 'formatted_template_type', 'button_layout', 'scheduled_at',
        'timezone', 'is_recurring', 'recurrence_pattern', 'cron_expression', 'recurrence_end_date',
        'max_occurrences', 'status', 'video_file_size_mb', 'video_duration_seconds', 'uses_streaming',
      ];

      let updateClauses = [];
      let queryParams = [];
      let paramIndex = 1;

      for (const field of settableFields) {
        if (updateData[field] !== undefined) {
          updateClauses.push(`${field} = $${paramIndex++}`);
          queryParams.push(updateData[field]);
        }
      }

      if (updateClauses.length === 0) {
        logger.warn('No valid fields to update for post', { postId, updateData });
        return this.getPostWithDetails(postId); // Return current state if no updates
      }

      queryParams.push(postId); // Add postId as the last parameter

      const query = `
        UPDATE community_posts
        SET ${updateClauses.join(', ')}, updated_at = NOW()
        WHERE post_id = $${paramIndex}
        RETURNING *;
      `;

      const result = await db.query(query, queryParams);

      if (result.rows.length === 0) {
        throw new Error('Post not found or no changes made');
      }

      logger.info('Community post updated', { postId });

      // If schedules or buttons are part of update, they need separate handling
      // For schedules, we would typically delete existing and re-create if structure changes significantly
      // For buttons, update/delete existing and add new ones as necessary

      return result.rows[0];
    } catch (error) {
      logger.error('Error updating community post details:', error);
      throw error;
    }
  }

  /**
   * Delete a community post and all its associated data (schedules, buttons, deliveries).
   * @param {string} postId - ID of the post to delete
   * @returns {Promise<void>}
   */
  async deleteCommunityPost(postId) {
    try {
      // Delete associated deliveries
      await db.query(`DELETE FROM community_post_deliveries WHERE post_id = $1;`, [postId]);
      await db.query(`DELETE FROM community_post_channel_deliveries WHERE post_id = $1;`, [postId]);

      // Delete associated schedules
      await db.query(`DELETE FROM community_post_schedules WHERE post_id = $1;`, [postId]);

      // Delete associated buttons
      await db.query(`DELETE FROM community_post_buttons WHERE post_id = $1;`, [postId]);

      // Delete the post itself
      await db.query(`DELETE FROM community_posts WHERE post_id = $1;`, [postId]);

      logger.info('Community post and all associated data deleted', { postId });
    } catch (error) {
      logger.error('Error deleting community post:', error);
      throw error;
    }
  }

  /**
   * Get details of a specific post schedule.
   * @param {string} scheduleId - ID of the schedule to retrieve
   * @returns {Promise<Object|null>} Schedule object or null if not found
   */
  async getPostScheduleDetails(scheduleId) {
    try {
      const query = `
        SELECT * FROM community_post_schedules
        WHERE schedule_id = $1;
      `;
      const result = await db.query(query, [scheduleId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error fetching post schedule details:', error);
      throw error;
    }
  }

  /**
   * Update details of a specific post schedule.
   * @param {string} scheduleId - ID of the schedule to update
   * @param {Object} updateData - Data to update the schedule with
   * @returns {Promise<Object>} Updated schedule object
   */
  async updatePostSchedule(scheduleId, updateData) {
    try {
      const settableFields = [
        'scheduled_for', 'timezone', 'status', 'is_recurring', 'recurrence_pattern',
        'cron_expression', 'recurrence_end_date', 'max_occurrences', 'execution_count',
        'last_executed_at', 'next_execution_at', 'error_message',
      ];

      let updateClauses = [];
      let queryParams = [];
      let paramIndex = 1;

      for (const field of settableFields) {
        if (updateData[field] !== undefined) {
          updateClauses.push(`${field} = $${paramIndex++}`);
          queryParams.push(updateData[field]);
        }
      }

      if (updateClauses.length === 0) {
        logger.warn('No valid fields to update for schedule', { scheduleId, updateData });
        return this.getPostScheduleDetails(scheduleId); // Return current state if no updates
      }

      queryParams.push(scheduleId); // Add scheduleId as the last parameter

      const query = `
        UPDATE community_post_schedules
        SET ${updateClauses.join(', ')}, updated_at = NOW()
        WHERE schedule_id = $${paramIndex}
        RETURNING *;
      `;

      const result = await db.query(query, queryParams);

      if (result.rows.length === 0) {
        throw new Error('Schedule not found or no changes made');
      }

      logger.info('Community post schedule updated', { scheduleId });
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating post schedule:', error);
      throw error;
    }
  }

  /**
   * Manually triggers a post to be sent immediately.
   * This sets the post and its primary schedule to 'executing' and 'scheduled for now' respectively,
   * allowing the scheduler to pick it up in its next cycle.
   * @param {string} postId - The ID of the post to trigger.
   * @returns {Promise<Object>} The updated post object.
   */
  async triggerPostImmediately(postId) {
    try {
      // First, update the post status to 'sending' to indicate it's being processed
      await db.query(
        `UPDATE community_posts SET status = 'sending', updated_at = NOW() WHERE post_id = $1;`,
        [postId]
      );

      // Then, find the primary scheduled entry for this post and set its scheduled_for to NOW()
      // and status to 'scheduled' so the scheduler picks it up immediately.
      // Assuming a post can have multiple schedules, we'll pick one that is 'scheduled' or 'pending'.
      // If none, we might create a new one, but for now, we'll modify an existing one.
      const updateScheduleQuery = `
        UPDATE community_post_schedules
        SET scheduled_for = NOW(), status = 'scheduled', updated_at = NOW()
        WHERE post_id = $1 AND status IN ('scheduled', 'pending', 'paused')
        ORDER BY scheduled_for ASC
        LIMIT 1
        RETURNING *;
      `;

      const result = await db.query(updateScheduleQuery, [postId]);

      if (result.rows.length === 0) {
        // If no existing schedule was found to update, it might be a post that was already sent/failed
        // or has no schedules. For an immediate trigger, we might need to create a new schedule.
        // For simplicity, we'll log a warning for now and let the admin handle.
        logger.warn('No active schedule found to trigger immediately for post', { postId });
        throw new Error('No active schedule found for immediate triggering.');
      }

      logger.info('Post marked for immediate triggering', { postId, scheduleId: result.rows[0].schedule_id });
      return this.getPostWithDetails(postId);
    } catch (error) {
      logger.error('Error triggering post immediately:', error);
      throw error;
    }
  }




  /**
   * Get a post with all details
   * @param {string} postId - Post UUID
   * @returns {Promise<Object>} Post object with buttons and schedules
   */
  async getPostWithDetails(postId) {
    try {
      const postQuery = `SELECT * FROM community_posts WHERE post_id = $1`;
      const buttonsQuery = `SELECT * FROM community_post_buttons WHERE post_id = $1 ORDER BY button_order ASC`;
      const schedulesQuery = `SELECT * FROM community_post_schedules WHERE post_id = $1 ORDER BY execution_order ASC`;

      const [postResult, buttonsResult, schedulesResult] = await Promise.all([
        db.query(postQuery, [postId]),
        db.query(buttonsQuery, [postId]),
        db.query(schedulesQuery, [postId]),
      ]);

      if (!postResult.rows[0]) {
        return null;
      }

      return {
        ...postResult.rows[0],
        buttons: buttonsResult.rows,
        schedules: schedulesResult.rows,
      };
    } catch (error) {
      logger.error('Error fetching post with details:', error);
      throw error;
    }
  }

  /**
   * Format message based on template type
   * @param {string} templateType - Template type
   * @param {string} messageText - Message text
   * @param {string} title - Optional title
   * @param {string} mediaType - Optional media type
   * @returns {string} Formatted message
   */
  formatMessage(templateType, messageText, title = null, mediaType = null) {
    let formatted = '';

    switch (templateType) {
      case 'featured':
        formatted = `━━━━━━━━━━━━━━━━━\n✨ ${title || 'Featured Post'}\n━━━━━━━━━━━━━━━━━\n\n*${messageText}*\n\n`;
        break;

      case 'announcement':
        formatted = `📢 *ANNOUNCEMENT*\n\n*${title || 'Important Update'}*\n\n${messageText}\n\n`;
        break;

      case 'event':
        formatted = `🎪 *EVENT*\n\n*${title || 'Event'}*\n\n${messageText}\n\n`;
        break;

      case 'standard':
      default:
        formatted = messageText + '\n\n';
    }

    return formatted;
  }

  /**
   * Build inline keyboard for buttons
   * @param {Array} buttons - Array of button objects
   * @returns {Object} Telegraf Markup keyboard
   */
  buildButtonKeyboard(buttons) {
    if (!buttons || buttons.length === 0) {
      return Markup.inlineKeyboard([]);
    }

    // Group buttons based on layout
    const keyboard = [];
    let currentRow = [];

    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i];
      const url = button.target_url || `https://t.me/pnptvbot?start=${button.button_type}`;

      currentRow.push(
        Markup.button.url(
          `${button.icon_emoji || '🔗'} ${button.button_label}`,
          url
        )
      );

      // Add max 2 buttons per row for better mobile UX
      if (currentRow.length === 2 || i === buttons.length - 1) {
        keyboard.push(currentRow);
        currentRow = [];
      }
    }

    return Markup.inlineKeyboard(keyboard);
  }

  /**
   * Send post to a single group
   * @param {Object} post - Post object with details
   * @param {Object} group - Group object
   * @param {Object} bot - Telegraf bot instance
   * @param {string} messageLanguage - 'en' or 'es'
   * @returns {Promise<Object>} Delivery result
   */
  async sendPostToGroup(post, group, bot, messageLanguage = 'en') {
    try {
      let message = this.formatMessage(
        post.formatted_template_type,
        messageLanguage === 'es' ? post.message_es : post.message_en,
        post.title,
        post.media_type
      );

      const buttons = await this.getButtonsForPost(post.post_id);
      const markup = this.buildButtonKeyboard(buttons);

      let messageId = null;
      const options = {
        parse_mode: 'Markdown',
        ...markup,
      };

      try {
        // Send media if present
        if (post.media_type === 'photo' && (post.telegram_file_id || post.media_url)) {
          const response = await bot.telegram.sendPhoto(
            group.telegram_group_id,
            post.telegram_file_id || post.media_url,
            { ...options, caption: message }
          );
          messageId = response.message_id;
        } else if (post.media_type === 'video' && (post.telegram_file_id || post.media_url)) {
          const response = await bot.telegram.sendVideo(
            group.telegram_group_id,
            post.telegram_file_id || post.media_url,
            { ...options, caption: message }
          );
          messageId = response.message_id;
        } else {
          // Text-only message
          const response = await bot.telegram.sendMessage(
            group.telegram_group_id,
            message,
            options
          );
          messageId = response.message_id;
        }

        // Log successful delivery
        await this.logDelivery(post.post_id, group.group_id, 'sent', messageId);

        return {
          success: true,
          messageId,
          groupId: group.group_id,
        };
      } catch (telegramError) {
        logger.error('Telegram send error', {
          groupId: group.group_id,
          error: telegramError.message
        });
        await this.logDelivery(post.post_id, group.group_id, 'failed', null, telegramError.message);

        return {
          success: false,
          groupId: group.group_id,
          error: telegramError.message,
        };
      }
    } catch (error) {
      logger.error('Error sending post to group:', error);
      throw error;
    }
  }

  /**
   * Send post to multiple channels
   * @param {Object} post - Post object with details
   * @param {Array} channelIds - Array of channel Telegram IDs
   * @param {Object} bot - Telegraf bot instance
   * @returns {Promise<Object>} Results summary
   */
  async sendPostToChannels(post, channelIds, bot) {
    try {
      const results = {
        successful: 0,
        failed: 0,
        total: channelIds.length,
        details: [],
      };

      for (const channelId of channelIds) {
        try {
          const result = await this.sendPostToChannel(post, bot, channelId, 'en');
          results.details.push(result);

          if (result.success) {
            results.successful++;
          } else {
            results.failed++;
          }
        } catch (error) {
          logger.error('Error sending post to channel:', { channelId, error: error.message });
          results.failed++;
          results.details.push({ success: false, channelId, error: error.message });
        }
      }

      logger.info('Batch send to channels complete', {
        postId: post.post_id,
        results,
      });

      return results;
    } catch (error) {
      logger.error('Error sending post to channels:', error);
      throw error;
    }
  }

  /**
   * Send post to a single channel
   * @param {Object} post - Post object with details
   * @param {Object} bot - Telegraf bot instance
   * @param {string} channelId - Telegram channel ID
   * @param {string} messageLanguage - 'en' or 'es'
   * @returns {Promise<Object>} Send result
   */
  async sendPostToChannel(post, bot, channelId, messageLanguage = 'en') {
    try {
      logger.info('Sending post to channel', { postId: post.post_id, channelId });

      let message = this.formatMessage(
        post.formatted_template_type,
        messageLanguage === 'es' ? post.message_es : post.message_en,
        post.title,
        post.media_type
      );

      const buttons = await this.getButtonsForPost(post.post_id);
      const markup = this.buildButtonKeyboard(buttons);

      let messageId = null;
      const options = {
        parse_mode: 'Markdown',
        ...(markup ? { reply_markup: markup } : {}),
      };

      // Send appropriate media type or text
      if (post.media_type === 'photo' && post.telegram_file_id) {
        const response = await bot.telegram.sendPhoto(channelId, post.telegram_file_id, {
          caption: message,
          ...options,
        });
        messageId = response.message_id;
      } else if (post.media_type === 'video' && post.telegram_file_id) {
        const response = await bot.telegram.sendVideo(channelId, post.telegram_file_id, {
          caption: message,
          ...options,
        });
        messageId = response.message_id;
      } else {
        // Text-only message
        const response = await bot.telegram.sendMessage(channelId, message, options);
        messageId = response.message_id;
      }

      await this.logChannelDelivery(post.post_id, channelId, 'sent', messageId);

      logger.info('Post sent to channel', { postId: post.post_id, channelId, messageId });

      return {
        success: true,
        channelId,
        messageId,
        postId: post.post_id,
      };
    } catch (error) {
      logger.error('Error sending post to channel:', { postId: post.post_id, channelId, error: error.message });
      await this.logChannelDelivery(post.post_id, channelId, 'failed', null, error.message);
      return {
        success: false,
        channelId,
        error: error.message,
        postId: post.post_id,
      };
    }
  }

  /**
   * Send post to multiple groups
   * @param {Object} post - Post object
   * @param {Array} groups - Array of group objects
   * @param {Object} bot - Telegraf bot instance
   * @returns {Promise<Object>} Results summary
   */
  async sendPostToGroups(post, groups, bot) {
    try {
      const results = {
        successful: 0,
        failed: 0,
        total: groups.length,
        details: [],
      };

      for (const group of groups) {
        const result = await this.sendPostToGroup(post, group, bot, 'en');
        results.details.push(result);

        if (result.success) {
          results.successful++;
        } else {
          results.failed++;
        }
      }

      // Update post sent/failed counts
      await this.updatePostStatus(post.post_id, 'sent', results.successful, results.failed);

      logger.info('Batch send complete', {
        postId: post.post_id,
        results,
      });

      return results;
    } catch (error) {
      logger.error('Error sending post to groups:', error);
      throw error;
    }
  }

  /**
   * Log post delivery
   * @param {string} postId - Post UUID
   * @param {string} groupId - Group UUID
   * @param {string} status - Delivery status
   * @param {string} messageId - Telegram message ID
   * @param {string} errorMessage - Optional error message
   */
  async logDelivery(postId, groupId, status, messageId = null, errorMessage = null) {
    try {
      const query = `
        INSERT INTO community_post_deliveries (
          post_id, group_id, status, message_id, error_message, sent_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT DO NOTHING;
      `;

      await db.query(query, [
        postId,
        groupId,
        status,
        messageId,
        errorMessage,
        status === 'sent' ? new Date() : null,
      ]);
    } catch (error) {
      logger.error('Error logging delivery:', error);
      // Don't throw - logging failures shouldn't break main flow
    }
  }

  /**
   * Update post status and counts
   * @param {string} postId - Post UUID
   * @param {string} status - New status
   * @param {number} sentCount - Number of successful sends
   * @param {number} failedCount - Number of failed sends
   */
  async updatePostStatus(postId, status, sentCount = 0, failedCount = 0) {
    try {
      const query = `
        UPDATE community_posts
        SET status = $1, sent_count = sent_count + $2, failed_count = failed_count + $3, updated_at = NOW()
        WHERE post_id = $4;
      `;

      await db.query(query, [status, sentCount, failedCount, postId]);
    } catch (error) {
      logger.error('Error updating post status:', error);
      throw error;
    }
  }

  /**
   * Update schedule execution
   * @param {string} scheduleId - Schedule UUID
   * @param {string} status - New status
   * @param {Date} nextExecution - Next execution time for recurring
   */
  async updateScheduleExecution(scheduleId, status, nextExecution = null) {
    try {
      const query = `
        UPDATE community_post_schedules
        SET
          status = $1,
          execution_count = execution_count + 1,
          last_executed_at = NOW(),
          next_execution_at = $2,
          updated_at = NOW()
        WHERE schedule_id = $3;
      `;

      await db.query(query, [status, nextExecution, scheduleId]);
    } catch (error) {
      logger.error('Error updating schedule execution:', error);
      throw error;
    }
  }

  /**
   * Get post analytics
   * @param {string} postId - Post UUID
   * @returns {Promise<Object>} Analytics object
   */
  async getPostAnalytics(postId) {
    try {
      const query = `
        SELECT
          (SELECT COUNT(*) FROM community_post_deliveries WHERE post_id = $1 AND status = 'sent') as total_sent,
          (SELECT COUNT(*) FROM community_post_deliveries WHERE post_id = $1 AND status = 'failed') as total_failed,
          (SELECT COUNT(DISTINCT group_id) FROM community_post_deliveries WHERE post_id = $1 AND status = 'sent') as groups_reached,
          (SELECT SUM(COALESCE((button_click_details->>'total')::INT, 0)) FROM community_post_analytics WHERE post_id = $1) as total_clicks
      `;

      const result = await db.query(query, [postId]);
      return result.rows[0];
    } catch (error) {
      logger.error('Error fetching post analytics:', error);
      throw error;
    }
  }

  /**
   * Cancel a scheduled post
   * @param {string} postId - Post UUID
   * @param {string} cancelledBy - Admin ID who cancelled
   * @param {string} reason - Cancellation reason
   */
  async cancelPost(postId, cancelledBy, reason = null) {
    try {
      const query = `
        UPDATE community_posts
        SET status = 'cancelled', updated_at = NOW()
        WHERE post_id = $1;
      `;

      await db.query(query, [postId]);

      const scheduleQuery = `
        UPDATE community_post_schedules
        SET status = 'cancelled'
        WHERE post_id = $1;
      `;

      await db.query(scheduleQuery, [postId]);

      logger.info('Post cancelled', { postId, cancelledBy, reason });
    } catch (error) {
      logger.error('Error cancelling post:', error);
      throw error;
    }
  }

  /**
   * Get button presets
   * @returns {Promise<Array>} Array of button presets
   */
  async getButtonPresets() {
    try {
      const query = `
        SELECT * FROM community_button_presets
        WHERE is_active = true
        ORDER BY button_type ASC
      `;

      const result = await db.query(query);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching button presets:', error);
      throw error;
    }
  }

  /**
   * Get all available posting destinations (groups + channels)
   * @param {boolean} activeOnly - Only active destinations
   * @returns {Promise<Array>} Destinations array
   */
  async getPostingDestinations(activeOnly = true) {
    try {
      const query = activeOnly
        ? `SELECT * FROM community_post_destinations WHERE is_active = true ORDER BY display_order ASC`
        : `SELECT * FROM community_post_destinations ORDER BY display_order ASC`;

      const result = await db.query(query);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching posting destinations:', error);
      throw error;
    }
  }

  /**
   * Send post to Prime channel
   * @param {Object} post - Post object with details
   * @param {Object} bot - Telegraf bot instance
   * @param {string} primeChannelId - Prime channel Telegram ID
   * @param {string} messageLanguage - 'en' or 'es'
   * @returns {Promise<Object>} Send result
   */
  async sendPostToPrimeChannel(post, bot, primeChannelId, messageLanguage = 'en') {
    try {
      logger.info('Sending post to Prime Channel', { postId: post.post_id });

      let message = this.formatMessage(
        post.formatted_template_type,
        messageLanguage === 'es' ? post.message_es : post.message_en,
        post.title,
        post.media_type
      );

      const buttons = await this.getButtonsForPost(post.post_id);
      const markup = this.buildButtonKeyboard(buttons);

      let messageId = null;
      const options = {
        parse_mode: 'Markdown',
        ...markup,
      };

      try {
        if (post.media_type === 'photo' && (post.telegram_file_id || post.media_url)) {
          const response = await bot.telegram.sendPhoto(
            primeChannelId,
            post.telegram_file_id || post.media_url,
            { ...options, caption: message }
          );
          messageId = response.message_id;
        } else if (post.media_type === 'video' && (post.telegram_file_id || post.media_url)) {
          const response = await bot.telegram.sendVideo(
            primeChannelId,
            post.telegram_file_id || post.media_url,
            {
              ...options,
              caption: message,
              supports_streaming: true, // Critical for large videos
            }
          );
          messageId = response.message_id;
        } else {
          const response = await bot.telegram.sendMessage(
            primeChannelId,
            message,
            options
          );
          messageId = response.message_id;
        }

        // Log successful delivery to channel
        await this.logChannelDelivery(post.post_id, 'prime_channel', primeChannelId, 'sent', messageId);

        return {
          success: true,
          messageId,
          channelId: primeChannelId,
          channelName: 'Prime Channel',
        };
      } catch (telegramError) {
        logger.error('Telegram send to channel error', {
          channelId: primeChannelId,
          error: telegramError.message,
        });
        await this.logChannelDelivery(post.post_id, 'prime_channel', primeChannelId, 'failed', null, telegramError.message);

        return {
          success: false,
          channelId: primeChannelId,
          error: telegramError.message,
        };
      }
    } catch (error) {
      logger.error('Error sending post to Prime Channel:', error);
      throw error;
    }
  }

  /**
   * Log channel delivery
   * @param {string} postId - Post UUID
   * @param {string} channelName - Channel name
   * @param {string} channelId - Telegram channel ID
   * @param {string} status - Delivery status
   * @param {string} messageId - Telegram message ID
   * @param {string} errorMessage - Optional error message
   */
  async logChannelDelivery(postId, channelName, channelId, status, messageId = null, errorMessage = null) {
    try {
      const query = `
        INSERT INTO community_post_channel_deliveries (
          post_id, channel_name, channel_id, status, message_id, error_message, sent_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT DO NOTHING;
      `;

      await db.query(query, [
        postId,
        channelName,
        channelId,
        status,
        messageId,
        errorMessage,
        status === 'sent' ? new Date() : null,
      ]);
    } catch (error) {
      logger.error('Error logging channel delivery:', error);
    }
  }

  /**
   * Send post to multiple destinations (groups + channels)
   * @param {Object} post - Post object
   * @param {Array} destinationIds - Array of destination IDs
   * @param {Object} bot - Telegraf bot instance
   * @returns {Promise<Object>} Results summary
   */
  async sendPostToMultipleDestinations(post, destinationIds, bot) {
    try {
      const results = {
        successful: 0,
        failed: 0,
        total: destinationIds.length,
        details: [],
      };

      for (const destId of destinationIds) {
        try {
          // Get destination details
          const destQuery = `SELECT * FROM community_post_destinations WHERE telegram_id = $1`;
          const destResult = await db.query(destQuery, [destId]);

          if (!destResult.rows[0]) {
            continue;
          }

          const destination = destResult.rows[0];

          if (destination.destination_type === 'channel') {
            // Send to channel (Prime Channel)
            const result = await this.sendPostToPrimeChannel(post, bot, destId, 'en');
            results.details.push(result);
            if (result.success) results.successful++;
            else results.failed++;
          } else {
            // Send to group using existing method
            const group = await this.getCommunityGroupById(destination.destination_name.split(' ')[1]); // Parse group name
            if (group) {
              const result = await this.sendPostToGroup(post, group, bot, 'en');
              results.details.push(result);
              if (result.success) results.successful++;
              else results.failed++;
            }
          }
        } catch (error) {
          logger.error('Error sending to destination:', error, { destId });
          results.failed++;
          results.details.push({ success: false, destId, error: error.message });
        }
      }

      logger.info('Multi-destination send complete', results);
      return results;
    } catch (error) {
      logger.error('Error sending to multiple destinations:', error);
      throw error;
    }
  }

  /**
   * Get channel analytics
   * @param {string} postId - Post UUID
   * @param {string} channelName - Channel name (optional)
   * @returns {Promise<Object>} Analytics object
   */
  async getChannelAnalytics(postId, channelName = null) {
    try {
      const query = channelName
        ? `SELECT * FROM community_post_channel_analytics WHERE post_id = $1 AND destination_name = $2`
        : `SELECT * FROM community_post_channel_analytics WHERE post_id = $1`;

      const params = channelName ? [postId, channelName] : [postId];
      const result = await db.query(query, params);

      return result.rows[0] || {
        views: 0,
        forwards: 0,
        reactions: 0,
        shares: 0,
      };
    } catch (error) {
      logger.error('Error fetching channel analytics:', error);
      throw error;
    }
  }
}

module.exports = new CommunityPostService();
