const CallModel = require('../../models/callModel');
const CallModerationLogModel = require('../../models/callModerationLogModel');
const UserModel = require('../../models/userModel');
const PerformerModel = require('../../models/performerModel');
const logger = require('../../utils/logger');

/**
 * Private Call Moderation Service - Safety and moderation features for private calls
 */
class PrivateCallModerationService {
  
  // =====================================================
  // CALL MONITORING
  // =====================================================
  
  /**
   * Monitor active calls for policy violations
   * @param {Object} bot - Telegram bot instance
   * @returns {Promise<number>} Number of calls monitored
   */
  static async monitorActiveCalls(bot) {
    try {
      const activeCalls = await CallModel.getByStatus('active');
      let monitoredCount = 0;
      
      for (const call of activeCalls) {
        // Check if call has exceeded maximum duration
        const shouldEnd = await this.checkCallDuration(call);
        
        if (shouldEnd) {
          await this.endCallDueToTimeout(bot, call.id);
          monitoredCount++;
        }
      }
      
      logger.info('Active calls monitored', {
        monitoredCount,
        totalActiveCalls: activeCalls.length,
      });
      
      return monitoredCount;
    } catch (error) {
      logger.error('Error monitoring active calls:', error);
      return 0;
    }
  }
  
  /**
   * Check if call has exceeded maximum duration
   * @param {Object} call - Call data
   * @returns {Promise<boolean>} Should end call
   */
  static async checkCallDuration(call) {
    try {
      if (!call.started_at || !call.duration) {
        return false;
      }
      
      const startTime = new Date(call.started_at);
      const maxDurationMs = call.duration * 60 * 1000; // Convert minutes to ms
      const now = new Date();
      const elapsedMs = now - startTime;
      
      // Add 2 minute grace period
      return elapsedMs > (maxDurationMs + 2 * 60 * 1000);
    } catch (error) {
      logger.error('Error checking call duration:', error);
      return false;
    }
  }
  
  /**
   * End call due to timeout
   * @param {Object} bot - Telegram bot instance
   * @param {string} callId - Call ID
   * @returns {Promise<boolean>} Success status
   */
  static async endCallDueToTimeout(bot, callId) {
    try {
      const call = await CallModel.getById(callId);
      
      if (!call || call.status !== 'active') {
        return false;
      }
      
      // End the call
      await CallModel.updateStatus(callId, 'completed', {
        ended_at: new Date(),
        completed_at: new Date(),
      });
      
      // Notify user
      const userId = call.user_id;
      const message = '⏰ *Call Ended*\n\nYour call has been automatically ended as it reached the maximum duration.';
      
      await bot.telegram.sendMessage(userId, message, {
        parse_mode: 'Markdown',
      });
      
      // Log moderation action
      await this.logModerationAction({
        callId: call.id,
        actionType: 'timeout_termination',
        actionReason: 'Call exceeded maximum duration',
        severity: 'low',
        userId: userId,
        performerId: call.performer_id,
        metadata: {
          duration: call.duration,
          actualDuration: call.duration + 2, // Include grace period
        },
      });
      
      logger.info('Call ended due to timeout', { callId });
      return true;
    } catch (error) {
      logger.error('Error ending call due to timeout:', error);
      return false;
    }
  }
  
  // =====================================================
  // NO-SHOW DETECTION
  // =====================================================
  
  /**
   * Check for no-show calls
   * @param {Object} bot - Telegram bot instance
   * @returns {Promise<number>} Number of no-shows detected
   */
  static async checkForNoShows(bot) {
    try {
      const now = new Date();
      const scheduledCalls = await CallModel.getByStatus('confirmed');
      let noShowsDetected = 0;
      
      for (const call of scheduledCalls) {
        const callDateTime = new Date(`${call.scheduled_date}T${call.scheduled_time}`);
        const diffMs = now - callDateTime;
        const diffMins = Math.ceil(diffMs / (1000 * 60));
        
        // If call was scheduled more than 15 minutes ago and hasn't started
        if (diffMins > 15 && !call.started_at) {
          await this.handleNoShow(bot, call.id, 'user');
          noShowsDetected++;
        }
      }
      
      logger.info('No-show check completed', {
        noShowsDetected,
        totalScheduledCalls: scheduledCalls.length,
      });
      
      return noShowsDetected;
    } catch (error) {
      logger.error('Error checking for no-shows:', error);
      return 0;
    }
  }
  
