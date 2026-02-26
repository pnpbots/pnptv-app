/**
 * Initialize Async Broadcast Queue
 * Call this from your bot initialization code
 */

const { getAsyncBroadcastQueue } = require('./asyncBroadcastQueue');
const { getBroadcastQueueIntegration } = require('./broadcastQueueIntegration');
const logger = require('../../utils/logger');

/**
 * Initialize the async queue system for broadcasts
 * @param {Object} bot - Telegram bot instance
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Queue integration instance
 */
async function initializeAsyncBroadcastQueue(bot, options = {}) {
  try {
    logger.info('Initializing Async Broadcast Queue...');

    // Configuration defaults
    const config = {
      concurrency: options.concurrency || 2,
      maxAttempts: options.maxAttempts || 3,
      autoStart: options.autoStart !== false,
      ...options,
    };

    // Step 1: Initialize database
    logger.info('Step 1: Initializing database tables...');
    const queue = getAsyncBroadcastQueue();
    await queue.initialize();
    logger.info('✓ Database tables initialized');

    // Step 2: Initialize queue integration
    logger.info('Step 2: Initializing queue integration...');
    const queueIntegration = getBroadcastQueueIntegration();
    await queueIntegration.initialize(bot);
    logger.info('✓ Queue integration initialized');

    // Step 3: Start processing if enabled
    if (config.autoStart) {
      logger.info(`Step 3: Starting queue processor (concurrency: ${config.concurrency})...`);
      await queueIntegration.start(config.concurrency);
      logger.info('✓ Queue processor started');
    }

    // Step 4: Log status
    const status = await queueIntegration.getStatus();
    logger.info('Queue Status:', {
      running: queue.isProcessorRunning(),
      queues: status.queues,
      activeJobs: status.activeJobs,
    });

    logger.info('✓ Async Broadcast Queue initialized successfully');

    return queueIntegration;
  } catch (error) {
    logger.error('Error initializing Async Broadcast Queue:', error);
    throw error;
  }
}

module.exports = {
  initializeAsyncBroadcastQueue,
};
