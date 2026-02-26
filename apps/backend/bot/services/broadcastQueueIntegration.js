/**
 * Broadcast Queue Integration Service
 * Integrates AsyncBroadcastQueue with EnhancedBroadcastService
 * Handles async broadcast processing, retries, and monitoring
 */

const { getAsyncBroadcastQueue } = require('./asyncBroadcastQueue');
const { getEnhancedBroadcastService } = require('./enhancedBroadcastService');
const logger = require('../../utils/logger');

class BroadcastQueueIntegration {
  constructor() {
    this.queue = getAsyncBroadcastQueue();
    this.broadcastService = getEnhancedBroadcastService();
    this.initialized = false;
    this.retryIntervalId = null;
    this.cleanupIntervalId = null;
    this.cleanupTimeoutId = null;
    this.schedulersStarted = false;
  }

  /**
   * Initialize the broadcast queue integration
   * @param {Object} bot - Telegram bot instance
   * @returns {Promise<void>}
   */
  async initialize(bot) {
    try {
      if (this.initialized) {
        return;
      }

      // Initialize queue
      await this.queue.initialize();

      // Register broadcast processor
      this.queue.registerProcessor('send_broadcast', async (jobData) => {
        return await this.processBroadcast(bot, jobData);
      });

      // Register retry processor
      this.queue.registerProcessor('process_retries', async (jobData) => {
        return await this.processRetryQueue(bot, jobData);
      });

      // Register segment broadcast processor
      this.queue.registerProcessor('send_segment_broadcast', async (jobData) => {
        return await this.processSegmentBroadcast(bot, jobData);
      });

      // Register cleanup processor
      this.queue.registerProcessor('cleanup_queue', async (jobData) => {
        return await this.cleanupQueue(jobData);
      });

      this.initialized = true;
      logger.info('Broadcast Queue Integration initialized');
    } catch (error) {
      logger.error('Error initializing Broadcast Queue Integration:', error);
      throw error;
    }
  }

  /**
   * Start async broadcast processing
   * @param {number} concurrency - Number of concurrent broadcast jobs
   * @param {number} retryJobs - Max concurrent retry jobs
   * @returns {Promise<void>}
   */
  async start(concurrency = 2, retryJobs = 5) {
    try {
      if (!this.initialized) {
        throw new Error('Broadcast Queue Integration not initialized');
      }

      if (!this.queue.isProcessorRunning()) {
        await this.queue.start(concurrency);
      }

      this.startSchedulers();

      logger.info(`Broadcast Queue Integration started (concurrency: ${concurrency})`);
    } catch (error) {
      logger.error('Error starting Broadcast Queue Integration:', error);
      throw error;
    }
  }

  /**
   * Stop async broadcast processing
   * @returns {Promise<void>}
   */
  async stop() {
    try {
      await this.queue.stop();
      this.stopSchedulers();
      logger.info('Broadcast Queue Integration stopped');
    } catch (error) {
      logger.error('Error stopping Broadcast Queue Integration:', error);
      throw error;
    }
  }

  /**
   * Queue a broadcast for async processing
   * @param {string} broadcastId - Broadcast ID
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Queued job
   */
  async queueBroadcast(broadcastId, options = {}) {
    try {
      const job = await this.queue.addJob(
        'broadcasts',
        'send_broadcast',
        {
          broadcastId,
          userId: options.userId || null,
          timestamp: new Date(),
        },
        {
          maxAttempts: options.maxAttempts || 3,
          delay: options.delay || 0,
        }
      );

      logger.info(`Broadcast ${broadcastId} queued for processing (job: ${job.job_id})`);
      return job;
    } catch (error) {
      logger.error('Error queuing broadcast:', error);
      throw error;
    }
  }

