const UserModel = require('../../models/userModel');
const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');
const BusinessNotificationService = require('./businessNotificationService');

/**
 * Membership Cleanup Service
 * Handles automatic membership status updates and channel access management
 */
class MembershipCleanupService {
  static bot = null;
  static primeChannelId = process.env.PRIME_CHANNEL_ID;

  /**
   * Initialize the service with bot instance
   * @param {Telegraf} bot - Bot instance
   */
  static initialize(bot) {
    this.bot = bot;
    logger.info('Membership cleanup service initialized', {
      primeChannelId: this.primeChannelId
    });
  }

  /**
   * Run full membership cleanup
   * - Updates subscription statuses (active/churned/free)
   * - Kicks churned users from PRIME channel
   * @returns {Promise<Object>} Cleanup results
   */
  static async runFullCleanup() {
    logger.info('Starting full membership cleanup...');

    const results = {
      statusUpdates: { toChurned: 0, toFree: 0, errors: 0 },
      channelKicks: { kicked: 0, failed: 0, skipped: 0 },
      startTime: new Date(),
      endTime: null
    };

    try {
      // Step 1: Update subscription statuses
      const statusResults = await this.updateAllSubscriptionStatuses();
      results.statusUpdates = statusResults;

      // Step 2: Add missing PRIME users to the channel
      if (this.bot && this.primeChannelId) {
        const addResults = await this.addMissingUsersToPrimeChannel();
        results.channelAdds = addResults;
      } else {
        logger.warn('Skipping channel adds: Bot or PRIME_CHANNEL_ID not configured');
      }

      // Step 3: Kick churned/expired users from PRIME channel
      if (this.bot && this.primeChannelId) {
        const kickResults = await this.kickExpiredUsersFromPrimeChannel();
        results.channelKicks = kickResults;
      } else {
        logger.warn('Skipping channel kicks: Bot or PRIME_CHANNEL_ID not configured');
      }

      results.endTime = new Date();
      const duration = (results.endTime - results.startTime) / 1000;

      logger.info('Membership cleanup completed', {
        duration: `${duration}s`,
        statusUpdates: results.statusUpdates,
        channelAdds: results.channelAdds,
        channelKicks: results.channelKicks
      });

      // Business channel notification
      BusinessNotificationService.notifyCleanupSummary(results).catch(() => {});

      return results;
    } catch (error) {
      logger.error('Error in full membership cleanup:', error);
      results.endTime = new Date();
      return results;
    }
  }

  /**
   * Add active Prime members to the PRIME channel if they are not already members
   * @returns {Promise<Object>} Add results
   */
  static async addMissingUsersToPrimeChannel() {
    const results = { added: 0, failed: 0, skipped: 0 };

    if (!this.bot || !this.primeChannelId) {
      logger.warn('Cannot add users: Bot or PRIME_CHANNEL_ID not configured');
      return results;
    }

    try {
      // Get all active Prime users from the database
      const primeUsers = await query(`
        SELECT id, username FROM users
        WHERE subscription_status = 'active' AND tier = 'Prime'
      `);

      logger.info(`Found ${primeUsers.rows.length} active Prime users to check for PRIME channel access`);

      for (const user of primeUsers.rows) {
        try {
          // Check if user is in the PRIME channel
          const chatMember = await this.bot.telegram.getChatMember(this.primeChannelId, user.id);

          // If user is not in the channel (left, kicked, or never joined), add them
          if (['left', 'kicked'].includes(chatMember.status)) {
            // To add a user, we create an invite link and send it to them
            const inviteLink = await this.bot.telegram.createChatInviteLink(this.primeChannelId, {
              member_limit: 1,
              expire_date: Math.floor(Date.now() / 1000) + 3600 // 1 hour expiry
            });

            await this.bot.telegram.sendMessage(user.id,
              `🎉 ¡Tu acceso al canal PRIME ha sido restaurado!\n\nUsa este enlace de un solo uso para unirte:\n${inviteLink.invite_link}`
            );

            results.added++;
            logger.info(`Sent invite link to user ${user.id} (${user.username || 'no username'}) for PRIME channel`);
            
            // Rate limit protection
            await new Promise(resolve => setTimeout(resolve, 100));
          } else {
            results.skipped++;
          }
        } catch (error) {
          if (error.response?.error_code === 400 && error.response?.description?.includes('user not found')) {
            // Bot cannot initiate conversation, user must start the bot first. Skip.
            results.skipped++;
             logger.warn(`Cannot send invite to user ${user.id} because they have not started the bot.`);
          } else {
            results.failed++;
            logger.error(`Error processing user ${user.id} for PRIME channel addition:`, {
              message: error.message,
              description: error.response?.description,
              error_code: error.response?.error_code
            });
          }
        }
      }

      logger.info('PRIME channel additions completed', results);
      return results;
    } catch (error) {
      logger.error('Error adding users to PRIME channel:', error);
      return results;
    }
  }
  
