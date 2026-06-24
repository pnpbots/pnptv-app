'use strict';

const CreatorService = require('../../../services/creatorService');
const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

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
      const { rows: candidates } = await query(
        `SELECT id FROM users
         WHERE creator_status = 'active'
           AND creator_type != 'diamond'
           AND (
             (creator_type = 'ice' AND creator_subscriber_count >= 10)
             OR (creator_type = 'crystal' AND creator_subscriber_count >= 25)
           )`
      );

      if (!candidates.length) return;

      logger.info(`Creator tier upgrade check: ${candidates.length} qualifying creator(s)`);

      for (const row of candidates) {
        try {
          const result = await CreatorService.checkAndUpgradeTier(row.id);
          if (result.upgraded) {
            logger.info('Creator tier auto-upgraded', { userId: row.id, from: result.from, to: result.to });
          }
        } catch (err) {
          logger.error('Creator tier upgrade failed for user', { userId: row.id, error: err.message });
        }
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
