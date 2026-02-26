const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));

class PaymentWebhookEventModel {
  static async logEvent({
    provider,
    eventId,
    paymentId,
    status,
    stateCode,
    isValidSignature = true,
    payload = {},
  }) {
    try {
      const safePaymentId = isUuid(paymentId) ? paymentId : null;
      const payloadJson = JSON.stringify(payload || {});

      await query(
        `INSERT INTO payment_webhook_events
         (provider, event_id, payment_id, status, state_code, is_valid_signature, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          provider,
          eventId || null,
          safePaymentId,
          status || null,
          stateCode || null,
          isValidSignature,
          payloadJson,
        ]
      );
    } catch (error) {
      logger.error('Error logging payment webhook event', {
        provider,
        eventId,
        error: error.message,
      });
    }
  }

  static async getSummary({ sinceHours = 24 } = {}) {
    try {
      const result = await query(
        `
        SELECT provider, status, is_valid_signature, COUNT(*)::int AS count
        FROM payment_webhook_events
        WHERE created_at >= NOW() - ($1 || ' hours')::interval
        GROUP BY provider, status, is_valid_signature
        ORDER BY provider, status, is_valid_signature
        `,
        [Number(sinceHours) || 24]
      );
      return result.rows;
    } catch (error) {
      logger.error('Error fetching webhook event summary', { error: error.message });
      return [];
    }
  }

  static async getRecent(limit = 10) {
    try {
      const result = await query(
        `
        SELECT provider, event_id, payment_id, status, is_valid_signature, created_at
        FROM payment_webhook_events
        ORDER BY created_at DESC
        LIMIT $1
        `,
        [limit]
      );
      return result.rows;
    } catch (error) {
      logger.error('Error fetching recent webhook events', { error: error.message });
      return [];
    }
  }
}

module.exports = PaymentWebhookEventModel;
