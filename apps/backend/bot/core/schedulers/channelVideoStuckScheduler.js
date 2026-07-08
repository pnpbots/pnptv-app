'use strict';

const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

const CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

class ChannelVideoStuckScheduler {
  constructor() {
    this.interval = null;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.runChecks();
    this.interval = setInterval(() => this.runChecks(), CHECK_INTERVAL);
    logger.info('[channelVideoStuck] Scheduler started (1h interval)');
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.isRunning = false;
  }

  async runChecks() {
    try {
      const result = await query(`
        UPDATE channel_videos
        SET status = 'failed', updated_at = NOW()
        WHERE status = 'processing'
          AND created_at < NOW() - INTERVAL '1 hour'
        RETURNING id, title, channel_id
      `);
      if (result.rows.length > 0) {
        logger.warn('[channelVideoStuck] Flipped stuck processing videos to failed', {
          count: result.rows.length,
          ids: result.rows.map(r => r.id),
        });
      }
    } catch (err) {
      logger.error('[channelVideoStuck] runChecks error', { error: err.message });
    }
  }
}

module.exports = ChannelVideoStuckScheduler;
