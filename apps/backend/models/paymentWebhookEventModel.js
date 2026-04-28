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
  /**
   * Atomic idempotency claim. Returns true if this is the first time we've
   * seen the (provider, event_id, state_code) tuple, false if it was already
   * claimed (in which case the caller should exit early — DO NOT process
   * the event again).
   *
   * Survives Redis flushes, container restarts, and concurrent recovery
   * replays — backed by the uq_payment_webhook_events_dedup partial index
   * (migration 234). Fall-open behavior on DB error: returns true so a DB
   * outage doesn't block payment processing entirely (Redis lock + atomic
   * UPDATE-WHERE-pending guards remain as backstops).
   */
  static async tryClaimEvent({ provider, eventId, paymentId, status, stateCode, isValidSignature = true, payload = {} }) {
    if (!provider || !eventId) {
      // Without an event_id the unique index doesn't apply — fall back to logEvent and let downstream guards handle dedup.
      await this.logEvent({ provider, eventId, paymentId, status, stateCode, isValidSignature, payload });
      return { claimed: true, reason: 'no_event_id' };
    }
    try {
      const safePaymentId = isUuid(paymentId) ? paymentId : null;
      const payloadJson = JSON.stringify(scrubPii(payload));
      const result = await query(
        `INSERT INTO payment_webhook_events
         (provider, event_id, payment_id, status, state_code, is_valid_signature, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (provider, event_id, state_code) WHERE event_id IS NOT NULL
         DO NOTHING
         RETURNING id`,
        [provider, eventId, safePaymentId, status || null, stateCode || null, isValidSignature, payloadJson]
      );
      if (result.rowCount === 0) {
        return { claimed: false, reason: 'duplicate' };
      }
      return { claimed: true, eventRowId: result.rows[0].id };
    } catch (error) {
      logger.error('tryClaimEvent failed (falling open)', {
        provider, eventId, error: error.message, errorCode: error.code,
      });
      return { claimed: true, reason: 'db_error_fallthrough' };
    }
  }

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
