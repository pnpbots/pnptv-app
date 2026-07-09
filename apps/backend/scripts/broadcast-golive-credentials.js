#!/usr/bin/env node
'use strict';

/**
 * broadcast-golive-credentials.js
 *
 * Sends each Go Live creator their personal RTMP stream key + server URL
 * with step-by-step OBS setup instructions. Every creator gets a unique
 * personalised message (per platform DM policy) with their own stream key
 * embedded in the body.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-golive-credentials.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-golive-credentials.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-golive-credentials.js --force
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }    = require(path.join(BACKEND, 'config/postgres'));
const { Telegram } = require('telegraf');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');

const ENTITY_ID    = 'golive-credentials-2026-07';
const RTMP_SERVER  = 'rtmp://live.pnptv.app/live';
const RTMP_TOKEN   = process.env.RESTREAMER_RTMP_TOKEN || '';
const URL_STUDIO   = 'https://pnptv.app/studio/stream';
const TG_DELAY_MS  = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Derive the OBS stream key from a live_channel slug (strips 'pnptv-' prefix)
function streamKey(liveChannel) {
  const name = liveChannel.startsWith('pnptv-') ? liveChannel.slice('pnptv-'.length) : liveChannel;
  return RTMP_TOKEN ? `${name}?token=${RTMP_TOKEN}` : name;
}

// ── Shared instruction blocks ─────────────────────────────────────────────────

function stepsEN(key) {
  return `🔑 <b>YOUR STREAM KEY (keep this private):</b>
<code>${key}</code>

📡 <b>SERVER:</b>
<code>${RTMP_SERVER}</code>

━━━━━━━━━━━━━━━━━━━━
📋 <b>HOW TO SET UP OBS</b>
━━━━━━━━━━━━━━━━━━━━

<b>Step 1 — Open OBS Studio</b>
Download it free at obsproject.com if you haven't yet.

<b>Step 2 — Go to Settings → Stream</b>
In OBS: <i>File → Settings → Stream</i> (or the Settings button on the main screen).

<b>Step 3 — Choose "Custom" as the service</b>
In the <i>Service</i> dropdown, select <b>Custom...</b>

<b>Step 4 — Enter the server</b>
In the <i>Server</i> field paste:
<code>${RTMP_SERVER}</code>

<b>Step 5 — Enter your stream key</b>
In the <i>Stream Key</i> field paste your key (shown above). It's unique to you — don't share it.

<b>Step 6 — Click OK, then Start Streaming</b>
Hit <b>OK</b> to save Settings, then click <b>Start Streaming</b> on the main OBS screen.

✅ <b>You're live!</b> Your stream will appear on PNPtv within a few seconds.

━━━━━━━━━━━━━━━━━━━━

Need help? Your full setup guide and stream stats are at:
🔗 ${URL_STUDIO}`;
}

function stepsES(key) {
  return `🔑 <b>TU STREAM KEY (mantenla privada):</b>
<code>${key}</code>

📡 <b>SERVIDOR:</b>
<code>${RTMP_SERVER}</code>

━━━━━━━━━━━━━━━━━━━━
📋 <b>CÓMO CONFIGURAR OBS</b>
━━━━━━━━━━━━━━━━━━━━

<b>Paso 1 — Abre OBS Studio</b>
Descárgalo gratis en obsproject.com si aún no lo tienes.

<b>Paso 2 — Ve a Ajustes → Emisión</b>
En OBS: <i>Archivo → Ajustes → Emisión</i> (o el botón Ajustes en la pantalla principal).

<b>Paso 3 — Elige "Personalizado" como servicio</b>
En el menú desplegable <i>Servicio</i>, selecciona <b>Personalizado...</b>

<b>Paso 4 — Ingresa el servidor</b>
En el campo <i>Servidor</i> pega:
<code>${RTMP_SERVER}</code>

<b>Paso 5 — Ingresa tu stream key</b>
En el campo <i>Clave de retransmisión</i> pega tu clave (mostrada arriba). Es única para ti — no la compartas.

<b>Paso 6 — Haz clic en Aceptar, luego en Iniciar emisión</b>
Haz clic en <b>Aceptar</b> para guardar los ajustes y luego presiona <b>Iniciar emisión</b> en la pantalla principal de OBS.

✅ <b>¡Estás en vivo!</b> Tu stream aparecerá en PNPtv en unos segundos.

━━━━━━━━━━━━━━━━━━━━

¿Necesitas ayuda? Tu guía completa y estadísticas de stream están en:
🔗 ${URL_STUDIO}`;
}

// ── Per-creator unique openers keyed by Telegram ID ──────────────────────────

const OPENERS = {
  // EN
  '1966945732': `🎬 <b>11Minutes — here are your Go Live credentials.</b>\n\nYou're set up and ready to broadcast. Below is everything you need to connect OBS to your PNPtv channel and go live right now.\n\n`,
  '5598791888': `🎬 <b>A — your PNPtv stream credentials are ready.</b>\n\nYour Go Live channel is provisioned and waiting. Here's your stream key and step-by-step OBS setup:\n\n`,
  '6341493008': `🎬 <b>Alpha — your Go Live channel is live and these are your keys.</b>\n\nEverything's provisioned on our end. Connect OBS with the credentials below and you'll be streaming on PNPtv in under 2 minutes.\n\n`,
  '5060931278': `🎬 <b>Avery — your personal stream key is ready. Here's how to go live.</b>\n\nYour PNPtv channel is set up and waiting for your first stream. Use the credentials below to connect OBS.\n\n`,
  '5374511130': `🎬 <b>BS — your Go Live credentials. Set up OBS and let's get you streaming.</b>\n\nYour channel is provisioned on the platform. Plug the details below into OBS and you're good to go.\n\n`,
  '5935084902': `🎬 <b>Carlos — your stream key and server. Go live when you're ready.</b>\n\nYour creator channel is active. These are the OBS credentials — server and stream key — to start broadcasting on PNPtv.\n\n`,
  '8553652686': `🎬 <b>CheekyBoy — here are your personal stream credentials.</b>\n\nYour Go Live channel is fully configured. Follow the steps below to connect OBS and start your first PNPtv stream.\n\n`,
  '8039520242': `🎬 <b>Clay — your stream key is below. Let's get you live.</b>\n\nYour PNPtv broadcast channel is ready. Plug these credentials into OBS and you'll be streaming within minutes.\n\n`,
  '5643392748': `🎬 <b>Cloud Computa — your personal RTMP credentials for PNPtv Go Live.</b>\n\nYour channel's been set up on our end. Here's everything you need to connect OBS and start streaming.\n\n`,
  '7166356500': `🎬 <b>D Chem Sub — Go Live credentials incoming. Time to get your stream running.</b>\n\nYour PNPtv channel is ready to receive your stream. Use the server and key below in OBS.\n\n`,
  '1071160931': `🎬 <b>Fedorius — your stream key and setup guide. Go live on PNPtv.</b>\n\nYour channel is provisioned and active. Follow these steps in OBS to start broadcasting:\n\n`,
  '5334575044': `🎬 <b>Here2see — here are your credentials so PNPtv can see you live.</b>\n\nYour Go Live channel is set up and ready. Plug the details below into OBS and hit start.\n\n`,
  '5951629484': `🎬 <b>J — your PNPtv stream key and OBS setup. Short and straight to the point.</b>\n\nYour channel is ready. Server and stream key are below — follow the steps and you're live.\n\n`,
  '8192241178': `🎬 <b>LAtinobb43 — your personal stream credentials for PNPtv Go Live.</b>\n\nYour broadcast channel is provisioned and active. Here's how to connect OBS and start streaming:\n\n`,
  '7205636669': `🎬 <b>Leon — VancityAladdin is about to go live on PNPtv. Here are your credentials.</b>\n\nYour channel is configured and waiting. Use the details below to connect OBS and start broadcasting.\n\n`,
  '7879412085': `🎬 <b>Mac — your Go Live keys are ready. Here's how to connect OBS.</b>\n\nYour PNPtv channel is provisioned and waiting for your first broadcast. Follow the steps below:\n\n`,
  '8173329279': `🎬 <b>Miguel — your personal stream key and server URL for PNPtv.</b>\n\nYour Go Live channel is set up and active. Use these credentials in OBS to start your stream:\n\n`,
  '6044736811': `🎬 <b>Minh — your PNPtv stream credentials and setup guide.</b>\n\nYour channel is ready to receive your stream. Follow these steps to connect OBS and go live:\n\n`,
  '7226864388': `🎬 <b>Naravudh — your Go Live credentials for PNPtv. Ready when you are.</b>\n\nYour stream channel is fully configured. Use the server and key below to connect OBS and start broadcasting:\n\n`,
  '7926587506': `🎬 <b>Nocturnal — time to light up the night on PNPtv. Here are your credentials.</b>\n\nYour channel is provisioned and ready. Connect OBS with the details below and go live:\n\n`,
  '1215151270': `🎬 <b>PERVDF — your personal stream key for PNPtv Go Live is below.</b>\n\nYour channel is set up on our end. Plug the credentials into OBS and you'll be live in minutes:\n\n`,
  '7250101394': `🎬 <b>Rickie — your stream key and server are ready. Let's get this going.</b>\n\nYour PNPtv Go Live channel is provisioned and waiting. Follow the OBS steps below to start:\n\n`,
  '7742875708': `🎬 <b>S — your PNPtv credentials. Ready to go live whenever you are.</b>\n\nYour broadcast channel is fully configured. Here's your stream key and step-by-step OBS setup:\n\n`,
  '8312901004': `🎬 <b>S F — your personal RTMP credentials for PNPtv Go Live.</b>\n\nYour channel is set up and active. Use the server and key below in OBS to start streaming:\n\n`,
  '7581552455': `🎬 <b>Sexy one — your Go Live credentials are here. Time to put on a show.</b>\n\nYour PNPtv channel is provisioned and ready. Follow the steps to connect OBS and go live:\n\n`,
  '6385726840': `🎬 <b>SpunQueeR — your stream key for PNPtv. NJ is about to go live.</b>\n\nYour channel is configured and waiting. Plug the credentials below into OBS and hit Start Streaming:\n\n`,
  '8666563080': `🎬 <b>SrFalconPR — your personal PNPtv stream credentials. Puerto Rico, let's go.</b>\n\nYour Go Live channel is set up on our end. Here's your stream key and OBS setup guide:\n\n`,
  '661173078':  `🎬 <b>The Jurong — your PNPtv stream credentials. Ready to broadcast.</b>\n\nYour channel is provisioned and active. Follow the steps below to connect OBS and go live:\n\n`,
  // ES
  '8668655116': `🎬 <b>Juansito — aquí están tus credenciales para salir en vivo en PNPtv.</b>\n\nTu canal de transmisión ya está configurado. Usa el servidor y la clave que ves abajo en OBS y ya puedes empezar:\n\n`,
  '7489239467': `🎬 <b>Ern — tus credenciales de Go Live están listas. A darle.</b>\n\nTu canal en PNPtv está configurado y esperando tu primera transmisión. Aquí está todo lo que necesitas para conectar OBS:\n\n`,
  '7454293437': `🎬 <b>Franciscano — aquí tienes tu clave de stream y guía paso a paso para OBS.</b>\n\nTu canal de PNPtv ya está activo. Sigue los pasos de abajo para conectar OBS y salir en vivo:\n\n`,
  '5994313923': `🎬 <b>Gabo BB — tus credenciales personales de Go Live en PNPtv.</b>\n\nTu canal ya está configurado en nuestra plataforma. Usa el servidor y la clave de abajo en OBS para empezar a transmitir:\n\n`,
  '1002190052': `🎬 <b>Jacks — aquí están tus claves de stream. Sigue los pasos y entra en vivo.</b>\n\nTu canal de transmisión está listo y esperándote. Conecta OBS con las credenciales de abajo y estarás en vivo en minutos:\n\n`,
  '8853192145': `🎬 <b>Jhon — tus credenciales de Go Live en PNPtv. Todo está listo de nuestro lado.</b>\n\nTu canal está configurado y activo. Usa el servidor y la clave de abajo en OBS para empezar tu primera transmisión:\n\n`,
  '7246621722': `🎬 <b>Lex — aquí están tus claves personales para transmitir en PNPtv.</b>\n\nTu canal de Go Live ya está aprovisionado. Sigue la guía de OBS de abajo y en unos minutos estás en vivo:\n\n`,
  '7894585080': `🎬 <b>Maikel — tus credenciales de stream para PNPtv. ¡A transmitir!</b>\n\nTu canal está configurado y listo. Copia el servidor y la clave de abajo en OBS y dale Start Streaming:\n\n`,
  '6158016962': `🎬 <b>Milo — aquí tienes tus credenciales personales de Go Live en PNPtv.</b>\n\nTu canal está activo en la plataforma. Sigue estos pasos en OBS para conectarte y salir en vivo:\n\n`,
  '8114296685': `🎬 <b>Oz — tus claves de stream para PNPtv desde NYC. Vamos.</b>\n\nTu canal está configurado y esperando. Aquí está tu stream key y la guía paso a paso para OBS:\n\n`,
  '721644409':  `🎬 <b>Saggitterna — aquí están tus credenciales de Go Live. Todo tuyo.</b>\n\nTu canal en PNPtv ya está listo. Usa el servidor y la clave de abajo en OBS para iniciar tu primera transmisión:\n\n`,
  '8599671840': `🎬 <b>Santino — tus credenciales personales de stream para PNPtv. A darle caña.</b>\n\nTu canal de transmisión está configurado y listo desde nuestro lado. Sigue los pasos en OBS y estarás en vivo en minutos:\n\n`,
  '5867063315': `🎬 <b>Hey — aquí tienes tu clave de stream y los pasos para configurar OBS en PNPtv.</b>\n\nTu canal ya está activo en la plataforma. Sigue la guía de abajo para conectarte y empezar a transmitir:\n\n`,
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' Go Live Credentials Broadcast — July 2026');
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

  // Warn about any creator with no custom opener
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
    console.log('\n── Sample messages (first 3) ──\n');
    for (const u of targets.slice(0, 3)) {
      const opener = OPENERS[String(u.telegram)] || `🎬 <b>${u.first_name} — your PNPtv stream credentials.</b>\n\n`;
      const isEs = u.language === 'es';
      const key = streamKey(u.live_channel);
      const msg = opener + (isEs ? stepsES(key) : stepsEN(key));
      console.log(`--- ${u.first_name || u.username} (${u.telegram}) ---`);
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
    const opener = OPENERS[String(u.telegram)] || `🎬 <b>${u.first_name} — your PNPtv stream credentials.</b>\n\n`;
    const isEs = u.language === 'es';
    const key = streamKey(u.live_channel);
    const msg = opener + (isEs ? stepsES(key) : stepsEN(key));

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

    // Record for dedup — non-fatal
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
        '🎬 Your PNPtv stream key and OBS setup guide — everything you need to go live.',
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
