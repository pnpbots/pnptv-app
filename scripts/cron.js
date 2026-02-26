require('dotenv').config({ allowEmptyValues: true });
const path = require('path');
const cron = require('node-cron');

// Use absolute paths based on script location
const basePath = __dirname;
const backendPath = path.join(basePath, '../apps/backend');

const { initializeRedis } = require(path.join(backendPath, 'config/redis'));
const { initializePostgres } = require(path.join(backendPath, 'config/postgres'));
const UserService = require(path.join(backendPath, 'bot/services/userService'));
const MembershipCleanupService = require(path.join(backendPath, 'bot/services/membershipCleanupService'));
const TutorialReminderService = require(path.join(backendPath, 'bot/services/tutorialReminderService'));
const CultEventService = require(path.join(backendPath, 'bot/services/cultEventService'));
const VisaCybersourceService = require(path.join(backendPath, 'bot/services/visaCybersourceService'));
const logger = require(path.join(backendPath, 'utils/logger'));
const PaymentRecoveryService = require(path.join(backendPath, 'bot/services/paymentRecoveryService'));
const MediaCleanupService = require(path.join(backendPath, 'bot/services/mediaCleanupService'));

/**
 * Initialize and start cron jobs
 */
const startCronJobs = async (bot = null) => {
  try {
    logger.info('Initializing cron jobs...');

    // Initialize dependencies
    initializeRedis();
    await initializePostgres();

    // Initialize services with bot if provided
    if (bot) {
      MembershipCleanupService.initialize(bot);
      TutorialReminderService.initialize(bot);
    }

    // Payment recovery - process stuck pending payments every 2 hours
    // Checks ePayco API for completed payments and replays webhooks if needed
    cron.schedule(process.env.PAYMENT_RECOVERY_CRON || '0 */2 * * *', async () => {
      try {
        logger.info('Running payment recovery process...');
        const results = await PaymentRecoveryService.processStuckPayments();
        logger.info('Payment recovery completed', {
          checked: results.checked,
          recovered: results.recovered,
          stillPending: results.stillPending,
          failed: results.failed,
          errors: results.errors,
        });
      } catch (error) {
        logger.error('Error in payment recovery cron:', error);
      }
    });

    // Abandoned payment cleanup - daily at midnight
    // Marks payments pending > 24 hours as abandoned (prevents 3DS timeout issues)
    cron.schedule(process.env.PAYMENT_CLEANUP_CRON || '0 0 * * *', async () => {
      try {
        logger.info('Running abandoned payment cleanup...');
        const results = await PaymentRecoveryService.cleanupAbandonedPayments();
        logger.info('Abandoned payment cleanup completed', {
          cleaned: results.cleaned,
          errors: results.errors,
        });
      } catch (error) {
        logger.error('Error in abandoned payment cleanup cron:', error);
      }
    });

    // Full membership cleanup daily at midnight
    // Updates statuses (active/churned/free) and kicks expired users from PRIME channel
    cron.schedule(process.env.MEMBERSHIP_CLEANUP_CRON || '0 0 * * *', async () => {
      try {
        logger.info('Running daily membership cleanup...');
        const results = await MembershipCleanupService.runFullCleanup();
        logger.info('Membership cleanup completed', {
          statusUpdates: results.statusUpdates,
          channelKicks: results.channelKicks
        });
      } catch (error) {
        logger.error('Error in membership cleanup cron:', error);
      }
    });

    // Comprehensive membership status sync - runs twice daily (6 AM and 6 PM UTC)
    // Ensures all users have correct status/tier based on plan_expiry
    cron.schedule(process.env.MEMBERSHIP_SYNC_CRON || '0 6,18 * * *', async () => {
      try {
        logger.info('Running membership status sync (twice daily)...');
        const results = await MembershipCleanupService.syncAllMembershipStatuses();
        logger.info('Membership status sync completed', {
          toActive: results.toActive,
          toChurned: results.toChurned,
          toFree: results.toFree,
          errors: results.errors
        });
      } catch (error) {
        logger.error('Error in membership sync cron:', error);
      }
    });

    // Subscription expiry check (legacy - keeping for backwards compatibility)
    cron.schedule(process.env.SUBSCRIPTION_CHECK_CRON || '0 6 * * *', async () => {
      try {
        logger.info('Running subscription expiry check...');
        const processed = await UserService.processExpiredSubscriptions();
        logger.info(`Processed ${processed} expired subscriptions`);
      } catch (error) {
        logger.error('Error in subscription expiry cron:', error);
      }
    });

    // Media cleanup - daily at 3 AM UTC
    // Deletes old avatars and orphaned post media files to minimize storage costs
    cron.schedule(process.env.MEDIA_CLEANUP_CRON || '0 3 * * *', async () => {
      try {
        logger.info('Running media cleanup job...');
        await MediaCleanupService.cleanupOldAvatars();
        await MediaCleanupService.cleanupOldPostMedia(90); // Keep posts 90 days
        logger.info('Media cleanup completed');
      } catch (error) {
        logger.error('Error in media cleanup cron:', error);
      }
    });

    // NOTE: Tutorial reminders are handled by TutorialReminderService.startScheduling() in bot.js
    // Do NOT duplicate them here to avoid exceeding the 6 messages/day rate limit
    // The service alternates between health tips and PRIME feature tutorials every 4 hours

    // Cult event reminders (daily)
    if (bot) {
      cron.schedule(process.env.CULT_EVENT_REMINDERS_CRON || '0 15 * * *', async () => {
        try {
          logger.info('Running cult event reminders...');
          await CultEventService.processReminders(bot);
        } catch (error) {
          logger.error('Error in cult event reminders cron:', error);
        }
      });
    }

    // Process recurring payments - runs daily at 8 AM UTC
    // Charges cards for subscriptions that are due for renewal
    cron.schedule(process.env.RECURRING_PAYMENTS_CRON || '0 8 * * *', async () => {
      try {
        logger.info('Running recurring payments processing...');
        const results = await VisaCybersourceService.processDuePayments();
        logger.info('Recurring payments processing completed', {
          total: results.total,
          successful: results.successful,
          failed: results.failed,
          errors: results.errors?.length || 0,
        });
      } catch (error) {
        logger.error('Error in recurring payments cron:', error);
      }
    });

    // Retry failed recurring payments - runs at 2 PM UTC (for retry after morning failures)
    cron.schedule(process.env.RECURRING_RETRY_CRON || '0 14 * * *', async () => {
      try {
        logger.info('Running recurring payment retry...');
        const results = await VisaCybersourceService.processDuePayments();
        logger.info('Recurring payment retry completed', {
          total: results.total,
          successful: results.successful,
          failed: results.failed,
        });
      } catch (error) {
        logger.error('Error in recurring payment retry cron:', error);
      }
    });

    logger.info('✓ Cron jobs started successfully');
    return true;
  } catch (error) {
    logger.error('Failed to start cron jobs:', error);
    logger.error('Application will continue running without cron jobs');
    return false;
  }
};

// NOTE: Cron jobs are started from bot.js via startCronJobs(bot)
// Do NOT start them here to avoid double execution
// The bot instance is needed for services like MembershipCleanupService

module.exports = { startCronJobs };