  /**
   * Handle no-show situation
   * @param {Object} bot - Telegram bot instance
   * @param {string} callId - Call ID
   * @param {string} userType - 'user' or 'performer'
   * @returns {Promise<boolean>} Success status
   */
  static async handleNoShow(bot, callId, userType) {
    try {
      const call = await CallModel.getById(callId);
      
      if (!call || call.status !== 'confirmed') {
        return false;
      }
      
      // Mark as no-show
      await CallModel.updateStatus(callId, 'completed', {
        no_show: true,
        ended_at: new Date(),
        completed_at: new Date(),
      });
      
      // Notify user
      const userId = call.user_id;
      const performer = await PerformerModel.getById(call.performer_id);
      const performerName = performer ? performer.display_name : 'Performer';
      
      const message = userType === 'user'
        ? `❌ *No-Show Detected*
\nYour call with ${performerName} was marked as no-show as you didn't join within 15 minutes of the scheduled time.`
        : `❌ *Performer No-Show*
\nYour call with ${performerName} was marked as no-show as the performer didn't join. You will receive a full refund.`;
      
      await bot.telegram.sendMessage(userId, message, {
        parse_mode: 'Markdown',
      });
      
      // Handle refund for performer no-show
      if (userType === 'performer') {
        await this.handlePerformerNoShowRefund(call.payment_id);
      }
      
      // Log moderation action
      await this.logModerationAction({
        callId: call.id,
        actionType: 'no_show',
        actionReason: `${userType}_no_show`,
        severity: 'medium',
        userId: userId,
        performerId: call.performer_id,
        metadata: {
          userType,
          scheduledTime: `${call.scheduled_date} ${call.scheduled_time}`,
        },
      });
      
      // Flag performer if multiple no-shows
      if (userType === 'performer') {
        await this.checkPerformerNoShowPattern(call.performer_id);
      }
      
      logger.info('No-show handled', {
        callId,
        userType,
        performerId: call.performer_id,
      });
      
      return true;
    } catch (error) {
      logger.error('Error handling no-show:', error);
      return false;
    }
  }
  
  /**
   * Handle refund for performer no-show
   * @param {string} paymentId - Payment ID
   * @returns {Promise<boolean>} Success status
   */
  static async handlePerformerNoShowRefund(paymentId) {
    try {
      // In a real implementation, this would call the payment provider API
      // For now, we'll just log the refund
      
      logger.info('Performer no-show refund processed', {
        paymentId,
        refundAmount: 'full',
      });
      
      return true;
    } catch (error) {
      logger.error('Error processing performer no-show refund:', error);
      return false;
    }
  }
  
  /**
   * Check performer no-show pattern and flag if necessary
   * @param {string} performerId - Performer ID
   * @returns {Promise<boolean>} Success status
   */
  static async checkPerformerNoShowPattern(performerId) {
    try {
      // Get recent calls for this performer
      const recentCalls = await CallModel.getByPerformer(performerId);
      const noShowCalls = recentCalls.filter(call => call.no_show && call.status === 'completed');
      
      // If performer has 3 or more no-shows in the last 30 days, flag them
      const recentNoShows = noShowCalls.filter(call => {
        const callDate = new Date(call.scheduled_date);
        const now = new Date();
        const diffDays = (now - callDate) / (1000 * 60 * 60 * 24);
        return diffDays <= 30;
      });
      
      if (recentNoShows.length >= 3) {
        // Flag performer
        await PerformerModel.update(performerId, {
          status: 'paused',
          availability_message: 'Performer temporarily unavailable due to multiple no-shows',
        });
        
        // Log moderation action
        await this.logModerationAction({
          actionType: 'performer_flagged',
          actionReason: 'multiple_no_shows',
          severity: 'high',
          performerId: performerId,
          metadata: {
            noShowCount: recentNoShows.length,
            timePeriod: '30_days',
          },
        });
        
        logger.warn('Performer flagged for multiple no-shows', {
          performerId,
          noShowCount: recentNoShows.length,
        });
      }
      
      return true;
    } catch (error) {
      logger.error('Error checking performer no-show pattern:', error);
      return false;
    }
  }
  
  // =====================================================
  // INCIDENT REPORTING
  // =====================================================
  
