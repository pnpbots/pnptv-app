const PrivateCallBookingService = require('../bot/services/privateCallBookingService');
const logger = require('../utils/logger');

/**
 * Private Calls Worker
 * Runs background jobs for the private calls system:
 * - Expire held bookings (every minute)
 * - Send pending notifications (every minute)
 * - Auto-end overdue calls (every minute)
 * - Check for no-shows (every 5 minutes)
 */
class PrivateCallsWorker {
  constructor(bot) {
    this.bot = bot;
    this.intervals = [];
    this.isRunning = false;
  }

  /**
   * Start all workers
   */
  start() {
    if (this.isRunning) {
      logger.warn('Private calls worker already running');
      return;
    }

    logger.info('Starting private calls worker...');
    this.isRunning = true;

    // Job 1: Expire held bookings (every minute)
    this.intervals.push(
      setInterval(async () => {
        try {
          const expiredCount = await PrivateCallBookingService.expireHeldBookings();
          if (expiredCount > 0) {
            logger.info('Private calls worker: expired bookings', { count: expiredCount });
          }
        } catch (error) {
          logger.error('Private calls worker: error expiring bookings', { error: error.message });
        }
      }, 60 * 1000) // 1 minute
    );

    // Job 2: Send pending notifications (every minute)
    this.intervals.push(
      setInterval(async () => {
        try {
          const sentCount = await PrivateCallBookingService.sendPendingNotifications(this.bot);
          if (sentCount > 0) {
            logger.info('Private calls worker: sent notifications', { count: sentCount });
          }
        } catch (error) {
          logger.error('Private calls worker: error sending notifications', { error: error.message });
        }
      }, 60 * 1000) // 1 minute
    );

    // Job 3: Auto-end overdue calls (every minute)
    this.intervals.push(
      setInterval(async () => {
        try {
          const endedCount = await PrivateCallBookingService.autoEndOverdueCalls();
          if (endedCount > 0) {
            logger.info('Private calls worker: auto-ended calls', { count: endedCount });
          }
        } catch (error) {
          logger.error('Private calls worker: error auto-ending calls', { error: error.message });
        }
      }, 60 * 1000) // 1 minute
    );

    // Job 4: Check for no-shows (every 5 minutes)
    this.intervals.push(
      setInterval(async () => {
        try {
          const noShowCount = await PrivateCallBookingService.checkNoShows(10); // 10 min grace period
          if (noShowCount > 0) {
            logger.info('Private calls worker: marked no-shows', { count: noShowCount });
          }
        } catch (error) {
          logger.error('Private calls worker: error checking no-shows', { error: error.message });
        }
      }, 5 * 60 * 1000) // 5 minutes
    );

    logger.info('Private calls worker started with 4 jobs');
  }

  /**
   * Stop all workers
   */
  stop() {
    logger.info('Stopping private calls worker...');

    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];
    this.isRunning = false;

    logger.info('Private calls worker stopped');
  }

  /**
   * Run all jobs once (for testing or manual trigger)
   */
  async runOnce() {
    logger.info('Running private calls worker jobs once...');

    try {
      const expiredCount = await PrivateCallBookingService.expireHeldBookings();
      logger.info('Expired bookings', { count: expiredCount });

      const sentCount = await PrivateCallBookingService.sendPendingNotifications(this.bot);
      logger.info('Sent notifications', { count: sentCount });

      const endedCount = await PrivateCallBookingService.autoEndOverdueCalls();
      logger.info('Auto-ended calls', { count: endedCount });

      const noShowCount = await PrivateCallBookingService.checkNoShows(10);
      logger.info('Marked no-shows', { count: noShowCount });

      return {
        expiredBookings: expiredCount,
        sentNotifications: sentCount,
        autoEndedCalls: endedCount,
        noShows: noShowCount,
      };
    } catch (error) {
      logger.error('Error running private calls worker jobs', { error: error.message });
      throw error;
    }
  }
}

// Singleton instance
let workerInstance = null;

/**
 * Initialize and start the worker
 */
function initializeWorker(bot) {
  if (!workerInstance) {
    workerInstance = new PrivateCallsWorker(bot);
  }
  return workerInstance;
}

/**
 * Get the worker instance
 */
function getWorker() {
  return workerInstance;
}

module.exports = {
  PrivateCallsWorker,
  initializeWorker,
  getWorker,
};
