#!/usr/bin/env node
'use strict';

/**
 * broadcast-golive-online-status-2026-07-09.js
 *
 * Announces to every Go Live creator that the platform now:
 *   1. Shows a green ONLINE dot on /live when they're logged into Studio
 *   2. Has upgraded stream quality (adaptive 720p variant, 1-second segments,
 *      background-noise denoising) applied to every channel
 *   3. Rewards them with tokens from tips + private calls while online
 *
 * Every creator gets an individually written opener. The body is a shared
 * bilingual (EN/ES) block.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-golive-online-status-2026-07-09.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-golive-online-status-2026-07-09.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-golive-online-status-2026-07-09.js --force
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }    = require(path.join(BACKEND, 'config/postgres'));
const { Telegram } = require('telegraf');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');

const ENTITY_ID   = 'golive-online-status-2026-07-09';
const URL_STUDIO  = 'https://pnptv.app/studio/stream';
const URL_LIVE    = 'https://pnptv.app/live';
const TG_DELAY_MS = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Shared body — bilingual ────────────────────────────────────────────────────

const BODY_EN = `━━━━━━━━━━━━━━━━━━━━
🟢 <b>WHAT CHANGED</b>
━━━━━━━━━━━━━━━━━━━━

<b>1. Green online dot on the Live page</b>
When you're logged into Creator Studio, viewers see a pulsing green dot on your card at <a href="${URL_LIVE}">pnptv.app/live</a>. You appear higher in the grid, and viewers know you're available <i>right now</i> — even if you're not broadcasting yet.

<b>2. Upgraded stream quality — applied to your channel already</b>
• Adaptive 720p variant so viewers on mobile don't buffer
• 1-second segments = lower latency
• Background-noise removal on your audio (FFT denoise, -25 dB threshold)

<b>3. Earn tokens while online</b>
Being online is enough to get discovered. Viewers can tip you and book private calls even when you're not broadcasting — the online dot signals you're reachable.

━━━━━━━━━━━━━━━━━━━━
🚀 <b>WHAT TO DO NOW</b>
━━━━━━━━━━━━━━━━━━━━

Open Creator Studio and stay logged in whenever you want to be visible:
🔗 ${URL_STUDIO}

That's it — no OBS required to show as online. Broadcasting is a bonus, not a requirement.`;

const BODY_ES = `━━━━━━━━━━━━━━━━━━━━
🟢 <b>QUÉ CAMBIÓ</b>
━━━━━━━━━━━━━━━━━━━━

<b>1. Punto verde de "en línea" en la página Live</b>
Cuando estás dentro del Estudio de Creador, los usuarios ven un punto verde pulsante en tu tarjeta de <a href="${URL_LIVE}">pnptv.app/live</a>. Apareces más arriba en la lista y los espectadores saben que estás disponible <i>ahora mismo</i> — incluso si aún no estás transmitiendo.

<b>2. Calidad de stream mejorada — ya aplicada a tu canal</b>
• Variante adaptativa 720p para que los espectadores móviles no tengan buffer
• Segmentos de 1 segundo = menor latencia
• Cancelación de ruido de fondo en tu audio (denoise FFT, umbral -25 dB)

<b>3. Gana tokens mientras estás en línea</b>
Estar en línea es suficiente para ser descubierto. Los espectadores pueden darte propinas y reservar llamadas privadas aunque no estés transmitiendo — el punto verde dice que estás disponible.

━━━━━━━━━━━━━━━━━━━━
🚀 <b>QUÉ HACER AHORA</b>
━━━━━━━━━━━━━━━━━━━━

Abre el Estudio de Creador y mantente conectado cuando quieras estar visible:
🔗 ${URL_STUDIO}

Eso es todo — no necesitas OBS para aparecer en línea. Transmitir es un extra, no un requisito.`;

// ── Per-creator unique openers keyed by Telegram ID ──────────────────────────

const OPENERS = {
  // EN
  '1966945732': `🟢 <b>11Minutes — good news. You just got more visible on PNPtv.</b>\n\nToday we shipped a change that puts you in front of viewers even when you're not broadcasting. Read on for how to take advantage of it right now.\n\n`,
  '5598791888': `🟢 <b>A — quick note: you're about to be more findable on PNPtv.</b>\n\nWe pushed an update today that changes how creators surface on the Live page. Your channel already has all the upgrades. Here's what to know.\n\n`,
  '6341493008': `🟢 <b>Alpha — small update, big impact on your Live-page presence.</b>\n\nStarting today, being online in Studio is a discovery signal on its own. You don't need to broadcast to show up in front of viewers.\n\n`,
  '5060931278': `🟢 <b>Avery — heads up: your Live-page card now signals when you're online.</b>\n\nWe rolled out a discovery upgrade this afternoon. Your card at pnptv.app/live now shows a green pulse whenever you're inside Creator Studio.\n\n`,
  '5374511130': `🟢 <b>BS — quick update from the platform side. Your channel just got smarter.</b>\n\nWe deployed a new online-presence indicator plus stream-quality upgrades. All applied to your channel automatically. Details below.\n\n`,
  '5935084902': `🟢 <b>Carlos — the Live page just got a lot friendlier to creators like you.</b>\n\nWe pushed a discovery update today that surfaces online creators to viewers immediately — no OBS required. Take a look:\n\n`,
  '8553652686': `🟢 <b>CheekyBoy — new discovery feature on PNPtv. You're the target audience.</b>\n\nStarting today, when you're logged into Creator Studio, viewers see you're online on the Live page. Here's what changed and what to do.\n\n`,
  '8039520242': `🟢 <b>Clay — small platform update that meaningfully bumps your visibility.</b>\n\nToday's push adds a pulsing green online-status indicator on your Live-page card whenever you're in Studio. Here's what it means for you.\n\n`,
  '5643392748': `🟢 <b>Cloud Computa — quick heads up on today's PNPtv changes.</b>\n\nWe shipped an online-presence indicator plus better stream quality across all channels — including yours. You don't have to do anything to enable it.\n\n`,
  '7166356500': `🟢 <b>D Chem Sub — a discovery update just went live. Read this before your next stream.</b>\n\nWe added a "you're online" signal to the Live page, and refreshed everyone's stream config for better quality. Full details below.\n\n`,
  '1071160931': `🟢 <b>Fedorius — new PNPtv feature deployed today. Applies to your channel already.</b>\n\nWe rolled out an online-status dot on the Live page plus stream-quality upgrades. You're in — here's how to use it.\n\n`,
  '5334575044': `🟢 <b>Here2see — appropriate name, given today's update. Viewers can now see when you're around.</b>\n\nWe launched a green-dot online indicator on the Live page. Log into Studio and viewers know you're reachable — even without a broadcast.\n\n`,
  '5951629484': `🟢 <b>J — quick platform update. Your Live-page card can now show "online".</b>\n\nDeployed today: an online-presence dot that lights up whenever you're inside Creator Studio. Also better stream quality on your channel. Details below.\n\n`,
  '8192241178': `🟢 <b>LAtinobb43 — you already tested Go Live for us. Here's the follow-up.</b>\n\nWe shipped an online-presence indicator that surfaces you on the Live page even without broadcasting. You've been marked as online in my tests today — nice work.\n\n`,
  '7205636669': `🟢 <b>Leon — new Live-page discovery feature. Vancouver, meet the green dot.</b>\n\nWe launched an online-status indicator today. When you're in Studio, viewers on pnptv.app/live see you're available. Full details below.\n\n`,
  '7879412085': `🟢 <b>Mac — small update, better creator discovery. Worth reading.</b>\n\nAs of today, viewers can see when you're online on the Live page — a pulsing green dot on your card whenever you're logged into Studio. Here's what to do.\n\n`,
  '8173329279': `🟢 <b>Miguel — heads up on today's PNPtv changes. You get more visibility now.</b>\n\nWe pushed an online-presence signal plus stream-quality upgrades to every channel — yours included. Read on for how it works.\n\n`,
  '6044736811': `🟢 <b>Minh — new PNPtv feature just deployed. Here's how it helps you.</b>\n\nWhen you're inside Creator Studio, viewers on pnptv.app/live now see a green online dot on your card. More discovery without more work.\n\n`,
  '7226864388': `🟢 <b>Naravudh — quick platform update from PNPtv. Discovery got easier for creators.</b>\n\nWe added a live "you're online" indicator on the Live page today. It fires whenever you're in Studio — even when you're not broadcasting.\n\n`,
  '7926587506': `🟢 <b>Nocturnal — the Live page now literally shows when you're around. Fitting.</b>\n\nWe deployed a green online dot that flags creators inside Studio. Details on how to use it and what else got upgraded below.\n\n`,
  '1215151270': `🟢 <b>PERVDF — new visibility feature on PNPtv. Deployed today.</b>\n\nWe added an online-presence dot on the Live-page grid + upgraded your channel to adaptive 720p with denoise. Zero setup needed — it's all live now.\n\n`,
  '7250101394': `🟢 <b>Rickie — quick heads up. Live-page discovery changed in your favor today.</b>\n\nStarting now, being logged into Studio is enough to appear as "online" to viewers. No broadcasting required. Full details below.\n\n`,
  '7742875708': `🟢 <b>S — small platform note. Your Live-page card just got smarter.</b>\n\nWe rolled out an online-status indicator plus stream-quality upgrades on every channel. Yours is already on the new config.\n\n`,
  '8312901004': `🟢 <b>S F — PNPtv discovery update. You're now surfaced when online.</b>\n\nToday's push: a pulsing green online dot on your Live-page card while you're in Studio, plus better stream quality across the board.\n\n`,
  '7581552455': `🟢 <b>Sexy one — you're about to be easier to find on PNPtv. Read this.</b>\n\nWe shipped an online-presence signal on the Live page today. When you're in Studio, viewers see you're reachable. Details on what to do next below.\n\n`,
  '6385726840': `🟢 <b>SpunQueeR — new discovery feature just went live. NJ, meet the green dot.</b>\n\nAs of today, being logged into Creator Studio gets you a pulsing green online marker on the Live page. Zero broadcast required.\n\n`,
  '8666563080': `🟢 <b>SrFalconPR — small update, meaningful for creators. Read on.</b>\n\nWe pushed an online-status indicator today. Being in Studio now surfaces you on pnptv.app/live to every viewer. Details below.\n\n`,
  '661173078':  `🟢 <b>The Jurong — quick update from PNPtv. Discovery got upgraded for you.</b>\n\nWe added an online-presence signal on the Live page — a pulsing green dot when you're in Studio. Applied to your channel automatically. Details below.\n\n`,
  // ES
  '8668655116': `🟢 <b>Juansito — actualización de PNPtv que te va a beneficiar. Léela.</b>\n\nHoy lanzamos un indicador de "en línea" en la página Live y mejoras de calidad de stream en tu canal. Todo aplicado sin que hicieras nada.\n\n`,
  '7489239467': `🟢 <b>Ern — pequeña novedad de PNPtv. Ahora sales más fácil en Live.</b>\n\nHoy pusimos en marcha un punto verde de "en línea" en la página Live. Cuando estás en el Estudio, los espectadores te ven disponible al instante.\n\n`,
  '7454293437': `🟢 <b>Franciscano — actualización de plataforma. Más visibilidad para ti a partir de hoy.</b>\n\nDesplegamos un indicador de estado en línea en la página Live y mejoras de calidad en tu canal. Zero configuración de tu parte.\n\n`,
  '5994313923': `🟢 <b>Gabo BB — nueva función en PNPtv que te hace más descubrible.</b>\n\nHoy lanzamos un punto verde en la página Live que se enciende cuando estás en el Estudio. Sin transmitir siquiera, ya sales frente a los espectadores.\n\n`,
  '1002190052': `🟢 <b>Jacks — quick update de PNPtv, en español. Tu tarjeta en Live cambió.</b>\n\nAhora hay un punto verde pulsante en tu tarjeta cuando estás en el Estudio de Creador. Los usuarios ya no tienen que adivinar si estás disponible.\n\n`,
  '8853192145': `🟢 <b>Jhon — heads up: nueva función de descubrimiento en PNPtv hoy.</b>\n\nCuando estás en el Estudio, los espectadores ven un punto verde en tu tarjeta en pnptv.app/live. Ya te aparece si te conectas ahora mismo.\n\n`,
  '7246621722': `🟢 <b>Lex — actualización de plataforma. Ahora es más fácil que te encuentren.</b>\n\nDesplegamos hoy un indicador de "en línea" en la página Live y mejoras de calidad en tu canal. Todo activo ya — no tienes que configurar nada.\n\n`,
  '7894585080': `🟢 <b>Maikel — nueva función de PNPtv que sube tu presencia en Live.</b>\n\nHoy pusimos un punto verde en las tarjetas de creadores cuando están en el Estudio. Aparece sin necesidad de transmitir. Detalles abajo.\n\n`,
  '6158016962': `🟢 <b>Milo — pequeño update de PNPtv. Ahora Milo en Leche brilla verde cuando estás.</b>\n\nLa página Live ahora muestra un punto verde en tu tarjeta cuando estás dentro del Estudio de Creador. Aumenta descubrimiento sin trabajo extra.\n\n`,
  '8114296685': `🟢 <b>Oz — desde NYC: la página Live ahora sabe cuándo estás disponible.</b>\n\nDesplegamos hoy un indicador de estado en línea. Cuando estás en el Estudio, los espectadores ven un punto verde en tu tarjeta. Lee los detalles.\n\n`,
  '721644409':  `🟢 <b>Saggitterna — actualización rápida. Más visibilidad para ti en PNPtv.</b>\n\nA partir de hoy hay un punto verde pulsante en tu tarjeta de la página Live cuando estás en el Estudio. Sin transmitir, ya te encuentran.\n\n`,
  '8599671840': `🟢 <b>Santino — gracias por probar el Go Live hoy. Aquí está el follow-up.</b>\n\nGracias a tu prueba encontramos y arreglamos varias cosas en /live. Ahora tu canal ya tiene la nueva configuración (720p adaptativo + denoise + 1s segments) y hay indicador verde cuando estás en el Estudio.\n\n`,
  '5867063315': `🟢 <b>Hey — actualización de PNPtv hoy que te toca directamente.</b>\n\nAhora tu tarjeta en la página Live muestra un punto verde cuando estás en el Estudio. Los espectadores saben que estás disponible sin que tengas que transmitir.\n\n`,
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' Online-Status Broadcast — 2026-07-09');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN) console.log(' MODE: DRY RUN — nothing will be sent\n');

  const { rows: creators } = await query(`
    SELECT u.id, u.pnptv_id, u.first_name, u.username, u.telegram, u.language, u.live_channel
    FROM users u
    WHERE u.live_channel IS NOT NULL
      AND u.live_channel != ''
      AND u.telegram IS NOT NULL
      AND COALESCE(u.is_deleted, false) = false
    ORDER BY u.first_name
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

  console.log(`\n   Go Live creators with Telegram: ${creators.length}`);
  console.log(`   Already notified:               ${alreadySent.size}`);
  console.log(`   To send:                        ${targets.length}`);

  const unmapped = targets.filter(u => !OPENERS[String(u.telegram)]);
  if (unmapped.length) {
    console.warn(`\n   ⚠️  No opener for:`);
    unmapped.forEach(u => console.warn(`      - ${u.first_name || u.username} (TG: ${u.telegram})`));
    if (!DRY_RUN) {
      console.error('\nABORTED: Add custom openers for the above creators before sending.');
      process.exit(1);
    }
  }

  if (DRY_RUN) {
    console.log('\n── Sample messages (first 2 EN + first 2 ES) ──\n');
    const enTargets = targets.filter(u => u.language !== 'es').slice(0, 2);
    const esTargets = targets.filter(u => u.language === 'es').slice(0, 2);
    for (const u of [...enTargets, ...esTargets]) {
      const opener = OPENERS[String(u.telegram)] || `🟢 <b>${u.first_name} — quick platform update.</b>\n\n`;
      const isEs = u.language === 'es';
      const msg = opener + (isEs ? BODY_ES : BODY_EN);
      console.log(`--- ${u.first_name || u.username} (${u.telegram}) [${isEs ? 'ES' : 'EN'}] ---`);
      console.log(msg);
      console.log();
    }
    console.log('═══════════════════════════════════════════════════');
    console.log(' DRY RUN COMPLETE — nothing sent');
    console.log('═══════════════════════════════════════════════════\n');
    process.exit(0);
  }

  const tg = new Telegram(process.env.BOT_TOKEN);
  let sent = 0, failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const u = targets[i];
    const opener = OPENERS[String(u.telegram)] || `🟢 <b>${u.first_name} — quick platform update.</b>\n\n`;
    const isEs = u.language === 'es';
    const msg = opener + (isEs ? BODY_ES : BODY_EN);

    try {
      await tg.sendMessage(u.telegram, msg, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
      sent++;
      process.stdout.write(`\r   Sent: ${sent}  Failed: ${failed}  (${i + 1}/${targets.length})`);
    } catch (err) {
      failed++;
      console.warn(`\n     TG err [${u.telegram} / ${u.first_name || u.username}]: ${err.message}`);
      await sleep(TG_DELAY_MS);
      continue;
    }

    try {
      await query(`
        INSERT INTO notifications
          (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message, metadata)
        VALUES ('announcement', 'system', 'high', NULL, $1, 'system', $2, $3, $4::jsonb)
        ON CONFLICT (type, target_user_id, entity_type, entity_id) WHERE actor_id IS NULL
        DO UPDATE SET is_read = FALSE, created_at = NOW(), message = EXCLUDED.message
      `, [
        u.id,
        ENTITY_ID,
        '🟢 New: viewers see you when you\'re online in Studio. Earn tokens without broadcasting.',
        JSON.stringify({ liveChannel: u.live_channel, studioUrl: URL_STUDIO }),
      ]);
    } catch (dbErr) {
      console.warn(`\n     DB dedup warn [${u.first_name || u.username}]: ${dbErr.message}`);
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
