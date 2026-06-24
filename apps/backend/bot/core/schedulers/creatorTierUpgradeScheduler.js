'use strict';

const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const notificationEmitter = require('../../../services/notificationEmitter');

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
      // Detect creators whose subscription gate is about to change (cross 10-follower threshold).
      // These are currently Ice tier (creator_subscription_paused = true) but have now reached >= 10 followers.
      const { rows: toUnlock } = await query(
        `SELECT id, username, followers_count
         FROM users
         WHERE creator_status = 'active'
           AND creator_subscription_paused = true
           AND followers_count >= 10`
      );

      // Notify before updating so the message arrives atomically with the unlock.
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

      // Batch-update creator_subscription_paused for all active creators that are out of sync.
      // Sets paused=true when followers_count < 10, paused=false when >= 10.
      const { rows: updated } = await query(
        `UPDATE users SET
           creator_subscription_paused = CASE
             WHEN followers_count >= 10 THEN false
             ELSE true
           END
         WHERE creator_status = 'active'
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
    } catch (err) {
      logger.error(`Creator tier upgrade scheduler error: ${err.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  getStatus() {
    return { isRunning: this.isRunning };
  }
}

module.exports = CreatorTierUpgradeScheduler;