  /**
   * Update subscription statuses for all users
   * - active + expired plan_expiry → churned
   * - expired status → churned (standardize)
   * - Lifetime pass users remain active (no expiry)
   * @returns {Promise<Object>} Update results
   */
  static async updateAllSubscriptionStatuses() {
    const results = { toChurned: 0, toFree: 0, errors: 0 };

    try {
      // Find users with 'active' status but expired plan_expiry (excluding lifetime)
      const expiredActiveUsers = await query(`
        SELECT id, username, subscription_status, plan_expiry, plan_id
        FROM users
        WHERE subscription_status = 'active'
        AND plan_expiry IS NOT NULL
        AND plan_expiry <= NOW()
      `);

      logger.info(`Found ${expiredActiveUsers.rows.length} users with expired 'active' subscriptions`);

      // Update expired active users to 'churned'
      for (const user of expiredActiveUsers.rows) {
        try {
          await UserModel.updateSubscription(user.id, {
            status: 'churned',
            planId: user.plan_id, // Keep plan_id for history
            expiry: user.plan_expiry // Keep expiry for history
          });
          results.toChurned++;
          logger.info(`Updated user ${user.id} (${user.username || 'no username'}) to churned`);
        } catch (error) {
          results.errors++;
          logger.error(`Error updating user ${user.id} to churned:`, error);
        }
      }

      // Find users with 'expired' status and update to 'churned'
      const expiredStatusUsers = await query(`
        SELECT id, username, plan_expiry, plan_id
        FROM users
        WHERE subscription_status = 'expired'
      `);

      logger.info(`Found ${expiredStatusUsers.rows.length} users with 'expired' status to convert to 'churned'`);

      for (const user of expiredStatusUsers.rows) {
        try {
          await UserModel.updateSubscription(user.id, {
            status: 'churned',
            planId: user.plan_id,
            expiry: user.plan_expiry
          });
          results.toChurned++;
          logger.info(`Updated user ${user.id} (${user.username || 'no username'}) from expired to churned`);
        } catch (error) {
          results.errors++;
          logger.error(`Error updating user ${user.id} from expired to churned:`, error);
        }
      }

      logger.info('Subscription status updates completed', results);
      return results;
    } catch (error) {
      logger.error('Error updating subscription statuses:', error);
      return results;
    }
  }

