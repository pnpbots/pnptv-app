/**
 * AI-Powered Content Moderation Service
 * Provides real-time content analysis for live streams
 */

const { query } = require('../config/postgres');
const logger = require('../utils/logger');
const { cache } = require('../config/redis');

// Moderation categories and thresholds
const MODERATION_CATEGORIES = {
  TOXICITY: 'toxicity',
  SEVERE_TOXICITY: 'severe_toxicity',
  IDENTITY_ATTACK: 'identity_attack',
  INSULT: 'insult',
  PROFANITY: 'profanity',
  THREAT: 'threat',
  SEXUALLY_EXPLICIT: 'sexually_explicit',
  FLIRTATION: 'flirtation',
};

const DEFAULT_THRESHOLDS = {
  [MODERATION_CATEGORIES.TOXICITY]: 0.7,
  [MODERATION_CATEGORIES.SEVERE_TOXICITY]: 0.5,
  [MODERATION_CATEGORIES.IDENTITY_ATTACK]: 0.6,
  [MODERATION_CATEGORIES.INSULT]: 0.6,
  [MODERATION_CATEGORIES.PROFANITY]: 0.5,
  [MODERATION_CATEGORIES.THREAT]: 0.4,
  [MODERATION_CATEGORIES.SEXUALLY_EXPLICIT]: 0.8,
  [MODERATION_CATEGORIES.FLIRTATION]: 0.9, // Higher threshold for flirtation
};

class AIModerationService {
  /**
   * Analyze text content for moderation violations
   * @param {string} text - Text to analyze
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>} Moderation results
   */
  static async analyzeContent(text, options = {}) {
    try {
      // In production, this would call an AI moderation API
      // For now, we'll implement a mock that simulates AI analysis
      
      if (!text || typeof text !== 'string') {
        return { valid: true, violations: [] };
      }

      // Mock AI analysis - in production, replace with actual API call
      const mockAnalysis = await this._mockAIAnalysis(text);
      
      // Apply thresholds and determine violations
      const violations = [];
      const thresholds = options.thresholds || DEFAULT_THRESHOLDS;

      for (const [category, score] of Object.entries(mockAnalysis.scores)) {
        if (score >= (thresholds[category] || 0.7)) {
          violations.push({
            category,
            score,
            threshold: thresholds[category] || 0.7,
            severity: this._getSeverity(score),
          });
        }
      }

      return {
        valid: violations.length === 0,
        violations,
        scores: mockAnalysis.scores,
        analysisId: mockAnalysis.analysisId,
      };
    } catch (error) {
      logger.error('AI moderation analysis failed:', error);
      return { valid: true, violations: [], error: error.message };
    }
  }

  /**
   * Mock AI analysis - replace with actual API call in production
   */
  static async _mockAIAnalysis(text) {
    // Simple keyword-based analysis for demonstration
    const analysisId = `analysis_${Date.now()}`;
    const lowerText = text.toLowerCase();

    // Initialize scores
    const scores = {
      [MODERATION_CATEGORIES.TOXICITY]: 0.1,
      [MODERATION_CATEGORIES.SEVERE_TOXICITY]: 0.05,
      [MODERATION_CATEGORIES.IDENTITY_ATTACK]: 0.05,
      [MODERATION_CATEGORIES.INSULT]: 0.1,
      [MODERATION_CATEGORIES.PROFANITY]: 0.1,
      [MODERATION_CATEGORIES.THREAT]: 0.05,
      [MODERATION_CATEGORIES.SEXUALLY_EXPLICIT]: 0.1,
      [MODERATION_CATEGORIES.FLIRTATION]: 0.2,
    };

    // Simple keyword detection (replace with AI API)
    const badWords = ['hate', 'stupid', 'idiot', 'fuck', 'shit', 'bitch', 'asshole'];
    const sexualWords = ['sex', 'fuck', 'nude', 'naked', 'dick', 'pussy', 'boobs'];
    const threatWords = ['kill', 'die', 'murder', 'bomb', 'shoot'];

    // Count matches
    let badWordCount = 0;
    let sexualWordCount = 0;
    let threatWordCount = 0;

    badWords.forEach(word => {
      if (lowerText.includes(word)) badWordCount++;
    });

    sexualWords.forEach(word => {
      if (lowerText.includes(word)) sexualWordCount++;
    });

    threatWords.forEach(word => {
      if (lowerText.includes(word)) threatWordCount++;
    });

    // Adjust scores based on matches
    if (badWordCount > 0) {
      scores[MODERATION_CATEGORIES.TOXICITY] = Math.min(0.3 + (badWordCount * 0.1), 0.9);
      scores[MODERATION_CATEGORIES.INSULT] = Math.min(0.2 + (badWordCount * 0.15), 0.8);
    }

    if (sexualWordCount > 0) {
      scores[MODERATION_CATEGORIES.SEXUALLY_EXPLICIT] = Math.min(0.4 + (sexualWordCount * 0.1), 0.9);
    }

    if (threatWordCount > 0) {
      scores[MODERATION_CATEGORIES.THREAT] = Math.min(0.5 + (threatWordCount * 0.2), 0.9);
      scores[MODERATION_CATEGORIES.SEVERE_TOXICITY] = Math.min(0.3 + (threatWordCount * 0.2), 0.8);
    }

    // Check for flirtation patterns
    const flirtationPatterns = ['hot', 'sexy', 'beautiful', 'gorgeous', 'love you', 'kiss', 'hug'];
    let flirtationCount = 0;
    flirtationPatterns.forEach(pattern => {
      if (lowerText.includes(pattern)) flirtationCount++;
    });

    if (flirtationCount > 0) {
      scores[MODERATION_CATEGORIES.FLIRTATION] = Math.min(0.3 + (flirtationCount * 0.1), 0.8);
    }

    return { analysisId, scores };
  }

