#!/usr/bin/env node
'use strict';

/**
 * broadcast-creator-weekend-bonus-2026-07-18.js
 *
 * Announces the Creator Weekend Bonus: +10% extra PNP Tokens on every purchase
 * during Jul 18–21 2026 UTC. Bonus is already live (Redis key set).
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-creator-weekend-bonus-2026-07-18.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-creator-weekend-bonus-2026-07-18.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-creator-weekend-bonus-2026-07-18.js --force
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }    = require(path.join(BACKEND, 'config/postgres'));
const { Telegram } = require('telegraf');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');

const ENTITY_ID   = 'creator-weekend-bonus-2026-07-18';
const BUY_URL     = 'https://pnptv.app/live';
const TG_DELAY_MS = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

const TG = {
  en: (name) =>
`🎁 <b>CREATOR WEEKEND — +10% bonus tokens this weekend only!</b>

Hey ${name}, for the next 3 days (Jul 18–21) every PNP Token purchase comes with 10% extra tokens — no code needed, no strings attached.

More tokens means more tips, more content unlocks, more private sessions. Don't miss it 👇

${BUY_URL}`,

  es: (name) =>
`🎁 <b>FIN DE SEMANA CREATOR — ¡+10% tokens de bono solo este fin de semana!</b>

Hey ${name}, durante los próximos 3 días (18–21 jul) cada compra de PNP Tokens incluye un 10% extra — sin código, sin condiciones.

Más tokens = más propinas, más contenido desbloqueado, más sesiones privadas. No te lo pierdas 👇

${BUY_URL}`,
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' Creator Weekend Bonus Broadcast — Jul 18 2026');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN) console.log(' MODE: DRY RUN — nothing will be sent\n');

  const { rows: users } = await query(`
    SELECT id, first_name, username, telegram, language
    FROM users
    WHERE telegram IS NOT NULL
      AND COALESCE(is_deleted, false) = false
    ORDER BY id
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

  console.log(`\n   Total users w/ Telegram:  ${users.length}`);
  console.log(`   Already notified:         ${alreadySent.size}`);
  console.log(`   To send:                  ${targets.length}`);

  if (DRY_RUN) {
    const samples = targets.slice(0, 2);
    for (const sample of samples) {
      const lang = isEn(sample.language) ? 'en' : 'es';
      const name = sample.first_name || sample.username || (lang === 'en' ? 'there' : 'amigo');
      console.log(`\n── Sample message (${lang}) [${sample.username || sample.id}] ──\n`);
      console.log(TG[lang](name));
    }
    console.log('\n═══════════════════════════════════════════════════');
    console.log(' DRY RUN COMPLETE — nothing sent');
    console.log('═══════════════════════════════════════════════════\n');
    process.exit(0);
  }

  const tg = new Telegram(process.env.BOT_TOKEN);
  let sent = 0, failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const u = targets[i];
    const lang = isEn(u.language) ? 'en' : 'es';
    const name = u.first_name || u.username || (lang === 'en' ? 'there' : 'amigo');
    const msg  = TG[lang](name);

    try {
      await tg.sendMessage(u.telegram, msg, {
        parse_mode: 'HTML',
      });

      await query(`
        INSERT INTO notifications
          (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message, metadata)
        VALUES ('announcement', 'system', 'high', NULL, $1, 'system', $2, $3, $4::jsonb)
        ON CONFLICT (type, target_user_id, entity_type, entity_id) WHERE actor_id IS NULL
        DO UPDATE SET is_read = FALSE, created_at = NOW(), message = EXCLUDED.message
      `, [
        u.id,
        ENTITY_ID,
        lang === 'en'
          ? '🎁 Creator Weekend — +10% bonus tokens Jul 18–21!'
          : '🎁 Fin de Semana Creator — ¡+10% tokens de bono 18–21 jul!',
        JSON.stringify({ buyUrl: BUY_URL }),
      ]);

      sent++;
      process.stdout.write(`\r   Sent: ${sent}  Failed: ${failed}  (${i + 1}/${targets.length})`);
    } catch (err) {
      failed++;
      if (failed <= 5 || failed % 20 === 0) {
        console.warn(`\n     TG err [${u.telegram} / ${u.username}]: ${err.message}`);
      }
    }

    await sleep(TG_DELAY_MS);
  }

  console.log('\n');
  console.log('═══════════════════════════════════════════════════');
  console.log(` DONE — sent: ${sent}  failed: ${failed}`);
  console.log('═══════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