  /**
   * Kick churned and expired users from PRIME channel
   * @returns {Promise<Object>} Kick results
   */
  static async kickExpiredUsersFromPrimeChannel() {
    const results = { kicked: 0, failed: 0, skipped: 0 };

    if (!this.bot || !this.primeChannelId) {
      logger.warn('Cannot kick users: Bot or PRIME_CHANNEL_ID not configured');
      return results;
    }

    try {
      // Get all churned users (formerly had subscription)
      const churnedUsers = await query(`
        SELECT id, username FROM users
        WHERE subscription_status IN ('churned', 'expired')
      `);

      logger.info(`Found ${churnedUsers.rows.length} churned/expired users to check for PRIME channel access`);

      for (const user of churnedUsers.rows) {
        try {
          // Check if user is in the PRIME channel
          const chatMember = await this.bot.telegram.getChatMember(this.primeChannelId, user.id);

          // Only kick if they're actually a member (not already kicked/left)
          if (['member', 'restricted'].includes(chatMember.status)) {
            await this.bot.telegram.banChatMember(this.primeChannelId, user.id);
            // Immediately unban to allow re-joining if they resubscribe
            await this.bot.telegram.unbanChatMember(this.primeChannelId, user.id);

            results.kicked++;
            logger.info(`Kicked user ${user.id} (${user.username || 'no username'}) from PRIME channel`);

            // Notify user they were removed
            try {
              await this.sendRemovalNotice(user.id);
            } catch (notifyError) {
              // Don't fail if notification fails
              logger.debug(`Could not notify user ${user.id} of removal:`, notifyError.message);
            }

            // Rate limit protection
            await new Promise(resolve => setTimeout(resolve, 100));
          } else {
            results.skipped++;
          }
        } catch (error) {
          if (error.response?.error_code === 400 && error.response?.description?.includes('user not found')) {
            // User not in channel, skip
            results.skipped++;
          } else if (error.response?.error_code === 400 && error.response?.description?.includes('PARTICIPANT_ID_INVALID')) {
            // User was never in the channel or invalid ID, skip
            results.skipped++;
          } else if (error.response?.error_code === 400 && error.response?.description?.includes('CHAT_ADMIN_REQUIRED')) {
            logger.error('Bot needs admin rights in PRIME channel to kick users');
            results.failed++;
          } else {
            results.failed++;
            logger.error(`Error processing user ${user.id} for PRIME channel:`, {
              message: error.message,
              description: error.response?.description,
              error_code: error.response?.error_code
            });
          }
        }
      }

      logger.info('PRIME channel cleanup completed', results);
      return results;
    } catch (error) {
      logger.error('Error kicking users from PRIME channel:', error);
      return results;
    }
  }

  /**
   * Send removal notice to user
   * @param {number} userId - User ID
   */
  static async sendRemovalNotice(userId) {
    if (!this.bot) return;

    const message = `⚠️ **Membership Expired**

Your PRIME membership has expired and your access to the exclusive PRIME channel has been removed.

💎 **Miss your PRIME benefits?**
Reactivate your membership to regain access to:
• Exclusive content channel
• Full-length videos
• Premium features

Type /subscribe to view membership plans and reactivate your access!`;

    await this.bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
  }

