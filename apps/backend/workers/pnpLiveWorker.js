const PNPLiveNotificationService = require('../bot/services/pnpLiveNotificationService');
const PNPLiveService = require('../bot/services/pnpLiveService');
const PNPLiveAvailabilityService = require('../bot/services/pnpLiveAvailabilityService');
const { query } = require('../config/postgres');
const logger = require('../utils/logger');

/**
 * PNP Television Live Worker
 * Runs background jobs for the PNP Live system:
 * - Send booking reminders and alerts (every minute)
 * - Auto-complete shows after duration (every 5 minutes)
 * - Update model online status (every 2 minutes)
 * - Send feedback requests after shows (every 5 minutes)
 */
class PNPLiveWorker {
  constructor(bot) {
    this.bot = bot;
    this.intervals = [];
    this.isRunning = false;

    // Job locks to prevent overlapping executions
    this.jobLocks = {
      notifications: false,
      autoComplete: false,
      statusUpdate: false,
      feedbackRequests: false,
      autoOffline: false,
      releaseHolds: false
    };

    // Initialize notification service with bot
    PNPLiveNotificationService.init(bot);
  }

  /**
   * Acquire a lock for a job
   * @param {string} jobName - Name of the job
   * @returns {boolean} True if lock acquired, false if already locked
   */
  acquireLock(jobName) {
    if (this.jobLocks[jobName]) {
      logger.debug(`PNP Live worker: ${jobName} job already running, skipping`);
      return false;
    }
    this.jobLocks[jobName] = true;
    return true;
  }

  /**
   * Release a lock for a job
   * @param {string} jobName - Name of the job
   */
  releaseLock(jobName) {
    this.jobLocks[jobName] = false;
  }

  /**
   * Start all workers
   */
  start() {
    if (this.isRunning) {
      logger.warn('PNP Live worker already running');
      return;
    }

    logger.info('Starting PNP Live worker...');
    this.isRunning = true;

    // Job 1: Send booking notifications (every minute) - with lock
    this.intervals.push(
      setInterval(async () => {
        if (!this.acquireLock('notifications')) return;
        try {
          await PNPLiveNotificationService.processPendingNotifications();
        } catch (error) {
          logger.error('PNP Live worker: error processing notifications', { error: error.message });
        } finally {
          this.releaseLock('notifications');
        }
      }, 60 * 1000) // 1 minute
    );

    // Job 2: Auto-complete shows after duration (every 5 minutes) - with lock
    this.intervals.push(
      setInterval(async () => {
        if (!this.acquireLock('autoComplete')) return;
        try {
          const completed = await this.autoCompleteShows();
          if (completed > 0) {
            logger.info('PNP Live worker: auto-completed shows', { count: completed });
          }
        } catch (error) {
          logger.error('PNP Live worker: error auto-completing shows', { error: error.message });
        } finally {
          this.releaseLock('autoComplete');
        }
      }, 5 * 60 * 1000) // 5 minutes
    );

    // Job 3: Update model online status (every 2 minutes) - with lock
    this.intervals.push(
      setInterval(async () => {
        if (!this.acquireLock('statusUpdate')) return;
        try {
          await this.updateModelOnlineStatus();
        } catch (error) {
          logger.error('PNP Live worker: error updating model status', { error: error.message });
        } finally {
          this.releaseLock('statusUpdate');
        }
      }, 2 * 60 * 1000) // 2 minutes
    );

    // Job 4: Send feedback requests (every 5 minutes) - with lock
    this.intervals.push(
      setInterval(async () => {
        if (!this.acquireLock('feedbackRequests')) return;
        try {
          const sent = await this.sendFeedbackRequests();
          if (sent > 0) {
            logger.info('PNP Live worker: sent feedback requests', { count: sent });
          }
        } catch (error) {
          logger.error('PNP Live worker: error sending feedback requests', { error: error.message });
        } finally {
          this.releaseLock('feedbackRequests');
        }
      }, 5 * 60 * 1000) // 5 minutes
    );

    // Job 5: Auto-offline inactive models (every 5 minutes) - with lock
    this.intervals.push(
      setInterval(async () => {
        if (!this.acquireLock('autoOffline')) return;
        try {
          const offlined = await PNPLiveAvailabilityService.autoOfflineInactiveModels();
          if (offlined > 0) {
            logger.info('PNP Live worker: auto-offlined inactive models', { count: offlined });
          }
        } catch (error) {
          logger.error('PNP Live worker: error auto-offlining models', { error: error.message });
        } finally {
          this.releaseLock('autoOffline');
        }
      }, 5 * 60 * 1000) // 5 minutes
    );

    // Job 6: Release expired slot holds (every minute) - with lock
    this.intervals.push(
      setInterval(async () => {
        if (!this.acquireLock('releaseHolds')) return;
        try {
          const released = await PNPLiveAvailabilityService.releaseExpiredHolds();
          if (released > 0) {
            logger.info('PNP Live worker: released expired slot holds', { count: released });
          }
        } catch (error) {
          logger.error('PNP Live worker: error releasing expired holds', { error: error.message });
        } finally {
          this.releaseLock('releaseHolds');
        }
      }, 60 * 1000) // 1 minute
    );

    logger.info('PNP Live worker started with all jobs');
  }

