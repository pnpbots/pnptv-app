#!/usr/bin/env node
'use strict';

/**
 * broadcast-private-calls-lex-santino.js
 *
 * Announces that Lex (@pnplatinoboy) and Santino (@santinofurioso)
 * are available NOW for private video calls — next 6 hours only.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-private-calls-lex-santino.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-private-calls-lex-santino.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-private-calls-lex-santino.js --skip-telegram
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-private-calls-lex-santino.js --skip-push
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }               = require(path.join(BACKEND, 'config/postgres'));
const PushNotificationService = require(path.join(BACKEND, 'services/pushNotificationService'));
const { Telegram }            = require('telegraf');

const DRY_RUN       = process.argv.includes('--dry-run');
const SKIP_TELEGRAM = process.argv.includes('--skip-telegram');
const SKIP_PUSH     = process.argv.includes('--skip-push');
const FORCE         = process.argv.includes('--force');

const ENTITY_ID   = 'private-calls-lex-santino-2026-06-18';
const TG_DELAY_MS = 80;

const URL_LEX     = 'https://pnptv.app/profile/7246621722';
const URL_SANTINO = 'https://pnptv.app/profile/8599671840';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `🔥 Lex & Santino are available NOW for a private video call — next 6 hours only. Book your slot at pnptv.app`,
  es: `🔥 Lex y Santino están disponibles AHORA para una videollamada privada — solo las próximas 6 horas. Reserva tu lugar en pnptv.app`,
};

const PUSH = {
  en: {
    title: '🔥 Private calls available NOW',
    body:  'Lex (@pnplatinoboy) & Santino are online for the next 6 hours. Book your private video call.',
  },
  es: {
    title: '🔥 Llamadas privadas disponibles AHORA',
    body:  'Lex (@pnplatinoboy) y Santino están en línea las próximas 6 horas. Reserva tu videollamada privada.',
  },
};

const TG = {
  en: (name) =>
`🔥 <b>Hey ${name} — private video calls are open RIGHT NOW.</b>

<b>Lex (@pnplatinoboy)</b> and <b>Santino (@santinofurioso)</b> are both online and available for the next 6 hours only.

A private video call is just you and them — one on one. Book your slot before they fill up.

━━━━━━━━━━━━━━━
📅 <b>Book with Lex</b>
👉 <a href="${URL_LEX}">pnptv.app/profile/PNPLatinoBoy</a>

📅 <b>Book with Santino</b>
👉 <a href="${URL_SANTINO}">pnptv.app/profile/SantinoFurioso</a>
━━━━━━━━━━━━━━━

Slots are limited. Don't wait. 🖤`,

  es: (name) =>
`🔥 <b>¡Hola ${name}! Las videollamadas privadas están abiertas AHORA MISMO.</b>

<b>Lex (@pnplatinoboy)</b> y <b>Santino (@santinofurioso)</b> están en línea y disponibles solo durante las próximas 6 horas.

Una videollamada privada es solo tú y él — uno a uno. Reserva tu turno antes de que se llenen.

━━━━━━━━━━━━━━━
📅 <b>Reservar con Lex</b>
👉 <a href="${URL_LEX}">pnptv.app/profile/PNPLatinoBoy</a>

📅 <b>Reservar con Santino</b>
👉 <a href="${URL_SANTINO}">pnptv.app/profile/SantinoFurioso</a>
━━━━━━━━━━━━━━━

Los lugares son limitados. No esperes. 🖤`,
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' Private Calls Broadcast — Lex & Santino — June 2026');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN)       console.log(' MODE: DRY RUN — nothing will be sent\n');
  if (SKIP_TELEGRAM) console.log(' --skip-telegram\n');
  if (SKIP_PUSH)     console.log(' --skip-push\n');

  const { rows: users } = await query(`
    SELECT u.id, u.first_name, u.username, u.telegram, u.language
    FROM users u
    WHERE COALESCE(u.is_deleted, false) = false
      AND u.role != 'banned'
    ORDER BY u.id
  `);

  let alreadySent = new Set();
  if (!FORCE) {
    const { rows: alreadyRows } = await query(`
      SELECT target_user_id FROM notifications
      WHERE entity_id = $1 AND entity_type = 'system' AND actor_id IS NULL
    `, [ENTITY_ID]);
    alreadySent = new Set(alreadyRows.map(r => r.target_user_id));
  }
  const isNew = (u) => !alreadySent.has(u.id);

  const withTelegram = users.filter(u => u.telegram && isNew(u));
  const eligible     = users.filter(u => isNew(u));

  console.log(`\n   Total users:      ${users.length}`);
  console.log(`   Already notified: ${alreadySent.size}`);
  console.log(`   New targets:      ${eligible.length}`);
  console.log(`   With Telegram:    ${withTelegram.length}`);

  const stats = { inApp: 0, push: 0, telegram: 0, telegramFailed: 0 };

  // 1. In-app bell
  console.log('\n1/3  In-app notifications...');
  if (!DRY_RUN) {
    try {
      const enIds = eligible.filter(u =>  isEn(u.language)).map(u => u.id);
      const esIds = eligible.filter(u => !isEn(u.language)).map(u => u.id);
      for (const [ids, msg] of [[enIds, NOTIFICATION_MSG.en], [esIds, NOTIFICATION_MSG.es]]) {
        if (!ids.length) continue;
        await query(`
          INSERT INTO notifications
            (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message, metadata)
          SELECT 'announcement', 'system', 'high', NULL,
            t.id, 'system', $2, $3, $4::jsonb
          FROM unnest($1::text[]) AS t(id)
          ON CONFLICT (type, target_user_id, entity_type, entity_id) WHERE actor_id IS NULL
          DO UPDATE SET is_read = FALSE, created_at = NOW(), message = EXCLUDED.message
        `, [ids, ENTITY_ID, msg, JSON.stringify({ url: URL_LEX })]);
        stats.inApp += ids.length;
      }
      console.log(`     ✓ ${stats.inApp} inserted/upserted`);
    } catch (err) { console.error(`     ✗ ${err.message}`); }
  } else {
    console.log(`     [DRY] Would notify ${eligible.length} users`);
  }

  // 2. Web push
  console.log('2/3  Web push...');
  if (!DRY_RUN && !SKIP_PUSH) {
    try {
      PushNotificationService.initialize();
      const enIds = eligible.filter(u =>  isEn(u.language)).map(u => u.id);
      const esIds = eligible.filter(u => !isEn(u.language)).map(u => u.id);
      let pushSent = 0;
      if (enIds.length) pushSent += await PushNotificationService.sendToUsers(enIds, { ...PUSH.en, url: URL_LEX, tag: ENTITY_ID });
      if (esIds.length) pushSent += await PushNotificationService.sendToUsers(esIds, { ...PUSH.es, url: URL_LEX, tag: ENTITY_ID });
      stats.push = pushSent;
      console.log(`     ✓ ${pushSent} push sent`);
    } catch (err) { console.error(`     ✗ ${err.message}`); }
  } else if (SKIP_PUSH) {
    console.log('     skipped');
  } else {
    console.log(`     [DRY] Would push to subscribed users`);
  }

  // 3. Telegram
  console.log(`3/3  Telegram to ${withTelegram.length} users...`);
  if (!DRY_RUN && !SKIP_TELEGRAM) {
    const tg = new Telegram(process.env.BOT_TOKEN);
    for (let i = 0; i < withTelegram.length; i++) {
      const u = withTelegram[i];
      const lang = isEn(u.language) ? 'en' : 'es';
      const name = u.first_name || u.username || (lang === 'en' ? 'there' : 'amigo');
      try {
        await tg.sendMessage(u.telegram, TG[lang](name), { parse_mode: 'HTML', disable_web_page_preview: true });
        stats.telegram++;
      } catch (err) {
        stats.telegramFailed++;
        if (stats.telegramFailed <= 5 || stats.telegramFailed % 100 === 0) {
          console.warn(`     TG err [${u.telegram}]: ${err.message}`);
        }
      }
      await sleep(TG_DELAY_MS);
      if ((i + 1) % 200 === 0) console.log(`     TG progress: ${i + 1}/${withTelegram.length}`);
    }
    console.log(`     ✓ sent=${stats.telegram}  failed=${stats.telegramFailed}`);
  } else if (SKIP_TELEGRAM) {
    console.log('     skipped');
  } else {
    console.log(`     [DRY] Would Telegram ${withTelegram.length} users`);
  }

  console.log('\n── Summary ──────────────────────────────────────────');
  console.log(`   In-app:   ${DRY_RUN ? '[dry]' : stats.inApp}`);
  console.log(`   Push:     ${DRY_RUN ? '[dry]' : stats.push}`);
  console.log(`   Telegram: ${DRY_RUN ? '[dry]' : stats.telegram} (failed: ${stats.telegramFailed})`);
  console.log('─────────────────────────────────────────────────────\n');

  process.exit(0);
}

main().catch((err) => { console.error('[fatal]', err); process.exit(1); });
