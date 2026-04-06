const crypto = require('crypto');
const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');

/**
 * Cal.com Webhook Controller
 *
 * Receives booking lifecycle events from Cal.com and keeps the
 * model_applications table in sync.  Signature verification uses
 * HMAC-SHA256 over the raw request body (Cal.com sends the digest
 * as the `x-cal-signature-256` header).
 *
 * Supported events
 *   BOOKING_CREATED      → call_scheduled = TRUE
 *   BOOKING_CANCELLED    → call_scheduled = FALSE
 *   BOOKING_RESCHEDULED  → logged only (booking still exists)
 */

const CALCOM_WEBHOOK_SECRET = process.env.CALCOM_WEBHOOK_SECRET;

/**
 * Verify the HMAC-SHA256 signature supplied by Cal.com.
 * Returns true when the signature is valid, false otherwise.
 *
 * @param {Buffer} rawBody   - The raw request body (Buffer from express.raw())
 * @param {string} sigHeader - Value of the `x-cal-signature-256` header
 */
function verifySignature(rawBody, sigHeader) {
  if (!CALCOM_WEBHOOK_SECRET) {
    logger.error('calcomWebhook: CALCOM_WEBHOOK_SECRET is not set — rejecting all requests');
    return false;
  }

  if (!sigHeader || typeof sigHeader !== 'string') {
    return false;
  }

  // Cal.com sends the digest as a plain hex string (no "sha256=" prefix)
  const expected = crypto
    .createHmac('sha256', CALCOM_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  // Both buffers must be the same length for timingSafeEqual
  const expectedBuf = Buffer.from(expected, 'hex');
  const receivedBuf = Buffer.from(sigHeader.replace(/^sha256=/, ''), 'hex');

  if (expectedBuf.length !== receivedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

/**
 * Extract the attendee e-mail from a Cal.com event payload.
 * Cal.com places attendees in `payload.attendees` (array of objects
 * with an `email` property).  The organiser is also in the list but
 * is identified by `organizer: true`; we want the non-organiser entry.
 *
 * @param {object} payload
 * @returns {string|null}
 */
function extractAttendeeEmail(payload) {
  const attendees = payload?.attendees;
  if (!Array.isArray(attendees) || attendees.length === 0) {
    return null;
  }

  // Prefer attendees who are NOT the organizer
  const nonOrganizer = attendees.find((a) => !a.organizer);
  const chosen = nonOrganizer || attendees[0];

  return chosen?.email || null;
}

/**
 * POST /api/webhooks/calcom
 *
 * No session auth — security is provided by HMAC-SHA256 signature verification.
 * Body must be parsed with express.raw({ type: 'application/json' }).
 */
async function handleCalcomWebhook(req, res) {
  // ── 1. Signature verification ────────────────────────────────────────────
  const sigHeader = req.headers['x-cal-signature-256'];

  if (!verifySignature(req.body, sigHeader)) {
    logger.warn('calcomWebhook: invalid or missing signature', {
      ip: req.ip,
      sigHeader: sigHeader ? sigHeader.slice(0, 16) + '…' : 'absent',
    });
    return res.status(401).json({ success: false, error: 'Invalid signature' });
  }

  // ── 2. Parse the JSON body (req.body is a Buffer at this point) ──────────
  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch (parseErr) {
    logger.warn('calcomWebhook: failed to parse JSON body', { error: parseErr.message });
    return res.status(400).json({ success: false, error: 'Malformed JSON body' });
  }

  const triggerEvent = payload?.triggerEvent || payload?.type || '';

  logger.info('calcomWebhook: received event', {
    triggerEvent,
    bookingId: payload?.payload?.uid || payload?.uid,
  });

  // ── 3. Dispatch by event type ────────────────────────────────────────────
  try {
    switch (triggerEvent) {
      case 'BOOKING_CREATED': {
        const bookingPayload = payload?.payload || payload;
        const email = extractAttendeeEmail(bookingPayload);

        if (!email) {
          logger.warn('calcomWebhook: BOOKING_CREATED — no attendee email found', { payload: JSON.stringify(bookingPayload).slice(0, 300) });
          return res.status(400).json({ success: false, error: 'No attendee email in payload' });
        }

        const result = await query(
          `UPDATE model_applications
              SET call_scheduled    = TRUE,
                  call_scheduled_at = NOW()
            WHERE status = 'pending'
              AND user_id IN (
                SELECT id FROM users WHERE LOWER(email) = LOWER($1)
              )
              AND call_scheduled = FALSE
            RETURNING id`,
          [email]
        );

        logger.info('calcomWebhook: BOOKING_CREATED — marked call_scheduled=true', {
          email,
          updatedCount: result.rowCount,
          applicationIds: result.rows.map((r) => r.id),
        });

        return res.json({ success: true, event: 'BOOKING_CREATED', updatedCount: result.rowCount });
      }

      case 'BOOKING_CANCELLED': {
        const bookingPayload = payload?.payload || payload;
        const email = extractAttendeeEmail(bookingPayload);

        if (!email) {
          logger.warn('calcomWebhook: BOOKING_CANCELLED — no attendee email found');
          return res.status(400).json({ success: false, error: 'No attendee email in payload' });
        }

        const result = await query(
          `UPDATE model_applications
              SET call_scheduled    = FALSE,
                  call_scheduled_at = NULL
            WHERE status = 'pending'
              AND user_id IN (
                SELECT id FROM users WHERE LOWER(email) = LOWER($1)
              )
              AND call_scheduled = TRUE
            RETURNING id`,
          [email]
        );

        logger.info('calcomWebhook: BOOKING_CANCELLED — marked call_scheduled=false', {
          email,
          updatedCount: result.rowCount,
          applicationIds: result.rows.map((r) => r.id),
        });

        return res.json({ success: true, event: 'BOOKING_CANCELLED', updatedCount: result.rowCount });
      }

      case 'BOOKING_RESCHEDULED': {
        // The booking still exists; call_scheduled remains TRUE.
        // Log only so operations can audit the change if needed.
        const bookingPayload = payload?.payload || payload;
        const email = extractAttendeeEmail(bookingPayload);

        logger.info('calcomWebhook: BOOKING_RESCHEDULED — no DB update required', {
          email,
          bookingUid: bookingPayload?.uid,
        });

        return res.json({ success: true, event: 'BOOKING_RESCHEDULED', action: 'logged_only' });
      }

      default: {
        logger.warn('calcomWebhook: unrecognised triggerEvent', { triggerEvent });
        return res.status(400).json({ success: false, error: `Unknown event type: ${triggerEvent}` });
      }
    }
  } catch (dbErr) {
    logger.error('calcomWebhook: database error', { error: dbErr.message, triggerEvent });
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = { handleCalcomWebhook };
