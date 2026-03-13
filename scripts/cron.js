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
const CreatorService = require(path.join(backendPath, 'bot/services/creatorService'));
const CreatorPayoutService = require(path.join(backendPath, 'bot/services/creatorPayoutService'));
const SubscriptionReminderEmailService = require(path.join(backendPath, 'services/subscriptionReminderEmailService'));
const TelegramSubscriptionReminderService = require(path.join(backendPath, 'bot/services/subscriptionReminderService'));
const NotificationDigestScheduler = require(path.join(backendPath, 'bot/services/notificationDigestScheduler'));

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

    // Initialize Telegram subscription reminder service
    if (bot) {
      TelegramSubscriptionReminderService.initialize(bot);
    }

    // Daimo payment recovery - process stuck Daimo payments every 5 minutes
    // Checks Daimo Pay API for completed payments and replays webhooks if needed
    // More frequent than ePayco since Daimo has no 3DS delay, payments complete fast
    cron.schedule(process.env.DAIMO_RECOVERY_CRON || '*/5 * * * *', async () => {
      try {
        logger.info('Running Daimo payment recovery process...');
        const results = await PaymentRecoveryService.processStuckDaimoPayments();
        logger.info('Daimo payment recovery completed', {
          checked: results.checked,
          recovered: results.recovered,
          stillPending: results.stillPending,
          failed: results.failed,
          errors: results.errors,
        });
      } catch (error) {
        logger.error('Error in Daimo payment recovery cron:', error);
      }
    });

    // ePayco payment recovery - process stuck pending payments every 2 hours
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

    // Creator eligibility batch check - daily at 3 AM UTC
    cron.schedule('0 3 * * *', async () => {
      try {
        logger.info('Running creator eligibility batch check...');
        const results = await CreatorService.runBatchEligibilityCheck();
        logger.info('Creator eligibility check completed', results);
      } catch (error) {
        logger.error('Error in creator eligibility cron:', error);
      }
    });

    // Creator subscription expiry - every 6 hours
    cron.schedule('0 */6 * * *', async () => {
      try {
        logger.info('Running creator subscription expiry check...');
        const results = await CreatorService.expireCreatorSubscriptions();
        logger.info('Creator subscription expiry completed', results);
      } catch (error) {
        logger.error('Error in creator subscription expiry cron:', error);
      }
    });

    // ── Creator Subscription Renewals — daily at 09:00 UTC ──────────────────
    // Finds active subscriptions expiring within 3 days with auto_renew=true.
    // Creates a Daimo checkout session per subscriber; extends expires_at by 30 days
    // and records earnings on session creation. Cancels subscription on failure.
    cron.schedule(process.env.CREATOR_RENEWAL_CRON || '0 9 * * *', async () => {
      try {
        logger.info('Running creator subscription renewal...');
        const results = await CreatorPayoutService.runSubscriptionRenewals();
        logger.info('Creator subscription renewal completed', results);
      } catch (error) {
        logger.error('Error in creator subscription renewal cron:', error);
      }
    });

    // ── Creator Monthly Payouts — 1st of month at 00:00 UTC ─────────────────
    // Groups all `available` creator_earnings by creator, sends one consolidated
    // USDC payout per creator to their creator_wallet_address via Daimo transfer.
    // Skips creators without a wallet address (notifies them instead).
    // Minimum threshold: $1.00. Earnings below threshold roll over automatically.
    cron.schedule(process.env.CREATOR_PAYOUT_CRON || '0 0 1 * *', async () => {
      try {
        logger.info('Running monthly creator payouts...');
        const results = await CreatorPayoutService.runMonthlyPayouts();
        logger.info('Monthly creator payouts completed', results);
      } catch (error) {
        logger.error('Error in monthly creator payout cron:', error);
      }
    });

    // Hangout subgroup inactivity cleanup - hourly
    // Deletes user-created hangout groups inactive for 72+ hours (CASCADE handles members, calls, messages)
    const { query: pgQuery } = require(path.join(backendPath, 'config/postgres'));
    cron.schedule('0 * * * *', async () => {
      try {
        logger.info('Running hangout inactivity cleanup...');

        // Find stale user-created groups (not main, not wall of fame)
        const { rows: staleGroups } = await pgQuery(
          `SELECT id, name FROM hangout_groups
           WHERE is_main = false AND is_wall_of_fame = false
             AND last_activity_at < NOW() - INTERVAL '72 hours'`
        );

        if (staleGroups.length === 0) {
          logger.info('Hangout cleanup: no stale groups found');
          return;
        }

        for (const group of staleGroups) {
          try {
            // End any active calls first
            await pgQuery(
              `UPDATE hangout_video_calls SET status = 'ended', ended_at = NOW()
               WHERE group_id = $1 AND status = 'active'`,
              [group.id]
            );

            // Delete group (CASCADE handles members, calls, participants, messages)
            await pgQuery('DELETE FROM hangout_groups WHERE id = $1', [group.id]);
            logger.info(`Hangout cleanup: deleted stale group "${group.name}" (id=${group.id})`);
          } catch (groupErr) {
            logger.error(`Hangout cleanup: failed to delete group ${group.id}`, groupErr);
          }
        }

        logger.info(`Hangout inactivity cleanup completed: ${staleGroups.length} group(s) deleted`);
      } catch (error) {
        logger.error('Error in hangout inactivity cleanup cron:', error);
      }
    });

    // Notification cleanup — daily at 03:00 UTC
    // Removes read notifications older than 90 days and all hangout_call
    // notifications older than 30 days (they become stale very quickly).
    cron.schedule('0 3 * * *', async () => {
      try {
        logger.info('Running notification cleanup job...');

        const { rows: oldReadRows } = await pgQuery(
          `DELETE FROM notifications
           WHERE is_read = TRUE
             AND created_at < NOW() - INTERVAL '90 days'
           RETURNING id`
        );
        const deletedRead = oldReadRows.length;

        const { rows: oldCallRows } = await pgQuery(
          `DELETE FROM notifications
           WHERE type = 'hangout_call'
             AND created_at < NOW() - INTERVAL '30 days'
           RETURNING id`
        );
        const deletedCalls = oldCallRows.length;

        logger.info('Notification cleanup completed', {
          deletedReadOlderThan90Days: deletedRead,
          deletedHangoutCallsOlderThan30Days: deletedCalls,
          totalDeleted: deletedRead + deletedCalls,
        });
      } catch (error) {
        logger.error('Error in notification cleanup cron:', error);
      }
    });

    // Subscription expiry email reminders — daily at 10 AM UTC
    // Targets users with subscriptions expiring in 7-14 days
    cron.schedule(process.env.SUB_EXPIRY_EMAIL_CRON || '0 10 * * *', async () => {
      try {
        logger.info('Running subscription expiry email reminders...');
        const results = await SubscriptionReminderEmailService.sendExpiryReminders();
        logger.info('Subscription expiry email reminders sent', results);
      } catch (error) {
        logger.error('Error in subscription expiry email reminder cron:', error);
      }
    });

    // Re-engagement emails to churned users — weekly on Monday at 11 AM UTC
    // Targets users who haven't paid in 30+ days
    cron.schedule(process.env.SUB_REENGAGEMENT_CRON || '0 11 * * 1', async () => {
      try {
        logger.info('Running re-engagement email campaign...');
        const results = await SubscriptionReminderEmailService.sendReEngagementEmails();
        logger.info('Re-engagement emails sent', results);
      } catch (error) {
        logger.error('Error in re-engagement email cron:', error);
      }
    });

    // Telegram subscription reminders — daily at 9 AM UTC
    // Sends 3-day and 1-day warnings before subscription expiry via private DM
    if (bot) {
      cron.schedule(process.env.SUB_REMINDER_TELEGRAM_CRON || '0 9 * * *', async () => {
        try {
          logger.info('Running Telegram subscription reminders...');
          const sent3d = await TelegramSubscriptionReminderService.send3DayReminders();
          const sent1d = await TelegramSubscriptionReminderService.send1DayReminders();
          logger.info(`Telegram subscription reminders sent — 3-day: ${sent3d}, 1-day: ${sent1d}`);
        } catch (error) {
          logger.error('Error in Telegram subscription reminder cron:', error);
        }
      });
    }

    // Daily notification digest email — runs at 10 AM UTC
    // Sends an HTML summary of unread notifications to inactive users with verified emails
    cron.schedule(process.env.NOTIFICATION_DIGEST_CRON || '0 10 * * *', async () => {
      try {
        logger.info('Running daily notification digest...');
        await NotificationDigestScheduler.runDigest();
      } catch (error) {
        logger.error('Error in notification digest cron:', error);
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
