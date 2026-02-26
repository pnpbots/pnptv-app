/**
 * Media Popularity Scheduler
 * Handles automated daily, weekly, and monthly announcements
 */

const MediaPopularityService = require('./mediaPopularityService');
const logger = require('../../utils/logger');
const { getPool } = require('../../config/postgres');

const MAX_TIMEOUT = 0x7fffffff;

class MediaPopularityScheduler {
  constructor(bot) {
    this.bot = bot;
    this.groupId = process.env.GROUP_ID || '-1003291737499';
    this.scheduledJobs = {};
  }

  /**
   * Initialize the scheduler
   */
  async initialize() {
    try {
      // Schedule daily winner announcement at 8 PM
      this.scheduleDailyAnnouncement();
      
      // Schedule weekly top sharer announcement every Monday at 8 PM
      this.scheduleWeeklyAnnouncement();
      
      // Schedule monthly top contributor announcement on the 1st of each month at 8 PM
      this.scheduleMonthlyAnnouncement();
      
      logger.info('Media popularity scheduler initialized');
      return true;
    } catch (error) {
      logger.error('Error initializing media popularity scheduler:', error);
      return false;
    }
  }

  /**
   * Schedule daily winner announcement
   */
  scheduleDailyAnnouncement() {
    try {
      // Clear existing job first to prevent duplicates
      if (this.scheduledJobs.daily) {
        clearTimeout(this.scheduledJobs.daily);
      }

      // Calculate time until next 8 PM
      const now = new Date();
      const next8PM = new Date();
      next8PM.setHours(20, 0, 0, 0);

      if (now >= next8PM) {
        next8PM.setDate(next8PM.getDate() + 1); // Tomorrow
      }

      const delay = Math.max(next8PM - now, 60000); // Minimum 1 minute

      // Schedule the first announcement
      this.scheduledJobs.daily = setTimeout(async () => {
        await this.runDailyAnnouncement();
        this.scheduleDailyAnnouncement(); // Reschedule for next day
      }, delay);

      logger.info(`Daily winner announcement scheduled for ${next8PM}`);
    } catch (error) {
      logger.error('Error scheduling daily announcement:', error);
    }
  }

  /**
   * Run daily winner announcement
   */
  async runDailyAnnouncement() {
    try {
      logger.info('Running daily winner announcement...');
      await MediaPopularityService.announceDailyWinners(this.bot, this.groupId);
      logger.info('Daily winner announcement completed');
    } catch (error) {
      logger.error('Error in daily winner announcement:', error);
    }
  }

  /**
   * Schedule weekly top sharer announcement
   */
  scheduleWeeklyAnnouncement() {
    try {
      // Clear existing job first to prevent duplicates
      if (this.scheduledJobs.weekly) {
        clearTimeout(this.scheduledJobs.weekly);
      }

      const now = new Date();
      const nextMonday = new Date();

      // Find next Monday at 8 PM
      const day = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
      let daysUntilMonday;

      if (day === 1) {
        // It's Monday
        const today8PM = new Date();
        today8PM.setHours(20, 0, 0, 0);

        if (now >= today8PM) {
          // Already past 8 PM Monday, schedule for next Monday
          daysUntilMonday = 7;
        } else {
          // Before 8 PM Monday, schedule for today
          daysUntilMonday = 0;
        }
      } else if (day === 0) {
        // Sunday - next Monday is tomorrow
        daysUntilMonday = 1;
      } else {
        // Tuesday-Saturday - calculate days until Monday
        daysUntilMonday = 8 - day;
      }

      nextMonday.setDate(now.getDate() + daysUntilMonday);
      nextMonday.setHours(20, 0, 0, 0);

      const delay = nextMonday - now;

      // Safety check: ensure delay is positive and reasonable
      if (delay <= 0 || delay > 8 * 24 * 60 * 60 * 1000) {
        logger.warn('Invalid weekly announcement delay, defaulting to 7 days', { delay });
        nextMonday.setDate(now.getDate() + 7);
        nextMonday.setHours(20, 0, 0, 0);
      }

      const finalDelay = Math.max(nextMonday - now, 60000); // Minimum 1 minute

      // Schedule the announcement
      this.scheduledJobs.weekly = setTimeout(async () => {
        await this.runWeeklyAnnouncement();
        this.scheduleWeeklyAnnouncement(); // Reschedule for next week
      }, finalDelay);

      logger.info(`Weekly top sharer announcement scheduled for ${nextMonday}`);
    } catch (error) {
      logger.error('Error scheduling weekly announcement:', error);
    }
  }

