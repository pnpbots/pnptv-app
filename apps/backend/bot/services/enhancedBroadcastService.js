/**
 * Enhanced Broadcast Service
 * Advanced broadcast system with social sharing, engagement tracking, and analytics
 * 
 * Features:
 * - Social media sharing integration
 * - Engagement tracking (likes, shares, views)
 * - Advanced analytics and reporting
 * - Content personalization
 * - A/B testing framework
 * - Scheduled sharing with optimal timing
 */

const { getPool } = require('../../config/postgres');
const logger = require('../../utils/logger');
const s3Service = require('../../utils/s3Service');
const userService = require('./userService');
const BroadcastService = require('./broadcastService');
const { v4: uuidv4 } = require('uuid');
const BroadcastButtonModel = require('../../models/broadcastButtonModel');
const { Markup } = require('telegraf');

class EnhancedBroadcastService extends BroadcastService {
  
  /**
   * Create a shareable post with social media integration
   * @param {Object} postData - Post data including social sharing options
   * @returns {Promise<Object>} Created shareable post
   */
  async createShareablePost(postData) {
    const {
      adminId,
      adminUsername,
      title,
      messageEn,
      messageEs,
      mediaType = null,
      mediaUrl = null,
      mediaFileId = null,
      s3Key = null,
      s3Bucket = null,
      scheduledAt = null,
      timezone = 'UTC',
      includeFilters = {},
      excludeUserIds = [],
      socialSharing = true,
      shareButtons = ['twitter', 'facebook', 'telegram', 'whatsapp'],
      engagementTracking = true,
      analyticsEnabled = true,
    } = postData;

    const query = `
      INSERT INTO shareable_posts (
        post_id, admin_id, admin_username, title,
        message_en, message_es,
        media_type, media_url, media_file_id, s3_key, s3_bucket,
        scheduled_at, timezone, include_filters, exclude_user_ids,
        social_sharing, share_buttons, engagement_tracking, analytics_enabled,
        status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      ) RETURNING *
    `;

    const postId = uuidv4();
    const status = scheduledAt ? 'scheduled' : 'pending';

    try {
      const result = await getPool().query(query, [
        postId,
        adminId,
        adminUsername,
        title,
        messageEn,
        messageEs,
        mediaType,
        mediaUrl,
        mediaFileId,
        s3Key,
        s3Bucket,
        scheduledAt,
        timezone,
        JSON.stringify(includeFilters),
        excludeUserIds,
        socialSharing,
        shareButtons,
        engagementTracking,
        analyticsEnabled,
        status,
      ]);

      logger.info(`Shareable post created: ${postId} by ${adminUsername}`);
      return result.rows[0];

    } catch (error) {
      logger.error('Error creating shareable post:', error);
      throw error;
    }
  }

  /**
   * Share post to social media platforms
   * @param {string} postId - Post ID to share
   * @param {Array} platforms - Platforms to share to
   * @returns {Promise<Object>} Sharing results
   */
  async sharePostToSocialMedia(postId, platforms = ['twitter', 'facebook', 'telegram', 'whatsapp']) {
    try {
      // Get post data
      const post = await this.getShareablePost(postId);
      if (!post) {
        throw new Error('Post not found');
      }

      const results = {};
      const shareUrl = `${process.env.WEB_APP_URL}/share/${postId}`;
      const message = post.message_en || post.message_es || '';

      // Simulate sharing to different platforms
      // In production, this would integrate with actual APIs
      for (const platform of platforms) {
        try {
          let result;
          
          switch (platform) {
            case 'twitter':
              result = await this.shareToTwitter(shareUrl, message);
              break;
            case 'facebook':
              result = await this.shareToFacebook(shareUrl, message);
              break;
            case 'telegram':
              result = await this.shareToTelegram(shareUrl, message);
              break;
            case 'whatsapp':
              result = await this.shareToWhatsApp(shareUrl, message);
              break;
            default:
              result = { success: false, error: 'Unsupported platform' };
          }

          results[platform] = result;

        } catch (error) {
          logger.error(`Error sharing to ${platform}:`, error);
          results[platform] = { success: false, error: error.message };
        }
      }

      // Record sharing activity
      await this.recordSocialSharing(postId, platforms, results);

      logger.info(`Post ${postId} shared to platforms: ${platforms.join(', ')}`);
      return results;

    } catch (error) {
      logger.error('Error sharing post to social media:', error);
      throw error;
    }
  }

