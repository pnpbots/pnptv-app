#!/usr/bin/env node
'use strict';

/**
 * sendInstallAppBroadcast.js
 *
 * Sends all users a message encouraging them to install the PNPtv app (PWA).
 *
 * - Telegram DM: sent to every user with a telegram ID
 * - Email: sent to every user with an email address
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/sendInstallAppBroadcast.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/sendInstallAppBroadcast.js
 */

const path = require('path');
const BACKEND_ROOT = path.resolve(__dirname, '..');

try {
  require('dotenv').config({ path: path.join(BACKEND_ROOT, '../../.env') });
} catch (_) {}

const { query } = require(path.join(BACKEND_ROOT, 'config/postgres'));
const emailService = require(path.join(BACKEND_ROOT, 'bot/services/emailservice'));
const logger = require(path.join(BACKEND_ROOT, 'utils/logger'));

const DRY_RUN = process.argv.includes('--dry-run');
const DELAY_MS = 1500; // 1.5s between Telegram sends to stay under rate limits

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

function buildTelegramMessage(firstName, language) {
  const name = firstName || 'friend';
  const isEs = language === 'es';

  if (isEs) {
    return `📱 <b>Hola ${name}!</b>

¡Ya puedes instalar la app de PNPtv! directamente en tu telefono, sin pasar por ninguna tienda de apps.

<b>Como instalarla:</b>
• <b>iPhone / iPad:</b> Abre <a href="https://pnptv.app">pnptv.app</a> en Safari, toca el boton compartir (cuadrado con flecha) y luego <i>"Agregar a pantalla de inicio"</i>.
• <b>Android:</b> Abre <a href="https://pnptv.app">pnptv.app</a> en Chrome, toca el menu (tres puntos) y luego <i>"Agregar a pantalla de inicio"</i>.

Una vez instalada, la app abre instantaneamente como una app nativa, con acceso a todo: feed social, hangouts, live, nearby, contenido PRIME y mas.

👉 <a href="https://pnptv.app">pnptv.app</a>

Con amor,
<b>El equipo de PNPtv!</b>`;
  }

  return `📱 <b>Hey ${name}!</b>

You can now install the PNPtv! app directly on your phone — no app store needed.

<b>How to install:</b>
• <b>iPhone / iPad:</b> Open <a href="https://pnptv.app">pnptv.app</a> in Safari, tap the Share button (box with arrow) and select <i>"Add to Home Screen"</i>.
• <b>Android:</b> Open <a href="https://pnptv.app">pnptv.app</a> in Chrome, tap the menu (three dots) and select <i>"Add to Home Screen"</i>.

Once installed it opens instantly like a native app — social feed, hangouts, live, nearby, PRIME content, and more.

👉 <a href="https://pnptv.app">pnptv.app</a>

With love,
<b>The PNPtv! Team</b>`;
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
    .steps { background: #111; border: 1px solid rgba(212,0,122,0.3); padding: 20px; border-radius: 8px; margin: 20px 0; }
    .steps h3 { color: #E69138; margin-top: 0; }
    .steps ol { padding-left: 20px; color: #ccc; }
    .steps li { margin: 12px 0; }
    .platform { background: rgba(212,0,122,0.08); border-left: 3px solid #D4007A; padding: 10px 14px; border-radius: 4px; margin: 8px 0; }
    .platform strong { color: #E69138; }
    .button { display: inline-block; padding: 14px 40px; background: linear-gradient(135deg, #D4007A 0%, #E69138 100%); color: white !important; text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: bold; font-size: 16px; }
    .features { display: grid; gap: 6px; margin: 16px 0; }
    .feature { color: #aaa; font-size: 14px; }
    .footer { text-align: center; padding-top: 20px; border-top: 1px solid #333; color: #555; font-size: 12px; }
  `;

  if (isEs) {
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Instala PNPtv! en tu telefono</title>
  <style>${styles}</style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>PNPtv!</h1></div>

    <div class="badge">
      <h2>📱 Instala la App en tu Telefono</h2>
      <p style="margin:8px 0 0 0; opacity:0.9;">Sin tienda de apps. Gratis. Para siempre.</p>
    </div>

    <div class="content">
      <p>Hola <strong style="color:#E69138">${name}</strong>,</p>
      <p>La app de PNPtv! ya esta lista para instalar directamente en tu telefono, sin necesidad de pasar por el App Store o Google Play.</p>

      <div class="steps">
        <h3>Como instalarla:</h3>
        <div class="platform">
          <strong>iPhone / iPad (Safari):</strong><br>
          Abre <a href="https://pnptv.app" style="color:#D4007A">pnptv.app</a> en Safari &rarr; toca el boton compartir (cuadrado con flecha arriba) &rarr; <em>"Agregar a pantalla de inicio"</em>
        </div>
        <div class="platform">
          <strong>Android (Chrome):</strong><br>
          Abre <a href="https://pnptv.app" style="color:#D4007A">pnptv.app</a> en Chrome &rarr; toca el menu (tres puntos arriba) &rarr; <em>"Agregar a pantalla de inicio"</em>
        </div>
      </div>

      <p>Una vez instalada, la app abre instantaneamente como una app nativa con acceso completo a:</p>
      <div class="features">
        <div class="feature">📡 Feed social — Publica, comenta y conecta</div>
        <div class="feature">📹 Hangouts — Salas de video comunitarias</div>
        <div class="feature">🔴 PNP Live — Transmisiones en vivo</div>
        <div class="feature">📍 Nearby — Descubre miembros cerca de ti</div>
        <div class="feature">🎬 Contenido PRIME exclusivo</div>
        <div class="feature">💬 Chat y mensajes directos</div>
      </div>

      <div style="text-align:center; margin:30px 0;">
        <a href="https://pnptv.app" class="button">Abrir PNPtv! &rarr;</a>
      </div>

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
  <title>Install PNPtv! on your phone</title>
  <style>${styles}</style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>PNPtv!</h1></div>

    <div class="badge">
      <h2>📱 Install the App on Your Phone</h2>
      <p style="margin:8px 0 0 0; opacity:0.9;">No app store. Free. Forever.</p>
    </div>

    <div class="content">
      <p>Hey <strong style="color:#E69138">${name}</strong>,</p>
      <p>The PNPtv! app is ready to install directly on your phone — no App Store or Google Play needed.</p>

      <div class="steps">
        <h3>How to install:</h3>
        <div class="platform">
          <strong>iPhone / iPad (Safari):</strong><br>
          Open <a href="https://pnptv.app" style="color:#D4007A">pnptv.app</a> in Safari &rarr; tap the Share button (box with arrow) &rarr; <em>"Add to Home Screen"</em>
        </div>
        <div class="platform">
          <strong>Android (Chrome):</strong><br>
          Open <a href="https://pnptv.app" style="color:#D4007A">pnptv.app</a> in Chrome &rarr; tap the menu (three dots) &rarr; <em>"Add to Home Screen"</em>
        </div>
      </div>

      <p>Once installed it opens instantly like a native app with full access to:</p>
      <div class="features">
        <div class="feature">📡 Social Feed — Post, comment and connect</div>
        <div class="feature">📹 Hangouts — Community video rooms</div>
        <div class="feature">🔴 PNP Live — Live streams</div>
        <div class="feature">📍 Nearby — Discover members near you</div>
        <div class="feature">🎬 Exclusive PRIME content</div>
        <div class="feature">💬 Chat and direct messages</div>
      </div>

      <div style="text-align:center; margin:30px 0;">
        <a href="https://pnptv.app" class="button">Open PNPtv! &rarr;</a>
      </div>

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
  console.log(`\n=== PNPtv Install-App Broadcast ${DRY_RUN ? '[DRY RUN]' : '[LIVE]'} ===\n`);

  // Fetch all users
  const { rows: users } = await query(`
    SELECT id, telegram, email, first_name, language
    FROM users
    WHERE terms_accepted = true
    ORDER BY created_at ASC
  `);

  console.log(`Found ${users.length} users total.\n`);

  const tgUsers  = users.filter((u) => u.telegram && String(u.telegram).trim() !== '');
  const emUsers  = users.filter((u) => u.email && u.email.includes('@'));

  console.log(`Telegram targets : ${tgUsers.length}`);
  console.log(`Email targets    : ${emUsers.length}\n`);

  // ── Telegram ──────────────────────────────────────────────────────────────
  let tgOk = 0, tgFail = 0, tgSkip = 0;

  console.log('--- Sending Telegram messages ---');
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
      ? 'Instala PNPtv! en tu telefono 📱'
      : 'Install PNPtv! on your phone 📱';

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
  logger.error('sendInstallAppBroadcast failed:', err);
  console.error(err);
  process.exit(1);
});
