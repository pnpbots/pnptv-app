#!/usr/bin/env node
'use strict';

/**
 * sendTelegramWelcome.js
 *
 * Sends a Telegram welcome message + unique PRIME channel invite link
 * to every distinct paying customer.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/sendTelegramWelcome.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/sendTelegramWelcome.js
 */

const path = require('path');
const BACKEND_ROOT = path.resolve(__dirname, '..');

try {
  require('dotenv').config({ path: path.join(BACKEND_ROOT, '../../.env') });
} catch (_) {}

const { Telegraf } = require('telegraf');
const { getPool, query } = require(path.join(BACKEND_ROOT, 'config/postgres'));
const logger = require(path.join(BACKEND_ROOT, 'utils/logger'));

const DRY_RUN = process.argv.includes('--dry-run');
const RETRY_FAILED = process.argv.includes('--retry-failed');
const DELAY_MS = 2000; // 2s between messages to respect Telegram rate limits
const PRIME_CHANNEL_ID = process.env.PRIME_CHANNEL_ID || '-1002997324714';

// User IDs that failed due to Markdown parse errors in first run
const FAILED_USER_IDS = [
  '1985858163', '2052693083', '5263369331', '5298011592',
  '5899228122', '5996615097', '6548836202', '6557776792',
  '7693917491', '7736471453', '7833561129', '8002643684',
  '8109691903', '8192241178', '8223749377', '8229666359',
  '8250283246', '8304222924',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeMarkdown(text) {
  if (!text) return '';
  return String(text).replace(/([*_`\[\]])/g, '\\$1');
}

function buildWelcomeMessage(user, inviteLink, lang) {
  const name = escapeMarkdown(user.first_name || user.username || 'there');
  const planDisplay = escapeMarkdown(user.plan_display_name || user.plan_db_name || user.plan_id || 'PRIME');
  const expiry = user.plan_expiry
    ? new Date(user.plan_expiry).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : (lang === 'es' ? 'Permanente' : 'Permanent');

  if (lang === 'es') {
    return [
      `🎉 ¡Hola ${name}!`,
      '',
      `Queremos agradecerte por ser parte de PNPtv! Tu membresía *${planDisplay}* está activa.`,
      '',
      `📅 *Válido hasta:* ${expiry}`,
      '',
      `Como compensación por las inconveniencias recientes, hemos renovado tu membresía desde hoy.`,
      '',
      '📦 *Lo que incluye tu membresía:*',
      '• Hangouts — Salas de videollamadas',
      '• PNP Television Live — Transmisiones en vivo',
      '• Social Feed — Publica y conecta',
      '• Nearby — Descubre miembros cercanos',
      '• Chat & DMs — Mensajes directos',
      '',
      `🌟 *Accede al canal PRIME exclusivo:*`,
      `👉 ${inviteLink}`,
      '',
      '🌐 Visita la plataforma: https://pnptv.app',
      '',
      '¡Gracias por apoyar un proyecto independiente! 🔥',
    ].join('\n');
  }

  return [
    `🎉 Hey ${name}!`,
    '',
    `Thank you for being part of PNPtv! Your *${planDisplay}* membership is active.`,
    '',
    `📅 *Valid until:* ${expiry}`,
    '',
    `As compensation for recent inconveniences, we've renewed your membership starting from today.`,
    '',
    '📦 *Your membership includes:*',
    '• Hangouts — Community video call rooms',
    '• PNP Television Live — Live streams',
    '• Social Feed — Post & connect',
    '• Nearby — Discover members near you',
    '• Chat & DMs — Direct messages',
    '',
    `🌟 *Access the exclusive PRIME channel:*`,
    `👉 ${inviteLink}`,
    '',
    '🌐 Visit the platform: https://pnptv.app',
    '',
    'Thank you for supporting an independent project! 🔥',
  ].join('\n');
}

async function main() {
  console.log('=== Telegram Welcome Message Sender ===');
  if (DRY_RUN) console.log('>>> DRY RUN — no messages will be sent <<<\n');

  const bot = new Telegraf(process.env.BOT_TOKEN);

  // Get all distinct paying users (Telegram user IDs only — skip UUID-style IDs)
  const { rows: users } = await query(`
    SELECT DISTINCT ON (p.user_id)
      p.user_id,
      u.username,
      u.first_name,
      u.language,
      u.plan_id,
      u.plan_expiry,
      pl.display_name AS plan_display_name,
      pl.name AS plan_db_name
    FROM payments p
    JOIN users u ON p.user_id::text = u.id::text
    LEFT JOIN plans pl ON u.plan_id = pl.id
    WHERE p.status = 'completed'
      AND p.user_id ~ '^[0-9]+$'
      AND u.subscription_status = 'active'
      ${RETRY_FAILED ? `AND p.user_id IN (${FAILED_USER_IDS.map(id => `'${id}'`).join(',')})` : ''}
    ORDER BY p.user_id, p.amount DESC
  `);

  console.log(`Total paying users to message: ${users.length}\n`);

  let sent = 0;
  let failed = 0;
  let blocked = 0;

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const lang = u.language || 'es';
    const label = `[${i + 1}/${users.length}]`;

    if (DRY_RUN) {
      console.log(`${label} DRY RUN: @${u.username || u.user_id} (${u.first_name || 'N/A'}) — ${u.plan_display_name || u.plan_id}`);
      sent++;
      continue;
    }

    try {
      // Create unique invite link for PRIME channel (with retry for rate limits)
      let inviteLink = 'https://t.me/PNPTV_PRIME';
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await bot.telegram.createChatInviteLink(PRIME_CHANNEL_ID, {
            member_limit: 1,
            name: `welcome_${u.user_id}_${Date.now()}`,
          });
          inviteLink = response.invite_link;
          break;
        } catch (linkErr) {
          if (linkErr.message && linkErr.message.includes('429') && attempt < 2) {
            const wait = parseInt(linkErr.message.match(/retry after (\d+)/)?.[1] || '20', 10);
            console.warn(`${label} Rate limited, waiting ${wait + 2}s...`);
            await sleep((wait + 2) * 1000);
          } else {
            console.warn(`${label} Failed to create invite link, using fallback: ${linkErr.message}`);
            break;
          }
        }
      }

      const message = buildWelcomeMessage(u, inviteLink, lang);

      await bot.telegram.sendMessage(u.user_id, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });

      sent++;
      console.log(`${label} OK: @${u.username || u.user_id} (${u.first_name || 'N/A'})`);
    } catch (err) {
      if (err.description && (err.description.includes('bot was blocked') || err.description.includes('user is deactivated') || err.description.includes('chat not found'))) {
        blocked++;
        console.warn(`${label} BLOCKED/DEACTIVATED: @${u.username || u.user_id} — ${err.description}`);
      } else {
        failed++;
        console.error(`${label} FAILED: @${u.username || u.user_id} — ${err.message}`);
      }
    }

    await sleep(DELAY_MS);
  }

  console.log('\n=== Summary ===');
  console.log(`Total users:     ${users.length}`);
  console.log(`Messages sent:   ${sent}`);
  console.log(`Blocked/Deact:   ${blocked}`);
  console.log(`Failed:          ${failed}`);

  const pool = getPool();
  await pool.end();
  process.exit(failed > 5 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
