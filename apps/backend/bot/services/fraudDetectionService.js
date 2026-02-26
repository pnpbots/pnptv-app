/**
 * Fraud Detection Service
 * Comprehensive fraud prevention and detection system
 */

const logger = require('../../utils/logger');
const redis = require('../../config/redis');
const { query } = require('../../config/postgres');
const crypto = require('crypto');

class FraudDetectionService {
  /**
   * RULE 1: Detect Velocity Abuse (multiple transactions in short time)
   */
  static async checkVelocityAbuse(userId, timeWindowMinutes = 5) {
    try {
      const cacheKey = `fraud:velocity:${userId}`;
      const current = await redis.incr(cacheKey);
      
      if (current === 1) {
        await redis.expire(cacheKey, timeWindowMinutes * 60);
      }

      const attempts = parseInt(current);
      const maxAttempts = 3; // Max 3 attempts per 5 minutes

      logger.info('Velocity check', {
        userId,
        attempts,
        maxAttempts,
        timeWindowMinutes,
        flagged: attempts > maxAttempts,
      });

      return {
        flagged: attempts > maxAttempts,
        attempts,
        maxAttempts,
        reason: attempts > maxAttempts ? 'Velocity abuse detected' : null,
      };
    } catch (error) {
      logger.error('Error checking velocity abuse:', error);
      return { flagged: false };
    }
  }

  /**
   * RULE 2: Detect Unusual Location Changes
   * Flag if user location changes dramatically between transactions
   */
  static async checkLocationAnomaly(userId, currentLocation) {
    try {
      const cacheKey = `fraud:location:${userId}`;
      const lastLocation = await redis.get(cacheKey);

      if (lastLocation) {
        const last = JSON.parse(lastLocation);
        const distance = this.calculateDistance(last, currentLocation);
        const speedKmh = distance / 0.0833; // Assuming 5 minutes between transactions

        logger.warn('Location anomaly check', {
          userId,
          distance: distance.toFixed(2),
          speedKmh: speedKmh.toFixed(2),
          flagged: speedKmh > 900, // Impossible travel speed
        });

        // Flag if travel speed exceeds 900 km/h (impossible)
        if (speedKmh > 900) {
          return {
            flagged: true,
            reason: 'Impossible travel distance between transactions',
            distance: distance.toFixed(2),
            speedKmh: speedKmh.toFixed(2),
          };
        }
      }

      // Store current location
      await redis.setex(cacheKey, 3600, JSON.stringify(currentLocation));

      return { flagged: false };
    } catch (error) {
      logger.error('Error checking location anomaly:', error);
      return { flagged: false };
    }
  }

  /**
   * RULE 3: Detect Unusual Amount Patterns
   */
  static async checkAmountAnomaly(userId, amount) {
    try {
      // Get user's transaction history for last 30 days
      const result = await query(`
        SELECT 
          AVG(CAST(amount AS FLOAT)) as avg_amount,
          MAX(CAST(amount AS FLOAT)) as max_amount,
          MIN(CAST(amount AS FLOAT)) as min_amount,
          STDDEV(CAST(amount AS FLOAT)) as stddev
        FROM payments
        WHERE user_id = $1 
          AND created_at > NOW() - INTERVAL '30 days'
          AND status = 'completed'
      `, [userId]);

      const stats = result.rows[0];
      if (!stats || !stats.avg_amount) {
        return { flagged: false, reason: 'No transaction history' };
      }

      const avg = parseFloat(stats.avg_amount);
      const stdDev = parseFloat(stats.stddev) || avg * 0.5;
      const zScore = Math.abs((amount - avg) / stdDev);

      logger.info('Amount anomaly check', {
        userId,
        currentAmount: amount,
        avgAmount: avg.toFixed(2),
        zScore: zScore.toFixed(2),
        flagged: zScore > 3, // 3 standard deviations = ~99.7% confidence
      });

      return {
        flagged: zScore > 3,
        reason: zScore > 3 ? 'Unusual transaction amount' : null,
        zScore: zScore.toFixed(2),
        avgAmount: avg.toFixed(2),
      };
    } catch (error) {
      logger.error('Error checking amount anomaly:', error);
      return { flagged: false };
    }
  }

