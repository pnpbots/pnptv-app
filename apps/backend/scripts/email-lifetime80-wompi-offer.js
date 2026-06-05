#!/usr/bin/env node
'use strict';

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const nodemailer = require('nodemailer');

const DRY_RUN = process.argv.includes('--dry-run');

const TARGETS = [
  { label: 'hkslutboi',   email: 'hkslutboi@outlook.com' },
  { label: 'scrufflvratx', email: 'scrufflvratx@gmail.com' },
];

const SUBJECT = 'PNPtv! — Exclusive offer: Lifetime membership $80 USD via Wompi';

const TEXT = `Hey! We noticed you tried to complete your Lifetime membership payment on PNPtv.

We have an exclusive one-time opportunity for you to get the PNPtv Lifetime membership at $80 USD — pay directly from your bank account or card via Wompi:

https://checkout.nequi.wompi.co/l/lbNzFX

The amount shown is in Colombian pesos (COP) — that's normal. It equals exactly $80 USD.

This link works with Wompi only (bank transfer or card). This offer won't be available again after today.

Reply to this email if you need any help.

— PNPtv! Team`;

const HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:sans-serif;color:#f0f0f0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="background:#7c3aed;padding:28px 32px;text-align:center;">
            <span style="font-size:22px;font-weight:700;color:#fff;letter-spacing:1px;">PNPtv!</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Hey! We noticed you tried to complete your <strong>Lifetime membership</strong> payment on PNPtv.</p>
            <p style="margin:0 0 24px;font-size:16px;line-height:1.6;">We have an <strong>exclusive one-time opportunity</strong> for you to get the PNPtv Lifetime membership at <strong>$80 USD</strong> — pay directly from your bank account or card via Wompi:</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr><td align="center">
                <a href="https://checkout.nequi.wompi.co/l/lbNzFX"
                   style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 32px;border-radius:8px;">
                  Pay Now via Wompi →
                </a>
              </td></tr>
            </table>
            <p style="margin:0 0 12px;font-size:14px;color:#aaa;line-height:1.6;">⚠️ The amount shown at checkout is in <strong>Colombian pesos (COP)</strong> — that's normal. It equals exactly <strong>$80 USD</strong>.</p>
            <p style="margin:0 0 24px;font-size:14px;color:#aaa;line-height:1.6;">This link works with <strong>Wompi only</strong> (bank transfer or card). This offer won't be available again after today.</p>
            <p style="margin:0;font-size:14px;color:#888;">Reply to this email if you need any help.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #2a2a2a;text-align:center;">
            <span style="font-size:12px;color:#555;">PNPtv! — pnptv.app</span>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

async function main() {
  console.log('\n══════════════════════════════════════════════════');
  console.log(' EMAIL → Lifetime80 Wompi offer (exclusive)');
  console.log('══════════════════════════════════════════════════');
  if (DRY_RUN) {
    console.log(' MODE: DRY RUN\n');
    for (const t of TARGETS) console.log(` → ${t.label} <${t.email}>`);
    console.log('\nSUBJECT:', SUBJECT);
    console.log('\nBODY:\n', TEXT);
    return;
  }

  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD || process.env.SMTP_PASS,
    },
  });

  for (const t of TARGETS) {
    console.log(`\n── ${t.label} <${t.email}>`);
    try {
      const info = await transporter.sendMail({
        from:    process.env.EMAIL_FROM || 'PNPtv! <noreply@pnptv.app>',
        to:      t.email,
        subject: SUBJECT,
        text:    TEXT,
        html:    HTML,
      });
      console.log(` ✓ Email sent — messageId: ${info.messageId}`);
    } catch (err) {
      console.error(` ✗ Failed: ${err.message}`);
    }
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(' Done.');
  console.log('══════════════════════════════════════════════════\n');
}

main().catch((err) => { console.error(err); process.exit(1); });
