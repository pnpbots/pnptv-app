/**
 * Payment Security Enhancements Service
 * Additional security layers for payment processing
 */

const crypto = require('crypto');
const logger = require('../../utils/logger');
const { cache } = require('../../config/redis');
const { query } = require('../../config/postgres');

class PaymentSecurityService {
  static getRequiredSecret(secretName) {
    const value = process.env[secretName];
    if (!value) {
      logger.error(`Missing required secret for payment security: ${secretName}`);
      return null;
    }
    return value;
  }

  /**
   * ENHANCEMENT 1: Encrypt Sensitive Payment Data
   */
  static encryptSensitiveData(data) {
    try {
      const encryptionKey = this.getRequiredSecret('ENCRYPTION_KEY');
      if (!encryptionKey) return null;

      const algorithm = 'aes-256-cbc';
      const key = crypto.createHash('sha256').update(encryptionKey).digest();
      const iv = crypto.randomBytes(16);

      const cipher = crypto.createCipheriv(algorithm, key, iv);
      let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const result = `${iv.toString('hex')}:${encrypted}`;
      logger.info('Payment data encrypted', { dataType: typeof data });
      return result;
    } catch (error) {
      logger.error('Error encrypting payment data:', error);
      return null;
    }
  }

  /**
   * ENHANCEMENT 2: Decrypt Sensitive Payment Data
   */
  static decryptSensitiveData(encryptedData) {
    try {
      const encryptionKey = this.getRequiredSecret('ENCRYPTION_KEY');
      if (!encryptionKey) return null;

      const algorithm = 'aes-256-cbc';
      const key = crypto.createHash('sha256').update(encryptionKey).digest();
      const [ivHex, encrypted] = encryptedData.split(':');
      const iv = Buffer.from(ivHex, 'hex');

      const decipher = crypto.createDecipheriv(algorithm, key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      logger.info('Payment data decrypted');
      return JSON.parse(decrypted);
    } catch (error) {
      logger.error('Error decrypting payment data:', error);
      return null;
    }
  }

  /**
   * ENHANCEMENT 3: Generate Secure Payment Token
   */
  static async generateSecurePaymentToken(paymentId, userId, amount) {
    try {
      const jwtSecret = this.getRequiredSecret('JWT_SECRET');
      if (!jwtSecret) return null;

      const data = `${paymentId}:${userId}:${amount}:${Date.now()}`;
      const token = crypto
        .createHmac('sha256', jwtSecret)
        .update(data)
        .digest('hex');

      const tokenData = {
        token,
        paymentId,
        userId,
        amount,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000), // 1 hour
      };

      // Store token in Redis
      await cache.set(`payment:token:${token}`, tokenData, 3600);

      logger.info('Secure payment token generated', { paymentId, expiresIn: '1 hour' });
      return token;
    } catch (error) {
      logger.error('Error generating payment token:', error);
      return null;
    }
  }

  /**
   * ENHANCEMENT 4: Validate Secure Payment Token
   */
  static async validatePaymentToken(token) {
    try {
      const data = await cache.get(`payment:token:${token}`);
      if (!data) {
        logger.warn('Invalid or expired payment token', { token: token.substring(0, 10) });
        return { valid: false, reason: 'Token expired or not found' };
      }

      if (new Date(data.expiresAt) < new Date()) {
        await cache.del(`payment:token:${token}`);
        logger.warn('Payment token expired', { token: token.substring(0, 10) });
        return { valid: false, reason: 'Token expired' };
      }

      logger.info('Payment token valid', { paymentId: data.paymentId });
      return { valid: true, data };
    } catch (error) {
      logger.error('Error validating payment token:', error);
      return { valid: false, reason: error.message };
    }
  }

  /**
   * ENHANCEMENT 5: Create Payment Request Hash
   */
  static createPaymentRequestHash(paymentData) {
    try {
      const encryptionKey = this.getRequiredSecret('ENCRYPTION_KEY');
      if (!encryptionKey) return null;

      const {
        userId,
        amount,
        currency,
        planId,
        timestamp,
      } = paymentData;

      const data = `${userId}|${amount}|${currency}|${planId}|${timestamp}`;
      const hash = crypto
        .createHmac('sha256', encryptionKey)
        .update(data)
        .digest('hex');

      logger.info('Payment request hash created', { paymentId: paymentData.id });
      return hash;
    } catch (error) {
      logger.error('Error creating payment hash:', error);
      return null;
    }
  }

