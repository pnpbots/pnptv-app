'use strict';

/**
 * One-shot broadcast: Creator Onboarding on Notion
 * Channels: in-app DMs, Hangout rooms (general + prime), Telegram, email
 * Run: docker exec pnptv-bot node /app/scripts/broadcast-creator-onboarding.js
 */

const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const https = require('https');

const NOTION_URL = 'https://app.notion.com/p/Manual-de-Creadores-Creator-Onboarding-39f64ff88bf18150b518e7f0d1a7f882';
const BOT_TOKEN = process.env.BOT_TOKEN_2;
const SYSTEM_USER_ID = '8552451957';
const SYSTEM_USERNAME = 'pnptv';
const SYSTEM_NAME = 'PNPtv! News';
const SYSTEM_PHOTO = '/uploads/avatars/8552451957-pnptv-logo.png';

const HANGOUT_MSG = `📚 Creator Onboarding — Now on Notion

We've organized everything you need to know as a PNPtv! creator (or future creator) into a step-by-step guide on Notion:

🔗 ${NOTION_URL}

Modules covered:
• Welcome & getting started
• Account & 2257 age verification
• How you earn money
• Getting paid (cashout)
• Content creation best practices
• Going live
• Building your audience
• Community guidelines & safety

📱 Download the Notion app to get notified whenever we publish updates or deploy new features:
iOS: https://apps.apple.com/app/notion/id1232780281
Android: https://play.google.com/store/apps/details?id=notion.id

Platform announcements will be published there going forward.`;

const DM_MSG = HANGOUT_MSG;

const TG_MSG = `📚 *PNPtv\\! Creator Onboarding — Now on Notion*

We've organized everything you need to know as a creator \\(or future creator\\) into a step\\-by\\-step guide:

🔗 [Open Creator Onboarding](${NOTION_URL.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')})

Covers: account setup, 2257 verification, earnings, cashouts, going live, content tips & community guidelines\\.

📱 Download Notion to get notified when we publish updates\\.

Platform announcements will be there going forward\\.`;

const EMAIL_SUBJECT = '📚 Creator Onboarding is now on Notion — PNPtv!';
const EMAIL_HTML = (firstName) => `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:Arial,sans-serif;color:#f0f0f0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#1a1a1a;border-radius:12px;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#e91e8c,#9c27b0);padding:32px;text-align:center;">
          <h1 style="margin:0;color:#fff;font-size:24px;">PNPtv! Creator Onboarding</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:15px;">Everything you need — now on Notion</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;font-size:16px;">Hey ${firstName || 'there'},</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#ccc;">We've put together a complete Creator Onboarding guide covering everything from account setup to going live and building your audience.</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${NOTION_URL}" style="background:linear-gradient(135deg,#e91e8c,#9c27b0);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:bold;display:inline-block;">Open Creator Onboarding →</a>
          </div>
          <p style="margin:24px 0 8px;font-size:14px;color:#aaa;font-weight:bold;">MODULES COVERED</p>
          <ul style="margin:0;padding:0 0 0 20px;color:#ccc;font-size:14px;line-height:2;">
            <li>Welcome & getting started</li>
            <li>Account setup & 2257 age verification</li>
            <li>How you earn money</li>
            <li>Getting paid (cashout)</li>
            <li>Content creation best practices</li>
            <li>Going live</li>
            <li>Building your audience</li>
            <li>Community guidelines & safety</li>
          </ul>
          <div style="margin:32px 0 0;padding:20px;background:#111;border-radius:8px;text-align:center;">
            <p style="margin:0 0 8px;font-size:14px;color:#aaa;">📱 Download Notion to get notified when we publish updates</p>
            <a href="https://apps.apple.com/app/notion/id1232780281" style="color:#e91e8c;font-size:13px;text-decoration:none;margin:0 8px;">iOS</a>
            <span style="color:#555;">|</span>
            <a href="https://play.google.com/store/apps/details?id=notion.id" style="color:#e91e8c;font-size:13px;text-decoration:none;margin:0 8px;">Android</a>
          </div>
        </td></tr>
        <tr><td style="padding:16px 32px 32px;text-align:center;color:#555;font-size:12px;">
          PNPtv! · <a href="https://pnptv.app" style="color:#e91e8c;text-decoration:none;">pnptv.app</a>
          <br><br>You received this because you have an account on PNPtv!
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'pg-pnptv',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DATABASE || 'pnptvbot',
  user: process.env.POSTGRES_USER || 'pnptvbot',
  password: process.env.POSTGRES_PASSWORD,
  max: 5,
});

const mailer = nodemailer.createTransport({
  host: 'smtp.hostinger.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.PNPTV_SMTP_USER || 'hello@pnptv.app',
    pass: process.env.PNPTV_SMTP_PASS,
  },
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function tgRequest(method, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function broadcastHangouts(client) {
  console.log('\n── Hangout rooms (general + prime) ──');
  for (const room of ['general', 'prime']) {
    await client.query(
      `INSERT INTO chat_messages (room, user_id, username, first_name, photo_url, content)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [room, SYSTEM_USER_ID, SYSTEM_USERNAME, SYSTEM_NAME, SYSTEM_PHOTO, HANGOUT_MSG]
    );
    console.log(`  ✓ posted to ${room}`);
  }
}