  /**
   * Stop all workers
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping PNP Live worker...');

    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals = [];
    this.isRunning = false;

    logger.info('PNP Live worker stopped');
  }

  /**
   * Auto-complete shows that have ended (based on start time + duration)
   */
  async autoCompleteShows() {
    try {
      const now = new Date();

      // Find shows that should have ended (booking_time + duration < now)
      const result = await query(
        `SELECT id, user_id, duration_minutes
         FROM pnp_bookings
         WHERE status = 'confirmed'
         AND payment_status = 'paid'
         AND (booking_time + (duration_minutes || ' minutes')::interval) < $1`,
        [now]
      );

      let completed = 0;
      for (const booking of result.rows || []) {
        try {
          await PNPLiveService.completeBooking(booking.id);
          completed++;
        } catch (error) {
          logger.error('Error auto-completing booking', { bookingId: booking.id, error: error.message });
        }
      }

      return completed;
    } catch (error) {
      logger.error('Error in autoCompleteShows:', error);
      return 0;
    }
  }

  /**
   * Update model online status based on recent activity
   * Models are marked offline if no activity in 30 minutes
   */
  async updateModelOnlineStatus() {
    try {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

      // Mark models as offline if no recent activity
      await query(
        `UPDATE pnp_models
         SET is_online = FALSE, updated_at = NOW()
         WHERE is_online = TRUE
         AND (last_online IS NULL OR last_online < $1)`,
        [thirtyMinutesAgo]
      );

      // Models with upcoming bookings in next 15 minutes should be marked online
      const fifteenMinutesFromNow = new Date(Date.now() + 15 * 60 * 1000);
      await query(
        `UPDATE pnp_models m
         SET is_online = TRUE, last_online = NOW(), updated_at = NOW()
         FROM pnp_bookings b
         WHERE m.id = b.model_id
         AND b.status = 'confirmed'
         AND b.payment_status = 'paid'
         AND b.booking_time BETWEEN NOW() AND $1
         AND m.is_online = FALSE`,
        [fifteenMinutesFromNow]
      );
    } catch (error) {
      logger.error('Error updating model online status:', error);
    }
  }

  /**
   * Send feedback requests for completed shows without feedback
   */
  async sendFeedbackRequests() {
    try {
      // Find completed shows from last 24 hours without feedback
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      const result = await query(
        `SELECT id, user_id
         FROM pnp_bookings
         WHERE status = 'completed'
         AND rating IS NULL
         AND show_ended_at IS NOT NULL
         AND show_ended_at > $1
         AND show_ended_at < $2`,
        [oneDayAgo, oneHourAgo]
      );

      let sent = 0;
      for (const booking of result.rows || []) {
        try {
          await PNPLiveNotificationService.sendShowCompleted(
            booking.id,
            booking.user_id,
            'es'
          );
          sent++;
        } catch (error) {
          logger.error('Error sending feedback request', { bookingId: booking.id, error: error.message });
        }
      }

      return sent;
    } catch (error) {
      logger.error('Error in sendFeedbackRequests:', error);
      return 0;
    }
  }
}

module.exports = PNPLiveWorker;