  /**
   * Queue multiple broadcasts in batch
   * @param {Array} broadcasts - Array of broadcast objects
   * @param {Object} options - Batch options
   * @returns {Promise<Array>} Array of queued jobs
   */
  async queueBroadcastBatch(broadcasts, options = {}) {
    try {
      const jobsData = broadcasts.map((broadcast) => ({
        broadcastId: broadcast.broadcast_id || broadcast.id,
        userId: options.userId || null,
        timestamp: new Date(),
      }));

      const jobs = await this.queue.addBatch(
        'broadcasts',
        'send_broadcast',
        jobsData,
        {
          maxAttempts: options.maxAttempts || 3,
          delayPerJob: options.delayPerJob || 0,
        }
      );

      logger.info(`${broadcasts.length} broadcasts queued for processing`);
      return jobs;
    } catch (error) {
      logger.error('Error queuing broadcast batch:', error);
      throw error;
    }
  }

  /**
   * Queue a segment broadcast for async processing
   * @param {string} broadcastId - Broadcast ID
   * @param {string} segmentId - Segment ID
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Queued job
   */
  async queueSegmentBroadcast(broadcastId, segmentId, options = {}) {
    try {
      const job = await this.queue.addJob(
        'segment-broadcasts',
        'send_segment_broadcast',
        {
          broadcastId,
          segmentId,
          timestamp: new Date(),
        },
        {
          maxAttempts: options.maxAttempts || 3,
          delay: options.delay || 0,
        }
      );

      logger.info(
        `Segment broadcast ${broadcastId}/${segmentId} queued (job: ${job.job_id})`
      );
      return job;
    } catch (error) {
      logger.error('Error queuing segment broadcast:', error);
      throw error;
    }
  }

  /**
   * Process a broadcast job (internal)
   * @private
   */
  async processBroadcast(bot, jobData) {
    try {
      logger.info(`Processing broadcast job: ${jobData.broadcastId}`);

      const result = await this.broadcastService.sendBroadcastWithEnhancements(
        bot,
        jobData.broadcastId
      );

      logger.info(
        `Broadcast ${jobData.broadcastId} completed: ${result.sent} sent, ${result.failed} failed`
      );

      return {
        success: true,
        broadcastId: jobData.broadcastId,
        ...result,
      };
    } catch (error) {
      logger.error(`Error processing broadcast ${jobData.broadcastId}:`, error);
      throw error;
    }
  }

  /**
   * Process retry queue job (internal)
   * @private
   */
  async processRetryQueue(bot, jobData) {
    try {
      logger.info('Processing retry queue');

      const result = await this.broadcastService.processRetryQueue(bot);

      logger.info(
        `Retry queue processed: ${result.processed} jobs, ${result.succeeded} succeeded, ${result.failed} failed`
      );

      return result;
    } catch (error) {
      logger.error('Error processing retry queue:', error);
      throw error;
    }
  }

