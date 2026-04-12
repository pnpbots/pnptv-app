#!/usr/bin/env node
'use strict';

/**
 * sendLiveTokensTutorialBroadcast.js
 *
 * Sends all users a step-by-step tutorial on how to buy PNP Tokens
 * and tip performers on PNPtv! Live, plus announces new creators/performers.
 *
 * - Telegram DM: sent to every user with a telegram ID
 * - Email: sent to every user with an email address
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/sendLiveTokensTutorialBroadcast.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/sendLiveTokensTutorialBroadcast.js
 */

const path = require('path');
const BACKEND_ROOT = path.resolve(__dirname, '..');

try {
  require('dotenv').config({ path: path.join(BACKEND_ROOT, '../../.env') });
} catch (_) {}

const { query } = require(path.join(BACKEND_ROOT, 'config/postgres'));
const emailService = require(path.join(BACKEND_ROOT, 'services/emailservice'));
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
    return `🔴 <b>Hola ${name}!</b>

<b>Nuevos creadores de contenido y performers llegan a PNPtv! Live</b> — y queremos que estes listo para recibirlos.

Aprende como comprar tokens y enviar propinas en vivo:

<b>🪙 Paso 1: Ve a la pagina Live</b>
Abre <a href="https://pnptv.app/live">pnptv.app/live</a> y explora las transmisiones en vivo.

<b>🔐 Paso 2: Inicia sesion</b>
Debes estar logueado para comprar tokens y enviar propinas.

<b>💰 Paso 3: Compra PNP Tokens</b>
• Busca el widget de <b>Saldo de Tokens</b> en la pagina Live
• Toca <b>"Comprar Tokens"</b>
• Elige un paquete:
  5 tokens — $5 USD
  10 tokens — $10 USD
  20 tokens — $20 USD
  50 tokens — $50 USD
  100 tokens — $100 USD
• Se abre el checkout de <b>Dash</b> (via BTCPay Server)
• Completa el pago y tus tokens se acreditan al instante

<b>🎯 Paso 4: Selecciona un performer</b>
Toca la tarjeta de un performer en vivo para seleccionarlo.

<b>🎁 Paso 5: Envia una propina</b>
• Asegurate de estar en el tab <b>"Tokens"</b>
• Elige el monto: <b>5T, 10T, 20T, 50T o 100T</b>
• Opcional: agrega un mensaje personal
• Toca para enviar — <b>instantaneo, sin ventanas emergentes!</b>

<b>1 token = $1 USD</b> — simple y directo.

🌟 <b>Proximamente nuevos creadores y performers en PNPtv! Live</b> — ten tus tokens listos para ser el primero en apoyarlos!

👉 <a href="https://pnptv.app/live">Ir a PNPtv! Live</a>

Con amor,
<b>El equipo de PNPtv!</b>`;
  }

  return `🔴 <b>Hey ${name}!</b>

<b>New content creators and performers are coming to PNPtv! Live</b> — and we want you to be ready to welcome them.

Learn how to buy tokens and send tips during live streams:

<b>🪙 Step 1: Go to the Live page</b>
Open <a href="https://pnptv.app/live">pnptv.app/live</a> and browse live streams.

<b>🔐 Step 2: Log in</b>
You must be logged in to buy tokens and send tips.

<b>💰 Step 3: Buy PNP Tokens</b>
• Find the <b>Token Balance</b> widget on the Live page
• Tap <b>"Buy Tokens"</b>
• Choose a package:
  5 tokens — $5 USD
  10 tokens — $10 USD
  20 tokens — $20 USD
  50 tokens — $50 USD
  100 tokens — $100 USD
• A <b>Dash</b> checkout opens (via BTCPay Server)
• Complete the payment and tokens are credited instantly

<b>🎯 Step 4: Select a performer</b>
Tap on a live performer's card to select them.

<b>🎁 Step 5: Send a tip</b>
• Make sure you're on the <b>"Tokens"</b> tab
• Choose the amount: <b>5T, 10T, 20T, 50T, or 100T</b>
• Optional: add a personal message
• Tap to send — <b>instant, no popups!</b>

<b>1 token = $1 USD</b> — simple and straightforward.

🌟 <b>New creators and performers are joining PNPtv! Live soon</b> — get your tokens ready to be the first to show them love!

👉 <a href="https://pnptv.app/live">Go to PNPtv! Live</a>

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
    .step { background: #111; border: 1px solid rgba(212,0,122,0.3); padding: 16px; border-radius: 8px; margin: 14px 0; }
    .step h3 { color: #E69138; margin: 0 0 8px 0; font-size: 16px; }
    .step p { margin: 4px 0; color: #ccc; font-size: 14px; }
    .packages { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin: 12px 0; }
    .pkg { background: rgba(212,0,122,0.1); border: 1px solid rgba(212,0,122,0.3); border-radius: 8px; padding: 10px; text-align: center; }
    .pkg .amount { font-size: 18px; font-weight: bold; color: #E69138; }
    .pkg .price { font-size: 11px; color: #aaa; }
    .tip-amounts { display: flex; gap: 8px; justify-content: center; margin: 12px 0; }
    .tip-btn { background: linear-gradient(135deg, #D4007A 0%, #E69138 100%); color: white; padding: 8px 16px; border-radius: 20px; font-weight: bold; font-size: 14px; }
    .announce { background: rgba(212,0,122,0.08); border-left: 3px solid #D4007A; padding: 14px; border-radius: 4px; margin: 20px 0; }
    .announce strong { color: #E69138; }
    .button { display: inline-block; padding: 14px 40px; background: linear-gradient(135deg, #D4007A 0%, #E69138 100%); color: white !important; text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: bold; font-size: 16px; }
    .footer { text-align: center; padding-top: 20px; border-top: 1px solid #333; color: #555; font-size: 12px; }
  `;

  if (isEs) {
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Como comprar tokens y dar propinas en PNPtv! Live</title>
  <style>${styles}</style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>PNPtv!</h1></div>

    <div class="badge">
      <h2>🔴 Nuevos Creadores y Performers en PNPtv! Live</h2>
      <p style="margin:8px 0 0 0; opacity:0.9;">Aprende a comprar tokens y enviar propinas</p>
    </div>

    <div class="content">
      <p>Hola <strong style="color:#E69138">${name}</strong>,</p>
      <p>Nuevos creadores de contenido y performers estan llegando a <strong style="color:#D4007A">PNPtv! Live</strong>. Aqui te explicamos paso a paso como comprar tokens y apoyarlos con propinas en vivo.</p>

      <div class="step">
        <h3>🪙 Paso 1: Ve a la pagina Live</h3>
        <p>Abre <a href="https://pnptv.app/live" style="color:#D4007A">pnptv.app/live</a> y explora las transmisiones en vivo.</p>
      </div>

      <div class="step">
        <h3>🔐 Paso 2: Inicia sesion</h3>
        <p>Debes estar logueado para comprar tokens y enviar propinas.</p>
      </div>

      <div class="step">
        <h3>💰 Paso 3: Compra PNP Tokens</h3>
        <p>Busca el widget de <strong>Saldo de Tokens</strong> y toca <strong>"Comprar Tokens"</strong>. Elige un paquete:</p>
        <div class="packages">
          <div class="pkg"><div class="amount">5</div><div class="price">$5 USD</div></div>
          <div class="pkg"><div class="amount">10</div><div class="price">$10 USD</div></div>
          <div class="pkg"><div class="amount">20</div><div class="price">$20 USD</div></div>
          <div class="pkg"><div class="amount">50</div><div class="price">$50 USD</div></div>
          <div class="pkg"><div class="amount">100</div><div class="price">$100 USD</div></div>
        </div>
        <p>Se abre el checkout de <strong>Dash</strong> (via BTCPay Server). Completa el pago y tus tokens se acreditan al instante.</p>
        <p><strong style="color:#E69138">1 token = $1 USD</strong></p>
      </div>

      <div class="step">
        <h3>🎯 Paso 4: Selecciona un performer</h3>
        <p>Toca la tarjeta de un performer en vivo para seleccionarlo.</p>
      </div>

      <div class="step">
        <h3>🎁 Paso 5: Envia una propina</h3>
        <p>Asegurate de estar en el tab <strong>"Tokens"</strong> y elige el monto:</p>
        <div class="tip-amounts">
          <span class="tip-btn">5T</span>
          <span class="tip-btn">10T</span>
          <span class="tip-btn">20T</span>
          <span class="tip-btn">50T</span>
          <span class="tip-btn">100T</span>
        </div>
        <p>Puedes agregar un mensaje personal. Toca para enviar — <strong>instantaneo, sin ventanas emergentes!</strong></p>
      </div>

      <div class="announce">
        <strong>🌟 Proximamente:</strong> Nuevos creadores y performers se unen a PNPtv! Live. Ten tus tokens listos para ser el primero en apoyarlos!
      </div>

      <div style="text-align:center; margin:30px 0;">
        <a href="https://pnptv.app/live" class="button">Ir a PNPtv! Live &rarr;</a>
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
  <title>How to Buy Tokens & Tip on PNPtv! Live</title>
  <style>${styles}</style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>PNPtv!</h1></div>

    <div class="badge">
      <h2>🔴 New Creators & Performers on PNPtv! Live</h2>
      <p style="margin:8px 0 0 0; opacity:0.9;">Learn how to buy tokens and send tips</p>
    </div>

    <div class="content">
      <p>Hey <strong style="color:#E69138">${name}</strong>,</p>
      <p>New content creators and performers are joining <strong style="color:#D4007A">PNPtv! Live</strong>. Here's a step-by-step guide on how to buy tokens and support them with live tips.</p>

      <div class="step">
        <h3>🪙 Step 1: Go to the Live page</h3>
        <p>Open <a href="https://pnptv.app/live" style="color:#D4007A">pnptv.app/live</a> and browse live streams.</p>
      </div>

      <div class="step">
        <h3>🔐 Step 2: Log in</h3>
        <p>You must be logged in to buy tokens and send tips.</p>
      </div>

      <div class="step">
        <h3>💰 Step 3: Buy PNP Tokens</h3>
        <p>Find the <strong>Token Balance</strong> widget and tap <strong>"Buy Tokens"</strong>. Choose a package:</p>
        <div class="packages">
          <div class="pkg"><div class="amount">5</div><div class="price">$5 USD</div></div>
          <div class="pkg"><div class="amount">10</div><div class="price">$10 USD</div></div>
          <div class="pkg"><div class="amount">20</div><div class="price">$20 USD</div></div>
          <div class="pkg"><div class="amount">50</div><div class="price">$50 USD</div></div>
          <div class="pkg"><div class="amount">100</div><div class="price">$100 USD</div></div>
        </div>
        <p>A <strong>Dash</strong> checkout opens (via BTCPay Server). Complete the payment and tokens are credited instantly.</p>
        <p><strong style="color:#E69138">1 token = $1 USD</strong></p>
      </div>

      <div class="step">
        <h3>🎯 Step 4: Select a performer</h3>
        <p>Tap on a live performer's card to select them.</p>
      </div>

      <div class="step">
        <h3>🎁 Step 5: Send a tip</h3>
        <p>Make sure you're on the <strong>"Tokens"</strong> tab and choose the amount:</p>
        <div class="tip-amounts">
          <span class="tip-btn">5T</span>
          <span class="tip-btn">10T</span>
          <span class="tip-btn">20T</span>
          <span class="tip-btn">50T</span>
          <span class="tip-btn">100T</span>
        </div>
        <p>You can add a personal message. Tap to send — <strong>instant, no popups!</strong></p>
      </div>

      <div class="announce">
        <strong>🌟 Coming soon:</strong> New creators and performers are joining PNPtv! Live. Get your tokens ready to be the first to show them love!
      </div>

      <div style="text-align:center; margin:30px 0;">
        <a href="https://pnptv.app/live" class="button">Go to PNPtv! Live &rarr;</a>
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
  console.log(`\n=== PNPtv Live Tokens Tutorial Broadcast ${DRY_RUN ? '[DRY RUN]' : '[LIVE]'} ===\n`);

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
      ? '🔴 Nuevos performers en PNPtv! Live — Aprende a comprar tokens'
      : '🔴 New performers on PNPtv! Live — Learn how to buy tokens';

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
  logger.error('sendLiveTokensTutorialBroadcast failed:', err);
  console.error(err);
  process.exit(1);
});