  /**
   * RULE 4: Detect Card Testing (small consecutive transactions)
   */
  static async checkCardTesting(userId, amount) {
    try {
      const cacheKey = `fraud:cardtest:${userId}`;
      const testThreshold = 5; // cents/COP
      
      const recentTxns = await query(`
        SELECT amount FROM payments
        WHERE user_id = $1 
          AND created_at > NOW() - INTERVAL '1 hour'
          AND CAST(amount AS FLOAT) < $2
        ORDER BY created_at DESC
        LIMIT 5
      `, [userId, testThreshold]);

      if (recentTxns.rows.length >= 3) {
        logger.warn('Card testing pattern detected', {
          userId,
          smallTransactions: recentTxns.rows.length,
          threshold: testThreshold,
          flagged: true,
        });

        return {
          flagged: true,
          reason: 'Card testing pattern detected (multiple small transactions)',
          count: recentTxns.rows.length,
        };
      }

      return { flagged: false };
    } catch (error) {
      logger.error('Error checking card testing:', error);
      return { flagged: false };
    }
  }

  /**
   * RULE 5: Detect Multiple Failed Attempts (Brute Force)
   */
  static async checkBruteForce(userId, paymentId) {
    try {
      const cacheKey = `fraud:failed:${userId}`;
      const failedAttempts = await redis.incr(cacheKey);

      if (failedAttempts === 1) {
        await redis.expire(cacheKey, 3600); // 1 hour window
      }

      const maxFailed = 5;
      const flagged = failedAttempts > maxFailed;

      logger.warn('Brute force check', {
        userId,
        failedAttempts,
        maxFailed,
        flagged,
      });

      return {
        flagged,
        reason: flagged ? 'Too many failed payment attempts' : null,
        failedAttempts,
        maxFailed,
      };
    } catch (error) {
      logger.error('Error checking brute force:', error);
      return { flagged: false };
    }
  }

  /**
   * RULE 6: Detect Account Takeover (new device/IP)
   */
  static async checkDeviceFingerprint(userId, ipAddress, userAgent) {
    try {
      const cacheKey = `fraud:device:${userId}`;
      const fingerprint = crypto
        .createHash('sha256')
        .update(`${ipAddress}:${userAgent}`)
        .digest('hex');

      const lastFingerprint = await redis.get(cacheKey);

      if (lastFingerprint && lastFingerprint !== fingerprint) {
        logger.warn('Device fingerprint changed', {
          userId,
          previousFingerprint: lastFingerprint.substring(0, 8),
          currentFingerprint: fingerprint.substring(0, 8),
          flagged: true,
        });

        return {
          flagged: true,
          reason: 'New device detected (possible account takeover)',
          newDevice: true,
          fingerprint: fingerprint.substring(0, 16),
        };
      }

      await redis.setex(cacheKey, 86400 * 30, fingerprint); // 30 days

      return { flagged: false, newDevice: false };
    } catch (error) {
      logger.error('Error checking device fingerprint:', error);
      return { flagged: false };
    }
  }

  /**
   * RULE 7: Detect Blacklisted Cards
   */
  static async checkBlacklistedCard(cardLastFour, cardBrand) {
    try {
      const key = `fraud:blacklist:card:${cardBrand}:${cardLastFour}`;
      const isBlacklisted = await redis.get(key);

      if (isBlacklisted) {
        logger.warn('Blacklisted card detected', {
          card: `${cardBrand} ****${cardLastFour}`,
          flagged: true,
        });

        return {
          flagged: true,
          reason: 'Card is blacklisted due to fraud',
        };
      }

      return { flagged: false };
    } catch (error) {
      logger.error('Error checking blacklist:', error);
      return { flagged: false };
    }
  }

  /**
   * RULE 8: Detect High-Risk Countries
   */
  static async checkHighRiskCountry(countryCode) {
    try {
      // List of high-risk countries for payments (FATF gray list + known fraud zones)
      const highRiskCountries = [
        'KP', // North Korea
        'IR', // Iran
        'SY', // Syria
        'CU', // Cuba
      ];

      const isHighRisk = highRiskCountries.includes(countryCode?.toUpperCase());

      if (isHighRisk) {
        logger.warn('High-risk country detected', {
          country: countryCode,
          flagged: true,
        });

        return {
          flagged: true,
          reason: 'Transaction from high-risk country',
          country: countryCode,
        };
      }

      return { flagged: false };
    } catch (error) {
      logger.error('Error checking country risk:', error);
      return { flagged: false };
    }
  }

  /**
   * RULE 9: Detect Duplicate Transactions
   */
  static async checkDuplicateTransaction(userId, amount, merchant, timeWindowSeconds = 60) {
    try {
      const result = await query(`
        SELECT COUNT(*) as count FROM payments
        WHERE user_id = $1 
          AND amount = $2
          AND created_at > NOW() - INTERVAL '${timeWindowSeconds} seconds'
          AND status IN ('completed', 'pending')
      `, [userId, amount]);

      const duplicateCount = parseInt(result.rows[0].count);
      const flagged = duplicateCount > 0;

      if (flagged) {
        logger.warn('Duplicate transaction detected', {
          userId,
          amount,
          duplicateCount,
          flagged: true,
        });
      }

      return {
        flagged,
        reason: flagged ? 'Duplicate transaction detected' : null,
        duplicateCount,
      };
    } catch (error) {
      logger.error('Error checking duplicate transaction:', error);
      return { flagged: false };
    }
  }