  /**
   * Sync ALL users' membership status and tier
   * This is a comprehensive fix that ensures all users have correct status/tier based on plan_expiry
   * - Users with plan_expiry > NOW() → 'active' status, 'Prime' tier
   * - Users with lifetime plans (no expiry or plan_id contains 'lifetime') → 'active' status, 'Prime' tier
   * - Users with plan_expiry <= NOW() → 'churned' status, 'Free' tier
   * - Users with no subscription → 'free' status, 'Free' tier
   * @returns {Promise<Object>} Sync results
   */
  static async syncAllMembershipStatuses() {
    const results = {
      toActive: 0,
      toChurned: 0,
      toFree: 0,
      alreadyCorrect: 0,
      errors: 0,
      startTime: new Date()
    };

    try {
      logger.info('Starting comprehensive membership status sync...');

      // Step 1: Update users with valid active subscriptions (expiry in future) to 'active'
      const activateResult = await query(`
        UPDATE users
        SET subscription_status = 'active',
            tier = 'Prime',
            updated_at = NOW()
        WHERE plan_expiry IS NOT NULL
          AND plan_expiry > NOW()
          AND (subscription_status != 'active' OR tier != 'Prime')
        RETURNING id, username
      `);
      results.toActive += activateResult.rowCount;
      if (activateResult.rowCount > 0) {
        logger.info(`Activated ${activateResult.rowCount} users with valid subscriptions`);
      }

      // Step 2: Update lifetime users to 'active' (plan_id contains 'lifetime' and no expiry)
      const lifetimeResult = await query(`
        UPDATE users
        SET subscription_status = 'active',
            tier = 'Prime',
            updated_at = NOW()
        WHERE (plan_id ILIKE '%lifetime%' OR plan_id ILIKE '%life-time%')
          AND (subscription_status != 'active' OR tier != 'Prime')
        RETURNING id, username
      `);
      results.toActive += lifetimeResult.rowCount;
      if (lifetimeResult.rowCount > 0) {
        logger.info(`Activated ${lifetimeResult.rowCount} lifetime users`);
      }

      // Step 3: Update users with expired subscriptions to 'churned'
      const churnResult = await query(`
        UPDATE users
        SET subscription_status = 'churned',
            tier = 'Free',
            updated_at = NOW()
        WHERE plan_expiry IS NOT NULL
          AND plan_expiry <= NOW()
          AND plan_id NOT ILIKE '%lifetime%'
          AND plan_id NOT ILIKE '%life-time%'
          AND subscription_status NOT IN ('churned', 'free')
        RETURNING id, username
      `);
      results.toChurned += churnResult.rowCount;
      if (churnResult.rowCount > 0) {
        logger.info(`Churned ${churnResult.rowCount} users with expired subscriptions`);
      }

      // Step 4: Ensure 'Free' tier for all churned users
      const fixChurnedTierResult = await query(`
        UPDATE users
        SET tier = 'Free',
            updated_at = NOW()
        WHERE subscription_status IN ('churned', 'expired', 'free')
          AND tier != 'Free'
        RETURNING id
      `);
      if (fixChurnedTierResult.rowCount > 0) {
        logger.info(`Fixed tier for ${fixChurnedTierResult.rowCount} churned/free users`);
      }

      // Step 5: Convert old 'expired' status to 'churned' for consistency
      const expiredToChurnedResult = await query(`
        UPDATE users
        SET subscription_status = 'churned',
            updated_at = NOW()
        WHERE subscription_status = 'expired'
        RETURNING id
      `);
      if (expiredToChurnedResult.rowCount > 0) {
        results.toChurned += expiredToChurnedResult.rowCount;
        logger.info(`Converted ${expiredToChurnedResult.rowCount} 'expired' status to 'churned'`);
      }

      // Step 6: Ensure users without any plan are set to 'free'
      const freeResult = await query(`
        UPDATE users
        SET subscription_status = 'free',
            tier = 'Free',
            updated_at = NOW()
        WHERE plan_id IS NULL
          AND plan_expiry IS NULL
          AND subscription_status NOT IN ('free')
        RETURNING id
      `);
      results.toFree += freeResult.rowCount;
      if (freeResult.rowCount > 0) {
        logger.info(`Set ${freeResult.rowCount} users to 'free' status`);
      }

      results.endTime = new Date();
      const duration = (results.endTime - results.startTime) / 1000;

      logger.info('Membership status sync completed', {
        duration: `${duration}s`,
        toActive: results.toActive,
        toChurned: results.toChurned,
        toFree: results.toFree,
        errors: results.errors
      });

      return results;
    } catch (error) {
      logger.error('Error in membership status sync:', error);
      results.errors++;
      results.endTime = new Date();
      return results;
    }
  }

  /**
   * Get membership statistics
   * @returns {Promise<Object>} Membership stats
   */
  static async getStats() {
    try {
      const result = await query(`
        SELECT
          subscription_status,
          COUNT(*) as count,
          COUNT(CASE WHEN plan_expiry > NOW() THEN 1 END) as active_plan,
          COUNT(CASE WHEN plan_expiry <= NOW() THEN 1 END) as expired_plan,
          COUNT(CASE WHEN plan_id LIKE '%lifetime%' THEN 1 END) as lifetime
        FROM users
        GROUP BY subscription_status
        ORDER BY count DESC
      `);

      return {
        byStatus: result.rows,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('Error getting membership stats:', error);
      return null;
    }
  }

  /**
   * Get churned users sorted by last payment date
   * Helps identify inactive churned users for re-engagement campaigns
   * @param {number} daysSincePayment - Days since last payment (default: 30)
   * @param {number} limit - Max records to return
   * @returns {Promise<Array>} Churned users with payment info
   */
  static async getInactiveChurnedUsers(daysSincePayment = 30, limit = 100) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysSincePayment);

