'use strict';

const { Pool } = require('pg');
const nodemailer = require('nodemailer');

const NOTION_URL = 'https://app.notion.com/p/Manual-de-Creadores-Creator-Onboarding-39f64ff88bf18150b518e7f0d1a7f882';

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
            <li>Welcome &amp; getting started</li>
            <li>Account setup &amp; 2257 age verification</li>
            <li>How you earn money</li>
            <li>Getting paid (cashout)</li>
            <li>Content creation best practices</li>
            <li>Going live</li>
            <li>Building your audience</li>
            <li>Community guidelines &amp; safety</li>
          </ul>
          <div style="margin:32px 0 0;padding:20px;background:#111;border-radius:8px;text-align:center;">
            <p style="margin:0 0 8px;font-size:14px;color:#aaa;">📱 Download Notion to get notified when we publish updates</p>
            <a href="https://apps.apple.com/app/notion/id1232780281" style="color:#e91e8c;font-size:13px;text-decoration:none;margin:0 8px;">iOS</a>
            <span style="color:#555;">|</span>
            <a href="https://play.google.com/store/apps/details?id=notion.id" style="color:#e91e8c;font-size:13px;text-decoration:none;margin:0 8px;">Android</a>
          </div>
        </td></tr>
        <tr><td style="padding:16px 32px 32px;text-align:center;color:#555;font-size:12px;">
          PNPtv! &middot; <a href="https://pnptv.app" style="color:#e91e8c;text-decoration:none;">pnptv.app</a><br><br>
          You received this because you have an account on PNPtv!
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
  max: 3,
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

async function main() {
  console.log('=== Email Broadcast: Creator Onboarding ===');
  const client = await pool.connect();
  try {
    const { rows: users } = await client.query(
      `SELECT id, email, first_name FROM users
       WHERE email IS NOT NULL
         AND email NOT LIKE '%@telegram.pnptv.app'
         AND email NOT LIKE '%@placeholder%'
         AND username NOT LIKE 'deleted_%'
         AND id != '8552451957'`
    );
    console.log(`Sending to ${users.length} addresses...`);
    let sent = 0, failed = 0;
    for (const user of users) {
      try {
        await mailer.sendMail({
          from: '"PNPtv!" <hello@pnptv.app>',
          to: user.email,
          subject: EMAIL_SUBJECT,
          html: EMAIL_HTML(user.first_name),
        });
        sent++;
      } catch (e) {
        failed++;
        if (failed <= 5) console.log(`  mail fail ${user.email}: ${e.message}`);
      }
      await sleep(200);
      if ((sent + failed) % 50 === 0) console.log(`  ${sent} sent, ${failed} failed / ${users.length}`);
    }
    console.log(`\n✓ Done: ${sent} sent, ${failed} failed`);
  } finally {
    client.release();
    await pool.end();
    mailer.close();
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