  /**
   * Report incident during call
   * @param {string} callId - Call ID
   * @param {string} reporterId - User ID reporting the incident
   * @param {string} incidentType - Type of incident
   * @param {string} details - Incident details
   * @returns {Promise<boolean>} Success status
   */
  static async reportIncident(callId, reporterId, incidentType, details) {
    try {
      const call = await CallModel.getById(callId);
      
      if (!call || call.status !== 'active') {
        throw new Error('Call not found or not active');
      }
      
      // End the call immediately
      await CallModel.updateStatus(callId, 'completed', {
        incident_reported: true,
        incident_details: details,
        ended_at: new Date(),
        completed_at: new Date(),
      });
      
      // Log moderation action
      await this.logModerationAction({
        callId: call.id,
        actionType: 'incident_reported',
        actionReason: incidentType,
        severity: 'high',
        userId: call.user_id,
        performerId: call.performer_id,
        moderatorId: reporterId,
        metadata: {
          incidentType,
          details,
          reportedBy: reporterId === call.user_id ? 'user' : 'performer',
        },
      });
      
      // Flag both user and performer for review
      await this.flagUserForReview(call.user_id, 'incident_reported');
      await this.flagUserForReview(call.performer_id, 'incident_reported');
      
      logger.info('Incident reported during call', {
        callId,
        incidentType,
        reporterId,
      });
      
      return true;
    } catch (error) {
      logger.error('Error reporting incident:', error);
      return false;
    }
  }
  
  /**
   * Flag user for moderation review
   * @param {string} userId - User ID
   * @param {string} reason - Reason for flagging
   * @returns {Promise<boolean>} Success status
   */
  static async flagUserForReview(userId, reason) {
    try {
      // In a real implementation, this would add to a moderation queue
      // For now, we'll just log it
      
      logger.warn('User flagged for moderation review', {
        userId,
        reason,
      });
      
      return true;
    } catch (error) {
      logger.error('Error flagging user for review:', error);
      return false;
    }
  }
  
  // =====================================================
  // MODERATION LOGGING
  // =====================================================
  
  /**
   * Log moderation action
   * @param {Object} logData - Log data
   * @returns {Promise<Object>} Created log entry
   */
  static async logModerationAction(logData) {
    try {
      const logEntry = await CallModerationLogModel.create({
        callId: logData.callId,
        bookingId: logData.bookingId,
        actionType: logData.actionType,
        actionReason: logData.actionReason,
        severity: logData.severity || 'medium',
        userId: logData.userId,
        performerId: logData.performerId,
        moderatorId: logData.moderatorId,
        metadata: logData.metadata || {},
      });
      
      logger.info('Moderation action logged', {
        actionId: logEntry.id,
        actionType: logData.actionType,
        callId: logData.callId,
      });
      
      return logEntry;
    } catch (error) {
      logger.error('Error logging moderation action:', error);
      throw error;
    }
  }
  
  /**
   * Get moderation logs for call
   * @param {string} callId - Call ID
   * @returns {Promise<Array>} Moderation logs
   */
  static async getModerationLogs(callId) {
    try {
      return await CallModerationLogModel.getByCallId(callId);
    } catch (error) {
      logger.error('Error getting moderation logs:', error);
      return [];
    }
  }
  
  // =====================================================
  // SAFETY FEATURES
  // =====================================================
  
  /**
   * Check user eligibility for private calls
   * @param {string} userId - User ID
   * @returns {Promise<Object>} { eligible, reason }
   */
  static async checkUserEligibility(userId) {
    try {
      const user = await UserModel.getById(userId);
      
      if (!user) {
        return { eligible: false, reason: 'user_not_found' };
      }
      
      // Check age verification
      if (!user.age_verified) {
        return { eligible: false, reason: 'age_not_verified' };
      }
      
      // Check terms acceptance
      if (!user.terms_accepted) {
        return { eligible: false, reason: 'terms_not_accepted' };
      }
      
      // Check if user is banned or restricted
      if (user.role === 'banned' || user.role === 'restricted') {
        return { eligible: false, reason: 'account_restricted' };
      }
      
      // Check for recent moderation actions
      const recentActions = await this.getRecentModerationActions(userId);
      
      if (recentActions.length > 0) {
        // Check if any recent actions are severe
        const severeActions = recentActions.filter(action => 
          action.severity === 'high' && 
          !action.resolved
        );
        
        if (severeActions.length > 0) {
          return { eligible: false, reason: 'recent_moderation_actions' };
        }
      }
      
      return { eligible: true, reason: 'all_checks_passed' };
    } catch (error) {
      logger.error('Error checking user eligibility:', error);
      return { eligible: false, reason: 'system_error' };
    }
  }
  
  /**
   * Get recent moderation actions for user
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Recent moderation actions
   */
  static async getRecentModerationActions(userId) {
    try {
      // Get actions from last 30 days
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      return await CallModerationLogModel.getByUserId(userId, {
        startDate: thirtyDaysAgo,
      });
    } catch (error) {
      logger.error('Error getting recent moderation actions:', error);
      return [];
    }
  }
  
