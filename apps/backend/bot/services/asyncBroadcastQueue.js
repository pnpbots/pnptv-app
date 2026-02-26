/**
 * Async Broadcast Queue Service
 * Handles asynchronous broadcast job processing using PostgreSQL-backed queue
 * Features: Job queuing, async processing, exponential backoff retries, monitoring
 */

const { getPool } = require('../../config/postgres');
const logger = require('../../utils/logger');
const { v4: uuidv4 } = require('uuid');

class AsyncBroadcastQueue {
  constructor() {
    this.jobProcessors = new Map();
    this.isRunning = false;
    this.processingInterval = null;
    this.maxConcurrentJobs = 2;
    this.activeJobs = new Set();
    this.tablesInitialized = false;
    this.pollIntervalMs = parseInt(process.env.BROADCAST_QUEUE_POLL_INTERVAL_MS, 10) || 1000;
    this.retryBaseDelayMs = parseInt(process.env.BROADCAST_QUEUE_RETRY_DELAY_MS, 10) || 60000;
  }

  /**
   * Initialize queue with database schema
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      if (this.tablesInitialized) {
        return;
      }

      // Create queue tables if they don't exist
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS broadcast_queue_jobs (
          id SERIAL PRIMARY KEY,
          job_id UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
          queue_name VARCHAR(50) NOT NULL,
          job_type VARCHAR(50) NOT NULL,
          job_data JSONB NOT NULL,
          status VARCHAR(50) DEFAULT 'pending',
          attempts INTEGER DEFAULT 0,
          max_attempts INTEGER DEFAULT 3,
          error_message TEXT,
          result JSONB,
          scheduled_at TIMESTAMP,
          started_at TIMESTAMP,
          completed_at TIMESTAMP,
          next_retry_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_queue_jobs_status ON broadcast_queue_jobs(status);
        CREATE INDEX IF NOT EXISTS idx_queue_jobs_queue_name ON broadcast_queue_jobs(queue_name);
        CREATE INDEX IF NOT EXISTS idx_queue_jobs_next_retry ON broadcast_queue_jobs(next_retry_at);
        CREATE INDEX IF NOT EXISTS idx_queue_jobs_created_at ON broadcast_queue_jobs(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_queue_jobs_scheduled_at ON broadcast_queue_jobs(scheduled_at);
      `;

      await getPool().query(createTableQuery);
      this.tablesInitialized = true;
      logger.info('Broadcast queue tables initialized');
    } catch (error) {
      logger.error('Error initializing queue tables:', error);
      throw error;
    }
  }

  /**
   * Register a job processor function
   * @param {string} jobType - Type of job (e.g., 'broadcast', 'retry')
   * @param {Function} processor - Async function to process the job
   */
  registerProcessor(jobType, processor) {
    if (typeof processor !== 'function') {
      throw new Error('Processor must be a function');
    }
    this.jobProcessors.set(jobType, processor);
    logger.info(`Job processor registered for: ${jobType}`);
  }

