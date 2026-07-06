'use strict';

/**
 * Cal.com Webhook Handler
 *
 * Handles Cal.com booking lifecycle events.  Signature verification uses
 * HMAC-SHA256 over the raw request body (`X-Cal-Signature-256` header).
 *
 * The full implementation lives in the sibling controller; this module
 * re-exports it so it can be imported from either location.
 *
 * Supported events:
 *   BOOKING_CREATED      → marks call_scheduled = TRUE in model_applications
 *   BOOKING_CANCELLED    → marks call_scheduled = FALSE
 *   BOOKING_RESCHEDULED  → logged only (booking still exists)
 *   MEETING_ENDED        → logged for post-call survey (future implementation)
 */

const crypto = require('crypto');
const { query } = require('../../../utils/db');
const logger = require('../../../utils/logger');

const CALCOM_WEBHOOK_SECRET = process.env.CALCOM_WEBHOOK_SECRET;

/**
 * Verify HMAC-SHA256 signature from Cal.com.
 * Cal.com sends the digest as a plain hex string, optionally prefixed with "sha256=".
 *
 * @param {Buffer} rawBody
 * @param {string} sigHeader - Value of `X-Cal-Signature-256` header
 * @returns {boolean}
 */
function verifySignature(rawBody, sigHeader) {
  if (!CALCOM_WEBHOOK_SECRET) {
    logger.error('[calcomWebhookHandler] CALCOM_WEBHOOK_SECRET not set — rejecting all requests');
    return false;
  }
  if (!sigHeader || typeof sigHeader !== 'string') return false;

  const expected = crypto
    .createHmac('sha256', CALCOM_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const receivedHex = sigHeader.replace(/^sha256=/, '');
  const receivedBuf = Buffer.from(receivedHex, 'hex');

  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

/**
 * Extract non-organiser attendee e-mail from a Cal.com payload.
 *
 * @param {object} payload
 * @returns {string|null}
 */
function extractAttendeeEmail(payload) {
  const attendees = payload?.attendees;
  if (!Array.isArray(attendees) || attendees.length === 0) return null;
  const nonOrganizer = attendees.find(a => !a.organizer);
  return (nonOrganizer || attendees[0])?.email || null;
}

/**
 * POST /api/webhooks/calcom
 *
 * Body must be parsed with `express.raw({ type: 'application/json' })`.
 * No session auth — security is HMAC-SHA256 signature verification only.
 */
async function handleCalcomWebhook(req, res) {
  // 1. Signature check
  const sigHeader = req.headers['x-cal-signature-256'];
  if (!verifySignature(req.body, sigHeader)) {
    logger.warn('[calcomWebhookHandler] Invalid or missing signature', {
      ip: req.ip,
      sigHeader: sigHeader ? sigHeader.slice(0, 16) + '…' : 'absent',
    });
    return res.status(401).json({ success: false, error: 'Invalid signature' });
  }

  // 2. Parse JSON (req.body is a Buffer from express.raw)
  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch (parseErr) {
    logger.warn('[calcomWebhookHandler] Failed to parse JSON body', { error: parseErr.message });
    return res.status(400).json({ success: false, error: 'Malformed JSON body' });
  }

  const triggerEvent = payload?.triggerEvent || payload?.type || '';
  const bookingPayload = payload?.payload || payload;

  logger.info('[calcomWebhookHandler] Received event', {
    triggerEvent,
    bookingUid: bookingPayload?.uid,
  });

  // 3. Dispatch
  try {
    switch (triggerEvent) {
      case 'BOOKING_CREATED': {
        // PNPtv already created the booking after payment — this is confirmatory.
        // Also sync call_scheduled flag in model_applications if an applicant booked.
        const email = extractAttendeeEmail(bookingPayload);
        logger.info('[calcomWebhookHandler] BOOKING_CREATED', {
          bookingUid: bookingPayload?.uid,
          email,
          startTime: bookingPayload?.startTime,
        });

        if (email) {
          await query(
            `UPDATE model_applications
                SET call_scheduled    = TRUE,
                    call_scheduled_at = NOW()
              WHERE status = 'pending'
                AND user_id IN (SELECT id FROM users WHERE LOWER(email) = LOWER($1))
                AND call_scheduled = FALSE`,
            [email]
          ).catch(err =>
            logger.warn('[calcomWebhookHandler] BOOKING_CREATED DB update failed (non-fatal)', { error: err.message })
          );
        }

        return res.json({ success: true, event: 'BOOKING_CREATED' });
      }

      case 'BOOKING_CANCELLED': {
        const email = extractAttendeeEmail(bookingPayload);
        const bookingUid = bookingPayload?.uid;

        logger.info('[calcomWebhookHandler] BOOKING_CANCELLED', { bookingUid, email });

        // Update bookings table if booking_uid matches
        if (bookingUid) {
          await query(
            `UPDATE bookings SET status = 'cancelled', updated_at = NOW() WHERE booking_uid = $1`,
            [bookingUid]
          ).catch(err =>
            logger.warn('[calcomWebhookHandler] BOOKING_CANCELLED bookings update failed (non-fatal)', { error: err.message })
          );
        }

        // Also clear call_scheduled in model_applications
        if (email) {
          await query(
            `UPDATE model_applications
                SET call_scheduled    = FALSE,
                    call_scheduled_at = NULL
              WHERE status = 'pending'
                AND user_id IN (SELECT id FROM users WHERE LOWER(email) = LOWER($1))
                AND call_scheduled = TRUE`,
            [email]
          ).catch(err =>
            logger.warn('[calcomWebhookHandler] BOOKING_CANCELLED model_applications update failed (non-fatal)', { error: err.message })
          );
        }

        return res.json({ success: true, event: 'BOOKING_CANCELLED' });
      }

      case 'MEETING_ENDED': {
        // Trigger post-call survey notification (logged for now; survey DM can be added)
        logger.info('[calcomWebhookHandler] MEETING_ENDED — post-call survey trigger (logged)', {
          bookingUid: bookingPayload?.uid,
          endTime: bookingPayload?.endTime,
        });
        return res.json({ success: true, event: 'MEETING_ENDED', action: 'logged_only' });
      }

      case 'BOOKING_RESCHEDULED': {
        logger.info('[calcomWebhookHandler] BOOKING_RESCHEDULED — no DB update required', {
          bookingUid: bookingPayload?.uid,
        });
        return res.json({ success: true, event: 'BOOKING_RESCHEDULED', action: 'logged_only' });
      }

      default: {
        logger.warn('[calcomWebhookHandler] Unrecognised triggerEvent', { triggerEvent });
        return res.status(400).json({ success: false, error: `Unknown event type: ${triggerEvent}` });
      }
    }
  } catch (err) {
    logger.error('[calcomWebhookHandler] Error processing event', { triggerEvent, error: err.message });
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = { handleCalcomWebhook };
