'use strict';

const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const notificationEmitter = require('../../../services/notificationEmitter');
const CreatorService = require('../../../services/creatorService');

const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

/**
 * Derives the tier label from followers_count.
 * Ice    < 10
 * Crystal >= 10 && < 25
 * Diamond >= 25
 */
function tierFromFollowers(followersCount) {
  if (followersCount >= 25) return 'diamond';
  if (followersCount >= 10) return 'crystal';
  return 'ice';
}

class CreatorTierUpgradeScheduler {
  constructor() {
    this.interval = null;
    this.isRunning = false;
    this.isProcessing = false;
  }

  start() {
    if (this.isRunning) {
      logger.warn('Creator tier upgrade scheduler already running');
      return;
    }

    this.isRunning = true;
    this.runChecks();
    this.interval = setInterval(() => this.runChecks(), CHECK_INTERVAL);
    logger.info('Creator tier upgrade scheduler started (24h interval)');
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      this.isRunning = false;
      logger.info('Creator tier upgrade scheduler stopped');
    }
  }

  async runChecks() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // Batch-update creator_subscription_paused for ice-tier creators only.
      // Crystal/Diamond creators may have manually paused — do not touch them.
      // Sets paused=true when followers_count < 10, paused=false when >= 10.
      // Run the UPDATE first with RETURNING so notifications only fire for rows
      // that were actually changed (prevents repeat notifications on scheduler failure).
      const { rows: updated } = await query(
        `UPDATE users SET
           creator_subscription_paused = CASE
             WHEN followers_count >= 10 THEN false
             ELSE true
           END
         WHERE creator_status = 'active'
           AND creator_type = 'ice'
           AND creator_subscription_paused != (followers_count < 10)
         RETURNING id, username, followers_count, creator_subscription_paused`
      );

      if (updated.length > 0) {
        logger.info(`Creator tier sync: updated ${updated.length} creator(s)`, {
          updates: updated.map((r) => ({
            id: r.id,
            username: r.username,
            followers: r.followers_count,
            subscriptionPaused: r.creator_subscription_paused,
            tier: tierFromFollowers(r.followers_count ?? 0),
          })),
        });
      }

      // Notify only the ice-tier creators that were actually unlocked by this run.
      const toUnlock = updated.filter((r) => r.creator_subscription_paused === false);
      for (const row of toUnlock) {
        try {
          const tier = tierFromFollowers(row.followers_count ?? 0);
          const tierLabel = tier === 'diamond' ? 'Diamond' : 'Crystal';

          await notificationEmitter.emit({
            type: 'creator_tier_unlocked',
            category: 'system',
            priority: 'high',
            targetUserId: row.id,
            entityType: 'creator_tier',
            entityId: String(row.id),
            message: `You reached ${row.followers_count} followers — exclusive content monetization is now unlocked! (${tierLabel} tier)`,
            metadata: { tier, followersCount: row.followers_count },
          });

          logger.info('Creator tier unlock notification sent', {
            userId: row.id,
            username: row.username,
            followers: row.followers_count,
            tier,
          });
        } catch (notifyErr) {
          logger.warn('Creator tier unlock notification failed', {
            userId: row.id,
            error: notifyErr.message,
          });
        }
      }
      // Refresh engagement scores for eligible creators so the admin promote form is always fresh.
      await this.refreshEngagementScores();
    } catch (err) {
      logger.error(`Creator tier upgrade scheduler error: ${err.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  async refreshEngagementScores() {
    try {
      const { rows } = await query(
        `SELECT id FROM users WHERE creator_status IN ('eligible', 'active') AND id IS NOT NULL LIMIT 500`
      );
      let refreshed = 0;
      for (const row of rows) {
        try {
          await CreatorService.calculateEngagementScore(row.id);
          refreshed++;
        } catch (err) {
          logger.warn('Engagement score refresh failed for creator', { userId: row.id, error: err.message });
        }
      }
      if (refreshed > 0) logger.info(`Engagement scores refreshed for ${refreshed} creator(s)`);
    } catch (err) {
      logger.error('refreshEngagementScores error', { error: err.message });
    }
  }

  getStatus() {
    return { isRunning: this.isRunning };
  }
}

module.exports = CreatorTierUpgradeScheduler;
