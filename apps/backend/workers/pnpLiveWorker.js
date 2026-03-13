const PNPLiveNotificationService = require('../bot/services/pnpLiveNotificationService');
const PNPLiveService = require('../bot/services/pnpLiveService');
const PNPLiveAvailabilityService = require('../bot/services/pnpLiveAvailabilityService');
const { query } = require('../config/postgres');
const { cache } = require('../config/redis');
const logger = require('../utils/logger');

// Inactivity threshold before a model is automatically set offline (minutes).
// A model whose `updated_at` (last row-level change) is older than this value
// and who is still marked is_available = TRUE will be offlined by Job 3.
const AUTO_OFFLINE_THRESHOLD_MINUTES = 5;

// Timeout limits (ms) — jobs exceeding these durations are aborted and the
// distributed lock is released so the next interval can run cleanly.
const JOB_TIMEOUT_MS = {
  notifications: 60_000,    // 1 minute
  autoComplete: 60_000,     // 1 minute
  statusUpdate: 60_000,     // 1 minute
  feedbackRequests: 60_000, // 1 minute
  autoOffline: 60_000,      // 1 minute
  releaseHolds: 60_000,     // 1 minute
};

// Redis distributed-lock keys and their TTLs (seconds).
// TTL is set to 2× the job interval so a crashed worker cannot permanently
// hold a lock past the next scheduled run.
const LOCK_KEYS = {
  notifications:    { key: 'pnplive:worker:notifications:lock',    ttl: 120 },
  autoComplete:     { key: 'pnplive:worker:autoComplete:lock',      ttl: 600 },
  statusUpdate:     { key: 'pnplive:worker:statusUpdate:lock',      ttl: 240 },
  feedbackRequests: { key: 'pnplive:worker:feedbackRequests:lock',  ttl: 600 },
  autoOffline:      { key: 'pnplive:worker:autoOffline:lock',       ttl: 600 },
  releaseHolds:     { key: 'pnplive:worker:releaseHolds:lock',      ttl: 120 },
};

/**
 * Wrap a promise with a hard timeout.  If the promise does not settle within
 * `ms` milliseconds a rejection with an Error('Job timeout') is returned so
 * the caller can release the distributed lock.
 *
 * @param {Promise<any>} promise - The async work to race.
 * @param {number} ms - Timeout in milliseconds.
 * @returns {Promise<any>}
 */