  /**
   * Get severity level based on score
   */
  static _getSeverity(score) {
    if (score >= 0.8) return 'HIGH';
    if (score >= 0.6) return 'MEDIUM';
    if (score >= 0.4) return 'LOW';
    return 'NONE';
  }

  /**
   * Moderate chat message before posting
   * @param {string} streamId - Stream ID
   * @param {string} userId - User ID
   * @param {string} text - Message text
   * @param {Object} options - Moderation options
   * @returns {Promise<Object>} Moderation result
   */
  static async moderateChatMessage(streamId, userId, text, options = {}) {
    try {
      // Analyze content
      const analysis = await this.analyzeContent(text, options);

      if (analysis.valid) {
        return { allowed: true, analysis };
      }

      // Content violates policies - handle accordingly
      const action = await this._determineModerationAction(streamId, userId, analysis);

      return {
        allowed: false,
        analysis,
        action,
        message: this._getViolationMessage(analysis.violations),
      };
    } catch (error) {
      logger.error('Chat message moderation failed:', error);
      return { allowed: true, error: error.message };
    }
  }

  /**
   * Determine appropriate moderation action
   */
  static async _determineModerationAction(streamId, userId, analysis) {
    // Check user's violation history
    const violations = await this._getUserViolations(streamId, userId);
    const totalViolations = violations.length;

    // Determine action based on severity and history
    const hasHighSeverity = analysis.violations.some(v => v.severity === 'HIGH');

    if (hasHighSeverity || totalViolations >= 3) {
      return { type: 'BAN', duration: 'PERMANENT' };
    } else if (totalViolations >= 2) {
      return { type: 'MUTE', duration: '30_MINUTES' };
    } else if (totalViolations >= 1) {
      return { type: 'WARN' };
    } else {
      return { type: 'WARN' };
    }
  }

  /**
   * Get user's violation history for a stream
   */
  static async _getUserViolations(streamId, userId) {
    try {
      const result = await query(
        `SELECT * FROM stream_chat_violations 
         WHERE stream_id = $1 AND user_id = $2 
         ORDER BY created_at DESC LIMIT 10`,
        [streamId, userId]
      );
      return result.rows || [];
    } catch (error) {
      logger.error('Error getting user violations:', error);
      return [];
    }
  }

