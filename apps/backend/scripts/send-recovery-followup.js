#!/usr/bin/env node
'use strict';

/**
 * send-recovery-followup.js — optional follow-up to the 3 customers from
 * the 2026-04-21 ensureEmailCredentials incident.
 *
 * The original apology (apps/backend/scripts/send-recovery-emails.js) pointed
 * to the Telegram bot since the webapp promo-apply flow didn't exist yet.
 * Now that the webapp flow is live, this sends a short "we also added a
 * direct link in the webapp" follow-up so users can redeem without Telegram.
 *
 * Run from inside pnptv-bot container:
 *   node apps/backend/scripts/send-recovery-followup.js
 */

require('dotenv').config();
require('dotenv').config({ path: '.env.production' });

const { query } = require('../config/postgres');
const EmailService = require('../services/emailservice');
const logger = require('../utils/logger');

const WEBAPP_DOMAIN = process.env.WEBAPP_DOMAIN || 'https://app.pnptv.app';
const FROM = process.env.PNPTV_FROM_EMAIL || 'support@pnptv.app';

const RECIPIENTS = [
  { paymentId: '625161a4-a2c9-4ced-a3c9-937bac0a4805', email: 'mechamrichard@gmail.com',  promoCode: 'SORRY-5BBC5AE5' },
  { paymentId: '85c9434b-2841-4269-b14d-69c11636f8ad', email: 'radiopasta21@gmail.com',    promoCode: 'SORRY-E9A25826' },
  { paymentId: 'a9774d11-b460-48fd-9503-0321f1fb7776', email: 'paparazziprince@gmail.com', promoCode: 'SORRY-E7B0C83D' },
];

function buildHtml({ promoCode }) {
  const link = `${WEBAPP_DOMAIN}/subscribe?promo=${promoCode}`;
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#1C1C1E;color:#F5F5F7;border-radius:12px;">
    <h2 style="color:#D4007A;margin-top:0;font-size:18px;">Quick update</h2>
    <p style="font-size:14px;line-height:1.5;">
      Quick follow-up to the email we sent earlier today — you can now redeem your
      <strong>30% off</strong> code <span style="font-family:monospace;background:rgba(212,0,122,0.1);padding:2px 6px;border-radius:4px;">${promoCode}</span>
      directly in the webapp, no Telegram needed.
    </p>
    <p style="margin:20px 0 8px;">Tap to subscribe with the discount already applied:</p>
    <a href="${link}" style="display:inline-block;padding:12px 24px;background:#D4007A;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:14px;">
      Open subscription page
    </a>
    <p style="font-size:12px;color:#A1A1A6;margin-top:20px;">Still valid through May 5, 2026. Either link works — whichever is easier for you.</p>
    <p style="font-size:13px;margin-top:20px;">— The PNPtv team</p>
  </div>`;
}

async function main() {
  await new Promise((r) => setTimeout(r, 1500));
  const transporter = EmailService.transporters?.pnptv;
  if (!transporter) {
    console.error('✖ PNPtv SMTP transporter not available');
    process.exit(1);
  }

  const results = [];
  for (const r of RECIPIENTS) {
    try {
      const info = await transporter.sendMail({
        from: FROM,
        to: r.email,
        subject: 'You can also redeem your 30% off directly in the webapp',
        html: buildHtml(r),
      });
      console.log(`✓ Sent follow-up to ${r.email} — messageId=${info.messageId}`);
      results.push({ ...r, sent: true, messageId: info.messageId });
    } catch (err) {
      console.error(`✖ Failed: ${r.email} — ${err.message}`);
      results.push({ ...r, sent: false, error: err.message });
    }
  }

  for (const r of results.filter((x) => x.sent)) {
    try {
      await query(
        `INSERT INTO payment_recovery_log (payment_id, action, status, result, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          r.paymentId,
          'apology_followup_webapp_link',
          'success',
          JSON.stringify({ email: r.email, promoCode: r.promoCode, messageId: r.messageId }),
          'system-recovery-2026-04-21-followup',
        ]
      );
    } catch (err) {
      logger.warn('Failed to log follow-up (non-critical)', { error: err.message });
    }
  }

  console.log(`\nSummary: ${results.filter((r) => r.sent).length}/${results.length} follow-ups sent.`);
  process.exit(0);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
