/**
 * Community Post Scheduler
 * Handles execution of scheduled community posts and recurring posts
 */

const logger = require('../../../utils/logger');
const communityPostService = require('../../services/communityPostService');
const db = require('../../../utils/db');

class CommunityPostScheduler {
  /**
   * Initialize scheduler
   * @param {Telegraf} bot - Bot instance
   */
  constructor(bot) {
    this.bot = bot;
    this.isRunning = false;
  }

  /**
   * Start the scheduler
   */
  start() {
    if (this.isRunning) {
      logger.warn('Community post scheduler already running');
      return;
    }

    this.isRunning = true;

    // Check every minute for posts to execute
    this.interval = setInterval(() => {
      this.checkAndExecutePendingPosts().catch((error) => {
        logger.error('Error in community post scheduler:', error);
      });
    }, 60 * 1000); // 60 seconds

    logger.info('Community post scheduler started');
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.isRunning = false;
      logger.info('Community post scheduler stopped');
    }
  }

  /**
   * Check and execute pending posts
   */
  async checkAndExecutePendingPosts() {
    try {
      // Get all pending posts scheduled for now or earlier
      const query = `
        SELECT
          p.post_id,
          p.admin_id,
          p.admin_username,
          p.title,
          p.message_en,
          p.message_es,
          p.media_type,
          p.media_url,
          p.s3_key,
          p.telegram_file_id,
          p.target_group_ids,
          p.target_all_groups,
          p.formatted_template_type,
          p.button_layout,
          p.scheduled_at,
          p.timezone,
          p.is_recurring,
          p.recurrence_pattern,
          p.cron_expression,
          p.recurrence_end_date,
          p.max_occurrences,
          p.status,
          p.scheduled_count,
          p.sent_count,
          p.failed_count,
          p.created_at,
          p.updated_at,
          p.destination_type,
          p.post_to_prime_channel,
          p.post_to_groups,
          p.post_to_destinations,
          p.target_channel_ids,
          p.video_file_size_mb,
          p.video_duration_seconds,
          p.uses_streaming,
          p.prime_channel_message_id,
          s.schedule_id,
          s.execution_order,
          s.next_execution_at,
          array_agg(DISTINCT g.group_id) as target_group_ids_agg,
          array_agg(DISTINCT g.telegram_group_id) as telegram_group_ids,
          array_agg(DISTINCT g.name) as group_names
        FROM community_posts p
        JOIN community_post_schedules s ON p.post_id = s.post_id
        LEFT JOIN community_groups g ON g.group_id = ANY(p.target_group_ids)
        WHERE s.status = 'scheduled'
        AND s.scheduled_for <= NOW()
        AND p.status IN ('scheduled', 'sending')
        AND (g.is_active = true OR g.id IS NULL)
        GROUP BY p.post_id, p.admin_id, p.admin_username, p.title, p.message_en, p.message_es, p.media_type, p.media_url, p.s3_key, p.telegram_file_id, p.target_group_ids, p.target_all_groups, p.formatted_template_type, p.button_layout, p.scheduled_at, p.timezone, p.is_recurring, p.recurrence_pattern, p.cron_expression, p.recurrence_end_date, p.max_occurrences, p.status, p.scheduled_count, p.sent_count, p.failed_count, p.created_at, p.updated_at, p.destination_type, p.post_to_prime_channel, p.post_to_groups, p.post_to_destinations, p.target_channel_ids, p.video_file_size_mb, p.video_duration_seconds, p.uses_streaming, p.prime_channel_message_id, s.schedule_id, s.execution_order, s.next_execution_at
        ORDER BY s.execution_order ASC
        LIMIT 5;
      `;

      const result = await db.query(query);

      if (result.rows.length === 0) {
        return; // No pending posts
      }

      logger.info(`Found ${result.rows.length} posts to execute`);

      for (const post of result.rows) {
        try {
          await this.executePost(post);
        } catch (error) {
          logger.error('Error executing post:', error, { postId: post.post_id });
        }
      }
    } catch (error) {
      logger.error('Error checking pending posts:', error);
    }
  }

  /**
   * Execute a single post
   * @param {Object} post - Post record
   */
  async executePost(post) {
    try {
      logger.info('Executing community post', { postId: post.post_id });

      // Mark schedule as executing
      await this.updateScheduleStatus(post.schedule_id, 'executing');

      // Get full post details with buttons
      const fullPost = await communityPostService.getPostWithDetails(post.post_id);

      // Get groups
      const groups = await communityPostService.getCommunityGroups();
      const targetGroups = groups.filter((g) => post.target_group_ids.includes(g.group_id));

      // Send to all target groups
      let groupResults = { successful: 0, failed: 0 };
      if (targetGroups.length > 0) {
        groupResults = await communityPostService.sendPostToGroups(
          fullPost,
          targetGroups,
          this.bot
        );
      }

      // Send to all target channels
      let channelResults = { successful: 0, failed: 0 };
      if (post.target_channel_ids && post.target_channel_ids.length > 0) {
        channelResults = await communityPostService.sendPostToChannels(
          fullPost,
          post.target_channel_ids,
          this.bot
        );
      }

      // Combine results
      const results = {
        successful: groupResults.successful + channelResults.successful,
        failed: groupResults.failed + channelResults.failed,
      };

      logger.info('Post execution complete', {
        postId: post.post_id,
        successful: results.successful,
        failed: results.failed,
      });

      // Handle recurring posts
      if (fullPost.is_recurring && fullPost.recurrence_pattern) {
        const nextExecution = await this.calculateNextExecution(
          fullPost,
          post.schedule_id
        );

        if (nextExecution) {
          // Update schedule with next execution
          await this.updateScheduleNextExecution(post.schedule_id, nextExecution);
          logger.info('Recurring post scheduled for next execution', {
            postId: post.post_id,
            nextExecution,
          });
        } else {
          // Recurrence limit reached
          await this.updateScheduleStatus(post.schedule_id, 'completed');
          logger.info('Recurring post completed (max occurrences reached)', {
            postId: post.post_id,
          });
        }
      } else {
        // Non-recurring post is complete
        await this.updateScheduleStatus(post.schedule_id, 'completed');
      }

      // Check if all schedules are complete
      await this.checkAndUpdatePostStatus(post.post_id);
    } catch (error) {
      logger.error('Error executing post:', error);

      // Mark schedule as failed
      try {
        await this.updateScheduleStatus(
          post.schedule_id,
          'failed',
          error.message
        );
      } catch (updateError) {
        logger.error('Error updating schedule status:', updateError);
      }

      throw error;
    }
  }

  /**
   * Calculate next execution time for recurring post
   * @param {Object} post - Post object
   * @param {string} scheduleId - Schedule UUID
   * @returns {Promise<Date|null>} Next execution time or null if limit reached
   */
  async calculateNextExecution(post, scheduleId) {
    try {
      // Get current execution count for this schedule
      const query = `
        SELECT execution_count, scheduled_for FROM community_post_schedules
        WHERE schedule_id = $1
      `;

      const result = await db.query(query, [scheduleId]);
      if (!result.rows[0]) return null;

      const schedule = result.rows[0];
      const currentCount = schedule.execution_count || 0;

      // Check if max occurrences reached
      if (post.max_occurrences && currentCount >= post.max_occurrences) {
        return null;
      }

      // Calculate next execution based on pattern
      const lastExecution = new Date(schedule.scheduled_for);
      let nextExecution;

      switch (post.recurrence_pattern) {
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
          // Use cron-parser for custom cron expressions
          try {
            const cronParser = require('cron-parser');
            const interval = cronParser.parseExpression(post.cron_expression, {
              currentDate: lastExecution,
            });
            nextExecution = interval.next().toDate();
          } catch (cronError) {
            logger.error('Error parsing custom cron expression:', cronError.message);
            return null;
          }
          break;

        default:
          return null;
      }

      // Check if end date exceeded (if set)
      if (post.recurrence_end_date) {
        const endDate = new Date(post.recurrence_end_date);
        if (nextExecution > endDate) {
          return null;
        }
      }

      return nextExecution;
    } catch (error) {
      logger.error('Error calculating next execution:', error);
      throw error;
    }
  }

  /**
   * Update schedule status
   * @param {string} scheduleId - Schedule UUID
   * @param {string} status - New status
   * @param {string} errorMessage - Optional error message
   */
  async updateScheduleStatus(scheduleId, status, errorMessage = null) {
    try {
      const query = `
        UPDATE community_post_schedules
        SET
          status = $1,
          error_message = $2,
          updated_at = NOW()
        WHERE schedule_id = $3
      `;

      await db.query(query, [status, errorMessage, scheduleId]);
    } catch (error) {
      logger.error('Error updating schedule status:', error);
      throw error;
    }
  }

  /**
   * Update schedule next execution time
   * @param {string} scheduleId - Schedule UUID
   * @param {Date} nextExecution - Next execution time
   */
  async updateScheduleNextExecution(scheduleId, nextExecution) {
    try {
      const query = `
        UPDATE community_post_schedules
        SET
          next_execution_at = $1,
          scheduled_for = $1,
          updated_at = NOW()
        WHERE schedule_id = $2
      `;

      await db.query(query, [nextExecution, scheduleId]);
    } catch (error) {
      logger.error('Error updating schedule next execution:', error);
      throw error;
    }
  }

  /**
   * Check and update post status based on schedules
   * @param {string} postId - Post UUID
   */
  async checkAndUpdatePostStatus(postId) {
    try {
      // Get all schedules for this post
      const query = `
        SELECT status FROM community_post_schedules WHERE post_id = $1
      `;

      const result = await db.query(query, [postId]);
      const schedules = result.rows;

      if (schedules.length === 0) return;

      // Determine post status based on schedule statuses
      const allCompleted = schedules.every((s) => s.status === 'completed');
      const anyFailed = schedules.some((s) => s.status === 'failed');
      const anyScheduled = schedules.some((s) => s.status === 'scheduled');

      let postStatus = 'sent';
      if (anyScheduled) {
        postStatus = 'scheduled';
      } else if (anyFailed) {
        postStatus = 'failed';
      } else if (allCompleted) {
        postStatus = 'sent';
      }

      // Update post status
      const updateQuery = `
        UPDATE community_posts
        SET status = $1, updated_at = NOW()
        WHERE post_id = $2
      `;

      await db.query(updateQuery, [postStatus, postId]);

      logger.info('Post status updated', {
        postId,
        status: postStatus,
      });
    } catch (error) {
      logger.error('Error checking post status:', error);
      // Don't throw - status update failures shouldn't break the flow
    }
  }

  /**
   * Get scheduler statistics
   * @returns {Promise<Object>} Statistics object
   */
  async getStatistics() {
    try {
      const query = `
        SELECT
          (SELECT COUNT(*) FROM community_posts WHERE status = 'scheduled') as scheduled_posts,
          (SELECT COUNT(*) FROM community_posts WHERE status = 'sent') as sent_posts,
          (SELECT COUNT(*) FROM community_posts WHERE status = 'failed') as failed_posts,
          (SELECT COUNT(*) FROM community_post_schedules WHERE status = 'scheduled') as pending_schedules,
          (SELECT COUNT(*) FROM community_post_schedules WHERE status = 'executing') as executing_schedules,
          (SELECT COUNT(*) FROM community_post_deliveries WHERE status = 'sent') as total_deliveries,
          (SELECT AVG(EXTRACT(EPOCH FROM (last_executed_at - scheduled_for))) FROM community_post_schedules WHERE last_executed_at IS NOT NULL) as avg_execution_delay_seconds
      `;

      const result = await db.query(query);
      return result.rows[0];
    } catch (error) {
      logger.error('Error fetching scheduler statistics:', error);
      return null;
    }
  }

  /**
   * Retry failed post delivery
   * @param {string} deliveryId - Delivery UUID
   */
  async retryFailedDelivery(deliveryId) {
    try {
      const query = `
        SELECT pd.*, cp.* FROM community_post_deliveries pd
        JOIN community_posts cp ON pd.post_id = cp.post_id
        WHERE pd.delivery_id = $1
      `;

      const result = await db.query(query, [deliveryId]);
      if (!result.rows.length) {
        throw new Error('Delivery not found');
      }

      const delivery = result.rows[0];
      const group = await communityPostService.getCommunityGroupById(delivery.group_id);

      if (!group) {
        throw new Error('Group not found');
      }

      // Retry send
      const postDetails = await communityPostService.getPostWithDetails(delivery.post_id);
      const sendResult = await communityPostService.sendPostToGroup(
        postDetails,
        group,
        this.bot
      );

      logger.info('Retried delivery', {
        deliveryId,
        success: sendResult.success,
      });

      return sendResult;
    } catch (error) {
      logger.error('Error retrying delivery:', error);
      throw error;
    }
  }
}

module.exports = CommunityPostScheduler;
