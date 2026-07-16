'use strict';

/**
 * Monetization launch announcement — EN + ES
 * Channels: hangouts (general, prime, creators), DMs, Telegram, email
 * Run: docker exec pnptv-bot node /app/apps/backend/scripts/broadcast-monetization-launch.js
 */

const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const https = require('https');

const SYSTEM_USER_ID = '8552451957';
const SYSTEM_USERNAME = 'pnptv';
const SYSTEM_NAME = 'PNPtv! News';
const SYSTEM_PHOTO = '/uploads/avatars/8552451957-pnptv-logo.png';
const BOT_TOKEN = process.env.BOT_TOKEN;

const MSG_EN = `🚀 Monetization is live — starting today at 6 PM Colombia time

Starting at 6:00 PM Colombia time, Fichas go on sale. Members can now purchase Fichas — our in-app currency — to access live shows, tip creators, and make purchases inside the platform. Creators can start earning today.

📋 Our quality standard
All monetized content must meet a minimum standard:
• Profile and bio are complete and up to date
• Live shows start on time and deliver what was announced
• Content is consistent with what your audience is paying for
• You engage with your room — members came to see you

🔄 Our refund policy
PNPtv! offers no-questions-asked refunds to dissatisfied members. We absorb that cost — it never comes out of creator earnings. We do this to build trust with our community.

Every refund request generates feedback shared privately with the creator. Repeated refund patterns can result in a formal warning, content restrictions, or account suspension. We are a team and our reputation is shared.

We're rooting for every creator here. Learning to monetize live content takes time — we're here to help you improve and grow together.

See you at 6. 🎉

━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 La monetización empieza hoy — a las 6 PM hora Colombia

A partir de las 6:00 PM hora Colombia, las Fichas entran en venta. Los miembros ya podrán comprar Fichas — nuestra moneda interna — para acceder a shows en vivo, dejar propinas y hacer compras dentro de la plataforma. Los creadores pueden empezar a generar ingresos hoy.

📋 Nuestro estándar de calidad
Todo el contenido monetizado debe cumplir un estándar mínimo:
• Perfil y bio completos y actualizados
• Los shows en vivo comienzan a tiempo y entregan lo prometido
• El contenido es consistente con lo que tu audiencia paga
• Interactúas con tu sala — los miembros llegaron a verte a ti

🔄 Nuestra política de reembolsos
PNPtv! ofrece reembolsos sin preguntas a miembros insatisfechos. Ese costo lo asumimos nosotros — nunca sale de las ganancias del creador. Lo hacemos para construir confianza con nuestra comunidad.

Cada solicitud de reembolso genera feedback que compartimos privadamente con el creador. Los patrones repetidos pueden resultar en amonestación formal, restricciones de contenido o suspensión de cuenta. Somos un equipo y nuestra reputación es compartida.

Estamos de tu lado. Aprender a monetizar toma tiempo — estamos aquí para crecer juntos.

Nos vemos a las 6. 🎉`;

const EMAIL_SUBJECT = '🚀 Monetization starts today at 6 PM — PNPtv! / La monetización empieza hoy a las 6 PM';

const EMAIL_HTML = (firstName) => `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:Arial,sans-serif;color:#f0f0f0;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#1a1a1a;border-radius:12px;overflow:hidden;">
      <tr><td style="background:linear-gradient(135deg,#e91e8c,#9c27b0);padding:32px;text-align:center;">
        <div style="font-size:36px;margin-bottom:8px;">🚀</div>
        <h1 style="margin:0;color:#fff;font-size:26px;line-height:1.3;">Monetization is live today<br><span style="font-size:18px;opacity:0.9">La monetización empieza hoy</span></h1>
        <p style="margin:10px 0 0;color:rgba(255,255,255,0.85);font-size:15px;">6:00 PM Colombia · July 16, 2026</p>
      </td></tr>
      <tr><td style="padding:32px;">
        <p style="margin:0 0 24px;font-size:16px;">Hey ${firstName || 'there'},</p>

        <!-- EN -->
        <p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#ccc;">Starting at <strong style="color:#e91e8c;">6:00 PM Colombia time</strong>, Fichas go on sale. Members can purchase Fichas — our in-app currency — to access live shows, tip creators, and make purchases. You can start earning today.</p>

        <div style="margin:20px 0;padding:16px;background:#111;border-left:3px solid #e91e8c;border-radius:0 8px 8px 0;">
          <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#e91e8c;">📋 QUALITY STANDARD</p>
          <ul style="margin:0;padding:0 0 0 16px;color:#ccc;font-size:13px;line-height:2;">
            <li>Complete profile &amp; bio</li>
            <li>Shows start on time, deliver what was announced</li>
            <li>Content matches what your audience is paying for</li>
            <li>Engage with your room — they came to see you</li>
          </ul>
        </div>

        <div style="margin:16px 0;padding:16px;background:#111;border-left:3px solid #9c27b0;border-radius:0 8px 8px 0;">
          <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#9c27b0;">🔄 REFUND POLICY</p>
          <p style="margin:0;font-size:13px;line-height:1.7;color:#ccc;">We offer no-questions-asked refunds. <strong style="color:#fff;">We absorb the cost</strong> — it never comes out of your earnings. Repeated refund patterns lead to warnings and may result in account suspension. We share all feedback privately with you so we can improve together.</p>
        </div>

        <hr style="border:none;border-top:1px solid #333;margin:28px 0;">

        <!-- ES -->
        <p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#ccc;">A partir de las <strong style="color:#e91e8c;">6:00 PM hora Colombia</strong>, las Fichas entran en venta. Los miembros podrán comprar Fichas — nuestra moneda interna — para acceder a shows en vivo, dejar propinas y hacer compras. Puedes empezar a generar ingresos hoy.</p>

        <div style="margin:20px 0;padding:16px;background:#111;border-left:3px solid #e91e8c;border-radius:0 8px 8px 0;">
          <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#e91e8c;">📋 ESTÁNDAR DE CALIDAD</p>
          <ul style="margin:0;padding:0 0 0 16px;color:#ccc;font-size:13px;line-height:2;">
            <li>Perfil y bio completos</li>
            <li>Shows comienzan a tiempo y entregan lo prometido</li>
            <li>El contenido es consistente con lo que tu audiencia paga</li>
            <li>Interactúas con tu sala — llegaron a verte a ti</li>
          </ul>
        </div>

        <div style="margin:16px 0;padding:16px;background:#111;border-left:3px solid #9c27b0;border-radius:0 8px 8px 0;">
          <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#9c27b0;">🔄 POLÍTICA DE REEMBOLSOS</p>
          <p style="margin:0;font-size:13px;line-height:1.7;color:#ccc;">Ofrecemos reembolsos sin preguntas. <strong style="color:#fff;">Ese costo lo asumimos nosotros</strong> — nunca sale de tus ganancias. Patrones repetidos llevan a amonestaciones y pueden resultar en suspensión. Compartimos el feedback contigo de forma privada para crecer juntos.</p>
        </div>

        <div style="text-align:center;margin:28px 0 8px;">
          <p style="margin:0;font-size:16px;color:#fff;font-weight:bold;">Nos vemos a las 6. See you at 6. 🎉</p>
        </div>
      </td></tr>
      <tr><td style="padding:16px 32px 32px;text-align:center;color:#555;font-size:12px;">
        PNPtv! &middot; <a href="https://pnptv.app" style="color:#e91e8c;text-decoration:none;">pnptv.app</a>
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

function tgSend(chatId, text) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 10000,
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ ok: false }); } });
    });
    req.on('error', () => resolve({ ok: false }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
    req.write(payload); req.end();
  });
}

async function broadcastHangouts(client) {
  console.log('\n── Hangout rooms ──');
  for (const room of ['general', 'prime', 'hangout:118']) {
    await client.query(
      `INSERT INTO chat_messages (room, user_id, username, first_name, photo_url, content)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [room, SYSTEM_USER_ID, SYSTEM_USERNAME, SYSTEM_NAME, SYSTEM_PHOTO, MSG_EN]
    );
    console.log(`  ✓ ${room}`);
  }
}

