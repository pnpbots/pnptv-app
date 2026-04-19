#!/usr/bin/env node
'use strict';

/**
 * sendMigrationNudge.js
 *
 * Daily migration push to the main Telegram community group. Posts a single
 * bilingual (EN + ES) HTML message with one inline button → https://app.pnptv.app
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/sendMigrationNudge.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/sendMigrationNudge.js
 *   docker exec pnptv-bot node apps/backend/scripts/sendMigrationNudge.js --pin
 *
 * Also exported as { sendMigrationToGroup } for the daily scheduler.
 */

const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
} catch (_) {}

const APP_URL = 'https://app.pnptv.app';
// Main community supergroup ("PNPtv! Main"). Stable real ID — env's GROUP_ID
// still points at an old group the bot was removed from. MIGRATION_NUDGE_CHAT_ID
// can override this without touching the rest of the bot's GROUP_ID-bound middleware.
const COMMUNITY_GROUP_ID = process.env.MIGRATION_NUDGE_CHAT_ID || '-1003760638625';

function getBotToken() {
  return process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
}

const TELEGRAM_HTML = `🚀 <b>The PNPtv! app is here — time to migrate</b>

This Telegram group is no longer where the action is. Telegram is phasing out groups and channels, and our home is now the <b>PNPtv! app</b> at <b>app.pnptv.app</b>.

<b>What's inside the app (and not in Telegram):</b>
• 💬 <b>Hangouts</b> — private rooms with live chat, media feeds and video calls
• 📺 <b>PNP Live</b> — live streams from creators with tips and overlays
• 📍 <b>Nearby</b> — find members close to you with the live map
• 🎬 <b>Videorama + Radio</b> — full VOD library and 24/7 audio
• 🧜‍♀️ <b>Cristina AI</b> — your personal assistant for anything PNPtv
• 💎 <b>Creator content, DMs, payments</b> — all in one place

<b>Migrate in 60 seconds:</b>
1️⃣ Tap <b>“🚀 Open the app”</b> below.
2️⃣ Sign in with Telegram — one tap, no password.
3️⃣ Tap the shining circle (Cristina AI) if you have any question.

ℹ️ This group still mirrors to its Hangout inside the app — your messages are not lost, they just live in a better place now.

━━━━━━━━━━━━━━━━━━━━━

🚀 <b>La app PNPtv! ya está aquí — es hora de migrar</b>

Este grupo de Telegram ya no es el centro. Telegram está eliminando grupos y canales, y nuestra casa es la <b>app PNPtv!</b> en <b>app.pnptv.app</b>.

<b>Lo que hay dentro de la app (y no en Telegram):</b>
• 💬 <b>Hangouts</b> — salas privadas con chat en vivo, feed de medios y videollamadas
• 📺 <b>PNP Live</b> — streams en vivo de los creadores con propinas y overlays
• 📍 <b>Cerca</b> — encontrá miembros cerca tuyo con el mapa en vivo
• 🎬 <b>Videorama + Radio</b> — biblioteca VOD completa y audio 24/7
• 🧜‍♀️ <b>Cristina AI</b> — tu asistente personal para todo lo de PNPtv
• 💎 <b>Contenido de creadores, DMs, pagos</b> — todo en un solo lugar

<b>Migrá en 60 segundos:</b>
1️⃣ Tocá <b>“🚀 Abrir la app”</b> abajo.
2️⃣ Iniciá sesión con Telegram — un toque, sin contraseña.
3️⃣ Tocá el círculo brillante (Cristina AI) si tenés cualquier duda.

ℹ️ Este grupo sigue conectado a su Hangout dentro de la app — tus mensajes no se pierden, solo viven en un lugar mejor ahora.

— <b>The PNPtv! Team</b>`;

const REPLY_MARKUP = {
  inline_keyboard: [[
    { text: '🚀 Open the app · Abrir la app', url: APP_URL },
  ]],
};

async function tgRequest(method, payload) {
  const token = getBotToken();
  if (!token) {
    return { ok: false, error: 'No BOT_TOKEN in env' };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) {
      return {
        ok: false,
        error: data.description || `Telegram API error (${res.status})`,
        retryAfter: data.parameters?.retry_after,
      };
    }
    return { ok: true, result: data.result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Send the migration message to the main community group.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun=false] - Log payload, do not send.
 * @param {boolean} [opts.pin=false]    - After sending, pin the message.
 * @param {string|number} [opts.chatId] - Override target chat (default: GROUP_ID).
 * @returns {Promise<{ok: boolean, messageId?: number, error?: string, retryAfter?: number}>}
 */
async function sendMigrationToGroup(opts = {}) {
  const { dryRun = false, pin = false, chatId = COMMUNITY_GROUP_ID } = opts;

  const payload = {
    chat_id: chatId,
    text: TELEGRAM_HTML,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: REPLY_MARKUP,
  };

  if (dryRun) {
    console.log('[migrationNudge] DRY RUN — would send to', chatId);
    console.log('[migrationNudge] payload:', JSON.stringify(payload, null, 2));
    return { ok: true, messageId: 0 };
  }

  const sendResult = await tgRequest('sendMessage', payload);
  if (!sendResult.ok) {
    return { ok: false, error: sendResult.error, retryAfter: sendResult.retryAfter };
  }

  const messageId = sendResult.result?.message_id;

  if (pin && messageId) {
    const pinResult = await tgRequest('pinChatMessage', {
      chat_id: chatId,
      message_id: messageId,
      disable_notification: false,
    });
    if (!pinResult.ok) {
      console.warn('[migrationNudge] pin failed:', pinResult.error);
    }
  }

  return { ok: true, messageId };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const pin = process.argv.includes('--pin');

  console.log('[migrationNudge] target chat:', COMMUNITY_GROUP_ID, '| dryRun:', dryRun, '| pin:', pin);

  const result = await sendMigrationToGroup({ dryRun, pin });

  if (!result.ok) {
    console.error('[migrationNudge] FAILED:', result.error, result.retryAfter ? `(retry after ${result.retryAfter}s)` : '');
    process.exit(1);
  }

  console.log('[migrationNudge] OK — message_id:', result.messageId, pin ? '(pinned)' : '');
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { sendMigrationToGroup, TELEGRAM_HTML, COMMUNITY_GROUP_ID, APP_URL };
