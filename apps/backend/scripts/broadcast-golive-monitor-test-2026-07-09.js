#!/usr/bin/env node
'use strict';

/**
 * broadcast-golive-monitor-test-2026-07-09.js
 *
 * Quick DM to the 6 performers who were online/streaming in the last 2 hours.
 * Tells them we're running another 6-minute real-time monitor test in ~15 minutes
 * and that if everything looks good they are free to start broadcasting.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-golive-monitor-test-2026-07-09.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-golive-monitor-test-2026-07-09.js
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }    = require(path.join(BACKEND, 'config/postgres'));
const { Telegram } = require('telegraf');

const DRY_RUN   = process.argv.includes('--dry-run');
const TG_DELAY  = 150;
const ENTITY_ID = 'golive-monitor-test-2026-07-09';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Only the 6 performers active in the last 2 hours who have Telegram
const MESSAGES = {

  // Gabo BB — was streaming earlier today
  '5994313923': `🔴 <b>Gabo — otra ronda de prueba en ~15 minutos. ¿Puedes volver a conectarte?</b>

Estuviste en vivo hace un momento y nos sirvió muchísimo. Queremos hacer una última ronda de monitoreo en tiempo real — solo 6 minutos con OBS conectado.

Si todo se ve bien del lado técnico, eres libre de empezar a transmitir cuando quieras. Solo entra a <b>pnptv.app/studio/stream</b> y conecta OBS cuando estés listo.

Gracias por la paciencia Gabo, ya casi terminamos. 🙏`,

  // LAtinobb43
  '8192241178': `📡 <b>Latinobb — test rápido en ~15 minutos. Te necesitamos conectado.</b>

Hicimos ajustes importantes al pipeline de streaming hoy. Queremos hacer una última prueba de 6 minutos monitoreando en tiempo real antes de dar luz verde total.

Si los números se ven bien, eres libre de transmitir cuando quieras a partir de hoy. Solo conecta OBS en <b>pnptv.app/studio/stream</b> cuando estés listo.

Gracias latinobb, esto es el último paso. 💪`,

  // PIGINPRACTICE (D Chem Sub)
  '7166356500': `🔴 <b>Hey — quick test in ~15 minutes. Can you get OBS connected again?</b>

We made some fixes to the streaming pipeline today and want to do one final 6-minute real-time monitor before we give everyone the green light.

If everything checks out, you're free to start broadcasting whenever you want after that. Just connect OBS at <b>pnptv.app/studio/stream</b> when you're ready.

Appreciate it — almost done with testing. 🙌`,

  // Dacior (Franciscano)
  '7454293437': `⚗️ <b>Dacior — prueba corta en ~15 minutos. ¿Puedes conectar OBS un momento?</b>

Hicimos correcciones al sistema de streaming hoy. Solo necesitamos 6 minutos de monitoreo en tiempo real para confirmar que todo funciona bien bajo carga real.

Si los resultados son positivos, quedas libre de transmitir cuando quieras. Conéctate en <b>pnptv.app/studio/stream</b> cuando estés listo.

Gracias por el aguante Dacior. 🙏`,

  // SantinoFurioso — was live most of the session
  '8599671840': `✨ <b>Santino — una prueba más en ~15 minutos y ya terminamos.</b>

Llevas un rato ayudándonos con las pruebas y lo apreciamos muchísimo. Queremos hacer un último monitoreo de 6 minutos en tiempo real con OBS conectado para confirmar que todo está estable.

Si los números se ven bien, eres libre de transmitir lo que quieras a partir de ahí. Ya sabes dónde está todo: <b>pnptv.app/studio/stream</b>.

Gracias Santino, eres fundamental en este lanzamiento. 🙌`,

  // PNPKINKYBOY (Saggitterna)
  '721644409': `🏹 <b>Hey — test rápido en ~15 minutos. ¿Puedes conectar OBS?</b>

Corregimos el pipeline de streaming hoy y queremos hacer una última ronda de 6 minutos de monitoreo en tiempo real para confirmar que todo va bien.

Si todo sale limpio, quedas libre de transmitir cuando quieras. Entra a <b>pnptv.app/studio/stream</b> y conecta OBS cuando puedas.

Gracias, esto es el último test antes del verde. 🙏`,
};

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' Go Live Monitor Test — 2026-07-09');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN) console.log(' MODE: DRY RUN — nothing will be sent\n');

  const telegramIds = Object.keys(MESSAGES);
  const { rows: targets } = await query(
    `SELECT u.id, u.username, u.telegram
     FROM users u
     WHERE u.telegram = ANY($1::text[])
       AND COALESCE(u.is_deleted, false) = false`,
    [telegramIds]
  );

  console.log(`\n   Targets: ${targets.length}`);
  targets.forEach(u => console.log(`   - ${(u.username || u.telegram).padEnd(20)} TG: ${u.telegram}`));

  if (DRY_RUN) {
    console.log('\n── Messages ──\n');
    targets.forEach(u => {
      console.log(`--- ${u.username || u.telegram} ---`);
      console.log(MESSAGES[String(u.telegram)]);
      console.log();
    });
    console.log('DRY RUN COMPLETE — nothing sent\n');
    process.exit(0);
  }

  const tg = new Telegram(process.env.BOT_TOKEN);
  let sent = 0, failed = 0;

  for (const u of targets) {
    const msg = MESSAGES[String(u.telegram)];
    if (!msg) { console.warn(`No message for TG ${u.telegram}`); continue; }
    try {
      await tg.sendMessage(u.telegram, msg, { parse_mode: 'HTML', disable_web_page_preview: true });
      sent++;
      console.log(`   ✓ ${u.username || u.telegram}`);
    } catch (err) {
      failed++;
      console.warn(`   ✗ ${u.username || u.telegram}: ${err.message}`);
    }
    await sleep(TG_DELAY);
  }

  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(` DONE — sent: ${sent}  failed: ${failed}`);
  console.log(`═══════════════════════════════════════════════════\n`);
  process.exit(0);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
