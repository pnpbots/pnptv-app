const logger = require('../../../utils/logger');
// Daimo retired — DaimoConfig require removed. handleDaimoWebhook below is a
// tiny 200-OK stub kept only so the routes.js import resolves. The active
// route registration is inline in routes.js with the same retired no-op.
const PaymentModel = require('../../../models/paymentModel');

const { cache } = require('../../../config/redis');

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));

/**
 * Sanitize bot username for safe HTML insertion
 * @param {string} username - Raw username
 * @returns {string} Sanitized username
 */
const sanitizeBotUsername = (username) => {
  if (!username) return 'pnplatinotv_bot';
  // Remove any HTML/script characters, keep only alphanumeric and underscore
  return username.replace(/[^a-zA-Z0-9_]/g, '') || 'pnplatinotv_bot';
};

// handleDaimoWebhook — RETIRED stub (route in routes.js is also no-op).
// Kept here only because module.exports below still references the symbol.
const handleDaimoWebhook = async (_req, res) => res.status(200).json({ ok: true, retired: true });

const handlePaymentResponse = async (req, res) => {
  try {
    const {
      x_ref_payco, x_transaction_state,
      status, x_extra2, x_extra3,
    } = req.query;

    const legacyRef = x_ref_payco || null;
    const legacyState = x_transaction_state || status || null;

    // C3: Validate x_extra3 is a well-formed UUID before using it as paymentId.
    // Rejecting anything that isn't a UUID prevents XSS via injected JS/HTML in the
    // server-side template literal that embeds this value into a <script> block.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const rawExtra3 = x_extra3 || null;
    const paymentIdFromQuery = rawExtra3 && UUID_RE.test(rawExtra3.trim()) ? rawExtra3.trim() : null;

    // x_extra2 carries the planId — sanitize to alphanumeric/hyphens only (no HTML/JS injection risk)
    const rawExtra2 = x_extra2 || null;
    const planIdFromQuery = rawExtra2 ? rawExtra2.trim().replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 64) : null;

    logger.info('Payment response page hit', {
      legacyRef,
      legacyState,
      paymentIdFromQuery,
      rawExtra3HasValue: !!rawExtra3,
      queryKeys: Object.keys(req.query),
    });

    const botUsername = sanitizeBotUsername(process.env.BOT_USERNAME);
    const botLink = botUsername ? `https://t.me/${botUsername}` : '#';

    // Serve a confirmation page that polls payment status and shows results on-screen
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Cross-Origin-Embedder-Policy');
    res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
    res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    const RESPONSE_CSP = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://code.jquery.com",
      "style-src 'self' 'unsafe-inline' https:",
      "font-src 'self' https: data:",
      "img-src 'self' https: data:",
      "connect-src 'self' https:",
      "frame-src https:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https:",
      "frame-ancestors 'self'",
    ].join('; ');
    res.setHeader('Content-Security-Policy', RESPONSE_CSP);
    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PNPtv! - Payment Confirmation</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0D0D0F; color: #fff; font-family: 'Segoe UI', system-ui, Arial, sans-serif;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #1C1C1E; border: 1px solid rgba(212,0,122,0.3);
            border-radius: 20px; padding: 40px 32px; max-width: 440px; width: 100%; text-align: center;
            box-shadow: 0 8px 32px rgba(212,0,122,0.1); }
    .logo { font-size: 32px; font-weight: 800; margin-bottom: 4px; }
    .logo span { color: #D4007A; }
    .subtitle { color: #888; font-size: 12px; margin-bottom: 24px; text-transform: uppercase; letter-spacing: 1px; }
    .spinner { width: 48px; height: 48px; border: 3px solid rgba(212,0,122,0.15);
               border-top-color: #D4007A; border-radius: 50%; margin: 0 auto 20px;
               animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .check { width: 64px; height: 64px; margin: 0 auto 20px; display: none; }
    .check svg { width: 100%; height: 100%; }
    .error-icon { width: 64px; height: 64px; margin: 0 auto 20px; display: none; }
    h2 { margin-bottom: 8px; font-size: 22px; font-weight: 700; }
    .msg { color: #aaa; margin-bottom: 24px; font-size: 14px; line-height: 1.5; }
    .details { background: rgba(255,255,255,0.04); border-radius: 12px; padding: 20px;
               margin-bottom: 24px; text-align: left; display: none; }
    .detail-row { display: flex; justify-content: space-between; padding: 8px 0;
                  border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 14px; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { color: #888; }
    .detail-value { color: #fff; font-weight: 600; text-align: right; }
    .detail-value.accent { color: #D4007A; }
    .email-note { background: rgba(212,0,122,0.08); border: 1px solid rgba(212,0,122,0.2);
                  border-radius: 10px; padding: 14px 16px; margin-bottom: 20px; display: none;
                  font-size: 13px; color: #ccc; line-height: 1.4; }
    .email-note strong { color: #D4007A; }
    .btn { display: inline-block; padding: 14px 28px; background: #D4007A; color: #fff;
           text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 15px;
           transition: background 0.2s; }
    .btn:hover { background: #B30066; }
    .btn-secondary { background: transparent; border: 1px solid rgba(255,255,255,0.15);
                     color: #aaa; margin-left: 8px; }
    .btn-secondary:hover { background: rgba(255,255,255,0.05); }
    .actions { display: none; margin-top: 8px; }
    .muted { color: #555; font-size: 11px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">PNPtv<span>!</span></div>
    <div class="subtitle" id="subtitle">Processing payment</div>

    <div class="spinner" id="spinner"></div>

    <div class="check" id="checkIcon">
      <svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="30" stroke="#D4007A" stroke-width="3" fill="rgba(212,0,122,0.1)"/>
      <path d="M20 33l8 8 16-16" stroke="#D4007A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>

    <div class="error-icon" id="errorIcon">
      <svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="30" stroke="#FF4444" stroke-width="3" fill="rgba(255,68,68,0.1)"/>
      <path d="M24 24l16 16M40 24l-16 16" stroke="#FF4444" stroke-width="3" stroke-linecap="round"/></svg>
    </div>

    <h2 id="title">Verifying payment...</h2>
    <p class="msg" id="msg">Please wait while we confirm your transaction.</p>

    <div class="details" id="details">
      <div class="detail-row"><span class="detail-label">Plan</span><span class="detail-value" id="dPlan">-</span></div>
      <div class="detail-row"><span class="detail-label">Amount</span><span class="detail-value accent" id="dAmount">-</span></div>
      <div class="detail-row"><span class="detail-label">Transaction</span><span class="detail-value" id="dTxn">-</span></div>
      <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value" id="dStatus">-</span></div>
    </div>

    <div class="email-note" id="emailNote">
      Your subscription is active! If you provided an email, check your inbox for your invoice and onboarding guide.
    </div>

    <div class="actions" id="actions">
      <a class="btn" href="https://pnptv.app/welcome" id="mainBtn">Go to PNPtv</a>
      <a class="btn btn-secondary" href="${botLink}" id="secondaryBtn" style="margin-top:10px;">Open Telegram Bot</a>
    </div>

    <p class="muted" id="footer"></p>
  </div>
  <script>
    (function() {
      var pid = ${paymentIdFromQuery ? `'${paymentIdFromQuery}'` : 'null'};
      try { if (!pid) pid = sessionStorage.getItem('pnptv_3ds_payment_id'); } catch(e) {}

      var attempts = 0;
      var maxAttempts = 40;
      var pollInterval = 3000;

      function showConfirmation(data) {
        document.getElementById('spinner').style.display = 'none';
        document.getElementById('checkIcon').style.display = 'block';
        document.getElementById('subtitle').textContent = 'Payment received';
        document.getElementById('title').textContent = 'We received your payment!';
        document.getElementById('msg').textContent = (data && data.planName)
          ? 'Your ' + data.planName + ' subscription is now active. Check your Telegram for your invite link.'
          : 'Your subscription is now active. Check your Telegram for your invite link.';

        if (data && data.planName) {
          document.getElementById('dPlan').textContent = data.planName;
          document.getElementById('dAmount').textContent = '$' + (parseFloat(data.amount) || 0).toFixed(2) + ' ' + (data.currency || 'USD');
          document.getElementById('dTxn').textContent = (data.transactionId || '-').substring(0, 20);
          document.getElementById('dStatus').innerHTML = '<span style="color:#4CAF50">Completed</span>';
          document.getElementById('details').style.display = 'block';
        }

        document.getElementById('emailNote').style.display = 'block';
        document.getElementById('actions').style.display = 'block';
        document.getElementById('footer').textContent = 'You can close this page safely.';
      }

      function showError(msg) {
        document.getElementById('spinner').style.display = 'none';
        document.getElementById('errorIcon').style.display = 'block';
        document.getElementById('subtitle').textContent = 'Payment issue';
        document.getElementById('title').textContent = 'Payment Not Completed';
        document.getElementById('msg').innerHTML = (msg || 'There was an issue with your payment. Please try again or contact support.').replace(/\n/g, '<br>');
        document.getElementById('actions').style.display = 'block';
        document.getElementById('mainBtn').textContent = 'Try Again';
        var retryPlan = ${planIdFromQuery ? `'${planIdFromQuery}'` : 'null'};
        document.getElementById('mainBtn').href = 'https://pnptv.app/subscribe' + (retryPlan ? '?plan=' + encodeURIComponent(retryPlan) : '');
      }

      function showProcessing() {
        document.getElementById('spinner').style.display = 'none';
        document.getElementById('checkIcon').style.display = 'block';
        document.getElementById('subtitle').textContent = 'Payment received';
        document.getElementById('title').textContent = 'We received your payment!';
        document.getElementById('msg').textContent = 'Your payment was received and is being processed. Your subscription will activate shortly. Check your Telegram for updates.';
        document.getElementById('emailNote').style.display = 'block';
        document.getElementById('actions').style.display = 'block';
        document.getElementById('footer').textContent = 'You can close this page. Check your email for the invoice and guide.';
      }

      function poll() {
        if (!pid) {
          showError('Could not track your payment. If you completed the payment, your subscription will activate automatically. Please check your Telegram for confirmation.');
          return;
        }
        attempts++;
        fetch('/api/payment/' + encodeURIComponent(pid) + '/status')
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.status === 'completed') {
              showConfirmation(data);
            } else if (data.status === 'failed' || data.status === 'refunded') {
              showError(data.message || 'Your payment was not successful. Please try again.');
            } else if (attempts >= maxAttempts) {
              showProcessing();
            } else {
              setTimeout(poll, pollInterval);
            }
          })
          .catch(function() {
            if (attempts >= maxAttempts) {
              showProcessing();
            } else {
              setTimeout(poll, pollInterval);
            }
          });
      }

      poll();
    })();
  </script>
</body>
</html>`);
  } catch (error) {
    logger.error('Error handling payment response:', error);
    res.status(500).send('Error processing payment response');
  }
};

// ── LiveKit Webhook ───────────────────────────────────────────────────────────
// Receives participant_joined, participant_left, room_finished events from LiveKit.
// Keeps hangout_video_calls.participant_count in sync without relying on manual
// increment/decrement from REST calls (which drift when clients disconnect abruptly).
// LiveKit signs the payload with LIVEKIT_API_SECRET; we verify before acting.

const { WebhookReceiver } = require('livekit-server-sdk');
const { query } = require('../../../config/postgres');

const HANGOUT_ROOM_PREFIX = 'hangout-';

const handleLiveKitWebhook = async (req, res) => {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    logger.error('LiveKit webhook: LIVEKIT_API_KEY or LIVEKIT_API_SECRET not set');
    return res.status(500).end();
  }

  try {
    const receiver = new WebhookReceiver(apiKey, apiSecret);
    // livekit-server-sdk needs the raw body as a string and the Authorization header
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);
    const authHeader = req.headers['authorization'] || '';
    const event = await receiver.receive(rawBody, authHeader);

    const roomName = event.room?.name || '';
    const eventType = event.event;

    logger.info('LiveKit webhook received', { event: eventType, room: roomName });

    // Only act on hangout rooms (named "hangout-{groupId}")
    if (roomName.startsWith(HANGOUT_ROOM_PREFIX)) {
      const groupId = roomName.slice(HANGOUT_ROOM_PREFIX.length);

      if (eventType === 'participant_left') {
        // LiveKit identities now carry a per-mint suffix (e.g. "12345-a1b2c3d4") to support
        // multi-tab usage (B1 fix). Strip the suffix to recover the stable user_id for the
        // DB lookup. Idempotent: left_at IS NULL guard prevents double-stamping.
        const rawIdentity = String(event.participant?.identity || '');
        const userIdRaw = rawIdentity.split('-')[0];
        if (userIdRaw) {
          await query(
            `UPDATE hangout_call_participants
             SET left_at = NOW()
             FROM hangout_video_calls
             WHERE hangout_video_calls.id = hangout_call_participants.call_id
               AND hangout_video_calls.room_name = $1
               AND hangout_call_participants.user_id = $2
               AND hangout_call_participants.left_at IS NULL`,
            [roomName, userIdRaw]
          );
          logger.info('LiveKit participant_left: stamped left_at', { roomName, userIdRaw });
        }
      } else if (eventType === 'participant_joined') {
        // Participant rows and the DB trigger own participant_count. The webhook
        // only observes transport events, which can arrive after REST writes or
        // disconnect races; mutating the counter here causes drift/double-counts.
      } else if (eventType === 'room_finished') {
        // Mark the call ended first, then bulk-stamp any participants still missing left_at.
        // This covers abrupt disconnects that bypassed the /call/leave REST endpoint.
        const { rows: callRows } = await query(
          `UPDATE hangout_video_calls
           SET status = 'ended', ended_at = NOW(), participant_count = 0
           WHERE group_id = $1 AND status = 'active'
           RETURNING id`,
          [groupId]
        );
        if (callRows.length > 0) {
          const callId = callRows[0].id;
          await query(
            `UPDATE hangout_call_participants SET left_at = NOW()
             WHERE call_id = $1 AND left_at IS NULL`,
            [callId]
          );
        }
        logger.info('LiveKit room_finished: hangout call marked ended, participants stamped', { groupId, roomName });
      }
    }

    res.status(200).end();
  } catch (err) {
    logger.error('LiveKit webhook error', { message: err.message });
    // Return 200 so LiveKit doesn't keep retrying; signature failures are logged above
    res.status(200).end();
  }
};

module.exports = {
  handleDaimoWebhook,
  handlePaymentResponse,
  handleLiveKitWebhook,
};