  /**
   * Add a job to the queue
   * @param {string} queueName - Name of the queue
   * @param {string} jobType - Type of job
   * @param {Object} jobData - Job data to process
   * @param {Object} options - Job options (maxAttempts, delay, etc.)
   * @returns {Promise<Object>} Created job record
   */
  async addJob(queueName, jobType, jobData, options = {}) {
    try {
      const jobId = uuidv4();
      const maxAttempts = options.maxAttempts || 3;
      const delay = options.delay || 0;
      const scheduledAt = new Date(Date.now() + delay);

      const query = `
        INSERT INTO broadcast_queue_jobs
          (job_id, queue_name, job_type, job_data, status, max_attempts, scheduled_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;

      const result = await getPool().query(query, [
        jobId,
        queueName,
        jobType,
        JSON.stringify(jobData),
        'pending',
        maxAttempts,
        scheduledAt,
      ]);

      logger.info(`Job added to queue: ${queueName}/${jobType} (${jobId})`);
      return result.rows[0];
    } catch (error) {
      logger.error('Error adding job:', error);
      throw error;
    }
  }

  /**
   * Add multiple jobs in a batch
   * @param {string} queueName - Name of the queue
   * @param {string} jobType - Type of job
   * @param {Array} jobsData - Array of job data objects
   * @param {Object} options - Batch options
   * @returns {Promise<Array>} Array of created jobs
   */
  async addBatch(queueName, jobType, jobsData, options = {}) {
    try {
      const jobs = [];
      const delayPerJob = options.delayPerJob || 0;

      for (let i = 0; i < jobsData.length; i++) {
        const job = await this.addJob(queueName, jobType, jobsData[i], {
          maxAttempts: options.maxAttempts || 3,
          delay: delayPerJob * i,
        });
        jobs.push(job);
      }

      logger.info(`Batch added to queue: ${jobsData.length} jobs to ${queueName}`);
      return jobs;
    } catch (error) {
      logger.error('Error adding batch:', error);
      throw error;
    }
  }

  /**
   * Start queue processor with specified concurrency
   * @param {number} concurrency - Number of concurrent jobs to process
   * @returns {Promise<void>}
   */
  async start(concurrency = 2) {
    if (this.isRunning) {
      logger.warn('Queue processor already running');
      return;
    }

    if (!this.tablesInitialized) {
      await this.initialize();
    }

    this.maxConcurrentJobs = concurrency;
    this.isRunning = true;

    // Start processing loop
    this.processingInterval = setInterval(() => {
      this.processNextJobs().catch((error) => {
        logger.error('Error in queue processing loop:', error);
      });
    }, this.pollIntervalMs); // Check on configured interval

    logger.info(`Queue processor started (concurrency: ${concurrency})`);
  }

  /**
   * Stop queue processor gracefully
   * @returns {Promise<void>}
   */
  async stop() {
    this.isRunning = false;

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }

    // Wait for active jobs to complete
    let maxWait = 30000; // 30 seconds
    const startTime = Date.now();

    while (this.activeJobs.size > 0 && Date.now() - startTime < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    logger.info('Queue processor stopped');
  }

  /**
   * Process next available jobs (internal)
   * @private
   */
  async processNextJobs() {
    try {
      if (!this.isRunning) {
        return;
      }

      // Check if we can process more jobs
      if (this.activeJobs.size >= this.maxConcurrentJobs) {
        return;
      }

      // Get pending jobs
      const availableSlots = this.maxConcurrentJobs - this.activeJobs.size;
      const pendingJobs = await this.getPendingJobs(availableSlots);

      for (const job of pendingJobs) {
        // Mark job as processing
        await this.updateJobStatus(job.job_id, 'processing', null, new Date());

        // Process job asynchronously (don't await)
        this.activeJobs.add(job.job_id);

        this.processJob(job)
          .then(() => {
            this.activeJobs.delete(job.job_id);
          })
          .catch(() => {
            this.activeJobs.delete(job.job_id);
          });
      }
    } catch (error) {
      logger.error('Error in processNextJobs:', error);
    }
  }

  /**
   * Get pending jobs from database (internal)
   * @private
   */
  async getPendingJobs(limit = 5) {
    try {
      const query = `
        SELECT * FROM broadcast_queue_jobs
        WHERE status IN ('pending', 'retry')
        AND (scheduled_at IS NULL OR scheduled_at <= CURRENT_TIMESTAMP)
        AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
        ORDER BY created_at ASC
        LIMIT $1
      `;

      const result = await getPool().query(query, [limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting pending jobs:', error);
      return [];
    }
  }

  /**
   * Process a single job (internal)
   * @private
   */
  async processJob(job) {
    try {
      logger.info(`Processing job: ${job.job_id} (type: ${job.job_type})`);

      const processor = this.jobProcessors.get(job.job_type);

      if (!processor) {
        throw new Error(`No processor registered for job type: ${job.job_type}`);
      }

      // Parse job data
      const jobData = typeof job.job_data === 'string'
        ? JSON.parse(job.job_data)
        : job.job_data;

      // Execute processor
      const result = await processor(jobData);

      // Mark job as completed
      await this.updateJobStatus(
        job.job_id,
        'completed',
        null,
        null,
        result,
        job.attempts + 1
      );

      logger.info(`Job completed successfully: ${job.job_id}`);
    } catch (error) {
      logger.error(`Error processing job ${job.job_id}: ${error.message}`);

      // Check if we should retry
      const nextAttempt = job.attempts + 1;
      if (nextAttempt < job.max_attempts) {
        // Calculate exponential backoff (base * 2^attempt)
        const delayMs = this.retryBaseDelayMs * Math.pow(2, nextAttempt - 1);
        const nextRetryAt = new Date(Date.now() + delayMs);

        await this.updateJobStatus(
          job.job_id,
          'retry',
          error.message,
          null,
          null,
          nextAttempt,
          nextRetryAt
        );

        logger.info(
          `Job scheduled for retry: ${job.job_id} (attempt ${nextAttempt}/${job.max_attempts}, next: ${Math.round(delayMs / 1000)}s)`
        );
      } else {
        // Max attempts exceeded
        await this.updateJobStatus(
          job.job_id,
          'failed',
          error.message,
          null,
          null,
          nextAttempt
        );

        logger.error(`Job failed (max attempts exceeded): ${job.job_id}`);
      }
    }
  }

  /**
   * Update job status in database (internal)
   * @private
   */
  async updateJobStatus(
    jobId,
    status,
    errorMessage = null,
    startedAt = null,
    result = null,
    attempts = null,
    nextRetryAt = null
  ) {
    try {
      let query = 'UPDATE broadcast_queue_jobs SET status = $2, updated_at = CURRENT_TIMESTAMP';
      const params = [jobId, status];
      let paramIndex = 3;

      if (errorMessage !== null) {
        query += `, error_message = $${paramIndex}`;
        params.push(errorMessage);
        paramIndex++;
      }

      if (startedAt) {
        query += `, started_at = $${paramIndex}`;
        params.push(startedAt);
        paramIndex++;
      }

      if (result !== null) {
        query += `, result = $${paramIndex}`;
        params.push(JSON.stringify(result));
        paramIndex++;
      }

      if (attempts !== null) {
        query += `, attempts = $${paramIndex}`;
        params.push(attempts);
        paramIndex++;
      }

      if (nextRetryAt) {
        query += `, next_retry_at = $${paramIndex}`;
        params.push(nextRetryAt);
        paramIndex++;
      }

      if (status === 'completed') {
        query += `, completed_at = CURRENT_TIMESTAMP`;
      }

      query += ' WHERE job_id = $1';

      await getPool().query(query, params);
    } catch (error) {
      logger.error(`Error updating job status for ${jobId}:`, error);
    }
  }

  /**
   * Get status of a specific queue
   * @param {string} queueName - Name of the queue
   * @returns {Promise<Object>} Queue status with counts
   */
  async getQueueStatus(queueName) {
    try {
      const query = `
        SELECT
          status,
          COUNT(*) as count
        FROM broadcast_queue_jobs
        WHERE queue_name = $1
        GROUP BY status
      `;

      const result = await getPool().query(query, [queueName]);
      const status = {
        queueName,
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        retry: 0,
        active: this.activeJobs.size,
        timestamp: new Date(),
      };

      result.rows.forEach((row) => {
        status[row.status] = parseInt(row.count, 10);
      });

      return status;
    } catch (error) {
      logger.error(`Error getting queue status for ${queueName}:`, error);
      return { error: error.message };
    }
  }

  /**
   * Get status of all queues
   * @returns {Promise<Object>} All queue statuses
   */
  async getAllQueueStatuses() {
    try {
      const query = `
        SELECT
          queue_name,
          status,
          COUNT(*) as count
        FROM broadcast_queue_jobs
        GROUP BY queue_name, status
        ORDER BY queue_name, status
      `;

      const result = await getPool().query(query);
      const statuses = {};

      result.rows.forEach((row) => {
        if (!statuses[row.queue_name]) {
          statuses[row.queue_name] = {
            pending: 0,
            processing: 0,
            completed: 0,
            failed: 0,
            retry: 0,
            active: 0,
          };
        }
        statuses[row.queue_name][row.status] = parseInt(row.count, 10);
      });

      return statuses;
    } catch (error) {
      logger.error('Error getting all queue statuses:', error);
      return {};
    }
  }

  /**
   * Get failed jobs from a queue
   * @param {string} queueName - Name of the queue
   * @param {number} limit - Number of jobs to retrieve
   * @returns {Promise<Array>} Array of failed jobs
   */
  async getFailedJobs(queueName, limit = 50) {
    try {
      const query = `
        SELECT
          job_id,
          job_type,
          job_data,
          error_message,
          attempts,
          max_attempts,
          created_at
        FROM broadcast_queue_jobs
        WHERE queue_name = $1 AND status = 'failed'
        ORDER BY created_at DESC
        LIMIT $2
      `;

      const result = await getPool().query(query, [queueName, limit]);
      return result.rows;
    } catch (error) {
      logger.error(`Error getting failed jobs for ${queueName}:`, error);
      return [];
    }
  }

  /**
   * Retry a failed job
   * @param {string} jobId - Job ID to retry
   * @returns {Promise<void>}
   */
  async retryJob(jobId) {
    try {
      const query = `
        UPDATE broadcast_queue_jobs
        SET status = 'pending', attempts = 0, error_message = NULL, next_retry_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE job_id = $1
      `;

      await getPool().query(query, [jobId]);
      logger.info(`Job ${jobId} scheduled for retry`);
    } catch (error) {
      logger.error(`Error retrying job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Clear completed jobs from a queue
   * @param {string} queueName - Name of the queue
   * @param {number} daysOld - Only clear jobs older than N days
   * @returns {Promise<number>} Number of jobs cleared
   */
  async clearCompletedJobs(queueName, daysOld = 7) {
    try {
      const query = `
        DELETE FROM broadcast_queue_jobs
        WHERE queue_name = $1
        AND status = 'completed'
        AND completed_at < CURRENT_TIMESTAMP - interval '1 day' * $2
      `;

      const result = await getPool().query(query, [queueName, daysOld]);
      logger.info(`Cleared ${result.rowCount} completed jobs from ${queueName}`);
      return result.rowCount;
    } catch (error) {
      logger.error(`Error clearing completed jobs for ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Get details of a specific job
   * @param {string} jobId - Job ID
   * @returns {Promise<Object>} Job details
   */
  async getJob(jobId) {
    try {
      const query = 'SELECT * FROM broadcast_queue_jobs WHERE job_id = $1';
      const result = await getPool().query(query, [jobId]);

      if (result.rows.length === 0) {
        throw new Error(`Job ${jobId} not found`);
      }

      return result.rows[0];
    } catch (error) {
      logger.error(`Error getting job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Get jobs by queue name
   * @param {string} queueName - Name of the queue
   * @param {string} status - Filter by status (optional)
   * @param {number} limit - Number of jobs to retrieve
   * @returns {Promise<Array>} Array of jobs
   */
  async getJobsByQueue(queueName, status = null, limit = 100) {
    try {
      let query = 'SELECT * FROM broadcast_queue_jobs WHERE queue_name = $1';
      const params = [queueName];

      if (status) {
        query += ' AND status = $2';
        params.push(status);
      }

      query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
      params.push(limit);

      const result = await getPool().query(query, params);
      return result.rows;
    } catch (error) {
      logger.error(`Error getting jobs for ${queueName}:`, error);
      return [];
    }
  }

  /**
   * Get queue statistics
   * @returns {Promise<Object>} Overall queue statistics
   */
  async getStatistics() {
    try {
      const query = `
        SELECT
          COUNT(*) as total_jobs,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_jobs,
          COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing_jobs,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_jobs,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_jobs,
          COUNT(CASE WHEN status = 'retry' THEN 1 END) as retry_jobs,
          AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_processing_time_sec,
          MIN(created_at) as oldest_job,
          MAX(created_at) as newest_job
        FROM broadcast_queue_jobs
        WHERE completed_at IS NOT NULL
      `;

      const result = await getPool().query(query);
      return result.rows[0];
    } catch (error) {
      logger.error('Error getting queue statistics:', error);
      return {};
    }
  }

  /**
   * Get active jobs count
   * @returns {number} Number of active jobs
   */
  getActiveJobsCount() {
    return this.activeJobs.size;
  }

  /**
   * Check if queue processor is running
   * @returns {boolean} True if processor is running
   */
  isProcessorRunning() {
    return this.isRunning;
  }
}

// Singleton instance
let instance = null;

function getAsyncBroadcastQueue() {
  if (!instance) {
    instance = new AsyncBroadcastQueue();
  }
  return instance;
}

module.exports = {
  AsyncBroadcastQueue,
  getAsyncBroadcastQueue,
};
