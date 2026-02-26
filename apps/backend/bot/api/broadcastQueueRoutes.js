/**
 * Broadcast Queue API Routes
 * REST endpoints for monitoring and managing async broadcast queue
 */

const express = require('express');
const { getBroadcastQueueIntegration } = require('../services/broadcastQueueIntegration');
const { getAsyncBroadcastQueue } = require('../services/asyncBroadcastQueue');
const logger = require('../../utils/logger');

const router = express.Router();
const queueIntegration = getBroadcastQueueIntegration();
const queue = getAsyncBroadcastQueue();

/**
 * GET /api/admin/queue/status
 * Get overall queue status and statistics
 */
router.get('/status', async (req, res) => {
  try {
    const status = await queueIntegration.getStatus();
    res.json(status);
  } catch (error) {
    logger.error('Error getting queue status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/queue/:queueName/status
 * Get status of a specific queue
 */
router.get('/:queueName/status', async (req, res) => {
  try {
    const status = await queue.getQueueStatus(req.params.queueName);
    res.json(status);
  } catch (error) {
    logger.error(`Error getting status for queue ${req.params.queueName}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/queue/:queueName/jobs
 * Get jobs from a specific queue
 */
router.get('/:queueName/jobs', async (req, res) => {
  try {
    const { status, limit = 50 } = req.query;
    const jobs = await queue.getJobsByQueue(req.params.queueName, status, parseInt(limit, 10));
    res.json({
      queueName: req.params.queueName,
      status,
      limit,
      count: jobs.length,
      jobs,
    });
  } catch (error) {
    logger.error(`Error getting jobs for queue ${req.params.queueName}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/queue/:queueName/failed
 * Get failed jobs from a specific queue
 */
router.get('/:queueName/failed', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const failedJobs = await queue.getFailedJobs(req.params.queueName, parseInt(limit, 10));
    res.json({
      queueName: req.params.queueName,
      count: failedJobs.length,
      failedJobs,
    });
  } catch (error) {
    logger.error(`Error getting failed jobs for queue ${req.params.queueName}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/queue/job/:jobId
 * Get details of a specific job
 */
router.get('/job/:jobId', async (req, res) => {
  try {
    const job = await queue.getJob(req.params.jobId);
    res.json(job);
  } catch (error) {
    logger.error(`Error getting job ${req.params.jobId}:`, error);
    res.status(404).json({ error: error.message });
  }
});

/**
 * GET /api/admin/queue/broadcasts/failed
 * Get all failed broadcasts
 */
router.get('/broadcasts/failed', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const failedBroadcasts = await queueIntegration.getFailedBroadcasts(parseInt(limit, 10));
    res.json({
      count: failedBroadcasts.length,
      failedBroadcasts,
    });
  } catch (error) {
    logger.error('Error getting failed broadcasts:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/queue/job/:jobId/retry
 * Retry a failed job
 */
router.post('/job/:jobId/retry', async (req, res) => {
  try {
    await queue.retryJob(req.params.jobId);
    res.json({ success: true, message: `Job ${req.params.jobId} scheduled for retry` });
  } catch (error) {
    logger.error(`Error retrying job ${req.params.jobId}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/queue/broadcast/:jobId/retry
 * Retry a failed broadcast
 */
router.post('/broadcast/:jobId/retry', async (req, res) => {
  try {
    await queueIntegration.retryFailedBroadcast(req.params.jobId);
    res.json({ success: true, message: `Broadcast ${req.params.jobId} scheduled for retry` });
  } catch (error) {
    logger.error(`Error retrying broadcast ${req.params.jobId}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/queue/statistics
 * Get detailed queue statistics
 */
router.get('/statistics', async (req, res) => {
  try {
    const stats = await queue.getStatistics();
    res.json(stats);
  } catch (error) {
    logger.error('Error getting queue statistics:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/queue/:queueName/cleanup
 * Clear old completed jobs from a queue
 */
router.post('/:queueName/cleanup', async (req, res) => {
  try {
    const { daysOld = 7 } = req.body;
    const cleared = await queue.clearCompletedJobs(req.params.queueName, daysOld);
    res.json({
      queueName: req.params.queueName,
      jobsCleared: cleared,
      daysOld,
    });
  } catch (error) {
    logger.error(`Error cleaning up queue ${req.params.queueName}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/queue/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  const isRunning = queue.isProcessorRunning();
  res.status(isRunning ? 200 : 503).json({
    status: isRunning ? 'healthy' : 'unhealthy',
    running: isRunning,
    activeJobs: queue.getActiveJobsCount(),
    timestamp: new Date(),
  });
});

module.exports = router;