  /**
   * Run weekly top sharer announcement
   */
  async runWeeklyAnnouncement() {
    try {
      logger.info('Running weekly top sharer announcement...');
      await MediaPopularityService.announceWeeklyTopSharers(this.bot, this.groupId);
      logger.info('Weekly top sharer announcement completed');
    } catch (error) {
      logger.error('Error in weekly top sharer announcement:', error);
    }
  }

  /**
   * Schedule monthly top contributor announcement
   */
  scheduleMonthlyAnnouncement() {
    try {
      // Clear existing job first to prevent duplicates
      if (this.scheduledJobs.monthly) {
        clearTimeout(this.scheduledJobs.monthly);
      }

      const now = new Date();
      const nextFirst = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      nextFirst.setHours(20, 0, 0, 0);

    const delay = Math.max(nextFirst - now, 60000); // Minimum 1 minute

    this.scheduleWithLimit('monthly', async () => {
      await this.runMonthlyAnnouncement();
      this.scheduleMonthlyAnnouncement();
    }, delay);

    logger.info(`Monthly top contributor announcement scheduled for ${nextFirst}`);
  } catch (error) {
    logger.error('Error scheduling monthly announcement:', error);
  }
}

  scheduleWithLimit(key, callback, delay) {
    // Clear existing job first
    if (this.scheduledJobs[key]) {
      clearTimeout(this.scheduledJobs[key]);
    }

    const scheduleChunk = (remaining) => {
      const chunk = Math.min(remaining, MAX_TIMEOUT);
      this.scheduledJobs[key] = setTimeout(() => {
        const nextRemaining = remaining - chunk;
        if (nextRemaining <= 0) {
          callback();
        } else {
          scheduleChunk(nextRemaining);
        }
      }, chunk);
    };

    scheduleChunk(delay);
  }

  /**
   * Run monthly top contributor announcement
   */
  async runMonthlyAnnouncement() {
    try {
      logger.info('Running monthly top contributor announcement...');
      await MediaPopularityService.announceMonthlyTopContributor(this.bot, this.groupId);
      logger.info('Monthly top contributor announcement completed');
    } catch (error) {
      logger.error('Error in monthly top contributor announcement:', error);
    }
  }

  /**
   * Cancel all scheduled jobs
   */
  cancelAllJobs() {
    try {
      Object.values(this.scheduledJobs).forEach(job => {
        if (job) clearTimeout(job);
      });
      this.scheduledJobs = {};
      logger.info('All media popularity scheduler jobs cancelled');
    } catch (error) {
      logger.error('Error cancelling scheduler jobs:', error);
    }
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      daily: this.scheduledJobs.daily ? 'scheduled' : 'not scheduled',
      weekly: this.scheduledJobs.weekly ? 'scheduled' : 'not scheduled',
      monthly: this.scheduledJobs.monthly ? 'scheduled' : 'not scheduled'
    };
  }

  /**
   * Manually trigger daily announcement (for testing)
   */
  async triggerDailyAnnouncement() {
    return this.runDailyAnnouncement();
  }

  /**
   * Manually trigger weekly announcement (for testing)
   */
  async triggerWeeklyAnnouncement() {
    return this.runWeeklyAnnouncement();
  }

  /**
   * Manually trigger monthly announcement (for testing)
   */
  async triggerMonthlyAnnouncement() {
    return this.runMonthlyAnnouncement();
  }

  /**
   * Get statistics for admin dashboard
   */
  static async getStatistics() {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_media,
          SUM(CASE WHEN media_type = 'photo' THEN 1 ELSE 0 END) as total_pictures,
          SUM(CASE WHEN media_type = 'video' THEN 1 ELSE 0 END) as total_videos,
          SUM(like_count) as total_likes,
          SUM(share_count) as total_shares
        FROM media_shares
      `;
      
      const result = await getPool().query(query);
      return result.rows[0] || {
        total_media: 0,
        total_pictures: 0,
        total_videos: 0,
        total_likes: 0,
        total_shares: 0
      };
    } catch (error) {
      logger.error('Error getting media popularity statistics:', error);
      return {
        total_media: 0,
        total_pictures: 0,
        total_videos: 0,
        total_likes: 0,
        total_shares: 0
      };
    }
  }
}

module.exports = MediaPopularityScheduler;
