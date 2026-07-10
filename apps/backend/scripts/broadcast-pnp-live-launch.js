#!/usr/bin/env node
'use strict';

/**
 * broadcast-pnp-live-launch.js
 *
 * Notifies all active creators that PNP Live is going to production today,
 * asks them to hold off until the official green-light, and points them to
 * OBS + the live show guidelines in Studio.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-pnp-live-launch.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-pnp-live-launch.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-pnp-live-launch.js --force
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }    = require(path.join(BACKEND, 'config/postgres'));
const { Telegram } = require('telegraf');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');

const ENTITY_ID    = 'pnp-live-launch-2026-07';
const URL_STUDIO   = 'https://pnptv.app/studio/stream';
const URL_OBS      = 'https://obsproject.com/download';
const TG_DELAY_MS  = 80;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

const TG = {
  en: (name) =>
`🎥 <b>Hey ${name} — PNP Live is going to production TODAY.</b>

We're running the last tests and fixes right now, so please <b>hold off on going live until we send you the official green light.</b>

The live tools are already enabled on your account — but we want everything to be perfect before the first shows go out.

━━━━━━━━━━━━━━━
📋 <b>IN THE MEANTIME</b>
━━━━━━━━━━━━━━━

<b>1. Download OBS</b> (if you haven't already)
OBS Studio is the free app you'll use to broadcast:
🔗 ${URL_OBS}

<b>2. Read the Live Show Guidelines</b>
Everything you need to know — rules, stream key setup, tips — is in your Studio:
🔗 ${URL_STUDIO}

━━━━━━━━━━━━━━━

We'll message you <b>as soon as we're ready.</b> Stay tuned — it's happening today! 🚀

<i>— The PNPtv! Team</i>`,

  es: (name) =>
`🎥 <b>Hey ${name} — PNP Live llega a producción HOY.</b>

Estamos corriendo las últimas pruebas y ajustes en este momento, así que por favor <b>espera nuestra confirmación oficial antes de salir en vivo.</b>

Las herramientas de transmisión ya están activas en tu cuenta — pero queremos que todo esté perfecto antes de los primeros shows.

━━━━━━━━━━━━━━━
📋 <b>MIENTRAS TANTO</b>
━━━━━━━━━━━━━━━

<b>1. Descarga OBS</b> (si aún no lo tienes)
OBS Studio es la app gratuita que usarás para transmitir:
🔗 ${URL_OBS}

<b>2. Lee las Guías de Shows en Vivo</b>
Todo lo que necesitas saber — reglas, cómo conectar tu stream key, tips — está en tu Studio:
🔗 ${URL_STUDIO}

━━━━━━━━━━━━━━━

Te avisaremos <b>en cuanto estemos listos.</b> ¡Mantente atento — es hoy! 🚀

<i>— El equipo de PNPtv!</i>`,
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' PNP Live Launch Broadcast — July 2026');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN) console.log(' MODE: DRY RUN — nothing will be sent\n');

  const { rows: creators } = await query(`
    SELECT id, first_name, username, telegram, language
    FROM users
    WHERE creator_status = 'active'
      AND COALESCE(is_deleted, false) = false
      AND telegram IS NOT NULL
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

  const targets = creators.filter(u => !alreadySent.has(u.id));

  console.log(`\n   Total active creators w/ Telegram: ${creators.length}`);
  console.log(`   Already notified:                  ${alreadySent.size}`);
  console.log(`   To send:                           ${targets.length}`);

  if (DRY_RUN) {
    const sample = targets[0];
    if (sample) {
      const lang = isEn(sample.language) ? 'en' : 'es';
      const name = sample.first_name || sample.username || (lang === 'en' ? 'there' : 'amigo');
      console.log('\n── Sample message (' + lang + ') ──\n');
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
      await tg.sendMessage(u.telegram, msg, { parse_mode: 'HTML', disable_web_page_preview: true });

      await query(`
        INSERT INTO notifications
          (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message, metadata)
        VALUES ('announcement', 'system', 'high', NULL, $1, 'system', $2, $3, $4::jsonb)
        ON CONFLICT (type, target_user_id, entity_type, entity_id) WHERE actor_id IS NULL
        DO UPDATE SET is_read = FALSE, created_at = NOW(), message = EXCLUDED.message
      `, [u.id, ENTITY_ID,
          lang === 'en'
            ? '🎥 PNP Live goes to production today — hold off until we send the green light. Download OBS + read the guidelines in Studio.'
            : '🎥 PNP Live llega a producción hoy — espera nuestra señal antes de salir en vivo. Descarga OBS y lee las guías en Studio.',
          JSON.stringify({ studioUrl: URL_STUDIO, obsUrl: URL_OBS })]);

      sent++;
      process.stdout.write(`\r   Sent: ${sent}  Failed: ${failed}  (${i + 1}/${targets.length})`);
    } catch (err) {
      failed++;
      if (failed <= 5 || failed % 10 === 0) {
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

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
