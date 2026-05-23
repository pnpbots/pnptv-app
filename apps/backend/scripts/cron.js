require('dotenv').config({ allowEmptyValues: true });
const path = require('path');
const cron = require('node-cron');

// Use absolute paths based on script location
const basePath = __dirname;
const backendPath = path.join(basePath, '..');

const { initializeRedis } = require(path.join(backendPath, 'config/redis'));
const { initializePostgres } = require(path.join(backendPath, 'config/postgres'));
const { refreshEpaycoCopRate } = require(path.join(backendPath, 'services/paymentService'));
const UserService = require(path.join(backendPath, 'services/userService'));
const MembershipCleanupService = require(path.join(backendPath, 'services/membershipCleanupService'));
const TutorialReminderService = require(path.join(backendPath, 'services/tutorialReminderService'));
const CultEventService = require(path.join(backendPath, 'services/cultEventService'));
const logger = require(path.join(backendPath, 'utils/logger'));
const PaymentRecoveryService = require(path.join(backendPath, 'services/paymentRecoveryService'));
const MediaCleanupService = require(path.join(backendPath, 'services/mediaCleanupService'));
const CreatorService = require(path.join(backendPath, 'services/creatorService'));
const CreatorPayoutService = require(path.join(backendPath, 'services/creatorPayoutService'));
const SubscriptionReminderEmailService = require(path.join(backendPath, 'services/subscriptionReminderEmailService'));
const TelegramSubscriptionReminderService = require(path.join(backendPath, 'services/subscriptionReminderService'));
const NotificationDigestScheduler = require(path.join(backendPath, 'services/notificationDigestScheduler'));
const AppUserService = require(path.join(backendPath, 'services/userService'));
const CristinaFeedService = require(path.join(backendPath, 'services/cristinaFeedService'));
const StreamRecordingService = require(path.join(backendPath, 'services/streamRecordingService'));

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

    // Daimo payment recovery — DISABLED (Daimo retired, all checkout surfaces
    // moved to Dash/BTCPay). Webhook handler at /api/webhooks/daimo stays
    // wired so any straggler settlement still credits the user, but the
    // 5-min polling loop is gone. Zero pending Daimo rows existed at cutover
    // (verified via DB query). To re-enable temporarily during incident
    // response, uncomment and set DAIMO_RECOVERY_CRON in env.

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

    // Dash/BTCPay reconciliation — every 30 min
    // Polls BTCPay for stuck pending invoices (missed webhooks) and either
    // marks them terminal (Expired/Invalid) or logs Settled-but-unprocessed
    // for operator replay. Idempotent and respects per-run Redis lock.
    cron.schedule(process.env.DASH_RECONCILE_CRON || '*/30 * * * *', async () => {
      try {
        logger.info('Running Dash/BTCPay reconciliation...');
        const results = await PaymentRecoveryService.processStuckDashInvoices();
        logger.info('Dash/BTCPay reconciliation completed', {
          checked: results.checked,
          settled: results.settled,
          expired: results.expired,
          invalid: results.invalid,
          stillPending: results.stillPending,
          errors: results.errors,
        });
      } catch (error) {
        logger.error('Error in Dash reconciliation cron:', error);
      }
    });

    // Meru lifetime100 reconciliation — every 15 min
    // Meru does not deliver webhooks; users must come back and POST /activate
    // after paying. If they don't, the link stays paid forever and we never
    // grant entitlements. This cron polls Meru for every meru_payment_link in
    // 'active'/'reserved' state and: auto-heals if reservation owner is known,
    // alerts ops if orphan (paid by direct-share with no reservation).
    // 18 stuck payments accumulated over 5 months before this cron existed.
    cron.schedule(process.env.MERU_RECONCILE_CRON || '7,22,37,52 * * * *', async () => {
      try {
        const results = await PaymentRecoveryService.processStuckMeruPayments();
        logger.info('Meru reconciliation completed', {
          checked: results.checked,
          autoHealed: results.autoHealed,
          orphans: results.orphans,
          stillUnpaid: results.stillUnpaid,
          errors: results.errors,
        });
      } catch (error) {
        logger.error('Error in Meru reconciliation cron:', error);
      }
    });

    // Stripe payment reconciliation — every 30 min
    // Covers the crash-after-idempotency-mark failure mode: webhook sets Redis key
    // then dies before granting entitlements, leaving the payments row stuck pending.
    // processStripeCheckout is idempotent; expired sessions are marked abandoned.
    cron.schedule(process.env.STRIPE_RECONCILE_CRON || '*/30 * * * *', async () => {
      try {
        const results = await PaymentRecoveryService.processStuckStripePayments();
        if (results.recovered > 0 || results.failed > 0) {
          logger.info('Stripe reconciliation completed', results);
        }
      } catch (error) {
        logger.error('Error in Stripe reconciliation cron:', error);
      }
    });

    // Video leak detector — every hour at :17
    // Scans video_fetch_log over the last 60 min and alerts the operator
    // group when an exclusive video URL has been fetched by 3+ distinct
    // user_ids OR 5+ distinct IPs — the signature of a paid user sharing
    // a URL on Twitter/Discord and randos piling on. The hotlink + entitlement
    // gates already block most leak attempts (those return 401/403 and don't
    // make it into the log) but a paid user who hands their cookie to friends
    // is still a leak vector this catches.
    cron.schedule(process.env.VIDEO_LEAK_DETECTOR_CRON || '17 * * * *', async () => {
      try {
        const { query } = require(path.join(backendPath, 'config/postgres'));
        const { rows: suspects } = await query(`
          SELECT vfl.media_url,
                 COUNT(DISTINCT vfl.user_id) FILTER (WHERE vfl.user_id IS NOT NULL) AS distinct_users,
                 COUNT(DISTINCT vfl.ip_address) FILTER (WHERE vfl.ip_address IS NOT NULL) AS distinct_ips,
                 COUNT(*) AS total_fetches
          FROM video_fetch_log vfl
          JOIN social_posts sp ON sp.media_url = vfl.media_url
          WHERE vfl.fetched_at > NOW() - INTERVAL '60 minutes'
            AND (sp.is_exclusive = true OR COALESCE(sp.content_tier, 'free') = 'prime')
            AND sp.is_deleted = false
          GROUP BY vfl.media_url
          HAVING COUNT(DISTINCT vfl.user_id) FILTER (WHERE vfl.user_id IS NOT NULL) >= 3
              OR COUNT(DISTINCT vfl.ip_address) FILTER (WHERE vfl.ip_address IS NOT NULL) >= 5
          ORDER BY distinct_users DESC, distinct_ips DESC
          LIMIT 10
        `);

        if (suspects.length === 0) {
          logger.info('Video leak detector: no suspicious patterns in the last hour');
          return;
        }

        // Throttle alerts to one per 6h per URL via Redis.
        const { cache } = require(path.join(backendPath, 'config/redis'));
        const fresh = [];
        for (const s of suspects) {
          const tk = `videoLeakAlert:${s.media_url}`;
          const got = await cache.acquireLock(tk, 6 * 3600);
          if (got) fresh.push(s);
        }
        if (fresh.length === 0) return;

        const BusinessNotificationService = require(path.join(backendPath, 'services/businessNotificationService'));
        const lines = [
          '🟠 <b>Possible video URL leak detected</b>',
          '',
          `${fresh.length} exclusive video URL(s) fetched by suspicious patterns in the last hour:`,
          '',
          ...fresh.map(s => `• <code>${s.media_url}</code>\n  ${s.distinct_users} users, ${s.distinct_ips} IPs, ${s.total_fetches} fetches`),
          '',
          'Investigate: the entitlement gate already blocks unauthorized fetches, so these are PRIME users hitting the same URL — likely a shared cookie or a screen-share. Consider rotating the post or revoking the leaker.',
        ].join('\n');
        await BusinessNotificationService.send(lines);
        logger.warn('Video leak detector: alert dispatched', { count: fresh.length });
      } catch (error) {
        logger.error('Error in video leak detector cron:', error);
      }
    });

    // Video fetch log retention — daily at 03:13 UTC
    cron.schedule(process.env.VIDEO_LOG_CLEANUP_CRON || '13 3 * * *', async () => {
      try {
        const { query } = require(path.join(backendPath, 'config/postgres'));
        const result = await query(
          `DELETE FROM video_fetch_log WHERE fetched_at < NOW() - INTERVAL '14 days'`
        );
        logger.info('Video fetch log retention sweep completed', { deleted: result.rowCount });
      } catch (error) {
        logger.error('Error in video log cleanup cron:', error);
      }
    });

    // BTCPay webhook URL probe — daily at 06:30 UTC
    // Catches the exact failure mode that caused the Apr-2026 incident: BTCPay
    // store webhook silently pointing at a 404 URL. Calls verifyWebhookRegistration
    // (config/btcpay.js) and dispatches a P0 alert if the configured URL drifts
    // from the expected handler path.
    cron.schedule(process.env.BTCPAY_WEBHOOK_PROBE_CRON || '30 6 * * *', async () => {
      try {
        const btcpay = require(path.join(backendPath, 'config/btcpay'));
        if (!btcpay.isConfigured) {
          logger.info('BTCPay webhook probe: BTCPay not configured — skipping');
          return;
        }
        const expectedUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/api/webhooks/btcpay`;
        const result = await btcpay.verifyWebhookRegistration({ expectedUrl });
        if (result.ok) {
          logger.info('BTCPay webhook probe: OK', { url: result.url });
          return;
        }
        logger.error('BTCPay webhook probe: MISCONFIGURED', result);
        try {
          const BusinessNotificationService = require(path.join(backendPath, 'services/businessNotificationService'));
          const reasonLine = result.reason === 'url_mismatch'
            ? `URL mismatch — expected ${result.expected}, found ${(result.foundUrls || []).join(', ') || '(none)'}`
            : `Reason: ${result.reason}${result.detail ? ` — ${result.detail}` : ''}`;
          await BusinessNotificationService.send([
            '🔴 <b>P0 ALERT — BTCPay webhook misconfigured</b>',
            '',
            reasonLine,
            '',
            'Action: BTCPay → Settings → Webhooks. Set URL + secret. The Apr-2026 incident took 7 weeks to spot — do not delay.',
          ].join('\n'));
        } catch (alertErr) {
          logger.warn('BTCPay webhook probe alert dispatch failed', { error: alertErr.message });
        }
      } catch (error) {
        logger.error('Error in BTCPay webhook probe cron:', error);
      }
    });

    // ── ePayco USD→COP FX rate refresh — daily at 06:00 UTC ─────────────────
    // PNPtv displays prices in USD to international users but settles via ePayco's
    // Colombian acquiring network in COP. A stale rate means every transaction
    // is systematically mis-priced. The cron keeps the Redis key fresh; the
    // self-heal path in getEpaycoCopRate() covers missed-cron windows.
    cron.schedule('0 6 * * *', async () => {
      try {
        const rate = await refreshEpaycoCopRate();
        logger.info('[ePayco FX] Daily rate refresh completed', { rate });
      } catch (err) {
        logger.error('[ePayco FX] Daily rate refresh FAILED — next request will self-heal or fail closed', {
          error: err.message,
        });
      }
    }, { timezone: 'UTC' });

    // Boot-time FX fetch — runs once when cron jobs start.
    // Ensures the rate is available immediately on first deploy without waiting for 06:00 UTC.
    setImmediate(async () => {
      try {
        const rate = await refreshEpaycoCopRate();
        logger.info('[ePayco FX] Boot-time rate fetch completed', { rate });
      } catch (err) {
        logger.error('[ePayco FX] Boot-time rate fetch failed (next request will self-heal or fail closed)', {
          error: err.message,
        });
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

    // Performer eligibility enforcement — daily at 7 AM UTC
    // Revokes creator role from performers who no longer have a profile photo
    // or whose activity score drops below the top 10% threshold.
    cron.schedule('0 7 * * *', async () => {
      try {
        logger.info('Running performer eligibility enforcement...');
        const results = await AppUserService.enforcePerformerEligibility();
        logger.info('Performer eligibility enforcement completed', {
          revoked: results.revoked.length,
          kept: results.kept.length,
          threshold: results.threshold,
          revokedUsers: results.revoked.map(r => r.username),
        });
      } catch (error) {
        logger.error('Error in performer eligibility cron:', error);
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
    // Deletes old avatars, orphaned post media, and stale DM media files.
    cron.schedule(process.env.MEDIA_CLEANUP_CRON || '0 3 * * *', async () => {
      try {
        logger.info('Running media cleanup job...');
        await MediaCleanupService.cleanupOldAvatars();
        await MediaCleanupService.cleanupOldPostMedia(90); // Keep posts 90 days
        await MediaCleanupService.cleanupOldDmMedia(parseInt(process.env.DM_MEDIA_RETENTION_DAYS, 10) || 30);
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

    // NOTE: The recurring-payments cron schedules (VisaCybersourceService.processDuePayments)
    // were removed with the rest of the visaCybersource cleanup. The service never
    // worked in production — config/payment.config.js did not exist so the axios
    // endpoint was always `undefined/...`. Real recurring renewals happen via the
    // ePayco / Daimo / BTCPay webhook paths which call grantEntitlementsForPlan
    // with the payment row's metadata.

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

    // ── Channel/Hangout Subscription Renewals — daily at 09:15 UTC ──────────
    // Mirrors the creator renewal pattern for channel-access and hangout-access
    // entitlements. Creates a Dash invoice 3 days before expiry and notifies
    // the subscriber. expires_at extends only when BTCPay webhook confirms payment.
    // Runs 15 min after creator renewal to spread DB load.
    cron.schedule(process.env.CHANNEL_HANGOUT_RENEWAL_CRON || '15 9 * * *', async () => {
      try {
        logger.info('Running channel/hangout scoped subscription renewal...');
        const results = await CreatorPayoutService.runScopedSubscriptionRenewals();
        logger.info('Channel/hangout renewal completed', results);
      } catch (error) {
        logger.error('Error in channel/hangout renewal cron:', error);
      }
    });

    // ── Creator Monthly Payouts — 1st of month at 00:00 UTC ─────────────────
    // Groups all `available` creator_earnings by creator, creates ONE BTCPay
    // Pull Payment in Dash per creator (creator claims via emailed link).
    // Falls back to fiat off-ramp via Peer Protocol when payout_method='fiat'.
    // Skips creators with no Dash address + no fiat method (notifies them).
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

    // ── Creator earnings maturation — hourly ─────────────────────────────────
    // Flips 'holding' earnings rows to 'available' once their available_at has passed.
    // This enforces the 72-hour hold window between earning record insertion and payout eligibility.
    const { query: pgQuery } = require(path.join(backendPath, 'config/postgres'));
    cron.schedule('0 * * * *', async () => {
      try {
        const { rows } = await pgQuery(`
          UPDATE creator_earnings
             SET status = 'available'
           WHERE status = 'holding'
             AND available_at <= NOW()
          RETURNING id, creator_id, amount_creator
        `);
        if (rows.length > 0) {
          logger.info('creator earnings matured', { count: rows.length });
        }
      } catch (error) {
        logger.error('Error in creator earnings maturation cron:', error);
      }
    });

    // Hangout subgroup inactivity cleanup - hourly
    // Deletes user-created hangout groups inactive for 72+ hours (CASCADE handles members, calls, messages)
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

    // ── Cristina AI social feed posts ─────────────────────────────────────────
    // Posts rotate: wellness → feature tutorial → PRIME promo → feature tutorial
    // Spread across the day to keep the feed lively without spamming.

    // Wellness tip — 10:00 AM UTC (morning check-in)
    cron.schedule(process.env.CRISTINA_WELLNESS_CRON || '0 10 * * *', async () => {
      try {
        logger.info('CristinaFeed: posting wellness tip...');
        await CristinaFeedService.postWellness();
      } catch (error) {
        logger.error('CristinaFeed: wellness cron error', { error: error.message });
      }
    });

    // Feature tutorial #1 — 2:00 PM UTC (afternoon engagement)
    cron.schedule(process.env.CRISTINA_TUTORIAL1_CRON || '0 14 * * *', async () => {
      try {
        logger.info('CristinaFeed: posting feature tutorial...');
        await CristinaFeedService.postFeatureTutorial();
      } catch (error) {
        logger.error('CristinaFeed: tutorial cron error', { error: error.message });
      }
    });

    // PRIME promo — 6:00 PM UTC (evening conversion window)
    cron.schedule(process.env.CRISTINA_PROMO_CRON || '0 18 * * *', async () => {
      try {
        logger.info('CristinaFeed: posting PRIME promo...');
        await CristinaFeedService.postPrimePromo();
      } catch (error) {
        logger.error('CristinaFeed: promo cron error', { error: error.message });
      }
    });

    // Feature tutorial #2 — 10:00 PM UTC (late-night engagement)
    cron.schedule(process.env.CRISTINA_TUTORIAL2_CRON || '0 22 * * *', async () => {
      try {
        logger.info('CristinaFeed: posting feature tutorial...');
        await CristinaFeedService.postFeatureTutorial();
      } catch (error) {
        logger.error('CristinaFeed: tutorial cron error', { error: error.message });
      }
    });

    // VOD recording retention — daily at 03:00 UTC
    // Deletes completed recordings older than 7 days and removes their HLS files.
    cron.schedule(process.env.RECORDING_EXPIRY_CRON || '0 3 * * *', async () => {
      try {
        logger.info('Running VOD recording retention cleanup...');
        await StreamRecordingService.expireOldRecordings(7);
      } catch (error) {
        logger.error('Error in VOD recording retention cron:', error);
      }
    });

    // Release expired Meru reservations back to the active pool every 5 minutes
    const meruLinkService = require(path.join(backendPath, 'services/meruLinkService'));
    cron.schedule(process.env.MERU_RESERVATION_CLEANUP_CRON || '*/5 * * * *', async () => {
      try {
        const released = await meruLinkService.releaseExpiredReservations();
        if (released > 0) {
          logger.info('Meru reservation cleanup', { released });
        }
      } catch (error) {
        logger.error('Meru reservation cleanup error:', error);
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