  /**
   * Check performer eligibility
   * @param {string} performerId - Performer ID
   * @returns {Promise<Object>} { eligible, reason }
   */
  static async checkPerformerEligibility(performerId) {
    try {
      const performer = await PerformerModel.getById(performerId);
      
      if (!performer) {
        return { eligible: false, reason: 'performer_not_found' };
      }
      
      // Check if performer is active
      if (performer.status !== 'active') {
        return { eligible: false, reason: 'performer_not_active' };
      }
      
      // Check if performer is available
      if (!performer.is_available) {
        return { eligible: false, reason: 'performer_not_available' };
      }
      
      // Check for recent no-shows
      const recentCalls = await CallModel.getByPerformer(performerId);
      const recentNoShows = recentCalls.filter(call => 
        call.no_show && 
        call.status === 'completed'
      );
      
      // If performer has 2 or more no-shows in the last 7 days, they're not eligible
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentSevenDayNoShows = recentNoShows.filter(call => {
        const callDate = new Date(call.scheduled_date);
        return callDate >= sevenDaysAgo;
      });
      
      if (recentSevenDayNoShows.length >= 2) {
        return { eligible: false, reason: 'recent_no_shows' };
      }
      
      return { eligible: true, reason: 'all_checks_passed' };
    } catch (error) {
      logger.error('Error checking performer eligibility:', error);
      return { eligible: false, reason: 'system_error' };
    }
  }
  
  // =====================================================
  // ADMIN ALERTS
  // =====================================================
  
  /**
   * Send admin alert for critical issues
   * @param {Object} bot - Telegram bot instance
   * @param {string} issueType - Type of issue
   * @param {Object} issueData - Issue data
   * @returns {Promise<boolean>} Success status
   */
  static async sendAdminAlert(bot, issueType, issueData) {
    try {
      // Get admin user IDs from environment or config
      const adminUserIds = process.env.ADMIN_USER_IDS ? process.env.ADMIN_USER_IDS.split(',') : [];
      
      if (adminUserIds.length === 0) {
        logger.warn('No admin user IDs configured for alerts');
        return false;
      }
      
      let alertMessage = '';
      
      switch (issueType) {
        case 'performer_no_show':
          alertMessage = `🚨 *ADMIN ALERT: Performer No-Show*
\n🎭 Performer: ${issueData.performerName}
📅 Call ID: ${issueData.callId}
🕒 Scheduled: ${issueData.scheduledTime}
💰 Refund: Processed
\nAction: Performer has been flagged for review.`;
          break;
        
        case 'incident_reported':
          alertMessage = `🚨 *ADMIN ALERT: Incident Reported*
\n📞 Call ID: ${issueData.callId}
👤 User: ${issueData.userId}
🎭 Performer: ${issueData.performerName}
📝 Incident: ${issueData.incidentType}
\nAction: Both parties flagged for review.`;
          break;
        
        case 'multiple_no_shows':
          alertMessage = `🚨 *ADMIN ALERT: Multiple No-Shows*
\n🎭 Performer: ${issueData.performerName}
📅 No-Show Count: ${issueData.noShowCount}
📊 Time Period: ${issueData.timePeriod}
\nAction: Performer account paused automatically.`;
          break;
        
        default:
          alertMessage = `🚨 *ADMIN ALERT: ${issueType}*
\n${JSON.stringify(issueData, null, 2)}`;
      }
      
      // Send alert to all admins
      for (const adminId of adminUserIds) {
        try {
          await bot.telegram.sendMessage(adminId, alertMessage, {
            parse_mode: 'Markdown',
          });
        } catch (error) {
          logger.error('Error sending admin alert:', error);
        }
      }
      
      logger.info('Admin alert sent', {
        issueType,
        adminCount: adminUserIds.length,
      });
      
      return true;
    } catch (error) {
      logger.error('Error sending admin alert:', error);
      return false;
    }
  }
  
  // =====================================================
  // SCHEDULED MODERATION TASKS
  // =====================================================
  
  /**
   * Run scheduled moderation tasks
   * @param {Object} bot - Telegram bot instance
   * @returns {Promise<Object>} Task results
   */
  static async runScheduledTasks(bot) {
    try {
      const results = {
        callsMonitored: 0,
        noShowsDetected: 0,
        adminAlertsSent: 0,
      };
      
      // Monitor active calls
      results.callsMonitored = await this.monitorActiveCalls(bot);
      
      // Check for no-shows
      results.noShowsDetected = await this.checkForNoShows(bot);
      
      logger.info('Scheduled moderation tasks completed', results);
      
      return results;
    } catch (error) {
      logger.error('Error running scheduled moderation tasks:', error);
      return {
        callsMonitored: 0,
        noShowsDetected: 0,
        adminAlertsSent: 0,
      };
    }
  }
}


module.exports = PrivateCallModerationService;