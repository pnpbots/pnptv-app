#!/usr/bin/env node
'use strict';

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query } = require(path.join(BACKEND, 'config/postgres'));
const sendSystemDM = require(path.join(BACKEND, 'services/sendSystemDM'));
const nodemailer = require('nodemailer');

const SANTINO_ID   = '8599671840';
const DREW_ID      = '10edc448-4809-45f7-a721-82956504f049';
const DREW_EMAIL   = 'tbarrett187@gmail.com';
const BOOKING_URL  = 'https://pnptv.app/profile/SANTINOFU​RIOSO';

const DM_TEXT = `Hey! 👋 It's Santino — your private call is ready to schedule!

🗓️ I'm available TODAY between 1:15 PM and 4:00 PM (Colombia time). Choose any 60-minute slot that works for you.

👉 Book here: https://pnptv.app/profile/SantinoFurioso
(tap "Book a Call" — your payment credit is already applied ✅)

Before we get started, I'd love to know:
• What would you like to focus on during our session?
• Any specific topics, questions, or fantasies you'd like to explore?
• Anything I should know to make this special for you?

Can't wait! 🔥`;

const EMAIL_HTML = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f0f0f;color:#fff;border-radius:12px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#7c3aed,#db2777);padding:32px 24px;text-align:center;">
    <h1 style="margin:0;font-size:24px;color:#fff;">Your Private Call is Ready to Book 🔥</h1>
  </div>
  <div style="padding:32px 24px;">
    <p style="font-size:16px;color:#e5e7eb;">Hey! It's Santino — I'm ready for our 60-minute private session today!</p>

    <div style="background:#1f1f2e;border-radius:10px;padding:20px;margin:20px 0;border-left:4px solid #7c3aed;">
      <p style="margin:0 0 8px;color:#a78bfa;font-weight:bold;">⏰ Available Today (Colombia Time)</p>
      <p style="margin:0;color:#e5e7eb;">1:15 PM → 1:30 PM → 2:00 PM → 2:30 PM → 3:00 PM</p>
      <p style="margin:4px 0 0;color:#9ca3af;font-size:14px;">Pick any 60-minute block. Your payment credit is already applied ✅</p>
    </div>

    <div style="text-align:center;margin:28px 0;">
      <a href="https://pnptv.app/profile/SantinoFurioso" style="background:linear-gradient(135deg,#7c3aed,#db2777);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:bold;display:inline-block;">Book My Session Now →</a>
    </div>

    <div style="background:#1f1f2e;border-radius:10px;padding:20px;margin:20px 0;">
      <p style="margin:0 0 12px;color:#a78bfa;font-weight:bold;">📝 Tell Me What You'd Like</p>
      <p style="margin:0;color:#e5e7eb;">Reply to this email or send me a message on PNPtv and let me know:</p>
      <ul style="color:#d1d5db;margin:12px 0;padding-left:20px;">
        <li>What would you like to focus on during our session?</li>
        <li>Any specific topics, questions, or fantasies to explore?</li>
        <li>Anything I should know to make this extra special for you?</li>
      </ul>
    </div>

    <p style="color:#9ca3af;font-size:14px;text-align:center;">Questions? Reply to this email or DM me at <a href="https://pnptv.app/profile/SantinoFurioso" style="color:#a78bfa;">pnptv.app</a></p>
  </div>
  <div style="background:#0a0a0a;padding:16px 24px;text-align:center;">
    <p style="margin:0;color:#6b7280;font-size:12px;">© 2026 PNPtv · <a href="https://pnptv.app" style="color:#6b7280;">pnptv.app</a></p>
  </div>
</div>
`;

async function run() {
  console.log('📨 Sending DM to DREWMEPLEASE...');
  try {
    await sendSystemDM(SANTINO_ID, DREW_ID, DM_TEXT, query);
    console.log('✅ DM sent');
  } catch (err) {
    console.error('❌ DM failed:', err.message);
  }

  console.log('📧 Sending email to', DREW_EMAIL);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.hostinger.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER || 'support@pnptv.app',
      pass: process.env.SMTP_PASSWORD || process.env.PNPTV_SMTP_PASS,
    },
  });

  try {
    await transporter.sendMail({
      from: '"Santino @ PNPtv" <support@pnptv.app>',
      to: DREW_EMAIL,
      subject: '🔥 Your Private Call is Ready — Book Today!',
      html: EMAIL_HTML,
      text: DM_TEXT,
    });
    console.log('✅ Email sent to', DREW_EMAIL);
  } catch (err) {
    console.error('❌ Email failed:', err.message);
  }

  console.log('\nDone. Drew can now book at: https://pnptv.app/profile/SantinoFurioso');
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
