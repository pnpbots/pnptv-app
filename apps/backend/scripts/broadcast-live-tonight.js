#!/usr/bin/env node
/**
 * One-time broadcast: Live tonight with Santino — raw, no masks
 * Sends Telegram broadcast to all users + email to users with emails
 */

const { query, getPool } = require('../config/postgres');
const logger = require('../utils/logger');
const emailService = require('../services/emailService');
const { Telegraf } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

const BROADCAST_MSG = `🔴 *LIVE TONIGHT on PNPtv!*

🎭 *A Day with Santino — Raw. No Masks.*

Tonight we go unfiltered. No scripts, no filters, no masks. Just Santino, raw and real.

🕐 Don't miss it — tune in live at app.pnptv.app/live

See you there! 🔥`;

const EMAIL_SUBJECT = 'LIVE TONIGHT: A Day with Santino — Raw. No Masks.';

const EMAIL_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#121212;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px;">
    <div style="text-align:center;margin-bottom:24px;">
      <span style="font-size:32px;font-weight:900;background:linear-gradient(135deg,#D4007A,#E69138);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">PNPtv!</span>
    </div>
    <div style="background:#1C1C1E;border-radius:16px;padding:32px 24px;border:1px solid rgba(255,255,255,0.1);">
      <div style="text-align:center;margin-bottom:20px;">
        <span style="display:inline-block;background:#C0392B;color:#fff;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;letter-spacing:1px;">LIVE TONIGHT</span>
      </div>
      <h1 style="color:#FFFFFF;font-size:24px;font-weight:800;text-align:center;margin:0 0 8px 0;line-height:1.3;">
        A Day with Santino
      </h1>
      <p style="color:#E69138;font-size:18px;font-weight:600;text-align:center;margin:0 0 20px 0;">
        Raw. No Masks.
      </p>
      <p style="color:#8E8E93;font-size:15px;line-height:1.6;text-align:center;margin:0 0 28px 0;">
        Tonight we go unfiltered. No scripts, no filters, no masks. Just Santino, raw and real. Don't miss it.
      </p>
      <div style="text-align:center;">
        <a href="https://app.pnptv.app/live" style="display:inline-block;background:linear-gradient(135deg,#D4007A,#E69138);color:#fff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 40px;border-radius:12px;">
          Watch Live
        </a>
      </div>
    </div>
    <p style="color:#555;font-size:12px;text-align:center;margin-top:24px;">
      PNPtv! &mdash; <a href="https://app.pnptv.app" style="color:#D4007A;text-decoration:none;">app.pnptv.app</a>
    </p>
  </div>
</body>
</html>`;

async function sendTelegramBroadcast() {
  console.log('--- TELEGRAM BROADCAST ---');
  const { rows: users } = await query(
    `SELECT id FROM users WHERE is_deleted = false AND id != '1087968824' ORDER BY id`
  );
  console.log(`Sending to ${users.length} users...`);

  let sent = 0, failed = 0;
  for (const user of users) {
    try {
      await bot.telegram.sendMessage(user.id, BROADCAST_MSG, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🔴 Watch Live', url: 'https://app.pnptv.app/live' }
          ]]
        }
      });
      sent++;
      if (sent % 50 === 0) console.log(`  Progress: ${sent}/${users.length} sent`);
      await new Promise(r => setTimeout(r, 50)); // rate limit
    } catch (err) {
      failed++;
      if (err.code === 429) {
        const wait = (err.parameters?.retry_after || 5) * 1000;
        console.log(`  Rate limited, waiting ${wait}ms...`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  console.log(`Telegram broadcast done: ${sent} sent, ${failed} failed`);
  return { sent, failed };
}

async function sendEmailBroadcast() {
  console.log('\n--- EMAIL BROADCAST ---');
  const { rows: users } = await query(
    `SELECT email FROM users WHERE is_deleted = false AND email IS NOT NULL AND email != '' AND email LIKE '%@%'`
  );
  console.log(`Sending email to ${users.length} users...`);

  let sent = 0, failed = 0;
  for (const user of users) {
    try {
      await emailService.send({
        to: user.email,
        subject: EMAIL_SUBJECT,
        html: EMAIL_HTML,
        from: 'PNPtv! <support@pnptv.app>',
      });
      sent++;
      if (sent % 20 === 0) console.log(`  Email progress: ${sent}/${users.length}`);
      await new Promise(r => setTimeout(r, 100)); // SMTP rate limit
    } catch (err) {
      failed++;
    }
  }
  console.log(`Email broadcast done: ${sent} sent, ${failed} failed`);
  return { sent, failed };
}

async function main() {
  console.log('=== LIVE TONIGHT BROADCAST: Santino Raw No Masks ===\n');

  const tgResult = await sendTelegramBroadcast();
  const emailResult = await sendEmailBroadcast();

  console.log('\n=== BROADCAST COMPLETE ===');
  console.log(`Telegram: ${tgResult.sent} sent, ${tgResult.failed} failed`);
  console.log(`Email: ${emailResult.sent} sent, ${emailResult.failed} failed`);

  const pool = getPool();
  if (pool) await pool.end();
  process.exit(0);
}

main().catch(err => {
  console.error('Broadcast failed:', err);
  process.exit(1);
});