  /**
   * RULE 10: Detect Linked Fraud Accounts
   * Check if payment details match other flagged/banned users
   */
  static async checkLinkedFraudAccounts(email, phone, cardLastFour) {
    try {
      const result = await query(`
        SELECT COUNT(DISTINCT user_id) as linked_count
        FROM fraud_flags
        WHERE (email = $1 OR phone = $2 OR card_last_four = $3)
          AND flagged = true
          AND created_at > NOW() - INTERVAL '180 days'
      `, [email, phone, cardLastFour]);

      const linkedCount = parseInt(result.rows[0].linked_count);
      const flagged = linkedCount > 0;

      if (flagged) {
        logger.warn('Linked fraud accounts detected', {
          linkedCount,
          flagged: true,
        });
      }

      return {
        flagged,
        reason: flagged ? 'Payment details match flagged accounts' : null,
        linkedCount,
      };
    } catch (error) {
      logger.error('Error checking linked fraud accounts:', error);
      return { flagged: false };
    }
  }

  /**
   * RULE 11: Detect Email/Phone Pattern Anomalies
   */
  static async checkContactAnomaly(userId, email, phone) {
    try {
      const result = await query(`
        SELECT COUNT(DISTINCT email) as email_count,
               COUNT(DISTINCT phone) as phone_count
        FROM payments
        WHERE user_id = $1
          AND created_at > NOW() - INTERVAL '90 days'
      `, [userId]);

      const { email_count, phone_count } = result.rows[0];

      const flagged = (email_count > 3 || phone_count > 3);

      logger.info('Contact anomaly check', {
        userId,
        uniqueEmails: email_count,
        uniquePhones: phone_count,
        flagged,
      });

      return {
        flagged,
        reason: flagged ? 'Unusual contact information pattern' : null,
        uniqueEmails: email_count,
        uniquePhones: phone_count,
      };
    } catch (error) {
      logger.error('Error checking contact anomaly:', error);
      return { flagged: false };
    }
  }

  /**
   * RULE 12: Detect Refund Abuse
   */
  static async checkRefundAbuse(userId) {
    try {
      const result = await query(`
        SELECT 
          COUNT(*) as refund_count,
          SUM(CAST(amount AS FLOAT)) as refund_total
        FROM payments
        WHERE user_id = $1 
          AND status = 'refunded'
          AND created_at > NOW() - INTERVAL '90 days'
      `, [userId]);

      const { refund_count, refund_total } = result.rows[0];
      const refundRate = await query(`
        SELECT COUNT(*) as total FROM payments
        WHERE user_id = $1 AND created_at > NOW() - INTERVAL '90 days'
      `, [userId]);

      const totalTxns = parseInt(refundRate.rows[0].total);
      const refundPercentage = (refund_count / totalTxns) * 100;

      const flagged = refundPercentage > 30; // More than 30% refund rate

      logger.warn('Refund abuse check', {
        userId,
        refundCount: refund_count,
        totalCount: totalTxns,
        refundPercentage: refundPercentage.toFixed(2),
        flagged,
      });

      return {
        flagged,
        reason: flagged ? 'Excessive refund requests' : null,
        refundCount: refund_count,
        refundPercentage: refundPercentage.toFixed(2),
      };
    } catch (error) {
      logger.error('Error checking refund abuse:', error);
      return { flagged: false };
    }
  }

