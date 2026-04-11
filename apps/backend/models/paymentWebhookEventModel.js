const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));

// H4: PII fields that must never be persisted to payment_webhook_events.payload.
// The column is intended for forensics and reconciliation, not for retaining
// names, emails, document IDs, or card data. If these are ever needed for a
// specific audit they can be pulled from the payments/users tables via the
// payment_id FK at query time.
const PII_FIELDS = new Set([
  // ePayco
  'x_customer_email',
  'x_customer_name',
  'x_customer_lastname',
  'x_customer_phone',
  'x_customer_country',
  'x_customer_city',
  'x_customer_ind_pais',
  'x_customer_document',
  'x_customer_doctype',
  'x_customer_movil',
  'x_customer_ip',
  'x_customer_ind_tel',
  'x_customer_address',
  'x_customer_lastname_2',
  'x_customer_movil_ind',
  'x_customer_phone2',
  'x_email',
  'x_name',
  'x_last_name',
  'x_card_number',
  'x_cardnumber',
  'x_cvc',
  // Daimo
  'email',
  'customerEmail',
  'customer_email',
  'phone',
  'phoneNumber',
]);

const scrubPii = (payload) => {
  if (!payload || typeof payload !== 'object') return payload || {};
  if (Array.isArray(payload)) return payload.map(scrubPii);
  const clean = {};
  for (const [key, value] of Object.entries(payload)) {
    if (PII_FIELDS.has(key)) {
      clean[key] = '[redacted]';
    } else if (value && typeof value === 'object') {
      clean[key] = scrubPii(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
};

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
      const payloadJson = JSON.stringify(scrubPii(payload));

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
        errorCode: error.code,       // PostgreSQL error code (e.g. 23505, 22001)
        errorDetail: error.detail,   // PostgreSQL constraint/column detail
        errorHint: error.hint,
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