const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Job timeout after ${ms}ms`)), ms)
    ),
  ]);

/**
 * PNP Television Live Worker
 * Runs background jobs for the PNP Live system:
 * - Send booking reminders and alerts (every minute)
 * - Auto-complete shows after duration (every 5 minutes)
 * - Update model online status (every 2 minutes)
 * - Send feedback requests after shows (every 5 minutes)
 * - Auto-offline inactive models (every 5 minutes)
 * - Release expired slot holds (every minute)
 *
 * All jobs use Redis distributed locks so that a multi-instance deployment
 * never runs the same job concurrently across processes.
 */
class PNPLiveWorker {
  constructor(bot) {
    this.bot = bot;
    this.intervals = [];
    this.isRunning = false;

    // Initialize notification service with bot
    PNPLiveNotificationService.init(bot);
  }

  /**
   * Try to acquire a Redis distributed lock for a named job.
   *
   * @param {string} jobName - Key into LOCK_KEYS (e.g. 'notifications')
   * @returns {Promise<boolean>} True when lock was acquired; false when
   *   another process/instance is already running this job.
   */
  async acquireRedisLock(jobName) {
    const { key, ttl } = LOCK_KEYS[jobName];
    const acquired = await cache.acquireLock(key, ttl);
    if (!acquired) {
      logger.debug(`PNP Live worker: ${jobName} lock held by another instance, skipping`);
    }
    return acquired;
  }

  /**
   * Release a previously acquired Redis distributed lock.
   *
   * @param {string} jobName - Key into LOCK_KEYS
   * @returns {Promise<void>}
   */
  async releaseRedisLock(jobName) {
    const { key } = LOCK_KEYS[jobName];
    await cache.releaseLock(key);
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

    // Job 1: Send booking notifications (every minute)
    this.intervals.push(
      setInterval(async () => {
        if (!(await this.acquireRedisLock('notifications'))) return;
        try {
          await withTimeout(
            PNPLiveNotificationService.processPendingNotifications(),
            JOB_TIMEOUT_MS.notifications
          );
        } catch (error) {
          logger.error('PNP Live worker: error processing notifications', { error: error.message });
        } finally {
          await this.releaseRedisLock('notifications');
        }
      }, 60 * 1000) // 1 minute
    );

    // Job 2: Auto-complete shows after duration (every 5 minutes)
    this.intervals.push(
      setInterval(async () => {
        if (!(await this.acquireRedisLock('autoComplete'))) return;
        try {
          const completed = await withTimeout(
            this.autoCompleteShows(),
            JOB_TIMEOUT_MS.autoComplete
          );
          if (completed > 0) {
            logger.info('PNP Live worker: auto-completed shows', { count: completed });
          }
        } catch (error) {
          logger.error('PNP Live worker: error auto-completing shows', { error: error.message });
        } finally {
          await this.releaseRedisLock('autoComplete');
        }
      }, 5 * 60 * 1000) // 5 minutes
    );

    // Job 3: Update model online status (every 2 minutes)
    // Only offlines models that have been inactive beyond AUTO_OFFLINE_THRESHOLD_MINUTES.
    this.intervals.push(
      setInterval(async () => {
        if (!(await this.acquireRedisLock('statusUpdate'))) return;
        try {
          await withTimeout(
            this.updateModelOnlineStatus(),
            JOB_TIMEOUT_MS.statusUpdate
          );
        } catch (error) {
          logger.error('PNP Live worker: error updating model status', { error: error.message });
        } finally {
          await this.releaseRedisLock('statusUpdate');
        }
      }, 2 * 60 * 1000) // 2 minutes
    );

    // Job 4: Send feedback requests (every 5 minutes)
    this.intervals.push(
      setInterval(async () => {
        if (!(await this.acquireRedisLock('feedbackRequests'))) return;
        try {
          const sent = await withTimeout(
            this.sendFeedbackRequests(),
            JOB_TIMEOUT_MS.feedbackRequests
          );
          if (sent > 0) {
            logger.info('PNP Live worker: sent feedback requests', { count: sent });
          }
        } catch (error) {
          logger.error('PNP Live worker: error sending feedback requests', { error: error.message });
        } finally {
          await this.releaseRedisLock('feedbackRequests');
        }
      }, 5 * 60 * 1000) // 5 minutes
    );

    // Job 5: Auto-offline inactive models (every 5 minutes)
    this.intervals.push(
      setInterval(async () => {
        if (!(await this.acquireRedisLock('autoOffline'))) return;
        try {
          const offlined = await withTimeout(
            PNPLiveAvailabilityService.autoOfflineInactiveModels(),
            JOB_TIMEOUT_MS.autoOffline
          );
          if (offlined > 0) {
            logger.info('PNP Live worker: auto-offlined inactive models', { count: offlined });
          }
        } catch (error) {
          logger.error('PNP Live worker: error auto-offlining models', { error: error.message });
        } finally {
          await this.releaseRedisLock('autoOffline');
        }
      }, 5 * 60 * 1000) // 5 minutes
    );

    // Job 6: Release expired slot holds (every minute)
    this.intervals.push(
      setInterval(async () => {
        if (!(await this.acquireRedisLock('releaseHolds'))) return;
        try {
          const released = await withTimeout(
            PNPLiveAvailabilityService.releaseExpiredHolds(),
            JOB_TIMEOUT_MS.releaseHolds
          );
          if (released > 0) {
            logger.info('PNP Live worker: released expired slot holds', { count: released });
          }
        } catch (error) {
          logger.error('PNP Live worker: error releasing expired holds', { error: error.message });
        } finally {
          await this.releaseRedisLock('releaseHolds');
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
   * Update model online status based on recent activity.
   *
   * Only performers that are currently marked available AND whose last row
   * update (`updated_at`) is older than AUTO_OFFLINE_THRESHOLD_MINUTES are
   * set offline.  This prevents a blanket reset that would override a model
   * who just toggled themselves online moments before this job ran.
   *
   * After the inactivity sweep, any model with a confirmed, paid booking
   * starting within the next 15 minutes is re-marked available so they
   * appear online to incoming viewers.
   */
  async updateModelOnlineStatus() {
    try {
      const inactivityCutoff = new Date(Date.now() - AUTO_OFFLINE_THRESHOLD_MINUTES * 60 * 1000);

      // Only offline models that have been inactive beyond the threshold.
      // updated_at is maintained by the trigger_performers_updated_at trigger,
      // so it reflects the last time the row was touched (including manual
      // online/offline toggles from the model's own session).
      const offlineResult = await query(
        `UPDATE performers
         SET is_available = FALSE, updated_at = NOW()
         WHERE is_available = TRUE
           AND updated_at < $1
         RETURNING id`,
        [inactivityCutoff]
      );

      const offlinedCount = offlineResult.rows?.length ?? 0;
      if (offlinedCount > 0) {
        logger.info('PNP Live worker: set inactive models offline', {
          count: offlinedCount,
          thresholdMinutes: AUTO_OFFLINE_THRESHOLD_MINUTES,
        });
      }

      // Models with upcoming bookings in the next 15 minutes should appear online
      // regardless of the inactivity window — the booking itself signals intent.
      const fifteenMinutesFromNow = new Date(Date.now() + 15 * 60 * 1000);
      await query(
        `UPDATE performers m
         SET is_available = TRUE, updated_at = NOW()
         FROM pnp_bookings b
         WHERE m.id = b.model_id
           AND b.status = 'confirmed'
           AND b.payment_status = 'paid'
           AND b.booking_time BETWEEN NOW() AND $1
           AND m.is_available = FALSE`,
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