  /**
   * Record a moderation violation
   */
  static async recordViolation(streamId, userId, violationData) {
    try {
      await query(
        `INSERT INTO stream_chat_violations 
         (stream_id, user_id, violation_type, severity, score, 
          category, message_text, action_taken, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          streamId,
          userId,
          violationData.violations[0].category,
          violationData.violations[0].severity,
          violationData.violations[0].score,
          violationData.violations[0].category,
          violationData.messageText || '',
          violationData.action?.type || 'NONE'
        ]
      );
    } catch (error) {
      logger.error('Error recording violation:', error);
    }
  }

  /**
   * Get violation message for user feedback
   */
  static _getViolationMessage(violations) {
    if (!violations || violations.length === 0) {
      return 'Your message was not posted.';
    }

    const highSeverity = violations.some(v => v.severity === 'HIGH');
    const categories = violations.map(v => v.category);

    if (highSeverity) {
      return 'Your message violates our community guidelines and cannot be posted.';
    }

    if (categories.includes(MODERATION_CATEGORIES.SEXUALLY_EXPLICIT)) {
      return 'Your message contains inappropriate content and cannot be posted.';
    }

    if (categories.includes(MODERATION_CATEGORIES.THREAT)) {
      return 'Threats and violent language are not allowed.';
    }

    return 'Your message violates our community guidelines.';
  }

  /**
   * Get stream moderation settings
   */
  static async getStreamModerationSettings(streamId) {
    try {
      const cacheKey = `stream:moderation:${streamId}`;
      const cached = await cache.get(cacheKey);

      if (cached) {
        return JSON.parse(cached);
      }

      const result = await query(
        `SELECT 
         COALESCE(ai_moderation_enabled, FALSE) as ai_moderation_enabled,
         COALESCE(moderation_thresholds, '{}')::jsonb as moderation_thresholds,
         COALESCE(auto_moderate, FALSE) as auto_moderate
         FROM live_streams WHERE stream_id = $1`,
        [streamId]
      );

      if (result.rows && result.rows.length > 0) {
        const settings = result.rows[0];
        await cache.setex(cacheKey, 300, JSON.stringify(settings));
        return settings;
      }

      return {
        ai_moderation_enabled: false,
        moderation_thresholds: DEFAULT_THRESHOLDS,
        auto_moderate: false,
      };
    } catch (error) {
      logger.error('Error getting moderation settings:', error);
      return {
        ai_moderation_enabled: false,
        moderation_thresholds: DEFAULT_THRESHOLDS,
        auto_moderate: false,
      };
    }
  }

  /**
   * Update stream moderation settings
   */
  static async updateStreamModerationSettings(streamId, settings) {
    try {
      await query(
        `UPDATE live_streams 
         SET 
         ai_moderation_enabled = $2,
         moderation_thresholds = $3,
         auto_moderate = $4,
         updated_at = NOW()
         WHERE stream_id = $1`,
        [streamId, settings.ai_moderation_enabled, settings.moderation_thresholds, settings.auto_moderate]
      );

      // Invalidate cache
      await cache.del(`stream:moderation:${streamId}`);

      return true;
    } catch (error) {
      logger.error('Error updating moderation settings:', error);
      return false;
    }
  }

  /**
   * Get moderation statistics for a stream
   */
  static async getModerationStats(streamId) {
    try {
      const result = await query(
        `SELECT 
         COUNT(*) as total_violations,
         COUNT(*) FILTER (WHERE severity = 'HIGH') as high_severity,
         COUNT(*) FILTER (WHERE severity = 'MEDIUM') as medium_severity,
         COUNT(*) FILTER (WHERE severity = 'LOW') as low_severity,
         COUNT(DISTINCT user_id) as violating_users,
         COUNT(*) FILTER (WHERE action_taken = 'BAN') as bans_issued,
         COUNT(*) FILTER (WHERE action_taken = 'MUTE') as mutes_issued
         FROM stream_chat_violations 
         WHERE stream_id = $1`,
        [streamId]
      );

      return result.rows[0] || {
        total_violations: 0,
        high_severity: 0,
        medium_severity: 0,
        low_severity: 0,
        violating_users: 0,
        bans_issued: 0,
        mutes_issued: 0,
      };
    } catch (error) {
      logger.error('Error getting moderation stats:', error);
      return {
        total_violations: 0,
        high_severity: 0,
        medium_severity: 0,
        low_severity: 0,
        violating_users: 0,
        bans_issued: 0,
        mutes_issued: 0,
      };
    }
  }
}

// Export service and constants
module.exports = AIModerationService;
module.exports.MODERATION_CATEGORIES = MODERATION_CATEGORIES;
module.exports.DEFAULT_THRESHOLDS = DEFAULT_THRESHOLDS;