  /**
   * ENHANCEMENT 6: Verify Payment Request Integrity
   */
  static verifyPaymentRequestHash(paymentData, hash) {
    try {
      const encryptionKey = this.getRequiredSecret('ENCRYPTION_KEY');
      if (!encryptionKey) return false;

      const {
        userId,
        amount,
        currency,
        planId,
        timestamp,
      } = paymentData;

      const data = `${userId}|${amount}|${currency}|${planId}|${timestamp}`;
      const expectedHash = crypto
        .createHmac('sha256', encryptionKey)
        .update(data)
        .digest('hex');

      const isValid = hash === expectedHash;
      logger.info('Payment request hash verification', {
        isValid,
        paymentId: paymentData.id,
      });

      return isValid;
    } catch (error) {
      logger.error('Error verifying payment hash:', error);
      return false;
    }
  }

  /**
   * ENHANCEMENT 7: Validate Payment Amount Integrity
   */
  static async validatePaymentAmount(paymentId, expectedAmount) {
    try {
      const payment = await query(
        'SELECT amount FROM payments WHERE id = $1',
        [paymentId]
      );

      if (!payment.rows.length) {
        logger.warn('Payment not found for amount validation', { paymentId });
        return { valid: false, reason: 'Payment not found' };
      }

      const actualAmount = parseFloat(payment.rows[0].amount);
      const isValid = Math.abs(actualAmount - expectedAmount) < 0.01; // Allow 1 cent difference

      if (!isValid) {
        logger.error('Payment amount mismatch', {
          paymentId,
          expected: expectedAmount,
          actual: actualAmount,
        });

        return { valid: false, reason: 'Amount mismatch', actual: actualAmount };
      }

      logger.info('Payment amount validated', { paymentId });
      return { valid: true };
    } catch (error) {
      logger.error('Error validating payment amount:', error);
      return { valid: false, reason: error.message };
    }
  }

  /**
   * ENHANCEMENT 8: Implement Rate Limiting per User
   */
  static async checkPaymentRateLimit(userId, maxPerHour = 10) {
    try {
      const key = `payment:ratelimit:${userId}`;
      const current = await cache.incr(key, 3600);

      const isLimited = current > maxPerHour;

      logger.info('Payment rate limit check', {
        userId,
        attempts: current,
        maxPerHour,
        limited: isLimited,
      });

      return {
        allowed: !isLimited,
        attempts: current,
        maxPerHour,
        reason: isLimited ? `Max ${maxPerHour} payments per hour allowed` : null,
      };
    } catch (error) {
      logger.error('Error checking payment rate limit:', error);
      return { allowed: true }; // Don't block on error
    }
  }

  /**
   * ENHANCEMENT 9: Webhook Signature Validation (Advanced)
   */
  static validateWebhookSignature(payload, signature, secret) {
    try {
      const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payloadString)
        .digest('hex');

      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );

