const logger = require('../../utils/logger');
const { query } = require('../../config/postgres');

/**
 * Message Rate Limiter Service
 * Centralized control for all group messages to ensure we don't exceed daily limits
 */
class MessageRateLimiter {
  /**
   * Initialize the rate limiter
   */
  static initialize() {
    // Create table if it doesn't exist
    this._ensureTableExists();
    
    // Reset counter at midnight
    this._scheduleMidnightReset();
    
    logger.info('Message rate limiter initialized');
  }

  /**
   * Ensure the message tracking table exists
   */
  static async _ensureTableExists() {
    try {
      await query(`
        CREATE TABLE IF NOT EXISTS message_rate_limits (
          date DATE PRIMARY KEY,
          total_messages_sent INTEGER DEFAULT 0,
          last_reset TIMESTAMP DEFAULT NOW(),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      
      logger.info('Message rate limit table ensured');
    } catch (error) {
      logger.error('Error ensuring message rate limit table:', error.message);
    }
  }

  /**
   * Schedule midnight reset
   */
  static _scheduleMidnightReset() {
    // Calculate time until next midnight
    const now = new Date();
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    
    const msUntilMidnight = midnight - now;
    
    // Schedule first reset at midnight
    setTimeout(async () => {
      await this._resetDailyCounter();
      
      // Then schedule daily resets at midnight
      setInterval(async () => {
        await this._resetDailyCounter();
      }, 24 * 60 * 60 * 1000);
      
    }, msUntilMidnight);
    
    logger.info(`Scheduled midnight reset in ${Math.round(msUntilMidnight / (60 * 60 * 1000))} hours`);
  }

  /**
   * Reset the daily counter at midnight
   */
  static async _resetDailyCounter() {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      await query(`
        INSERT INTO message_rate_limits (date, total_messages_sent, last_reset) 
        VALUES ($1, 0, NOW())
        ON CONFLICT (date) 
        DO UPDATE SET total_messages_sent = 0, last_reset = NOW()
      `, [today]);
      
      logger.info('Daily message counter reset at midnight');
    } catch (error) {
      logger.error('Error resetting daily message counter:', error.message);
    }
  }

  /**
   * Check if we can send a message without exceeding the daily limit
   * @param {number} maxMessagesPerDay - Maximum allowed messages per day
   * @returns {Promise<{canSend: boolean, messagesSentToday: number, messagesRemaining: number}>}
   */
  static async canSendMessage(maxMessagesPerDay = 6) {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Get or create today's record
      const result = await query(`
        INSERT INTO message_rate_limits (date) 
        VALUES ($1)
        ON CONFLICT (date) 
        DO NOTHING
        RETURNING *
      `, [today]);
      
      // Get current count
      const currentResult = await query(`
        SELECT total_messages_sent FROM message_rate_limits WHERE date = $1
      `, [today]);
      
      const messagesSentToday = currentResult.rows[0]?.total_messages_sent || 0;
      const messagesRemaining = maxMessagesPerDay - messagesSentToday;
      
      return {
        canSend: messagesSentToday < maxMessagesPerDay,
        messagesSentToday,
        messagesRemaining
      };
    } catch (error) {
      logger.error('Error checking message limit:', error.message);
      // Fail safe - allow sending if we can't check the limit
      return { canSend: true, messagesSentToday: 0, messagesRemaining: maxMessagesPerDay };
    }
  }

  /**
   * Record that a message was sent
   * @returns {Promise<void>}
   */
  static async recordMessageSent() {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      await query(`
        UPDATE message_rate_limits
        SET total_messages_sent = total_messages_sent + 1
        WHERE date = $1
      `, [today]);
    } catch (error) {
      logger.error('Error recording message sent:', error.message);
    }
  }

  /**
   * Get current message statistics
   * @returns {Promise<{messagesSentToday: number, limit: number}>}
   */
  static async getStats() {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const result = await query(`
        SELECT total_messages_sent FROM message_rate_limits WHERE date = $1
      `, [today]);
      
      return {
        messagesSentToday: result.rows[0]?.total_messages_sent || 0,
        limit: 6
      };
    } catch (error) {
      logger.error('Error getting message stats:', error.message);
      return { messagesSentToday: 0, limit: 6 };
    }
  }

  /**
   * Check if we can send a message and record it if we can
   * @param {number} maxMessagesPerDay - Maximum allowed messages per day
   * @returns {Promise<{canSend: boolean, messagesSentToday: number, messagesRemaining: number}>}
   */
  static async checkAndRecordMessage(maxMessagesPerDay = 6) {
    const { canSend, messagesSentToday, messagesRemaining } = await this.canSendMessage(maxMessagesPerDay);
    
    if (canSend) {
      await this.recordMessageSent();
    }
    
    return { canSend, messagesSentToday, messagesRemaining };
  }
}

module.exports = MessageRateLimiter;