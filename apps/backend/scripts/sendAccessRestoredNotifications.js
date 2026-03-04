#!/usr/bin/env node
'use strict';

/**
 * sendAccessRestoredNotifications.js
 *
 * Notifies ALL active subscribers that their access has been restored:
 *
 * Group A (62 paying users):
 *   "Your plan has been restored from today — enjoy your full <plan> access until <expiry>"
 *
 * Group B (291 non-paying users):
 *   "You've been given a 3-day complimentary PRIME trial — explore the app until <expiry>"
 *
 * Sends via:
 *   - Email (for users with email on file) — via pnptv transporter
 *   - Telegram message (for ALL users, including those without email)
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/sendAccessRestoredNotifications.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/sendAccessRestoredNotifications.js
 */

const path = require('path');
const BACKEND_ROOT = path.resolve(__dirname, '..');

try {
  require('dotenv').config({ path: path.join(BACKEND_ROOT, '../../.env') });
} catch (_) {}

const { getPool, query } = require(path.join(BACKEND_ROOT, 'config/postgres'));
const emailService = require(path.join(BACKEND_ROOT, 'bot/services/emailservice'));
const logger = require(path.join(BACKEND_ROOT, 'utils/logger'));

const DRY_RUN = process.argv.includes('--dry-run');
const DELAY_MS = 2000; // 2s between sends to avoid rate limits

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Telegram Bot API direct (we can't use Telegraf instance from a standalone script)
const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

async function sendTelegramMessage(chatId, text) {
  if (!BOT_TOKEN) {
    console.log(`  [TG SKIP] No BOT_TOKEN configured`);
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
        disable_web_page_preview: false,
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

function formatDate(d) {
  if (!d) return 'N/A';
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function generateEmailHtml({ customerName, planName, expiryDate, isPaid, language }) {
  const isSpanish = language === 'es';
  const formattedExpiry = formatDate(expiryDate);

  if (isPaid) {
    // Group A — paid users
    return `
<!DOCTYPE html>
<html lang="${isSpanish ? 'es' : 'en'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 20px auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { text-align: center; padding-bottom: 20px; border-bottom: 3px solid #D4007A; }
    .header h1 { color: #D4007A; margin: 0; font-size: 28px; }
    .badge { background: linear-gradient(135deg, #D4007A 0%, #E69138 100%); color: white; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0; }
    .badge h2 { margin: 0; font-size: 22px; }
    .content { padding: 20px 0; }
    .details { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #D4007A; }
    .details p { margin: 10px 0; }
    .button { display: inline-block; padding: 14px 35px; background: linear-gradient(135deg, #D4007A 0%, #E69138 100%); color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; font-size: 16px; }
    .footer { text-align: center; padding-top: 20px; border-top: 1px solid #ddd; color: #888; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>PNPtv!</h1>
    </div>

    <div class="badge">
      <h2>${isSpanish ? 'Tu Acceso Ha Sido Restaurado' : 'Your Access Has Been Restored'}</h2>
    </div>

    <div class="content">
      <p>${isSpanish ? 'Hola' : 'Hey'} ${customerName},</p>

      <p>${isSpanish
        ? 'Buenas noticias — la app PNPtv! ya esta disponible y tu suscripcion ha sido restaurada a partir de hoy.'
        : 'Great news — the PNPtv! app is now live and your subscription has been restored starting today.'}</p>

      <p>${isSpanish
        ? 'Sabemos que compraste tu plan y no pudiste disfrutarlo mientras completabamos la app. Ahora queremos que lo disfrutes al maximo con el tiempo completo de tu plan contando desde hoy.'
        : 'We know you purchased your plan and couldn\'t enjoy it while we were completing the app. Now we want you to enjoy it fully with the complete duration of your plan counting from today.'}</p>

      <div class="details">
        <p><strong>${isSpanish ? 'Plan' : 'Plan'}:</strong> ${planName}</p>
        <p><strong>${isSpanish ? 'Acceso hasta' : 'Access until'}:</strong> ${formattedExpiry}</p>
        <p><strong>${isSpanish ? 'Estado' : 'Status'}:</strong> PRIME Active</p>
      </div>

      <p style="text-align: center;">
        <a href="https://app.pnptv.app" class="button">${isSpanish ? 'Abrir PNPtv!' : 'Open PNPtv!'}</a>
      </p>

      <p>${isSpanish
        ? 'Gracias por tu paciencia y por ser parte de la comunidad.'
        : 'Thank you for your patience and for being part of the community.'}</p>

      <p>${isSpanish ? 'Con amor' : 'With love'},<br><strong>PNPtv Team</strong></p>
    </div>

    <div class="footer">
      <p>PNPtv! | support@pnptv.app</p>
    </div>
  </div>
</body>
</html>`.trim();
  } else {
    // Group B — trial users
    return `
<!DOCTYPE html>
<html lang="${isSpanish ? 'es' : 'en'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 20px auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { text-align: center; padding-bottom: 20px; border-bottom: 3px solid #D4007A; }
    .header h1 { color: #D4007A; margin: 0; font-size: 28px; }
    .badge { background: linear-gradient(135deg, #D4007A 0%, #E69138 100%); color: white; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0; }
    .badge h2 { margin: 0; font-size: 22px; }
    .content { padding: 20px 0; }
    .details { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #D4007A; }
    .details p { margin: 10px 0; }
    .button { display: inline-block; padding: 14px 35px; background: linear-gradient(135deg, #D4007A 0%, #E69138 100%); color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; font-size: 16px; }
    .footer { text-align: center; padding-top: 20px; border-top: 1px solid #ddd; color: #888; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>PNPtv!</h1>
    </div>

    <div class="badge">
      <h2>${isSpanish ? '3 Dias Gratis de PRIME' : '3-Day Free PRIME Trial'}</h2>
    </div>

    <div class="content">
      <p>${isSpanish ? 'Hola' : 'Hey'} ${customerName},</p>

      <p>${isSpanish
        ? 'La app PNPtv! ya esta disponible! Te hemos dado 3 dias de acceso PRIME gratis para que explores todo lo que tenemos para ti.'
        : 'The PNPtv! app is now live! We\'ve given you 3 free days of PRIME access so you can explore everything we have for you.'}</p>

      <div class="details">
        <p><strong>${isSpanish ? 'Plan' : 'Plan'}:</strong> 3-Day PRIME Trial</p>
        <p><strong>${isSpanish ? 'Acceso hasta' : 'Access until'}:</strong> ${formattedExpiry}</p>
      </div>

      <p>${isSpanish
        ? 'Disfruta de Videorama, Hangouts, Nearby y todo el contenido PRIME. Si te gusta, suscribete para seguir disfrutando!'
        : 'Enjoy Videorama, Hangouts, Nearby and all PRIME content. If you like it, subscribe to keep enjoying!'}</p>

      <p style="text-align: center;">
        <a href="https://app.pnptv.app" class="button">${isSpanish ? 'Explorar PNPtv!' : 'Explore PNPtv!'}</a>
      </p>

      <p>${isSpanish ? 'Con amor' : 'With love'},<br><strong>PNPtv Team</strong></p>
    </div>

    <div class="footer">
      <p>PNPtv! | support@pnptv.app</p>
    </div>
  </div>
</body>
</html>`.trim();
  }
}

function generateTelegramMessage({ customerName, planName, expiryDate, isPaid, language }) {
  const isSpanish = language === 'es';
  const formattedExpiry = formatDate(expiryDate);

  if (isPaid) {
    return isSpanish
      ? `🎬 <b>PNPtv! - Tu Acceso Ha Sido Restaurado</b>\n\nHola ${customerName}!\n\nLa app PNPtv! ya esta disponible y tu suscripcion <b>${planName}</b> ha sido restaurada desde hoy.\n\nSabemos que compraste tu plan y no pudiste disfrutarlo. Ahora tu tiempo corre completo desde hoy.\n\n📋 <b>Plan:</b> ${planName}\n📅 <b>Acceso hasta:</b> ${formattedExpiry}\n✅ <b>Estado:</b> PRIME Activo\n\n👉 <a href="https://app.pnptv.app">Abrir PNPtv!</a>\n\nGracias por tu paciencia, papi! 💜`
      : `🎬 <b>PNPtv! - Your Access Has Been Restored</b>\n\nHey ${customerName}!\n\nThe PNPtv! app is now live and your <b>${planName}</b> subscription has been restored starting today.\n\nWe know you purchased your plan and couldn't enjoy it. Now your full plan duration counts from today.\n\n📋 <b>Plan:</b> ${planName}\n📅 <b>Access until:</b> ${formattedExpiry}\n✅ <b>Status:</b> PRIME Active\n\n👉 <a href="https://app.pnptv.app">Open PNPtv!</a>\n\nThank you for your patience! 💜`;
  } else {
    return isSpanish
      ? `🎬 <b>PNPtv! - 3 Dias Gratis de PRIME</b>\n\nHola ${customerName}!\n\nLa app PNPtv! ya esta disponible! Te hemos dado <b>3 dias de acceso PRIME gratis</b> para que explores todo.\n\n📋 <b>Plan:</b> 3-Day PRIME Trial\n📅 <b>Acceso hasta:</b> ${formattedExpiry}\n\nDisfruta Videorama, Hangouts, Nearby y todo el contenido PRIME!\n\n👉 <a href="https://app.pnptv.app">Explorar PNPtv!</a>\n\n💜 Si te gusta, suscribete en <a href="https://app.pnptv.app/subscribe">app.pnptv.app/subscribe</a>`
      : `🎬 <b>PNPtv! - 3-Day Free PRIME Trial</b>\n\nHey ${customerName}!\n\nThe PNPtv! app is now live! We've given you <b>3 free days of PRIME access</b> to explore everything.\n\n📋 <b>Plan:</b> 3-Day PRIME Trial\n📅 <b>Access until:</b> ${formattedExpiry}\n\nEnjoy Videorama, Hangouts, Nearby and all PRIME content!\n\n👉 <a href="https://app.pnptv.app">Explore PNPtv!</a>\n\n💜 If you like it, subscribe at <a href="https://app.pnptv.app/subscribe">app.pnptv.app/subscribe</a>`;
  }
}

async function main() {
  console.log('=== PNPtv! Access Restored Notification Script ===');
  console.log(`Date: ${new Date().toISOString()}`);
  if (DRY_RUN) console.log('>>> DRY RUN — no messages will be sent <<<\n');

  // Get all active subscribers with their payment status
  const { rows: users } = await query(`
    SELECT
      u.id, u.username, u.first_name, u.email, u.language,
      u.plan_id, u.plan_expiry, u.tier,
      CASE WHEN p.user_id IS NOT NULL THEN true ELSE false END as is_paid,
      pl.display_name as plan_display_name,
      pl.name as plan_db_name
    FROM users u
    LEFT JOIN (
      SELECT DISTINCT user_id FROM payments WHERE status = 'completed'
    ) p ON u.id = p.user_id
    LEFT JOIN plans pl ON u.plan_id = pl.id
    WHERE u.subscription_status = 'active'
    ORDER BY
      CASE WHEN p.user_id IS NOT NULL THEN 0 ELSE 1 END,
      u.plan_expiry DESC
  `);

  const paidUsers = users.filter(u => u.is_paid);
  const trialUsers = users.filter(u => !u.is_paid);

  console.log(`Total active subscribers: ${users.length}`);
  console.log(`  Paid users (Group A): ${paidUsers.length}`);
  console.log(`  Trial users (Group B): ${trialUsers.length}`);
  console.log(`  Users with email: ${users.filter(u => u.email).length}`);
  console.log(`  Users without email: ${users.filter(u => !u.email).length}`);
  console.log('');

  let emailsSent = 0;
  let emailsFailed = 0;
  let telegramSent = 0;
  let telegramFailed = 0;
  let telegramBlocked = 0;

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const customerName = u.first_name || u.username || 'Papi';
    const planName = u.plan_display_name || u.plan_db_name || u.plan_id || 'PRIME';
    const isPaid = u.is_paid;
    const language = u.language || 'es';
    const label = `[${i + 1}/${users.length}]`;
    const group = isPaid ? 'PAID' : 'TRIAL';

    if (DRY_RUN) {
      console.log(`${label} [${group}] ${u.id} @${u.username || '(no username)'} | email: ${u.email || 'NONE'} | plan: ${u.plan_id} | expiry: ${u.plan_expiry}`);
      if (u.email) emailsSent++;
      telegramSent++;
      continue;
    }

    // 1. Send email (if they have one)
    if (u.email && u.email.trim()) {
      try {
        const subject = isPaid
          ? (language === 'es' ? 'Tu acceso PNPtv! ha sido restaurado' : 'Your PNPtv! access has been restored')
          : (language === 'es' ? '3 dias gratis de PRIME en PNPtv!' : '3 free days of PRIME on PNPtv!');

        const html = generateEmailHtml({
          customerName,
          planName,
          expiryDate: u.plan_expiry,
          isPaid,
          language,
        });

        if (emailService.transporters && emailService.transporters.pnptv) {
          const result = await emailService.transporters.pnptv.sendMail({
            from: '"PNPtv!" <noreply@pnptv.app>',
            to: u.email.trim(),
            subject,
            html,
          });
          emailsSent++;
          console.log(`${label} [${group}] EMAIL OK: ${u.email}`);
        } else {
          console.log(`${label} [${group}] EMAIL SKIP: No transporter configured`);
          emailsFailed++;
        }
      } catch (err) {
        emailsFailed++;
        console.error(`${label} [${group}] EMAIL FAIL: ${u.email} — ${err.message}`);
      }
    }

    // 2. Send Telegram message (to all users — their user ID is the Telegram chat ID)
    const telegramChatId = u.id;
    // Only send to numeric IDs (Telegram chat IDs), skip UUID-style IDs
    if (/^\d+$/.test(String(telegramChatId))) {
      try {
        const tgMsg = generateTelegramMessage({
          customerName,
          planName,
          expiryDate: u.plan_expiry,
          isPaid,
          language,
        });
        const tgResult = await sendTelegramMessage(telegramChatId, tgMsg);
        if (tgResult.success) {
          telegramSent++;
          console.log(`${label} [${group}] TG OK: ${telegramChatId} @${u.username || ''}`);
        } else {
          if (tgResult.error && tgResult.error.includes('bot was blocked')) {
            telegramBlocked++;
            console.log(`${label} [${group}] TG BLOCKED: ${telegramChatId} @${u.username || ''}`);
          } else {
            telegramFailed++;
            console.error(`${label} [${group}] TG FAIL: ${telegramChatId} — ${tgResult.error}`);
          }
        }
      } catch (err) {
        telegramFailed++;
        console.error(`${label} [${group}] TG ERROR: ${telegramChatId} — ${err.message}`);
      }
    } else {
      console.log(`${label} [${group}] TG SKIP: Non-numeric ID ${telegramChatId}`);
    }

    // Rate limit pause
    await sleep(DELAY_MS);
  }

  console.log('\n=== Summary ===');
  console.log(`Total processed:    ${users.length}`);
  console.log(`  Paid (Group A):   ${paidUsers.length}`);
  console.log(`  Trial (Group B):  ${trialUsers.length}`);
  console.log(`Emails sent:        ${emailsSent}`);
  console.log(`Emails failed:      ${emailsFailed}`);
  console.log(`Telegram sent:      ${telegramSent}`);
  console.log(`Telegram blocked:   ${telegramBlocked}`);
  console.log(`Telegram failed:    ${telegramFailed}`);

  const pool = getPool();
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
