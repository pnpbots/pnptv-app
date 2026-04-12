#!/usr/bin/env node
'use strict';

/**
 * sendMaintenanceBroadcast.js
 *
 * Notifies active users about scheduled maintenance via:
 *   - Web Push notification
 *   - Telegram DM
 *   - Email
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/sendMaintenanceBroadcast.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/sendMaintenanceBroadcast.js
 */

const path = require('path');
const BACKEND_ROOT = path.resolve(__dirname, '..');

try {
  require('dotenv').config({ path: path.join(BACKEND_ROOT, '../../.env') });
} catch (_) {}

const { query } = require(path.join(BACKEND_ROOT, 'config/postgres'));
const emailService = require(path.join(BACKEND_ROOT, 'services/emailservice'));
const PushNotificationService = require(path.join(BACKEND_ROOT, 'services/pushNotificationService'));
const logger = require(path.join(BACKEND_ROOT, 'utils/logger'));

const DRY_RUN = process.argv.includes('--dry-run');
const DELAY_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Telegram ────────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

async function sendTelegramMessage(chatId, text) {
  if (!BOT_TOKEN) {
    console.log('  [TG SKIP] No BOT_TOKEN configured');
    return { success: false, error: 'No BOT_TOKEN' };
  }
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      return { success: false, error: data.description || 'Telegram API error' };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function buildTelegramMessage(firstName, language) {
  const name = firstName || 'friend';
  const isEs = language === 'es';

  if (isEs) {
    return `🔧 <b>Hola ${name}!</b>

Te escribimos para avisarte que hoy estaremos realizando una <b>actualizacion de seguridad</b> en nuestra plataforma para hacerla mas segura y proteger mejor tu cuenta.

⏰ <b>Tiempo de inactividad:</b>
Hoy de <b>1:15 PM a 1:45 PM</b> (hora Colombia)

Durante este periodo, la app estara temporalmente fuera de servicio. Sera rapido y todo volvera a la normalidad enseguida.

Gracias por tu paciencia y por ser parte de PNPtv! 💜

— <b>El equipo de PNPtv!</b>`;
  }

  return `🔧 <b>Hey ${name}!</b>

We're writing to let you know that today we'll be performing a <b>security upgrade</b> on our platform to make it safer and better protect your account.

⏰ <b>Downtime:</b>
Today from <b>1:15 PM to 1:45 PM</b> (Colombia time / COT)

During this time, the app will be temporarily unavailable. It'll be quick and everything will be back to normal right away.

Thanks for your patience and for being part of PNPtv! 💜

— <b>The PNPtv! Team</b>`;
}

// ── Email ────────────────────────────────────────────────────────────────────

function buildEmailHtml(firstName, language) {
  const name = firstName || 'there';
  const isEs = language === 'es';

  const styles = `
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #0d0d0d; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 20px auto; background: #1a1a1a; padding: 30px; border-radius: 12px; box-shadow: 0 2px 20px rgba(212,0,122,0.15); }
    .header { text-align: center; padding-bottom: 20px; border-bottom: 2px solid #D4007A; }
    .header h1 { background: linear-gradient(135deg, #D4007A, #E69138); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 0; font-size: 32px; }
    .badge { background: linear-gradient(135deg, #D4007A 0%, #E69138 100%); color: white; padding: 20px; border-radius: 10px; text-align: center; margin: 24px 0; }
    .badge h2 { margin: 0; font-size: 22px; }
    .content { padding: 10px 0; color: #ccc; }
    .content p { color: #ccc; }
    .time-box { background: #111; border: 1px solid rgba(212,0,122,0.3); padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
    .time-box h3 { color: #E69138; margin-top: 0; }
    .time-box .time { font-size: 24px; font-weight: bold; color: #fff; margin: 10px 0; }
    .time-box .zone { color: #aaa; font-size: 14px; }
    .footer { text-align: center; padding-top: 20px; border-top: 1px solid #333; color: #555; font-size: 12px; }
  `;

  if (isEs) {
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mantenimiento Programado - PNPtv!</title>
  <style>${styles}</style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>PNPtv!</h1></div>

    <div class="badge">
      <h2>🔧 Actualizacion de Seguridad</h2>
      <p style="margin:8px 0 0 0; opacity:0.9;">Estamos mejorando la plataforma para ti</p>
    </div>

    <div class="content">
      <p>Hola <strong style="color:#E69138">${name}</strong>,</p>
      <p>Te escribimos para avisarte que hoy estaremos realizando una <strong>actualizacion de seguridad</strong> en nuestra plataforma para hacerla mas segura y proteger mejor tu cuenta.</p>

      <div class="time-box">
        <h3>Tiempo de Inactividad Programado</h3>
        <div class="time">1:15 PM — 1:45 PM</div>
        <div class="zone">Hora Colombia (COT) — Hoy</div>
      </div>

      <p>Durante este periodo, la app estara temporalmente fuera de servicio. Sera rapido y todo volvera a la normalidad enseguida.</p>

      <p>Gracias por tu paciencia y por ser parte de PNPtv! 💜</p>

      <p>Con amor,<br><strong style="color:#E69138">El equipo de PNPtv!</strong></p>
    </div>

    <div class="footer">
      <p>PNPtv! &bull; <a href="https://pnptv.app" style="color:#D4007A">pnptv.app</a></p>
      <p>Este es un correo automatico. Para dejar de recibirlos, contacta support@pnptv.app</p>
    </div>
  </div>
</body>
</html>`.trim();
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Scheduled Maintenance - PNPtv!</title>
  <style>${styles}</style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>PNPtv!</h1></div>

    <div class="badge">
      <h2>🔧 Security Upgrade</h2>
      <p style="margin:8px 0 0 0; opacity:0.9;">We're making the platform better for you</p>
    </div>

    <div class="content">
      <p>Hey <strong style="color:#E69138">${name}</strong>,</p>
      <p>We're writing to let you know that today we'll be performing a <strong>security upgrade</strong> on our platform to make it safer and better protect your account.</p>

      <div class="time-box">
        <h3>Scheduled Downtime</h3>
        <div class="time">1:15 PM — 1:45 PM</div>
        <div class="zone">Colombia Time (COT) — Today</div>
      </div>

      <p>During this time, the app will be temporarily unavailable. It'll be quick and everything will be back to normal right away.</p>

      <p>Thanks for your patience and for being part of PNPtv! 💜</p>

      <p>With love,<br><strong style="color:#E69138">The PNPtv! Team</strong></p>
    </div>

    <div class="footer">
      <p>PNPtv! &bull; <a href="https://pnptv.app" style="color:#D4007A">pnptv.app</a></p>
      <p>This is an automated email. To stop receiving these, contact support@pnptv.app</p>
    </div>
  </div>
</body>
</html>`.trim();
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== PNPtv Maintenance Broadcast ${DRY_RUN ? '[DRY RUN]' : '[LIVE]'} ===\n`);

  // Initialize push notifications
  PushNotificationService.initialize();

  // Fetch active users (accepted terms, not banned, not deleted)
  const { rows: users } = await query(`
    SELECT id, telegram, email, first_name, language
    FROM users
    WHERE terms_accepted = true
      AND deleted_at IS NULL
      AND (tier IS NULL OR tier != 'banned')
    ORDER BY created_at ASC
  `);

  console.log(`Found ${users.length} active users.\n`);

  const tgUsers = users.filter((u) => u.telegram && String(u.telegram).trim() !== '');
  const emUsers = users.filter((u) => u.email && u.email.includes('@'));
  const pushUserIds = users.map((u) => u.id);

  console.log(`Push targets     : ${pushUserIds.length} (all active users with subscriptions)`);
  console.log(`Telegram targets : ${tgUsers.length}`);
  console.log(`Email targets    : ${emUsers.length}\n`);

  // ── Push Notifications ────────────────────────────────────────────────────
  console.log('--- Sending Push Notifications ---');
  if (DRY_RUN) {
    console.log(`  [DRY] Would send push to ${pushUserIds.length} users`);
  } else {
    const pushSent = await PushNotificationService.sendToAll({
      title: 'PNPtv! — Scheduled Maintenance',
      body: 'Security upgrade today 1:15-1:45 PM (Colombia). The app will be briefly unavailable.',
      url: '/',
      tag: 'maintenance-2026-03-20',
    });
    console.log(`  [OK] Push notifications sent: ${pushSent}`);
  }

  // ── Telegram ──────────────────────────────────────────────────────────────
  let tgOk = 0, tgFail = 0, tgSkip = 0;

  console.log('\n--- Sending Telegram messages ---');
  for (const user of tgUsers) {
    const lang = user.language || 'es';
    const text = buildTelegramMessage(user.first_name, lang);

    if (DRY_RUN) {
      console.log(`  [DRY] TG -> ${user.telegram} (${lang})`);
      tgOk++;
    } else {
      const result = await sendTelegramMessage(user.telegram, text);
      if (result.success) {
        tgOk++;
        console.log(`  [OK] TG -> ${user.telegram}`);
      } else {
        const err = result.error || '';
        if (err.toLowerCase().includes('blocked') || err.toLowerCase().includes('deactivated') || err.toLowerCase().includes('not found')) {
          tgSkip++;
          console.log(`  [SKIP] TG -> ${user.telegram}: ${err}`);
        } else {
          tgFail++;
          console.log(`  [FAIL] TG -> ${user.telegram}: ${err}`);
        }
      }
      await sleep(DELAY_MS);
    }
  }

  console.log(`\nTelegram: ${tgOk} sent, ${tgFail} failed, ${tgSkip} skipped (blocked/deactivated)\n`);

  // ── Email ─────────────────────────────────────────────────────────────────
  let emOk = 0, emFail = 0;

  console.log('--- Sending emails ---');
  for (const user of emUsers) {
    const lang = user.language || 'es';
    const name = user.first_name || 'there';
    const subject = lang === 'es'
      ? 'Mantenimiento Programado — PNPtv! 🔧'
      : 'Scheduled Maintenance — PNPtv! 🔧';

    if (DRY_RUN) {
      console.log(`  [DRY] Email -> ${user.email} (${lang})`);
      emOk++;
    } else {
      try {
        const transporter = emailService.transporters.pnptv;
        if (!transporter) {
          console.log('  [SKIP] PNPtv email transporter not configured');
          break;
        }
        await transporter.sendMail({
          from: '"PNPtv!" <noreply@pnptv.app>',
          to: user.email,
          subject,
          html: buildEmailHtml(name, lang),
        });
        emOk++;
        console.log(`  [OK] Email -> ${user.email}`);
      } catch (err) {
        emFail++;
        console.log(`  [FAIL] Email -> ${user.email}: ${err.message}`);
      }
      await sleep(500);
    }
  }

  console.log(`\nEmail: ${emOk} sent, ${emFail} failed`);

  console.log('\n=== Done ===\n');
  process.exit(0);
}

main().catch((err) => {
  logger.error('sendMaintenanceBroadcast failed:', err);
  console.error(err);
  process.exit(1);
});