async function broadcastDMs(client) {
  console.log('\n── In-app DMs ──');
  const { rows } = await client.query(
    `SELECT id FROM users WHERE username NOT LIKE 'deleted_%' AND id != $1`,
    [SYSTEM_USER_ID]
  );
  console.log(`  Sending to ${rows.length} users...`);
  let sent = 0, failed = 0;
  for (const user of rows) {
    try {
      await client.query(
        `INSERT INTO direct_messages (sender_id, recipient_id, content) VALUES ($1,$2,$3)`,
        [SYSTEM_USER_ID, user.id, MSG_EN]
      );
      sent++;
    } catch { failed++; }
    if (sent % 500 === 0) console.log(`  DM ${sent}/${rows.length}`);
  }
  console.log(`  ✓ DMs: ${sent} sent, ${failed} failed`);
}

async function broadcastTelegram(client) {
  if (!BOT_TOKEN) { console.log('\n── Telegram: SKIPPED (no BOT_TOKEN) ──'); return; }
  console.log('\n── Telegram ──');
  const { rows } = await client.query(
    `SELECT id FROM users WHERE id ~ '^[0-9]+$' AND username NOT LIKE 'deleted_%' AND id != $1`,
    [SYSTEM_USER_ID]
  );
  console.log(`  Sending to ${rows.length} users...`);
  let sent = 0, failed = 0;
  for (const user of rows) {
    const r = await tgSend(parseInt(user.id), MSG_EN);
    if (r.ok) sent++; else failed++;
    if ((sent + failed) % 25 === 0) {
      await sleep(1000);
      console.log(`  TG ${sent} sent, ${failed} failed / ${rows.length}`);
    }
  }
  console.log(`  ✓ Telegram: ${sent} sent, ${failed} failed`);
}

async function broadcastEmail(client) {
  console.log('\n── Email ──');
  const { rows } = await client.query(
    `SELECT id, email, first_name FROM users
     WHERE email IS NOT NULL
       AND email NOT LIKE '%@telegram.pnptv.app'
       AND email NOT LIKE '%@placeholder%'
       AND username NOT LIKE 'deleted_%'
       AND id != $1`,
    [SYSTEM_USER_ID]
  );
  console.log(`  Sending to ${rows.length} addresses...`);
  let sent = 0, failed = 0;
  for (const user of rows) {
    try {
      await mailer.sendMail({
        from: '"PNPtv!" <hello@pnptv.app>',
        to: user.email,
        subject: EMAIL_SUBJECT,
        html: EMAIL_HTML(user.first_name),
      });
      sent++;
    } catch { failed++; }
    await sleep(200);
    if ((sent + failed) % 50 === 0) console.log(`  Email ${sent} sent, ${failed} failed / ${rows.length}`);
  }
  console.log(`  ✓ Email: ${sent} sent, ${failed} failed`);
}

async function main() {
  console.log('=== Monetization Launch Broadcast ===');
  console.log('6 PM Colombia / July 16 2026\n');
  const client = await pool.connect();
  try {
    await broadcastHangouts(client);
    await broadcastDMs(client);
    await broadcastTelegram(client);
    await broadcastEmail(client);
    console.log('\n=== Done ===');
  } finally {
    client.release();
    await pool.end();
    mailer.close();
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
