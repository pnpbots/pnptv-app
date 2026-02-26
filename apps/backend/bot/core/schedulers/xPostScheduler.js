const logger = require('../../../utils/logger');
const XPostService = require('../../services/xPostService');

const MAX_RETRIES = 3;
const RETRY_DELAYS = [5, 15, 30]; // minutes
const RATE_LIMIT_RETRY_DELAYS = [15, 30, 60]; // minutes - longer for 429

class XPostScheduler {
  constructor(bot = null) {
    this.interval = null;
    this.isRunning = false;
    this.isProcessing = false;
    this.bot = bot;
    this.processingPosts = new Set();
  }

  setBot(bot) {
    this.bot = bot;
  }

  start() {
    if (this.isRunning) {
      logger.warn('X post scheduler already running');
      return;
    }

    this.isRunning = true;
    // Process immediately on start, then every 30 seconds
    this.processQueue();
    this.interval = setInterval(() => this.processQueue(), 30 * 1000);
    logger.info('X post scheduler started (30s interval)');
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      this.isRunning = false;
      logger.info('X post scheduler stopped');
    }
  }

  async processQueue() {
    // Mutex guard: prevent overlapping runs from setInterval
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;

    try {
      const pendingPosts = await XPostService.getPendingPosts();

      if (!pendingPosts.length) {
        return;
      }

      logger.info(`Processing ${pendingPosts.length} pending X posts`);

      for (const post of pendingPosts) {
        // Skip if already being processed (prevent duplicates)
        if (this.processingPosts.has(post.post_id)) {
          logger.debug('Skipping post already being processed', { postId: post.post_id });
          continue;
        }

        this.processingPosts.add(post.post_id);

        try {
          await this.publishPost(post);
        } finally {
          this.processingPosts.delete(post.post_id);
        }
      }
    } catch (error) {
      logger.error('Error processing X post queue:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  async publishPost(post) {
    const postId = post.post_id;

    try {
      // getPendingPosts() already atomically set status to 'sending'
      // Attempt to publish
      const response = await XPostService.publishScheduledPost(post);

      // Success - notify admin
      await this.notifyAdmin(post, 'success', response);

      logger.info('Scheduled X post published successfully', {
        postId,
        adminId: post.admin_id,
        tweetId: response?.data?.id,
      });
    } catch (error) {
      logger.error('Failed to publish scheduled X post', {
        postId,
        error: error.message,
      });

      // Check retry count and handle accordingly
      await this.handleFailure(post, error);
    }
  }

  async handleFailure(post, error) {
    const postId = post.post_id;
    const retryCount = await XPostService.incrementRetryCount(postId);

    // Check if error is retryable
    const isRetryable = this.isRetryableError(error);
    const isRateLimit = error.response?.status === 429;

    if (isRetryable && retryCount < MAX_RETRIES) {
      // Use longer delays for rate limit errors; respect Retry-After header
      const delays = isRateLimit ? RATE_LIMIT_RETRY_DELAYS : RETRY_DELAYS;
      const retryAfter = parseInt(error.response?.headers?.['retry-after'] || '0', 10);
      const retryAfterMinutes = retryAfter > 0 ? Math.ceil(retryAfter / 60) : 0;
      const baseDelay = delays[retryCount - 1] || delays[delays.length - 1];
      const delayMinutes = Math.max(baseDelay, retryAfterMinutes);

      await XPostService.reschedulePost(postId, delayMinutes);

      logger.info('Scheduled X post for retry', {
        postId,
        retryCount,
        delayMinutes,
      });

      // Notify admin about retry
      await this.notifyAdmin(post, 'retry', {
        error: error.message,
        retryCount,
        nextRetryIn: delayMinutes,
      });
    } else {
      // Max retries reached or non-retryable error - mark as failed
      const errorMessage = this.formatErrorMessage(error);

      await XPostService.updatePostJob(postId, {
        status: 'failed',
        errorMessage,
      });

      // Notify admin about failure
      await this.notifyAdmin(post, 'failed', {
        error: errorMessage,
        retryCount,
      });

      logger.warn('Scheduled X post failed permanently', {
        postId,
        retryCount,
        error: errorMessage,
      });
    }
  }

  isRetryableError(error) {
    // Network errors are retryable
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      return true;
    }

    // Rate limit errors are retryable
    if (error.response?.status === 429) {
      return true;
    }

    // Server errors (5xx) are retryable
    if (error.response?.status >= 500 && error.response?.status < 600) {
      return true;
    }

    // Auth errors and client errors (4xx except 429) are not retryable
    if (error.response?.status >= 400 && error.response?.status < 500) {
      return false;
    }

    // Default: retry for unknown errors
    return true;
  }

  formatErrorMessage(error) {
    if (error.response?.data) {
      const data = error.response.data;
      if (data.detail) return data.detail;
      if (data.errors && data.errors.length > 0) {
        return data.errors.map(e => e.message || e.detail).join('; ');
      }
      if (typeof data === 'string') return data;
      return JSON.stringify(data);
    }

    return error.message || 'Error desconocido';
  }

  async notifyAdmin(post, status, details = {}) {
    if (!this.bot || !post.admin_id) {
      return;
    }

    try {
      let message = '';
      const handle = post.handle || 'desconocido';
      const rawPreview = (post.text || '').substring(0, 50) + (post.text?.length > 50 ? '...' : '');
      // Strip lone surrogates that cause UTF-8 errors in Telegram API
      const textPreview = rawPreview.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');

      switch (status) {
        case 'success': {
          const tweetId = details?.data?.id;
          const tweetUrl = tweetId ? `https://x.com/i/status/${tweetId}` : null;

          message = '✅ **Post de X Publicado**\n\n';
          message += `📤 Cuenta: @${handle}\n`;
          message += `📝 ${textPreview}\n`;

          if (tweetUrl) {
            message += `\n🔗 [Ver en X](${tweetUrl})`;
          }
          break;
        }

        case 'retry':
          message = '⚠️ **Reintento Programado**\n\n';
          message += `📤 Cuenta: @${handle}\n`;
          message += `📝 ${textPreview}\n\n`;
          message += `❌ Error: ${details.error}\n`;
          message += `🔄 Intento ${details.retryCount} de ${MAX_RETRIES}\n`;
          message += `⏰ Próximo intento en ${details.nextRetryIn} minutos`;
          break;

        case 'failed':
          message = '❌ **Post de X Falló**\n\n';
          message += `📤 Cuenta: @${handle}\n`;
          message += `📝 ${textPreview}\n\n`;
          message += `❌ Error: ${details.error}\n`;

          if (details.retryCount >= MAX_RETRIES) {
            message += `\n⚠️ Se agotaron los ${MAX_RETRIES} intentos.`;
          }
          break;

        default:
          return;
      }

      await this.bot.telegram.sendMessage(post.admin_id, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });

      logger.debug('Admin notified about X post status', {
        adminId: post.admin_id,
        status,
        postId: post.post_id,
      });
    } catch (error) {
      logger.warn('Failed to notify admin about X post', {
        adminId: post.admin_id,
        error: error.message,
      });
    }
  }

  // Manual trigger for testing
  async triggerProcessing() {
    logger.info('Manual X post queue processing triggered');
    await this.processQueue();
  }

  // Get scheduler status
  getStatus() {
    return {
      isRunning: this.isRunning,
      processingCount: this.processingPosts.size,
      hasBot: !!this.bot,
    };
  }
}

module.exports = XPostScheduler;
