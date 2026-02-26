const logger = require('../../utils/logger');
const supportRoutingService = require('./supportRoutingService');

/**
 * SLA Monitor Service
 * Periodically checks for SLA breaches and sends alerts
 */
class SlaMonitor {
  constructor() {
    this.intervalId = null;
    this.isRunning = false;
  }

  /**
   * Start the SLA monitoring service
   * @param {number} intervalMs - Check interval in milliseconds (default: 1 hour)
   */
  start(intervalMs = 3600000) {
    if (this.isRunning) {
      logger.warn('SLA monitor is already running');
      return;
    }

    // Initial check
    this.checkSlaBreaches();

    // Set up periodic checking
    this.intervalId = setInterval(() => {
      this.checkSlaBreaches();
    }, intervalMs);

    this.isRunning = true;
    logger.info('SLA monitor started', { intervalMs });
  }

  /**
   * Stop the SLA monitoring service
   */
  stop() {
    if (!this.isRunning) {
      logger.warn('SLA monitor is not running');
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    logger.info('SLA monitor stopped');
  }

  /**
   * Perform SLA breach check
   */
  async checkSlaBreaches() {
    try {
      logger.info('Running SLA breach check...');
      await supportRoutingService.checkSlaBreaches();
    } catch (error) {
      logger.error('Error in SLA breach check:', error);
    }
  }

  /**
   * Check if monitor is running
   * @returns {boolean} True if monitor is running
   */
  isMonitorRunning() {
    return this.isRunning;
  }
}

// Export singleton instance
const slaMonitor = new SlaMonitor();
module.exports = slaMonitor;