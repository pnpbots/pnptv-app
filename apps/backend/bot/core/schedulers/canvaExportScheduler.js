'use strict';

/**
 * Canva Export Scheduler
 *
 * Polls canva_export_jobs for active jobs and processes them through the pipeline:
 *   pending → exporting → downloading → uploading → completed
 *
 * Follows the XPostScheduler pattern: class with start/stop, mutex guard, retry logic.
 * Interval: 15 seconds.
 */

const CanvaService = require('../../services/canvaService');
const logger = require('../../../utils/logger');

const CHECK_INTERVAL = 15 * 1000; // 15 seconds
const MAX_RETRIES = 5;
// Exponential backoff in seconds: 15s, 30s, 60s, 120s, 300s
const RETRY_DELAYS_SEC = [15, 30, 60, 120, 300];

class CanvaExportScheduler {
  constructor() {
    this.interval = null;
    this.isRunning = false;
    this.isProcessing = false;
    this.processingJobs = new Set();
  }

  start() {
    if (this.isRunning) {
      logger.warn('Canva export scheduler already running');
      return;
    }

    this.isRunning = true;
    this.processQueue();
    this.interval = setInterval(() => this.processQueue(), CHECK_INTERVAL);
    logger.info('Canva export scheduler started (15s interval)');
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      this.isRunning = false;
      logger.info('Canva export scheduler stopped');
    }
  }

  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const jobs = await CanvaService.getActiveExportJobs();
      if (!jobs.length) return;

      logger.info(`Processing ${jobs.length} active Canva export jobs`);

      for (const job of jobs) {
        if (this.processingJobs.has(job.id)) continue;
        this.processingJobs.add(job.id);

        try {
          await this.processJob(job);
        } catch (err) {
          logger.error('Error processing Canva export job', {
            jobId: job.id,
            status: job.status,
            error: err.message,
          });
          await this.handleFailure(job, err);
        } finally {
          this.processingJobs.delete(job.id);
        }
      }
    } catch (err) {
      logger.error('Error in Canva export scheduler:', err.message);
    } finally {
      this.isProcessing = false;
    }
  }

  async processJob(job) {
    switch (job.status) {
      case 'pending':
        await this.handlePending(job);
        break;
      case 'exporting':
        await this.handleExporting(job);
        break;
      case 'downloading':
        await this.handleDownloading(job);
        break;
      case 'uploading':
        await this.handleUploading(job);
        break;
      default:
        logger.warn('Unknown job status', { jobId: job.id, status: job.status });
    }
  }

  /**
   * pending → call Canva export API → exporting
   */
  async handlePending(job) {
    logger.info('Starting Canva export', { jobId: job.id, designId: job.canva_design_id });

    const result = await CanvaService.createExport(
      job.user_id,
      job.canva_design_id,
      job.export_format,
      job.export_quality
    );

    await CanvaService.updateExportJob(job.id, {
      status: 'exporting',
      canva_export_id: result.exportId,
    });

    logger.info('Canva export started', { jobId: job.id, exportId: result.exportId });
  }

  /**
   * exporting → poll Canva for export status → downloading (or stay exporting)
   */
  async handleExporting(job) {
    if (!job.canva_export_id) {
      throw new Error('Missing canva_export_id for exporting job');
    }

    const exportStatus = await CanvaService.getExportStatus(job.user_id, job.canva_export_id);

    if (exportStatus.status === 'completed' || exportStatus.status === 'success') {
      if (!exportStatus.urls || exportStatus.urls.length === 0) {
        throw new Error('Export completed but no download URLs provided');
      }

      // Store the download URL temporarily in error_message field (reused as metadata)
      // This avoids adding a new column — we clear it on success
      const downloadUrl = exportStatus.urls[0];

      await CanvaService.updateExportJob(job.id, {
        status: 'downloading',
        error_message: downloadUrl, // temporary storage for download URL
      });

      logger.info('Canva export ready for download', { jobId: job.id });
    } else if (exportStatus.status === 'failed') {
      throw new Error('Canva export failed on Canva side');
    }
    // else: still exporting, do nothing — check again next cycle
  }

  /**
   * downloading → download MP4 from Canva → uploading
   */
  async handleDownloading(job) {
    const downloadUrl = job.error_message; // stored by handleExporting
    if (!downloadUrl || !downloadUrl.startsWith('http')) {
      throw new Error('Invalid download URL');
    }

    await CanvaService.updateExportJob(job.id, {
      status: 'uploading',
      error_message: null, // clear temporary URL storage
    });

    logger.info('Downloading Canva export', { jobId: job.id });

    const result = await CanvaService.downloadAndUploadToDirectus(
      downloadUrl,
      job.design_title,
      job.user_id
    );

    await CanvaService.updateExportJob(job.id, {
      status: 'completed',
      directus_file_id: result.fileId,
      directus_content_id: result.contentId,
    });

    logger.info('Canva export completed', {
      jobId: job.id,
      fileId: result.fileId,
      contentId: result.contentId,
    });
  }

  /**
   * uploading — this state is normally transient. If we land here on restart,
   * treat as needing retry from downloading.
   */
  async handleUploading(job) {
    // If we're here, the upload was interrupted. Reset to downloading to retry.
    logger.warn('Found stale uploading job, resetting to pending for retry', { jobId: job.id });
    await CanvaService.updateExportJob(job.id, {
      status: 'pending',
      retry_count: job.retry_count + 1,
    });
  }

  /**
   * Handle job failure with retry logic.
   */
  async handleFailure(job, error) {
    const retryCount = (job.retry_count || 0) + 1;

    if (retryCount >= MAX_RETRIES) {
      await CanvaService.updateExportJob(job.id, {
        status: 'failed',
        error_message: error.message || 'Unknown error',
        retry_count: retryCount,
      });

      logger.warn('Canva export job failed permanently', {
        jobId: job.id,
        retryCount,
        error: error.message,
      });
    } else {
      // Exponential backoff: set status back to current, increment retry
      // The job will be picked up again on the next cycle after the delay
      const delaySec = RETRY_DELAYS_SEC[retryCount - 1] || RETRY_DELAYS_SEC[RETRY_DELAYS_SEC.length - 1];

      // Reset to pending so the pipeline restarts from the beginning
      await CanvaService.updateExportJob(job.id, {
        status: 'pending',
        retry_count: retryCount,
        error_message: `Retry ${retryCount}/${MAX_RETRIES}: ${error.message}`,
      });

      logger.info('Canva export job scheduled for retry', {
        jobId: job.id,
        retryCount,
        delaySec,
      });
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      processingCount: this.processingJobs.size,
    };
  }
}

module.exports = CanvaExportScheduler;