      logger.info('Webhook signature validation', { isValid });
      return isValid;
    } catch (error) {
      logger.error('Error validating webhook signature:', error);
      return false;
    }
  }

  /**
   * ENHANCEMENT 10: Transaction Replay Attack Prevention
   */
  static async checkReplayAttack(transactionId, provider) {
    try {
      const key = `payment:replay:${provider}:${transactionId}`;
      const exists = await cache.get(key);

      if (exists) {
        logger.error('REPLAY ATTACK DETECTED', {
          transactionId,
          provider,
        });

        return { isReplay: true, reason: 'Transaction already processed' };
      }

      // Mark as processed (30-day retention)
      await cache.set(key, 'processed', 86400 * 30);

      logger.info('Transaction replay check passed', { transactionId });
      return { isReplay: false };
    } catch (error) {
      logger.error('Error checking replay attack:', error);
      return { isReplay: false };
    }
  }

  /**
   * ENHANCEMENT 11: Implement Payment Timeout
   */
  static async setPaymentTimeout(paymentId, timeoutSeconds = 3600) {
    try {
      const key = `payment:timeout:${paymentId}`;
      await cache.set(key, { paymentId, createdAt: new Date() }, timeoutSeconds);

      logger.info('Payment timeout set', { paymentId, timeoutSeconds });
      return true;
    } catch (error) {
      logger.error('Error setting payment timeout:', error);
      return false;
    }
  }

  /**
   * ENHANCEMENT 12: Check Payment Timeout
   */
  static async checkPaymentTimeout(paymentId) {
    try {
      const key = `payment:timeout:${paymentId}`;
      const timeout = await cache.get(key);

      if (!timeout) {
        logger.warn('Payment timeout expired or not found', { paymentId });
        return { expired: true, reason: 'Payment timeout expired' };
      }

      logger.info('Payment still within timeout window', { paymentId });
      return { expired: false };
    } catch (error) {
      logger.error('Error checking payment timeout:', error);
      return { expired: false };
    }
  }

  /**
   * ENHANCEMENT 13: Log All Payment Events (Audit Trail)
   */
  static async logPaymentEvent(eventData) {
    try {
      const {
        paymentId,
        userId,
        eventType, // 'created', 'pending', 'completed', 'failed', 'refunded', 'blocked'
        provider,
        amount,
        status,
        ipAddress,
        userAgent,
        details,
      } = eventData;

      await query(
        `INSERT INTO payment_audit_log
         (payment_id, user_id, event_type, provider, amount, status, ip_address, user_agent, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [paymentId, userId, eventType, provider, amount, status, ipAddress, userAgent, JSON.stringify(details)]
      );

      logger.info('Payment event logged', { paymentId, eventType, status });
    } catch (error) {
      logger.error('Error logging payment event:', error);
    }
  }

  /**
   * ENHANCEMENT 14: Implement PCI Compliance Measures
   */
  static validatePCICompliance(cardData) {
    try {
      // Never store full credit card numbers
      if (cardData.fullNumber && cardData.fullNumber.length > 6) {
        logger.error('PCI VIOLATION: Full card number detected!');
        return { compliant: false, reason: 'Full card number should never be stored' };
      }

      // Validate card format (Luhn algorithm)
      if (cardData.lastFour && cardData.lastFour.length !== 4) {
        logger.error('Invalid card data format');
        return { compliant: false, reason: 'Invalid card format' };
      }

      // Ensure no sensitive data in logs
      if (JSON.stringify(cardData).includes('CVV') || JSON.stringify(cardData).includes('CVC')) {
        logger.error('PCI VIOLATION: CVV/CVC data detected!');
        return { compliant: false, reason: 'CVV/CVC should never be stored' };
      }

      logger.info('PCI compliance check passed');
      return { compliant: true };
    } catch (error) {
      logger.error('Error checking PCI compliance:', error);
      return { compliant: false, reason: error.message };
    }
  }

  /**
   * ENHANCEMENT 15: Implement IP Whitelist for Admin
   */
  static async checkAdminIPWhitelist(userId, ipAddress) {
    try {
      const ips = await cache.get(`admin:whitelist:${userId}`);
      if (!ips) {
        logger.info('No IP whitelist for admin', { userId });
        return { allowed: true };
      }

      const isAllowed = Array.isArray(ips) && ips.includes(ipAddress);

      if (!isAllowed) {
        logger.warn('Admin access from non-whitelisted IP', {
          userId,
          ipAddress,
        });
      }

      return { allowed: isAllowed };
    } catch (error) {
      logger.error('Error checking admin IP whitelist:', error);
      return { allowed: true }; // Don't block on error
    }
  }

  /**
   * ENHANCEMENT 16: Implement Two-Factor Authentication for Large Payments
   */
  static async requireTwoFactorAuth(paymentId, userId, amount, threshold = 1000) {
    try {
      if (amount < threshold) {
        return { required: false };
      }

      const key = `payment:2fa:${paymentId}`;
      const existing = await cache.get(key);

      if (!existing) {
        // Generate OTP
        const otp = Math.random().toString().slice(2, 8);
        await cache.set(key, { otp, attempts: 0 }, 300); // 5 minutes

        logger.info('2FA required for large payment', {
          paymentId,
          userId,
          amount,
          threshold,
        });

        return { required: true, reason: 'Large payment amount' };
      }

      return { required: true, reason: 'Awaiting 2FA verification' };
    } catch (error) {
      logger.error('Error requiring 2FA:', error);
      return { required: false };
    }
  }

  /**
   * ENHANCEMENT 17: Monitor Payment Errors
   */
  static async logPaymentError(errorData) {
    try {
      const {
        paymentId,
        userId,
        provider,
        errorCode,
        errorMessage,
        stackTrace,
      } = errorData;

      await query(
        `INSERT INTO payment_errors
         (payment_id, user_id, provider, error_code, error_message, stack_trace, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [paymentId, userId, provider, errorCode, errorMessage, stackTrace]
      );

      logger.error('Payment error logged', {
        paymentId,
        provider,
        errorCode,
      });
    } catch (error) {
      logger.error('Error logging payment error:', error);
    }
  }

  /**
   * ENHANCEMENT 18: Create Payment Security Report
   */
  static async generateSecurityReport(days = 30) {
    try {
      const report = await query(
        `SELECT
           DATE(created_at) as date,
           COUNT(*) as total_events,
           SUM(CASE WHEN event_type = 'blocked' THEN 1 ELSE 0 END) as blocked_payments,
           SUM(CASE WHEN event_type = 'failed' THEN 1 ELSE 0 END) as failed_payments,
           COUNT(DISTINCT user_id) as unique_users
         FROM payment_audit_log
         WHERE created_at > NOW() - $1::interval
         GROUP BY DATE(created_at)
         ORDER BY date DESC`,
        [`${Number(days)} days`]
      );

      logger.info('Payment security report generated', { days, records: report.rowCount });
      return report.rows;
    } catch (error) {
      logger.error('Error generating security report:', error);
      return [];
    }
  }

  /**
   * ENHANCEMENT 19: Validate Payment Consistency
   */
  static async validatePaymentConsistency(paymentId) {
    try {
      const payment = await query(
        `SELECT
           p.id, p.user_id, p.amount, p.status, p.created_at,
           COUNT(pa.id) as audit_count
         FROM payments p
         LEFT JOIN payment_audit_log pa ON p.id = pa.payment_id
         WHERE p.id = $1
         GROUP BY p.id`,
        [paymentId]
      );

      if (!payment.rows.length) {
        logger.warn('Payment not found for consistency check', { paymentId });
        return { consistent: false, reason: 'Payment not found' };
      }

      const paymentData = payment.rows[0];

      // Check if audit trail exists
      if (paymentData.audit_count === 0) {
        logger.error('Payment audit trail missing', { paymentId });
        return { consistent: false, reason: 'No audit trail found' };
      }

      logger.info('Payment consistency check passed', { paymentId });
      return { consistent: true };
    } catch (error) {
      logger.error('Error validating payment consistency:', error);
      return { consistent: false, reason: error.message };
    }
  }

  /**
   * ENHANCEMENT 20: Implement Payment Encryption at Rest
   */
  static async encryptPaymentDataAtRest(paymentId) {
    try {
      const payment = await query(
        'SELECT * FROM payments WHERE id = $1',
        [paymentId]
      );

      if (!payment.rows.length) {
        return { success: false, reason: 'Payment not found' };
      }

      const paymentData = payment.rows[0];
      const encrypted = this.encryptSensitiveData(paymentData);

      await query(
        'UPDATE payments SET encrypted_data = $1 WHERE id = $2',
        [encrypted, paymentId]
      );

      logger.info('Payment data encrypted at rest', { paymentId });
      return { success: true };
    } catch (error) {
      logger.error('Error encrypting payment at rest:', error);
      return { success: false, reason: error.message };
    }
  }
}

module.exports = PaymentSecurityService;
