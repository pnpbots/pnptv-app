'use strict';

/**
 * callNotificationService.js
 * Email + Telegram notifications for Book a Call bookings.
 *
 * Depends on:
 *  - emailservice.js  (singleton EmailService with transporters.pnptv / transporters.easybots)
 *  - notificationBotDelivery.js  ({ sendNotificationViaTelegram })
 */

const emailService = require('./emailservice');
const { sendNotificationViaTelegram } = require('./notificationBotDelivery');
const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const APP_URL = process.env.APP_PUBLIC_URL || 'https://pnptv.app';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a UTC ISO timestamp into a human-readable string for emails/Telegram. */
function formatDateTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
}

/**
 * Fetch user email + username for a given internal user id.
 * Returns { email, username, display_name } — email may be null if not stored.
 */
async function fetchUserInfo(userId) {
  try {
    const { rows } = await query(
      `SELECT email, username, display_name FROM users WHERE id = $1`,
      [userId]
    );
    return rows[0] || { email: null, username: userId, display_name: null };
  } catch (err) {
    logger.warn('[callNotificationService] fetchUserInfo error', { userId, error: err.message });
    return { email: null, username: userId, display_name: null };
  }
}

/**
 * Send a booking email via the pnptv transporter (or easybots if pnptv is unavailable).
 * Falls back silently if no transporter is configured.
 */
async function sendBookingEmail({ to, subject, html }) {
  if (!to) return;

  // Prefer the pnptv transporter; fall back to easybots
  const transporter = emailService.transporters.pnptv || emailService.transporters.easybots;
  if (!transporter) {
    logger.warn('[callNotificationService] No email transporter configured — skipping booking email', { to, subject });
    return;
  }

  try {
    const result = await transporter.sendMail({
      from: '"PNPtv" <noreply@pnptv.app>',
      to,
      subject,
      html,
    });
    logger.info('[callNotificationService] booking email sent', { to, subject, messageId: result.messageId });
  } catch (err) {
    logger.warn('[callNotificationService] booking email failed', { to, subject, error: err.message });
  }
}

// ---------------------------------------------------------------------------
// HTML generators
// ---------------------------------------------------------------------------