      const result = await query(
        `SELECT
          id, username, email, subscription_status, tier,
          last_payment_date, last_payment_amount, last_payment_method,
          created_at,
          EXTRACT(DAY FROM (NOW() - last_payment_date)) as days_since_payment
        FROM users
        WHERE subscription_status IN ('churned', 'expired', 'free')
          AND last_payment_date IS NOT NULL
          AND last_payment_date < $1
        ORDER BY last_payment_date ASC
        LIMIT $2`,
        [cutoffDate, limit]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error fetching inactive churned users:', error);
      return [];
    }
  }

  /**
   * Get churn analysis statistics
   * Shows breakdown of inactive users by payment method
   * @returns {Promise<Object>} Churn statistics
   */
  static async getChurnAnalysis() {
    try {
      const result = await query(`
        SELECT
          last_payment_method as payment_method,
          COUNT(*) as churned_count,
          COUNT(CASE WHEN last_payment_date > NOW() - INTERVAL '30 days' THEN 1 END) as recent_30d,
          COUNT(CASE WHEN last_payment_date > NOW() - INTERVAL '60 days' THEN 1 END) as recent_60d,
          COUNT(CASE WHEN last_payment_date > NOW() - INTERVAL '90 days' THEN 1 END) as recent_90d,
          MIN(last_payment_date) as oldest_payment,
          MAX(last_payment_date) as newest_payment,
          AVG(last_payment_amount) as avg_payment_amount
        FROM users
        WHERE subscription_status IN ('churned', 'expired', 'free')
          AND last_payment_date IS NOT NULL
        GROUP BY last_payment_method
        ORDER BY churned_count DESC
      `);

      return {
        byMethod: result.rows,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('Error getting churn analysis:', error);
      return null;
    }
  }

  /**
   * Get users who need re-engagement emails
   * Identifies active premium users approaching expiry without recent payment
   * @returns {Promise<Array>} Users for re-engagement
   */
  static async getUsersForReEngagement() {
    try {
      const result = await query(`
        SELECT
          id, username, email, language,
          plan_expiry,
          last_payment_date,
          EXTRACT(DAY FROM (plan_expiry - NOW())) as days_until_expiry,
          EXTRACT(DAY FROM (NOW() - last_payment_date)) as days_since_payment,
          last_payment_method
        FROM users
        WHERE subscription_status = 'active'
          AND plan_expiry IS NOT NULL
          AND plan_expiry > NOW()
          AND plan_expiry < NOW() + INTERVAL '14 days'
          AND last_payment_date IS NOT NULL
        ORDER BY plan_expiry ASC
        LIMIT 500
      `);

      return result.rows;
    } catch (error) {
      logger.error('Error getting re-engagement users:', error);
      return [];
    }
  }

  /**
   * Get subscription renewal statistics
   * Shows payment trends and renewal rates
   * @param {Date} startDate - Start of analysis period
   * @param {Date} endDate - End of analysis period
   * @returns {Promise<Object>} Renewal statistics
   */
  static async getRenewalStats(startDate, endDate) {
    try {
      const result = await query(
        `SELECT
          last_payment_method,
          COUNT(*) as total_users,
          COUNT(CASE WHEN last_payment_date >= $1 AND last_payment_date <= $2 THEN 1 END) as renewed,
          COUNT(CASE WHEN subscription_status = 'active' THEN 1 END) as active_now,
          COUNT(CASE WHEN subscription_status IN ('churned', 'expired') THEN 1 END) as churned,
          ROUND(100.0 * COUNT(CASE WHEN subscription_status = 'active' THEN 1 END) / COUNT(*), 2) as retention_rate,
          AVG(last_payment_amount) as avg_payment
        FROM users
        WHERE last_payment_date IS NOT NULL
        GROUP BY last_payment_method
        ORDER BY total_users DESC`,
        [startDate, endDate]
      );

      return {
        byMethod: result.rows,
        period: { startDate, endDate },
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('Error getting renewal statistics:', error);
      return null;
    }
  }
}

module.exports = MembershipCleanupService;
