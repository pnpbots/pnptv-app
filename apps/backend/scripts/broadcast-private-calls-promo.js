#!/usr/bin/env node
'use strict';

/**
 * broadcast-private-calls-promo.js
 *
 * Promotional broadcast for private 1-on-1 video calls with Santino & Lex.
 * Telegram only. Run this after the launch broadcast to keep the feature top of mind.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-private-calls-promo.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-private-calls-promo.js
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }  = require(path.join(BACKEND, 'config/postgres'));
const { Telegram } = require('telegraf');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');

const ENTITY_ID     = 'private-calls-promo-2026-06';
const URL_SANTINO   = 'https://pnptv.app/profile/8599671840';
const URL_LATINOBOY = 'https://pnptv.app/profile/7246621722';
const TG_DELAY_MS   = 80;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Telegram messages ─────────────────────────────────────────────────────────

const TG = {
  en: (name) =>
`🔥 <b>${name}, have you booked your private call yet?</b>

PNPtv now offers <b>private 1-on-1 encrypted video sessions</b> with our creators — just you and them, totally discreet.

━━━━━━━━━━━━━━━
🎭 <b>SANTINO FURIOSO</b>
━━━━━━━━━━━━━━━
Dominant. Kinky. In charge. Choose your session length and get a private link sent directly to you.

⏱ 30 min → <b>$60</b>
⏱ 60 min → <b>$100</b>
🪙 Pay crypto and save 20%

👉 <a href="${URL_SANTINO}">Book Santino</a>

━━━━━━━━━━━━━━━
🌶️ <b>PNP LATINO BOY (LEX)</b>
━━━━━━━━━━━━━━━
Hot, passionate, and all yours. One click to book, one click to join.

⏱ 30 min → <b>$60</b>
⏱ 60 min → <b>$100</b>
🪙 Pay crypto and save 20%

👉 <a href="${URL_LATINOBOY}">Book Lex</a>

━━━━━━━━━━━━━━━

🔒 <b>100% private. Encrypted. Discreet.</b>
Pick a slot, pay, get your link. That's it.`,

  es: (name) =>
`🔥 <b>${name}, ¿ya agendaste tu llamada privada?</b>

PNPtv ahora tiene <b>sesiones de video privadas y encriptadas 1-a-1</b> con nuestros creadores — solo tú y él, con total discreción.

━━━━━━━━━━━━━━━
🎭 <b>SANTINO FURIOSO</b>
━━━━━━━━━━━━━━━
Dominante. Kinky. Al mando. Elige la duración y recibe tu enlace privado directamente.

⏱ 30 min → <b>$60</b>
⏱ 60 min → <b>$100</b>
🪙 Paga con cripto y ahorra 20%

👉 <a href="${URL_SANTINO}">Reservar con Santino</a>

━━━━━━━━━━━━━━━
🌶️ <b>PNP LATINO BOY (LEX)</b>
━━━━━━━━━━━━━━━
Caliente, apasionado y todo tuyo. Un clic para reservar, un clic para entrar.

⏱ 30 min → <b>$60</b>
⏱ 60 min → <b>$100</b>
🪙 Paga con cripto y ahorra 20%

👉 <a href="${URL_LATINOBOY}">Reservar con Lex</a>

━━━━━━━━━━━━━━━

🔒 <b>100% privado. Encriptado. Discreto.</b>
Elige un horario, paga, recibe tu enlace. Así de fácil.`,
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' Private Calls Promo Broadcast — June 2026');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN) console.log(' MODE: DRY RUN — nothing will be sent\n');

  const { rows: users } = await query(`
    SELECT u.id, u.first_name, u.username, u.telegram, u.language
    FROM users u
    WHERE COALESCE(u.is_deleted, false) = false
      AND u.role != 'banned'
      AND u.telegram IS NOT NULL
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

  const targets = users.filter(u => !alreadySent.has(u.id));

  console.log(`\n   Total users with Telegram: ${users.length}`);
  console.log(`   Already notified:          ${alreadySent.size}`);
  console.log(`   New targets:               ${targets.length}`);

  if (DRY_RUN) {
    console.log('\n── Sample TG message (EN) ──\n');
    console.log(TG.en('Alex'));
    console.log('\n── Sample TG message (ES) ──\n');
    console.log(TG.es('Carlos'));
    console.log('\n═══════════════════════════════════════════════════');
    console.log(' DRY RUN COMPLETE — nothing sent');
    console.log('═══════════════════════════════════════════════════\n');
    process.exit(0);
  }

  // Record notification rows before sending so a crash mid-send
  // doesn't cause duplicates on re-run (idempotent via ON CONFLICT).
  const enIds = targets.filter(u =>  isEn(u.language)).map(u => u.id);
  const esIds = targets.filter(u => !isEn(u.language)).map(u => u.id);
  const notifMsg = {
    en: `📞 Private 1-on-1 video calls with Santino & Lex — book your session at pnptv.app`,
    es: `📞 Videollamadas privadas 1-a-1 con Santino y Lex — reserva en pnptv.app`,
  };
  for (const [ids, msg] of [[enIds, notifMsg.en], [esIds, notifMsg.es]]) {
    if (!ids.length) continue;
    await query(`
      INSERT INTO notifications
        (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message, metadata)
      SELECT 'announcement', 'system', 'normal', NULL,
        t.id, 'system', $2, $3, $4::jsonb
      FROM unnest($1::text[]) AS t(id)
      ON CONFLICT (type, target_user_id, entity_type, entity_id) WHERE actor_id IS NULL
      DO NOTHING
    `, [ids, ENTITY_ID, msg, JSON.stringify({ url: URL_SANTINO })]);
  }

  // Send Telegram messages
  const tg = new Telegram(process.env.BOT_TOKEN);
  let sent = 0, failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const u = targets[i];
    const lang = isEn(u.language) ? 'en' : 'es';
    const name = u.first_name || u.username || (lang === 'en' ? 'there' : 'amigo');

    try {
      await tg.sendMessage(u.telegram, TG[lang](name), {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
      sent++;
    } catch (err) {
      failed++;
      if (failed <= 5 || failed % 100 === 0) {
        console.warn(`  TG err [${u.telegram}]: ${err.message}`);
      }
    }

    await sleep(TG_DELAY_MS);
    if ((i + 1) % 200 === 0) {
      console.log(`  Progress: ${i + 1}/${targets.length} (${sent} sent, ${failed} failed)`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(' BROADCAST COMPLETE');
  console.log('═══════════════════════════════════════════════════');
  console.log(` Telegram: ${sent} sent / ${failed} failed`);
  console.log('═══════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