function buildBaseEmailHtml({ title, headerSubtitle, contentHtml }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 20px auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { text-align: center; padding-bottom: 20px; border-bottom: 3px solid #667eea; }
    .header h1 { color: #667eea; margin: 0; font-size: 28px; }
    .header p { color: #888; margin: 6px 0 0; }
    .badge { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 16px 20px; border-radius: 8px; text-align: center; margin: 20px 0; }
    .badge h2 { margin: 0; font-size: 20px; }
    .details { background: #f8f9fa; padding: 16px 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #667eea; }
    .details p { margin: 8px 0; }
    .info-block { background: #e8f4ff; padding: 16px 20px; border-radius: 6px; margin: 20px 0; }
    .info-block h3 { color: #667eea; margin: 0 0 10px; }
    .info-block ul { margin: 0; padding-left: 20px; }
    .info-block li { margin: 6px 0; }
    .btn { display: inline-block; padding: 12px 28px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0; }
    .footer { text-align: center; padding-top: 20px; border-top: 1px solid #ddd; color: #999; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>PNPtv!</h1>
      <p>${headerSubtitle}</p>
    </div>
    <div class="badge"><h2>${title}</h2></div>
    ${contentHtml}
    <div class="footer">
      <p>PNPtv | noreply@pnptv.app</p>
      <p>This is an automated message. Please do not reply directly to this email.</p>
    </div>
  </div>
</body>
</html>`.trim();
}

function memberConfirmationHtml({ creatorName, startAt, durationMinutes, joinUrl }) {
  const formattedTime = formatDateTime(startAt);
  return buildBaseEmailHtml({
    headerSubtitle: 'Book a Call',
    title: 'Your call is booked!',
    contentHtml: `
    <p>Hi there,</p>
    <p>Great news — your 1-on-1 call with <strong>${creatorName}</strong> has been confirmed!</p>

    <div class="details">
      <p><strong>Creator:</strong> ${creatorName}</p>
      <p><strong>Date &amp; Time:</strong> ${formattedTime}</p>
      <p><strong>Duration:</strong> ${durationMinutes} minutes</p>
      ${joinUrl ? `<p><strong>Join Link:</strong> <a href="${joinUrl}">${joinUrl}</a></p>` : ''}
    </div>

    <div class="info-block">
      <h3>How to join your call</h3>
      <ul>
        <li>Click the join link above (or in your app) at the scheduled time.</li>
        <li>Allow camera and microphone access when prompted.</li>
        <li>Join a minute or two early to test your connection.</li>
      </ul>
    </div>

    <div class="info-block">
      <h3>Call etiquette</h3>
      <ul>
        <li>Be respectful and treat others as you would like to be treated.</li>
        <li>Find a quiet, well-lit space before the call begins.</li>
        <li>Calls are private — recording or sharing is not permitted.</li>
        <li>If you need to cancel, please do so at least 2 hours in advance.</li>
      </ul>
    </div>

    ${joinUrl ? `<div style="text-align:center;"><a href="${joinUrl}" class="btn">Join Your Call</a></div>` : ''}
    <p>See you soon!<br><strong>The PNPtv Team</strong></p>
    `,
  });
}

function creatorConfirmationHtml({ memberUsername, startAt, durationMinutes, joinUrl }) {
  const formattedTime = formatDateTime(startAt);
  return buildBaseEmailHtml({
    headerSubtitle: 'Book a Call',
    title: 'New call booking!',
    contentHtml: `
    <p>Hi there,</p>
    <p>You have a new 1-on-1 call booked with <strong>${memberUsername}</strong>.</p>

    <div class="details">
      <p><strong>Member:</strong> ${memberUsername}</p>
      <p><strong>Date &amp; Time:</strong> ${formattedTime}</p>
      <p><strong>Duration:</strong> ${durationMinutes} minutes</p>
      ${joinUrl ? `<p><strong>Join Link:</strong> <a href="${joinUrl}">${joinUrl}</a></p>` : ''}
    </div>

    <div class="info-block">
      <h3>Creator guidelines</h3>
      <ul>
        <li>Be on time — members appreciate punctuality.</li>
        <li>Ensure your background is appropriate and lighting is good.</li>
        <li>Keep the session focused on the member's questions or goals.</li>
        <li>If you need to reschedule, notify support as soon as possible.</li>
        <li>Calls are private — recording without consent is prohibited.</li>
      </ul>
    </div>

    ${joinUrl ? `<div style="text-align:center;"><a href="${joinUrl}" class="btn">Open Call Room</a></div>` : ''}
    <p>Thank you for being part of PNPtv!<br><strong>The PNPtv Team</strong></p>
    `,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send booking confirmation to the member.
 *
 * @param {string} memberId  - users.id of the member
 * @param {{ creator_name?: string, start_at: string, duration_minutes: number }} booking
 * @param {{ token?: string, roomName?: string, meetingUrl?: string }|null} callInfo
 */
async function sendBookingConfirmationToMember(memberId, booking, callInfo) {
  const memberInfo = await fetchUserInfo(memberId);
  const creatorName = booking.creator_name || 'your creator';
  const joinUrl = callInfo?.meetingUrl || null;

  // Email
  if (memberInfo.email) {
    await sendBookingEmail({
      to: memberInfo.email,
      subject: 'Your call is booked! — PNPtv',
      html: memberConfirmationHtml({
        creatorName,
        startAt: booking.start_at,
        durationMinutes: booking.duration_minutes,
        joinUrl,
      }),
    });
  }

  // Telegram
  const formattedTime = formatDateTime(booking.start_at);
  const tgMsg = `Your 1-on-1 call with <b>${creatorName}</b> is confirmed!\n\n📅 ${formattedTime}\n⏱ ${booking.duration_minutes} min`;
  await sendNotificationViaTelegram(memberId, {
    type: 'hangout_call',
    message: tgMsg,
    entityType: 'call',
    entityId: null,
  }).catch((err) => logger.warn('[callNotificationService] Telegram member confirm failed', { memberId, error: err.message }));
}

/**
 * Send booking confirmation to the creator.
 *
 * @param {string} creatorId  - users.id of the creator
 * @param {{ start_at: string, duration_minutes: number }} booking
 * @param {{ username?: string, display_name?: string }} memberInfo
 * @param {{ token?: string, roomName?: string, meetingUrl?: string }|null} callInfo
 */
async function sendBookingConfirmationToCreator(creatorId, booking, memberInfo, callInfo) {
  const creatorUserInfo = await fetchUserInfo(creatorId);
  const memberUsername = memberInfo?.display_name || memberInfo?.username || 'a member';
  const joinUrl = callInfo?.meetingUrl || null;

  // Email
  if (creatorUserInfo.email) {
    await sendBookingEmail({
      to: creatorUserInfo.email,
      subject: 'New call booking! — PNPtv',
      html: creatorConfirmationHtml({
        memberUsername,
        startAt: booking.start_at,
        durationMinutes: booking.duration_minutes,
        joinUrl,
      }),
    });
  }

  // Telegram
  const formattedTime = formatDateTime(booking.start_at);
  const tgMsg = `New call booking from <b>${memberUsername}</b>!\n\n📅 ${formattedTime}\n⏱ ${booking.duration_minutes} min`;
  await sendNotificationViaTelegram(creatorId, {
    type: 'hangout_call',
    message: tgMsg,
    entityType: 'call',
    entityId: null,
  }).catch((err) => logger.warn('[callNotificationService] Telegram creator confirm failed', { creatorId, error: err.message }));
}

/**
 * Schedule 1h and 15min reminders for both parties.
 * Uses setTimeout for simplicity. In production, replace with a job queue (BullMQ / pg-boss).
 *
 * @param {number}  bookingId   - call_credits.id (used as an identifier in logs)
 * @param {string}  creatorId
 * @param {string}  memberId
 * @param {string}  startAt     - ISO timestamp of call start
 * @param {{ token?: string, roomName?: string, meetingUrl?: string }|null} callInfo
 */
function scheduleCallReminders(bookingId, creatorId, memberId, startAt, callInfo) {
  const startMs = new Date(startAt).getTime();
  const nowMs = Date.now();

  const ONE_HOUR_MS = 60 * 60 * 1000;
  const FIFTEEN_MIN_MS = 15 * 60 * 1000;

  const joinUrl = callInfo?.meetingUrl || APP_URL;

  async function sendReminder(label, includeEmail) {
    const formattedTime = formatDateTime(startAt);
    const tgMsg = `${label} Your call starts at ${formattedTime}. ${callInfo ? `Join: ${joinUrl}` : ''}`;

    await Promise.allSettled([
      sendNotificationViaTelegram(memberId, { type: 'hangout_call', message: tgMsg, entityType: 'call', entityId: null }),
      sendNotificationViaTelegram(creatorId, { type: 'hangout_call', message: tgMsg, entityType: 'call', entityId: null }),
    ]);

    if (includeEmail) {
      const [memberInfo, creatorUserInfo] = await Promise.all([
        fetchUserInfo(memberId),
        fetchUserInfo(creatorId),
      ]);

      const html = buildBaseEmailHtml({
        headerSubtitle: 'Upcoming Call Reminder',
        title: label,
        contentHtml: `
        <div class="details">
          <p><strong>Date &amp; Time:</strong> ${formattedTime}</p>
          ${joinUrl ? `<p><strong>Join Link:</strong> <a href="${joinUrl}">${joinUrl}</a></p>` : ''}
        </div>
        ${joinUrl ? `<div style="text-align:center;"><a href="${joinUrl}" class="btn">Join Now</a></div>` : ''}
        `,
      });

      await Promise.allSettled([
        memberInfo.email
          ? sendBookingEmail({ to: memberInfo.email, subject: `${label} — Your PNPtv call`, html })
          : Promise.resolve(),
        creatorUserInfo.email
          ? sendBookingEmail({ to: creatorUserInfo.email, subject: `${label} — Upcoming call on PNPtv`, html })
          : Promise.resolve(),
      ]);
    }
  }

  // 1h before reminder
  const msUntil1h = startMs - ONE_HOUR_MS - nowMs;
  if (msUntil1h > 0) {
    const t = setTimeout(() => {
      sendReminder('Your call starts in 1 hour!', false)
        .catch((err) => logger.warn('[callNotificationService] 1h reminder failed', { bookingId, error: err.message }));
    }, msUntil1h);
    if (t.unref) t.unref(); // don't hold Node process open
    logger.info('[callNotificationService] 1h reminder scheduled', { bookingId, inMs: msUntil1h });
  } else {
    logger.info('[callNotificationService] 1h reminder skipped — call is less than 1h away', { bookingId });
  }

  // 15min before reminder
  const msUntil15m = startMs - FIFTEEN_MIN_MS - nowMs;
  if (msUntil15m > 0) {
    const t = setTimeout(() => {
      sendReminder('Your call starts in 15 minutes!', true)
        .catch((err) => logger.warn('[callNotificationService] 15min reminder failed', { bookingId, error: err.message }));
    }, msUntil15m);
    if (t.unref) t.unref();
    logger.info('[callNotificationService] 15min reminder scheduled', { bookingId, inMs: msUntil15m });
  } else {
    logger.info('[callNotificationService] 15min reminder skipped — call is less than 15min away', { bookingId });
  }
}

/**
 * Re-schedule in-memory reminders for all confirmed future bookings.
 * Must be called on server startup after the DB is ready so that reminders
 * lost during container restarts (setTimeout is in-process memory) are restored.
 */
async function reconcileReminders() {
  try {
    const { rows } = await query(
      `SELECT b.id AS booking_id,
              b.user_id    AS member_id,
              p.user_id    AS creator_id,
              b.start_time_utc AS start_at
       FROM bookings b
       JOIN performers p ON p.id = b.performer_id
       WHERE b.status IN ('confirmed', 'paid')
         AND b.start_time_utc > NOW()`
    );

    let count = 0;
    for (const row of rows) {
      try {
        scheduleCallReminders(row.booking_id, row.creator_id, row.member_id, row.start_at, null);
        count++;
      } catch (schedErr) {
        logger.warn('[callNotificationService] reconcileReminders: failed to schedule reminder', {
          bookingId: row.booking_id,
          error: schedErr.message,
        });
      }
    }

    logger.info(`[callNotificationService] Reconciled ${count} pending call reminders on startup`);
  } catch (err) {
    logger.error('[callNotificationService] reconcileReminders failed', { error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Post-call survey prompt
// ---------------------------------------------------------------------------

function postCallSurveyHtml({ creatorName, surveyUrl }) {
  return buildBaseEmailHtml({
    headerSubtitle: 'Book a Call',
    title: `How was your call with ${creatorName}?`,
    contentHtml: `
    <p>Hi there,</p>
    <p>Your 1-on-1 call with <strong>${creatorName}</strong> has ended. We hope it was great!</p>
    <p>If you have a minute, leave a quick rating — it helps creators improve and helps other members choose the right person for them.</p>
    <div style="text-align:center;"><a href="${surveyUrl}" class="btn">Rate your call</a></div>
    <p>Takes less than 30 seconds.<br><strong>The PNPtv Team</strong></p>
    `,
  });
}

/**
 * Send a post-call survey prompt to the member after a booking ends.
 * Non-fatal — all errors are swallowed and logged as warnings.
 *
 * @param {string} memberId
 * @param {string} bookingId
 * @param {string} creatorDisplayName
 */
async function sendPostCallSurveyPrompt(memberId, bookingId, creatorDisplayName) {
  try {
    const memberInfo = await fetchUserInfo(memberId);
    const surveyUrl = `${APP_URL}/booking/${encodeURIComponent(bookingId)}/confirm?survey=1`;
    const creatorName = creatorDisplayName || 'the creator';

    const tgMsg =
      `✅ Your call with ${creatorName} has ended!\n\n` +
      `How did it go? Leave a quick rating (takes 30 seconds):\n${surveyUrl}`;

    await sendNotificationViaTelegram(memberId, {
      type: 'hangout_call',
      message: tgMsg,
      entityType: 'call',
      entityId: null,
    });

    if (memberInfo.email) {
      await sendBookingEmail({
        to: memberInfo.email,
        subject: `How was your call with ${creatorName}?`,
        html: postCallSurveyHtml({ creatorName, surveyUrl }),
      });
    }

    logger.info('[callNotificationService] post-call survey prompt sent', { memberId, bookingId });
  } catch (err) {
    logger.warn('[callNotificationService] sendPostCallSurveyPrompt failed', { memberId, bookingId, error: err.message });
  }
}

module.exports = {
  sendBookingConfirmationToMember,
  sendBookingConfirmationToCreator,
  scheduleCallReminders,
  reconcileReminders,
  sendPostCallSurveyPrompt,
};
