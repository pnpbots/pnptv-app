/**
 * Broadcast Scheduler Service
 * Manages scheduled broadcasts using cron jobs
 * Supports both one-time and recurring broadcasts with database persistence
 */

const cron = require('node-cron');
const logger = require('../utils/logger');
const BroadcastService = require('../bot/services/broadcastService');
const broadcastService = new BroadcastService();
const { cache } = require('../config/redis');

class BroadcastScheduler {
  constructor() {
    this.scheduledTasks = new Map(); // Map of broadcast_id -> cron task (for in-memory scheduled tasks)
    this.isRunning = false;
    this.bot = null;
  }

  /**
   * Initialize the scheduler
   * @param {Object} bot - Telegram bot instance
   */
  initialize(bot) {
    if (!bot) {
      throw new Error('Bot instance is required for broadcast scheduler');
    }

    this.bot = bot;
    logger.info('Broadcast scheduler initialized');
  }

  /**
   * Start the scheduler (checks for pending broadcasts every minute)
   */
  async start() {
    if (this.isRunning) {
      logger.warn('Broadcast scheduler is already running');
      return;
    }

    if (!this.bot) {
      throw new Error('Bot instance not initialized. Call initialize() first.');
    }

    // Check for pending scheduled broadcasts every minute
    this.mainTask = cron.schedule('* * * * *', async () => {
      try {
        await this.processPendingBroadcasts();
        await this.processRecurringSchedules();
      } catch (error) {
        logger.error('Error processing broadcasts:', error);
      }
    });

    this.isRunning = true;
    logger.info('Broadcast scheduler started - checking for pending broadcasts every minute');

    // Run initial check for any pending broadcasts
    try {
      await this.processPendingBroadcasts();
      await this.processRecurringSchedules();
    } catch (error) {
      logger.error('Error in initial broadcast check:', error);
    }
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.mainTask) {
      this.mainTask.stop();
      this.mainTask = null;
    }

    // Stop all individual scheduled tasks
    this.scheduledTasks.forEach((task) => task.stop());
    this.scheduledTasks.clear();