  /**
   * Helper: Calculate distance between two GPS coordinates (Haversine formula)
   */
  static calculateDistance(point1, point2) {
    const R = 6371; // Earth radius in km
    const lat1 = (point1.lat * Math.PI) / 180;
    const lat2 = (point2.lat * Math.PI) / 180;
    const deltaLat = ((point2.lat - point1.lat) * Math.PI) / 180;
    const deltaLon = ((point2.lng - point1.lng) * Math.PI) / 180;

    const a =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1) *
        Math.cos(lat2) *
        Math.sin(deltaLon / 2) *
        Math.sin(deltaLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * COMPREHENSIVE: Run all fraud checks
   */
  static async runAllFraudChecks(transactionData) {
    try {
      const {
        userId,
        amount,
        email,
        phone,
        cardLastFour,
        cardBrand,
        ipAddress,
        userAgent,
        countryCode,
        location,
      } = transactionData;

      logger.info('🔒 Running comprehensive fraud checks', {
        userId,
        amount,
        timestamp: new Date(),
      });

      // Run all checks in parallel
      const [
        velocityCheck,
        locationCheck,
        amountCheck,
        cardTestCheck,
        bruteForceCheck,
        deviceCheck,
        blacklistCheck,
        countryCheck,
        duplicateCheck,
        linkedCheck,
        contactCheck,
        refundCheck,
      ] = await Promise.all([
        this.checkVelocityAbuse(userId),
        location ? this.checkLocationAnomaly(userId, location) : Promise.resolve({ flagged: false }),
        this.checkAmountAnomaly(userId, amount),
        this.checkCardTesting(userId, amount),
        this.checkBruteForce(userId),
        this.checkDeviceFingerprint(userId, ipAddress, userAgent),
        this.checkBlacklistedCard(cardLastFour, cardBrand),
        this.checkHighRiskCountry(countryCode),
        this.checkDuplicateTransaction(userId, amount),
        this.checkLinkedFraudAccounts(email, phone, cardLastFour),
        this.checkContactAnomaly(userId, email, phone),
        this.checkRefundAbuse(userId),
      ]);

      const fraudChecks = [
        { name: 'Velocity Abuse', ...velocityCheck },
        { name: 'Location Anomaly', ...locationCheck },
        { name: 'Amount Anomaly', ...amountCheck },
        { name: 'Card Testing', ...cardTestCheck },
        { name: 'Brute Force', ...bruteForceCheck },
        { name: 'Device Fingerprint', ...deviceCheck },
        { name: 'Blacklisted Card', ...blacklistCheck },
        { name: 'High-Risk Country', ...countryCheck },
        { name: 'Duplicate Transaction', ...duplicateCheck },
        { name: 'Linked Fraud', ...linkedCheck },
        { name: 'Contact Anomaly', ...contactCheck },
        { name: 'Refund Abuse', ...refundCheck },
      ];

      const flaggedChecks = fraudChecks.filter((c) => c.flagged);
      const riskScore = flaggedChecks.length; // 0-12 scale

      logger.warn('Fraud check results', {
        userId,
        totalChecks: fraudChecks.length,
        flaggedChecks: flaggedChecks.length,
        riskScore,
        flaggedRules: flaggedChecks.map((c) => c.name),
      });

      // Store fraud flags for audit
      if (flaggedChecks.length > 0) {
        await this.storeFraudFlags(userId, transactionData, flaggedChecks);
      }

      return {
        riskScore,
        isFraudulent: riskScore >= 3, // Flag if 3+ checks fail
        flaggedChecks,
        allChecks: fraudChecks,
        recommendation:
          riskScore >= 3 ? 'BLOCK_TRANSACTION' : riskScore >= 2 ? 'REVIEW' : 'APPROVE',
      };
    } catch (error) {
      logger.error('Error running fraud checks:', error);
      return {
        riskScore: 0,
        isFraudulent: false,
        error: error.message,
        recommendation: 'REVIEW',
      };
    }
  }

  /**
   * Store fraud flags in database for audit trail
   */
  static async storeFraudFlags(userId, transactionData, flaggedChecks) {
    try {
      const { email, phone, cardLastFour, amount } = transactionData;
      const reasons = flaggedChecks.map((c) => c.name).join(', ');

      await query(
        `INSERT INTO fraud_flags (user_id, email, phone, card_last_four, amount, flagged_rules, risk_score, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [userId, email, phone, cardLastFour, amount, reasons, flaggedChecks.length]
      );

      logger.info('Fraud flags stored', {
        userId,
        flagsCount: flaggedChecks.length,
      });
    } catch (error) {
      logger.error('Error storing fraud flags:', error);
    }
  }

  /**
   * Reset failed payment counter for user
   */
  static async resetFailedCounter(userId) {
    try {
      const key = `fraud:failed:${userId}`;
      await redis.del(key);
      logger.info('Failed payment counter reset', { userId });
    } catch (error) {
      logger.error('Error resetting counter:', error);
    }
  }

  /**
   * Blacklist a card temporarily
   */
  static async blacklistCard(cardLastFour, cardBrand, reason, durationDays = 30) {
    try {
      const key = `fraud:blacklist:card:${cardBrand}:${cardLastFour}`;
      await redis.setex(
        key,
        durationDays * 86400,
        JSON.stringify({ reason, blockedAt: new Date() })
      );

      logger.warn('Card blacklisted', {
        card: `${cardBrand} ****${cardLastFour}`,
        reason,
        durationDays,
      });
    } catch (error) {
      logger.error('Error blacklisting card:', error);
    }
  }
}

module.exports = FraudDetectionService;