  /**
   * Process segment broadcast job (internal)
   * @private
   */
  async processSegmentBroadcast(bot, jobData) {
    try {
      logger.info(
        `Processing segment broadcast: ${jobData.broadcastId}/${jobData.segmentId}`
      );

      const result = await this.broadcastService.sendBroadcastToSegment(
        bot,
        jobData.broadcastId,
        jobData.segmentId
      );

      logger.info(
        `Segment broadcast completed: ${result.sent} sent, ${result.failed} failed`
      );

      return {
        success: true,
        broadcastId: jobData.broadcastId,
        segmentId: jobData.segmentId,
        ...result,
      };
    } catch (error) {
      logger.error(
        `Error processing segment broadcast ${jobData.broadcastId}/${jobData.segmentId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Cleanup old queue jobs (internal)
   * @private
   */
  async cleanupQueue(jobData) {
    try {
      logger.info('Starting queue cleanup');

      const daysOld = jobData.daysOld || 7;
      const queues = ['broadcasts', 'segment-broadcasts', 'retries'];

      let totalCleared = 0;
      for (const queueName of queues) {
        const cleared = await this.queue.clearCompletedJobs(queueName, daysOld);
        totalCleared += cleared;
      }

      logger.info(`Queue cleanup completed: ${totalCleared} jobs cleared`);
      return { success: true, jobsCleared: totalCleared };
    } catch (error) {
      logger.error('Error cleaning up queue:', error);
      throw error;
    }
  }

  /**
   * Setup periodic retry processing
   * @private
   */
  startSchedulers() {
    if (this.schedulersStarted) return;
    this.setupRetryScheduler();
    this.setupCleanupScheduler();
    this.schedulersStarted = true;
  }

  stopSchedulers() {
    if (this.retryIntervalId) {
      clearInterval(this.retryIntervalId);
      this.retryIntervalId = null;
    }
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
    if (this.cleanupTimeoutId) {
      clearTimeout(this.cleanupTimeoutId);
      this.cleanupTimeoutId = null;
    }
    this.schedulersStarted = false;
  }

  setupRetryScheduler() {
    // Process retries every 5 minutes
    if (this.retryIntervalId) return;
    this.retryIntervalId = setInterval(async () => {
      try {
        await this.queue.addJob(
          'retries',
          'process_retries',
          { timestamp: new Date() },
          { maxAttempts: 1 }
        );
      } catch (error) {
        logger.error('Error scheduling retry processor:', error);
      }
    }, 5 * 60 * 1000);

    logger.info('Retry scheduler started (every 5 minutes)');
  }

  /**
   * Setup periodic cleanup
   * @private
   */
  setupCleanupScheduler() {
    if (this.cleanupTimeoutId || this.cleanupIntervalId) return;
    // Cleanup old jobs daily at 2 AM
    const now = new Date();
    const target = new Date();
    target.setHours(2, 0, 0, 0);

    if (target <= now) {
      target.setDate(target.getDate() + 1);
    }

    const delay = target - now;

    this.cleanupTimeoutId = setTimeout(() => {
      this.queue.addJob(
        'cleanup',
        'cleanup_queue',
        { daysOld: 7 },
        { maxAttempts: 1 }
      );

      // Then repeat daily
      this.cleanupIntervalId = setInterval(async () => {
        try {
          await this.queue.addJob(
            'cleanup',
            'cleanup_queue',
            { daysOld: 7 },
            { maxAttempts: 1 }
          );
        } catch (error) {
          logger.error('Error scheduling cleanup:', error);
        }
      }, 24 * 60 * 60 * 1000); // Every 24 hours
    }, delay);

    logger.info(`Cleanup scheduler started (daily at 2 AM)`);
  }

  /**
   * Get queue status summary
   * @returns {Promise<Object>} Queue status
   */
  async getStatus() {
    try {
      const statuses = await this.queue.getAllQueueStatuses();
      const stats = await this.queue.getStatistics();

      return {
        running: this.queue.isProcessorRunning(),
        queues: statuses,
        statistics: stats,
        activeJobs: this.queue.getActiveJobsCount(),
        timestamp: new Date(),
      };
    } catch (error) {
      logger.error('Error getting queue status:', error);
      return { error: error.message };
    }
  }

  /**
   * Get failed broadcasts
   * @param {number} limit - Number of failed jobs to retrieve
   * @returns {Promise<Array>} Failed broadcast jobs
   */
  async getFailedBroadcasts(limit = 50) {
    try {
      return await this.queue.getFailedJobs('broadcasts', limit);
    } catch (error) {
      logger.error('Error getting failed broadcasts:', error);
      return [];
    }
  }

  /**
   * Retry a failed broadcast
   * @param {string} jobId - Job ID
   * @returns {Promise<void>}
   */
  async retryFailedBroadcast(jobId) {
    try {
      await this.queue.retryJob(jobId);
      logger.info(`Failed broadcast ${jobId} scheduled for retry`);
    } catch (error) {
      logger.error('Error retrying failed broadcast:', error);
      throw error;
    }
  }

  /**
   * Get detailed job info
   * @param {string} jobId - Job ID
   * @returns {Promise<Object>} Job details
   */
  async getJobDetails(jobId) {
    try {
      return await this.queue.getJob(jobId);
    } catch (error) {
      logger.error('Error getting job details:', error);
      throw error;
    }
  }
}

// Singleton instance
let instance = null;

function getBroadcastQueueIntegration() {
  if (!instance) {
    instance = new BroadcastQueueIntegration();
  }
  return instance;
}

module.exports = {
  BroadcastQueueIntegration,
  getBroadcastQueueIntegration,
};