  /**
   * Simulate sharing to Twitter (placeholder for actual API integration)
   */
  async shareToTwitter(url, message) {
    // In production, integrate with Twitter API
    logger.info(`[SIMULATED] Sharing to Twitter: ${message} ${url}`);
    return {
      success: true,
      platform: 'twitter',
      postId: 'simulated_tweet_id',
      url: `https://twitter.com/status/simulated_tweet_id`,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Simulate sharing to Facebook (placeholder for actual API integration)
   */
  async shareToFacebook(url, message) {
    // In production, integrate with Facebook API
    logger.info(`[SIMULATED] Sharing to Facebook: ${message} ${url}`);
    return {
      success: true,
      platform: 'facebook',
      postId: 'simulated_facebook_post_id',
      url: `https://facebook.com/posts/simulated_facebook_post_id`,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Simulate sharing to Telegram (placeholder for actual API integration)
   */
  async shareToTelegram(url, message) {
    // In production, integrate with Telegram API
    logger.info(`[SIMULATED] Sharing to Telegram: ${message} ${url}`);
    return {
      success: true,
      platform: 'telegram',
      postId: 'simulated_telegram_post_id',
      url: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(message)}`,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Simulate sharing to WhatsApp (placeholder for actual API integration)
   */
  async shareToWhatsApp(url, message) {
    // In production, integrate with WhatsApp API
    logger.info(`[SIMULATED] Sharing to WhatsApp: ${message} ${url}`);
    return {
      success: true,
      platform: 'whatsapp',
      postId: 'simulated_whatsapp_message_id',
      url: `https://wa.me/?text=${encodeURIComponent(message + ' ' + url)}`,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Record social sharing activity in database
   */
  async recordSocialSharing(postId, platforms, results) {
    const query = `
      INSERT INTO social_sharing (
        sharing_id, post_id, platforms, results, timestamp
      ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
    `;

    try {
      await getPool().query(query, [
        uuidv4(),
        postId,
        platforms,
        JSON.stringify(results)
      ]);

      logger.info(`Social sharing recorded for post ${postId}`);
    } catch (error) {
      logger.error('Error recording social sharing:', error);
      throw error;
    }
  }

  /**
   * Get shareable post by ID
   */
  async getShareablePost(postId) {
    const query = `
      SELECT * FROM shareable_posts WHERE post_id = $1
    `;

    try {
      const result = await getPool().query(query, [postId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting shareable post:', error);
      throw error;
    }
  }

  /**
   * Track engagement (likes, shares, views) for a post
   */
  async trackEngagement(postId, userId, engagementType, metadata = {}) {
    const query = `
      INSERT INTO post_engagement (
        engagement_id, post_id, user_id, engagement_type, metadata, timestamp
      ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
    `;

    try {
      await getPool().query(query, [
        uuidv4(),
        postId,
        userId,
        engagementType,
        JSON.stringify(metadata)
      ]);

      logger.info(`Engagement tracked: ${engagementType} for post ${postId} by user ${userId}`);
      return { success: true };

    } catch (error) {
      logger.error('Error tracking engagement:', error);
      throw error;
    }
  }

  /**
   * Get engagement analytics for a post
   */
  async getPostAnalytics(postId) {
    const query = `
      SELECT 
        COUNT(*) as total_engagements,
        COUNT(*) FILTER (WHERE engagement_type = 'like') as likes,
        COUNT(*) FILTER (WHERE engagement_type = 'share') as shares,
        COUNT(*) FILTER (WHERE engagement_type = 'view') as views,
        COUNT(*) FILTER (WHERE engagement_type = 'comment') as comments,
        COUNT(DISTINCT user_id) as unique_users
      FROM post_engagement
      WHERE post_id = $1
    `;

    try {
      const result = await getPool().query(query, [postId]);
      
      if (result.rows.length === 0) {
        return {
          total_engagements: 0,
          likes: 0,
          shares: 0,
          views: 0,
          comments: 0,
          unique_users: 0
        };
      }

      return result.rows[0];

    } catch (error) {
      logger.error('Error getting post analytics:', error);
      throw error;
    }
  }

  /**
   * Get top performing posts
   */
  async getTopPerformingPosts(limit = 10, timeRange = 'all') {
    let timeCondition = '';
    const params = [];

    if (timeRange === 'week') {
      timeCondition = 'AND p.created_at > CURRENT_TIMESTAMP - INTERVAL \'7 days\'';
    } else if (timeRange === 'month') {
      timeCondition = 'AND p.created_at > CURRENT_TIMESTAMP - INTERVAL \'30 days\'';
    }

    const query = `
      SELECT 
        p.post_id,
        p.title,
        p.admin_username,
        COUNT(e.engagement_id) as total_engagements,
        COUNT(*) FILTER (WHERE e.engagement_type = 'like') as likes,
        COUNT(*) FILTER (WHERE e.engagement_type = 'share') as shares,
        COUNT(*) FILTER (WHERE e.engagement_type = 'view') as views,
        COUNT(DISTINCT e.user_id) as unique_users,
        p.created_at
      FROM shareable_posts p
      LEFT JOIN post_engagement e ON p.post_id = e.post_id
      ${timeCondition}
      GROUP BY p.post_id, p.title, p.admin_username, p.created_at
      ORDER BY total_engagements DESC
      LIMIT $1
    `;

    try {
      const result = await getPool().query(query, [limit]);
      return result.rows;

    } catch (error) {
      logger.error('Error getting top performing posts:', error);
      throw error;
    }
  }

  /**
   * Create A/B test for broadcasts
   */
  async createABTest(testData) {
    const {
      adminId,
      adminUsername,
      title,
      variantA,
      variantB,
      targetAudience,
      testSize = 1000,
      successMetric = 'engagement_rate'
    } = testData;

    const query = `
      INSERT INTO ab_tests (
        test_id, admin_id, admin_username, title,
        variant_a, variant_b, target_audience, test_size,
        success_metric, status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      ) RETURNING *
    `;

    try {
      const result = await getPool().query(query, [
        uuidv4(),
        adminId,
        adminUsername,
        title,
        JSON.stringify(variantA),
        JSON.stringify(variantB),
        targetAudience,
        testSize,
        successMetric,
        'pending'
      ]);

      logger.info(`A/B test created: ${result.rows[0].test_id}`);
      return result.rows[0];

    } catch (error) {
      logger.error('Error creating A/B test:', error);
      throw error;
    }
  }

  /**
   * Get A/B test results
   */
  async getABTestResults(testId) {
    const query = `
      SELECT 
        t.*,
        (SELECT COUNT(*) FROM post_engagement WHERE post_id = t.variant_a_post_id) as variant_a_engagements,
        (SELECT COUNT(*) FROM post_engagement WHERE post_id = t.variant_b_post_id) as variant_b_engagements
      FROM ab_tests t
      WHERE test_id = $1
    `;

    try {
      const result = await getPool().query(query, [testId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const test = result.rows[0];
      
      // Calculate winner
      const winner = test.variant_a_engagements > test.variant_b_engagements ? 'A' : 'B';
      const improvement = Math.abs(test.variant_a_engagements - test.variant_b_engagements) / 
                         Math.max(test.variant_a_engagements, test.variant_b_engagements) * 100;

      return {
        ...test,
        winner,
        improvement_percent: improvement.toFixed(2)
      };

    } catch (error) {
      logger.error('Error getting A/B test results:', error);
      throw error;
    }
  }

  /**
   * Schedule optimal sharing time based on audience analytics
   */
  async scheduleOptimalSharing(postId, audienceType = 'all') {
    // Get audience analytics to determine optimal time
    const optimalTime = await this.determineOptimalTime(audienceType);
    
    // Schedule the post
    const scheduledAt = this.calculateNextOptimalTime(optimalTime);
    
    // Update post with scheduled time
    const query = `
      UPDATE shareable_posts
      SET scheduled_at = $1, status = 'optimized'
      WHERE post_id = $2
      RETURNING *
    `;

    try {
      const result = await getPool().query(query, [scheduledAt, postId]);
      
      logger.info(`Optimal sharing scheduled for post ${postId} at ${scheduledAt}`);
      return result.rows[0];

    } catch (error) {
      logger.error('Error scheduling optimal sharing:', error);
      throw error;
    }
  }

  /**
   * Determine optimal posting time based on audience analytics
   */
  async determineOptimalTime(audienceType) {
    // In production, this would analyze user activity patterns
    // For now, return reasonable defaults based on audience type
    const defaults = {
      'all': { hour: 19, minute: 0, timezone: 'UTC' }, // 7 PM UTC
      'premium': { hour: 20, minute: 30, timezone: 'UTC' }, // 8:30 PM UTC
      'free': { hour: 18, minute: 0, timezone: 'UTC' }, // 6 PM UTC
    };

    return defaults[audienceType] || defaults['all'];
  }

  /**
   * Calculate next optimal time from current time
   */
  calculateNextOptimalTime({ hour, minute, timezone }) {
    const now = new Date();
    const scheduled = new Date();
    
    // Set to optimal time today
    scheduled.setUTCHours(hour, minute, 0, 0);
    
    // If optimal time is in the past, schedule for tomorrow
    if (scheduled <= now) {
      scheduled.setUTCDate(scheduled.getUTCDate() + 1);
    }
    
    return scheduled.toISOString();
  }

  /**
   * Create personalized content variants for different user segments
   */
  async createPersonalizedContent(baseContent, segments = ['new', 'active', 'inactive']) {
    const variants = {};
    
    for (const segment of segments) {
      variants[segment] = this.personalizeForSegment(baseContent, segment);
    }
    
    return variants;
  }

  /**
   * Personalize content for specific user segment
   */
  personalizeForSegment(content, segment) {
    const personalizations = {
      'new': {
        prefix: '🎉 Welcome to PNPtv! ',
        suffix: '\n\nWe\'re excited to have you join our community!'
      },
      'active': {
        prefix: '🌟 Thanks for being an active member! ',
        suffix: '\n\nKeep up the great engagement!'
      },
      'inactive': {
        prefix: '💤 We miss you! ',
        suffix: '\n\nCome back and see what\'s new!'
      }
    };
    
    const { prefix = '', suffix = '' } = personalizations[segment] || {};
    
    return {
      ...content,
      messageEn: prefix + (content.messageEn || '') + suffix,
      messageEs: prefix + (content.messageEs || '') + suffix
    };
  }

  /**
   * Build button markup for a broadcast
   * @param {Array} buttons - Array of button configurations
   * @param {string} language - User language for translation
   * @returns {Object|undefined} Markup.inlineKeyboard object or undefined
   */
  buildButtonMarkup(buttons, language = 'en') {
    if (!buttons || buttons.length === 0) {
      return undefined; // No buttons
    }

    try {
      const buttonRows = [];
      for (const btn of buttons) {
        const buttonObj = typeof btn === 'string' ? JSON.parse(btn) : btn;

        // Validate button object structure
        if (!buttonObj || typeof buttonObj !== 'object') {
          logger.warn('Invalid button object structure:', buttonObj);
          continue;
        }

        // Translate button text based on user language
        let buttonText = buttonObj.text;
        if (buttonObj.translationKey) {
          // Use translation system if translation key is provided
          buttonText = this.translateButtonText(buttonObj.translationKey, language);
        }

        if (buttonObj.type === 'url') {
          if (buttonText && buttonObj.target) {
            buttonRows.push([Markup.button.url(buttonText, buttonObj.target)]);
          }
        } else if (buttonObj.type === 'callback') {
          if (buttonText && buttonObj.data) {
            buttonRows.push([Markup.button.callback(buttonText, buttonObj.data)]);
          }
        } else if (buttonObj.type === 'command') {
          if (buttonText && buttonObj.target) {
            buttonRows.push([Markup.button.callback(buttonText, `broadcast_action_${buttonObj.target}`)]);
          }
        } else if (buttonObj.type === 'plan') {
          if (buttonText && buttonObj.target) {
            buttonRows.push([Markup.button.callback(buttonText, `broadcast_plan_${buttonObj.target}`)]);
          }
        } else if (buttonObj.type === 'feature') {
          if (buttonText && buttonObj.target) {
            buttonRows.push([Markup.button.callback(buttonText, `broadcast_feature_${buttonObj.target}`)]);
          }
        }
      }

      return buttonRows.length > 0 ? Markup.inlineKeyboard(buttonRows) : undefined;
    } catch (error) {
      logger.warn('Error building button markup:', error);
      return undefined;
    }
  }

  /**
   * Translate button text based on user language
   * @param {string} buttonKey - Button translation key
   * @param {string} language - User language ('en' or 'es')
   * @returns {string} Translated button text
   */
  translateButtonText(buttonKey, language = 'en') {
    const i18n = require('../utils/i18n');
    return i18n.t(buttonKey, language);
  }

  /**
   * Send broadcast with enhancements (buttons, analytics, etc.)
   * @param {Object} bot - Telegram bot instance
   * @param {string} broadcastId - Broadcast ID
   * @returns {Promise<Object>} Broadcast results with enhancements
   */
  async sendBroadcastWithEnhancements(bot, broadcastId) {
    try {
      // Get broadcast details
      const broadcastQuery = 'SELECT * FROM broadcasts WHERE broadcast_id = $1';
      const broadcastResult = await getPool().query(broadcastQuery, [broadcastId]);

      if (broadcastResult.rows.length === 0) {
        throw new Error(`Broadcast not found: ${broadcastId}`);
      }

      const broadcast = broadcastResult.rows[0];

      // Check if broadcast is already being processed or completed (idempotency check)
      if (broadcast.status === 'sending' || broadcast.status === 'completed') {
        logger.warn(`Broadcast ${broadcastId} is already ${broadcast.status}, skipping duplicate execution`);
        return {
          total: broadcast.total_recipients || 0,
          sent: broadcast.sent_count || 0,
          failed: broadcast.failed_count || 0,
          blocked: broadcast.blocked_count || 0,
          deactivated: broadcast.deactivated_count || 0,
          errors: broadcast.error_count || 0,
          duplicate: true,
        };
      }

      // Update status to sending
      await getPool().query(
        'UPDATE broadcasts SET status = $1, started_at = CURRENT_TIMESTAMP WHERE broadcast_id = $2',
        ['sending', broadcastId]
      );

      // Get buttons for this broadcast (we'll build markup per user based on language)
      const buttons = await BroadcastButtonModel.getButtonsForBroadcast(broadcastId);

      // Get target users
      const targetUsers = await this.getTargetUsers(
        broadcast.target_type,
        broadcast.exclude_user_ids || [],
        broadcast.include_filters || {}
      );

      const stats = {
        total: targetUsers.length,
        sent: 0,
        failed: 0,
        blocked: 0,
        deactivated: 0,
        errors: 0,
      };

      // Update total recipients
      await getPool().query(
        'UPDATE broadcasts SET total_recipients = $1 WHERE broadcast_id = $2',
        [stats.total, broadcastId]
      );

      logger.info(`Starting enhanced broadcast ${broadcastId} to ${stats.total} users`);

      const perRecipientDelayMs = parseInt(process.env.BROADCAST_SEND_DELAY_MS || '80', 10);
      const progressUpdateEvery = parseInt(process.env.BROADCAST_PROGRESS_EVERY || '10', 10);
      const cancellationCheckEvery = parseInt(process.env.BROADCAST_CANCELLATION_CHECK_EVERY || '25', 10);

      // Send to each user
      for (let index = 0; index < targetUsers.length; index++) {
        const user = targetUsers[index];
        try {
          // Allow cancelling mid-flight
          if (index % cancellationCheckEvery === 0) {
            const current = await this.getBroadcastById(broadcastId);
            if (current?.status === 'cancelled') {
              logger.warn(`Broadcast ${broadcastId} cancelled during send loop, stopping early`);
              break;
            }
          }

          const message = user.language === 'es' ? broadcast.message_es : broadcast.message_en;

          // Send based on media type
          let messageId = null;
          const attemptSend = async () => {
            // Build button markup for this specific user based on their language
            const userButtonMarkup = this.buildButtonMarkup(buttons, user.language);
            const sendOptions = {
              parse_mode: 'Markdown',
              ...(userButtonMarkup ? { reply_markup: userButtonMarkup.reply_markup } : {})
            };

            if (broadcast.media_type && broadcast.media_url) {
              return this.sendMediaMessage(
                bot,
                user.id,
                broadcast.media_type,
                broadcast.media_url,
                message,
                broadcast.s3_key,
                sendOptions
              );
            }
            const result = await bot.telegram.sendMessage(user.id, message, sendOptions);
            return result.message_id;
          };

          try {
            messageId = await attemptSend();
          } catch (error) {
            const classification = this.classifyTelegramSendError(error);
            if (classification.status === 'retry') {
              const retryAfterSeconds = this.getTelegramRetryAfterSeconds(error);
              const waitMs = Math.min(Math.max(retryAfterSeconds ? retryAfterSeconds * 1000 : 1500, 1000), 120000);
              logger.warn(`Rate limited, waiting ${Math.round(waitMs / 1000)}s then retrying user ${user.id}`);
              await this.sleep(waitMs);
              messageId = await attemptSend();
            } else {
              throw error;
            }
          }

          // Record successful delivery
          await this.recordRecipient(broadcastId, user.id, 'sent', {
            messageId,
            language: user.language,
            subscriptionTier: user.subscription_tier,
          });

          stats.sent++;

          // Small delay to avoid rate limiting
          await this.sleep(perRecipientDelayMs);
        } catch (error) {
          const classification = this.classifyTelegramSendError(error);
          const status = classification.status === 'retry' ? 'failed' : classification.status;
          if (status === 'blocked') stats.blocked++;
          else if (status === 'deactivated') stats.deactivated++;
          else stats.errors++;
          stats.failed++;

          // Record failed delivery
          await this.recordRecipient(broadcastId, user.id, status, {
            errorCode: error.code,
            errorMessage: classification.description || error.message,
            language: user.language,
            subscriptionTier: user.subscription_tier,
          });

          logger.warn(`Failed to send to user ${user.id}: ${classification.description || error.message}`);
        }

        // Update progress
        if (index % progressUpdateEvery === 0 || index === targetUsers.length - 1) {
          const progress = ((stats.sent + stats.failed) / stats.total) * 100;
          await getPool().query(
            'UPDATE broadcasts SET sent_count = $1, failed_count = $2, blocked_count = $3, deactivated_count = $4, error_count = $5, progress_percentage = $6 WHERE broadcast_id = $7',
            [stats.sent, stats.failed, stats.blocked, stats.deactivated, stats.errors, progress.toFixed(2), broadcastId]
          );
        }
      }

      // Mark broadcast as completed (or keep cancelled)
      const finalBroadcast = await this.getBroadcastById(broadcastId);
      if (finalBroadcast?.status !== 'cancelled') {
        await getPool().query(
          'UPDATE broadcasts SET status = $1, completed_at = CURRENT_TIMESTAMP WHERE broadcast_id = $2',
          ['completed', broadcastId]
        );
      }

      logger.info(`Enhanced broadcast ${broadcastId} completed: ${stats.sent} sent, ${stats.failed} failed`);

      return stats;
    } catch (error) {
      // Mark broadcast as failed
      await getPool().query(
        'UPDATE broadcasts SET status = $1 WHERE broadcast_id = $2',
        ['failed', broadcastId]
      );

      logger.error(`Error sending enhanced broadcast ${broadcastId}:`, error);
      throw error;
    }
  }
}

let instance;

function getEnhancedBroadcastService() {
  if (!instance) {
    instance = new EnhancedBroadcastService();
  }
  return instance;
}

// Delegate processRetryQueue to parent BroadcastService
EnhancedBroadcastService.prototype.processRetryQueue = function(bot) {
  return BroadcastService.prototype.processRetryQueue.call(this, bot);
};

module.exports = {
  EnhancedBroadcastService,
  getEnhancedBroadcastService,
};