    this.isRunning = false;
    logger.info('Broadcast scheduler stopped');
  }

  /**
   * Process all pending scheduled broadcasts (one-time)
   */
  async processPendingBroadcasts() {
    try {
      const pendingBroadcasts = await broadcastService.getPendingScheduledBroadcasts();

      if (pendingBroadcasts.length === 0) {
        return;
      }

      logger.info(`Found ${pendingBroadcasts.length} pending scheduled broadcasts`);

      for (const broadcast of pendingBroadcasts) {
        try {
          // Use Redis lock to ensure broadcast is only sent once
          const lockKey = `broadcast:executing:${broadcast.broadcast_id}`;
          const acquired = await cache.acquireLock(lockKey);

          if (!acquired) {
            logger.warn(`Broadcast ${broadcast.broadcast_id} is already being processed, skipping`);
            continue;
          }

          try {
            await this.executeBroadcast(broadcast.broadcast_id);
          } finally {
            // Always release the lock
            await cache.releaseLock(lockKey);
          }
        } catch (error) {
          logger.error(`Error executing broadcast ${broadcast.broadcast_id}:`, error);
        }
      }
    } catch (error) {
      logger.error('Error processing pending broadcasts:', error);
    }
  }

  /**
   * Process all pending recurring broadcast schedules
   */
  async processRecurringSchedules() {
    try {
      const pendingSchedules = await broadcastService.getPendingRecurringSchedules();

      if (pendingSchedules.length === 0) {
        return;
      }

      logger.info(`Found ${pendingSchedules.length} pending recurring schedules`);

      for (const schedule of pendingSchedules) {
        try {
          // Use Redis lock to ensure schedule is only processed once
          const lockKey = `schedule:executing:${schedule.schedule_id}`;
          const acquired = await cache.acquireLock(lockKey);

          if (!acquired) {
            logger.warn(`Schedule ${schedule.schedule_id} is already being processed, skipping`);
            continue;
          }

          try {
            await this.executeRecurringSchedule(schedule);
          } finally {
            // Always release the lock
            await cache.releaseLock(lockKey);
          }
        } catch (error) {
          logger.error(`Error executing recurring schedule ${schedule.schedule_id}:`, error);
        }
      }
    } catch (error) {
      logger.error('Error processing recurring schedules:', error);
    }
  }

  /**
   * Execute a recurring schedule
   * @param {Object} schedule - Schedule record with broadcast data
   */
  async executeRecurringSchedule(schedule) {
    try {
      logger.info(`Executing recurring schedule: ${schedule.schedule_id} for broadcast ${schedule.broadcast_id}`);

      // Execute the broadcast
      const results = await this.executeBroadcast(schedule.broadcast_id);

      // Calculate next execution time
      const nextExecution = broadcastService.calculateNextExecution(schedule);

      if (nextExecution) {
        // Update schedule with next execution time
        await broadcastService.updateScheduleExecution(
          schedule.schedule_id,
          nextExecution,
          'scheduled'
        );
        logger.info(`Recurring schedule ${schedule.schedule_id} updated, next execution: ${nextExecution.toISOString()}`);
      } else {
        // No more executions - mark as completed
        await broadcastService.updateScheduleExecution(
          schedule.schedule_id,
          null,
          'completed'
        );
        logger.info(`Recurring schedule ${schedule.schedule_id} completed (max occurrences or end date reached)`);
      }

      return results;
    } catch (error) {
      logger.error(`Error executing recurring schedule ${schedule.schedule_id}:`, error);

      // Mark schedule as failed
      try {
        await broadcastService.updateScheduleExecution(
          schedule.schedule_id,
          schedule.next_execution_at, // Keep the same time for retry
          'failed'
        );
      } catch (updateError) {
        logger.error('Error updating schedule status:', updateError);
      }

      throw error;
    }
  }

  /**
   * Execute a broadcast immediately
   * @param {string} broadcastId - Broadcast ID to execute
   * @returns {Promise<Object>} Broadcast results
   */
  async executeBroadcast(broadcastId) {
    try {
      logger.info(`Executing scheduled broadcast: ${broadcastId}`);

      // Queue broadcast using async queue if available
      let results;
      const queueIntegration = global.broadcastQueueIntegration;
      if (queueIntegration) {
        try {
          const job = await queueIntegration.queueBroadcast(broadcastId);
          logger.info('Scheduled broadcast queued', {
            broadcastId,
            jobId: job.job_id,
          });
          results = { success: true, jobId: job.job_id, queued: true };
        } catch (error) {
          logger.warn('Failed to queue scheduled broadcast, falling back to sync:', error.message);
          results = await broadcastService.sendBroadcast(this.bot, broadcastId);
        }
      } else {
        // Fallback if queue not initialized
        results = await broadcastService.sendBroadcast(this.bot, broadcastId);
      }

      if (!results.queued) {
        logger.info(
          `Scheduled broadcast ${broadcastId} completed: ${results.sent} sent, ${results.failed} failed`
        );
      }

      return results;
    } catch (error) {
      logger.error(`Error executing broadcast ${broadcastId}:`, error);
      throw error;
    }
  }

  /**
   * Schedule a broadcast for a specific date/time
   * @param {string} broadcastId - Broadcast ID
   * @param {Date} scheduledDate - When to send the broadcast
   * @returns {boolean} Success status
   */
  scheduleAt(broadcastId, scheduledDate) {
    try {
      // Cancel any existing schedule for this broadcast
      if (this.scheduledTasks.has(broadcastId)) {
        this.cancelSchedule(broadcastId);
      }

      // Calculate time until execution
      const now = new Date();
      const timeUntilExecution = scheduledDate.getTime() - now.getTime();

      if (timeUntilExecution <= 0) {
        logger.warn(`Broadcast ${broadcastId} scheduled time is in the past, executing immediately`);
        this.executeBroadcast(broadcastId);
        return true;
      }

      // Schedule with setTimeout (for one-time execution)
      const timeout = setTimeout(async () => {
        try {
          await this.executeBroadcast(broadcastId);
          this.scheduledTasks.delete(broadcastId);
        } catch (error) {
          logger.error(`Error in scheduled broadcast ${broadcastId}:`, error);
        }
      }, timeUntilExecution);

      // Store the timeout so we can cancel it if needed
      this.scheduledTasks.set(broadcastId, {
        type: 'timeout',
        task: timeout,
        scheduledDate,
      });

      logger.info(
        `Broadcast ${broadcastId} scheduled for ${scheduledDate.toISOString()} (in ${Math.round(timeUntilExecution / 1000 / 60)} minutes)`
      );

      return true;
    } catch (error) {
      logger.error(`Error scheduling broadcast ${broadcastId}:`, error);
      return false;
    }
  }

  /**
   * Schedule a recurring broadcast using cron expression
   * @param {string} broadcastId - Broadcast ID
   * @param {string} cronExpression - Cron expression (e.g., '0 9 * * *' for daily at 9am)
   * @returns {boolean} Success status
   */
  scheduleRecurring(broadcastId, cronExpression) {
    try {
      // Validate cron expression
      if (!cron.validate(cronExpression)) {
        throw new Error(`Invalid cron expression: ${cronExpression}`);
      }

      // Cancel any existing schedule for this broadcast
      if (this.scheduledTasks.has(broadcastId)) {
        this.cancelSchedule(broadcastId);
      }

      // Create cron task
      const task = cron.schedule(cronExpression, async () => {
        try {
          await this.executeBroadcast(broadcastId);
        } catch (error) {
          logger.error(`Error in recurring broadcast ${broadcastId}:`, error);
        }
      });

      this.scheduledTasks.set(broadcastId, {
        type: 'cron',
        task,
        cronExpression,
      });

      logger.info(`Recurring broadcast ${broadcastId} scheduled with cron: ${cronExpression}`);

      return true;
    } catch (error) {
      logger.error(`Error scheduling recurring broadcast ${broadcastId}:`, error);
      return false;
    }
  }

  /**
   * Cancel a scheduled broadcast
   * @param {string} broadcastId - Broadcast ID
   * @returns {boolean} Success status
   */
  cancelSchedule(broadcastId) {
    try {
      const scheduled = this.scheduledTasks.get(broadcastId);

      if (!scheduled) {
        logger.warn(`No scheduled task found for broadcast ${broadcastId}`);
        return false;
      }

      if (scheduled.type === 'cron') {
        scheduled.task.stop();
      } else if (scheduled.type === 'timeout') {
        clearTimeout(scheduled.task);
      }

      this.scheduledTasks.delete(broadcastId);

      logger.info(`Cancelled scheduled broadcast: ${broadcastId}`);
      return true;
    } catch (error) {
      logger.error(`Error cancelling scheduled broadcast ${broadcastId}:`, error);
      return false;
    }
  }

  /**
   * Get all currently scheduled broadcasts
   * @returns {Array} List of scheduled broadcast info
   */
  getScheduledBroadcasts() {
    const scheduled = [];

    this.scheduledTasks.forEach((value, broadcastId) => {
      scheduled.push({
        broadcastId,
        type: value.type,
        scheduledDate: value.scheduledDate || null,
        cronExpression: value.cronExpression || null,
      });
    });

    return scheduled;
  }

  /**
   * Check if a broadcast is scheduled
   * @param {string} broadcastId - Broadcast ID
   * @returns {boolean} True if scheduled
   */
  isScheduled(broadcastId) {
    return this.scheduledTasks.has(broadcastId);
  }

  /**
   * Get scheduler status
   * @returns {Object} Scheduler status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      scheduledCount: this.scheduledTasks.size,
      scheduled: this.getScheduledBroadcasts(),
    };
  }
}

// Export singleton instance
module.exports = new BroadcastScheduler();