async function broadcastDMs(client) {
  console.log('\n── In-app DMs (all users) ──');
  const { rows: users } = await client.query(
    `SELECT id FROM users
     WHERE username NOT LIKE 'deleted_%' AND id != $1`,
    [SYSTEM_USER_ID]
  );
  console.log(`  Sending to ${users.length} users...`);
  let sent = 0, failed = 0;
  for (const user of users) {
    try {
      await client.query(
        `INSERT INTO direct_messages (sender_id, recipient_id, content)
         VALUES ($1,$2,$3)`,
        [SYSTEM_USER_ID, user.id, DM_MSG]
      );
      sent++;
    } catch (e) {
      failed++;
    }
    if (sent % 500 === 0) console.log(`  DM progress: ${sent}/${users.length}`);
  }
  console.log(`  ✓ DMs sent: ${sent}, failed: ${failed}`);
}

async function broadcastTelegram(client) {
  if (!BOT_TOKEN) { console.log('\n── Telegram: SKIPPED (no BOT_TOKEN_2) ──'); return; }
  console.log('\n── Telegram (all TG users) ──');
  const { rows: users } = await client.query(
    `SELECT id, first_name FROM users
     WHERE id ~ '^[0-9]+$' AND username NOT LIKE 'deleted_%' AND id != $1`,
    [SYSTEM_USER_ID]
  );
  console.log(`  Sending to ${users.length} Telegram users...`);
  let sent = 0, failed = 0;
  for (const user of users) {
    try {
      const result = await tgRequest('sendMessage', {
        chat_id: parseInt(user.id),
        text: TG_MSG,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: false,
      });
      if (result.ok) sent++; else failed++;
    } catch (e) {
      failed++;
    }
    // Telegram rate limit: ~30 msg/sec to different users
    if ((sent + failed) % 30 === 0) {
      await sleep(1100);
      console.log(`  TG progress: ${sent} sent, ${failed} failed`);
    }
  }
  console.log(`  ✓ Telegram sent: ${sent}, failed: ${failed}`);
}

async function broadcastEmail(client) {
  console.log('\n── Email (users with real emails) ──');
  const { rows: users } = await client.query(
    `SELECT id, email, first_name FROM users
     WHERE email IS NOT NULL
       AND email NOT LIKE '%@telegram.pnptv.app'
       AND email NOT LIKE '%@placeholder%'
       AND username NOT LIKE 'deleted_%'
       AND id != $1`,
    [SYSTEM_USER_ID]
  );
  console.log(`  Sending to ${users.length} email addresses...`);
  let sent = 0, failed = 0;
  for (const user of users) {
    try {
      await mailer.sendMail({
        from: `"PNPtv!" <hello@pnptv.app>`,
        to: user.email,
        subject: EMAIL_SUBJECT,
        html: EMAIL_HTML(user.first_name),
      });
      sent++;
    } catch (e) {
      failed++;
    }
    // Hostinger SMTP: throttle to avoid rate limits
    await sleep(150);
    if (sent % 100 === 0) console.log(`  Email progress: ${sent}/${users.length}`);
  }
  console.log(`  ✓ Emails sent: ${sent}, failed: ${failed}`);
}

async function main() {
  console.log('=== Creator Onboarding Broadcast ===');
  console.log(`Notion URL: ${NOTION_URL}\n`);
  const client = await pool.connect();
  try {
    await broadcastHangouts(client);
    await broadcastDMs(client);
    await broadcastTelegram(client);
    await broadcastEmail(client);
    console.log('\n=== Broadcast complete ===');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
