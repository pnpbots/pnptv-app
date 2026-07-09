#!/usr/bin/env node
'use strict';

/**
 * broadcast-golive-stress-test.js
 *
 * Sends a personal DM to every creator with Go Live (live_channel) enabled,
 * asking them to fire up OBS and go live so we can monitor platform performance
 * under real load. Each creator gets a unique, individually-written message.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-golive-stress-test.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-golive-stress-test.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-golive-stress-test.js --force
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }    = require(path.join(BACKEND, 'config/postgres'));
const { Telegram } = require('telegraf');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');

const ENTITY_ID   = 'golive-stress-test-2026-07';
const URL_STUDIO  = 'https://pnptv.app/studio/stream';
const TG_DELAY_MS = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Per-creator unique messages keyed by Telegram ID ─────────────────────────
// 10 creators have no Telegram ID and are excluded at query time.

const MESSAGES = {

  // ── EN ──────────────────────────────────────────────────────────────────────

  // 11Minutes
  '1966945732': `🔴 <b>Go Live stress test — we need you, 11Minutes.</b>

PNP Live is working. We've fixed the pipeline, tuned the HLS delivery, and now we need real streams hitting it at the same time to confirm everything holds under load.

Your stream key is sitting in your Studio waiting: <b>pnptv.app/studio/stream</b>

Fire up OBS, connect, and go live — even 10 minutes is super helpful. We're watching the server in real time while you stream.

No pressure on content — just run it. Thanks for being part of this. 🙌`,

  // A (a_stxen)
  '5598791888': `🚀 <b>Hey A — we're doing a live load test and want you in it.</b>

The Go Live feature is officially production-ready. What we need now is real simultaneous streams to make sure everything scales.

You're one of the creators with it enabled. Head to <b>pnptv.app/studio/stream</b>, grab your stream key, connect OBS, and start a test stream whenever you can today.

Even a short session counts. We're monitoring everything live. 🎯`,

  // Alpha
  '6341493008': `🎬 <b>Alpha — final Go Live stress test. We want you on it.</b>

We've rebuilt the streaming pipeline from the ground up — RTMP ingest, HLS output, adaptive bitrate, the works. Everything's tested in isolation. Now we need real creators streaming simultaneously.

Your slot is live at <b>pnptv.app/studio/stream</b> — OBS → stream key → go. That's it.

We'll be watching bandwidth, latency, and viewer delivery the whole time you're on. Let's see what this thing can do. 💪`,

  // Avery
  '5060931278': `📡 <b>Avery — we're load testing Go Live today and you're on the list.</b>

The feature is ready. Bitrate detection, live viewer counts, the HLS player — all working. What we haven't stress-tested yet is multiple creators streaming at the same time.

That's where you come in. Pop into <b>pnptv.app/studio/stream</b>, get your OBS connected, and go live for a bit. We'll handle the monitoring side.

No specific content needed — just a live stream. We appreciate it. 🙏`,

  // BS (bg → EN)
  '5374511130': `🔴 <b>BS — quick ask: can you go live today for a test?</b>

Go Live is production-ready. We're doing a final stress test with as many creators streaming simultaneously as possible to verify the infrastructure holds.

Your channel is already configured. Just open <b>pnptv.app/studio/stream</b> in your browser, copy your stream key into OBS, and hit go. Even 5–10 minutes helps a lot.

We'll be watching the server metrics in real time. Thanks for helping us nail this. 🤝`,

  // Carlos
  '5935084902': `🎥 <b>Carlos — stress test time. Fire up OBS.</b>

The pipeline is clean: RTMP ingest verified, HLS segments delivering, ABR working. Last thing we need is real simultaneous load.

You know where your stream key is — <b>pnptv.app/studio/stream</b>. OBS, connect, start streaming. We're watching server response live.

This is the final gate before we open it to all creators. Let's close it out. 🚀`,

  // CheekyBoy
  '8553652686': `😏 <b>CheekyBoy — we need you live today for a platform stress test.</b>

PNP Live is ready to roll. We've been testing the tech side all week — now we need actual creators broadcasting at the same time to make sure the servers handle real concurrent load.

Your stream is configured and waiting. Hit <b>pnptv.app/studio/stream</b>, copy your key into OBS, and go live. Stay as long as you want — longer is better for the test.

We're watching everything in real time. Appreciate you being part of this. 🙌`,

  // Clay
  '8039520242': `📺 <b>Clay — Go Live stress test today. We want you on it.</b>

All the technical pieces are in place: your RTMP channel is provisioned, the HLS player works, viewer counts update in real time. What we need now is concurrent streams.

Your details are at <b>pnptv.app/studio/stream</b> — hook up OBS, stream for a bit, and let us watch the infrastructure perform.

No elaborate setup needed. Just stream something and we'll monitor the backend live. Thanks Clay. 🎯`,

  // Cloud Computa (ferbearcdmx)
  '5643392748': `☁️ <b>Cloud Computa — time to actually stress the cloud. Go live today?</b>

PNP Live is fully operational. We've sorted the latency, fixed segment delivery, and the player is adaptive. What's left is a real-world concurrent load test.

Your stream channel is active — check <b>pnptv.app/studio/stream</b> for your key, plug into OBS, and broadcast. We'll be monitoring server CPU, memory, and delivery metrics in real time while you're on.

It'd mean a lot to have you in this test. 🙌`,

  // D Chem Sub
  '7166356500': `⚗️ <b>D Chem Sub — we're running a Go Live stress test and want you in it.</b>

The streaming infrastructure is production-ready. Adaptive bitrate, 1-second HLS segments, live viewer counts — everything's been built and verified in testing.

Now we need the real thing: multiple creators streaming at once. Your channel's been provisioned. Open <b>pnptv.app/studio/stream</b>, grab your stream key, connect OBS, and go.

We're watching the platform the whole time. Even 10 minutes of real stream data is invaluable. Thank you. 🙏`,

  // Fedorius
  '1071160931': `🎮 <b>Fedorius — can you go live today? We're stress testing the platform.</b>

Go Live is fully live (no pun intended). The pipeline handles RTMP → HLS → adaptive delivery → live viewer counts. We've tested each piece. Now we need real concurrent streams.

Your stream key lives at <b>pnptv.app/studio/stream</b>. OBS setup takes 2 minutes if you've done it before. Just start streaming — content doesn't matter for this test.

We'll be watching all the infrastructure metrics while you're on. Respect for helping us get this right. ✊`,

  // Here2see
  '5334575044': `👀 <b>Here2see — we want to see you live today. Stress test time.</b>

PNP Live is ready. We need real creators streaming simultaneously to validate the infrastructure holds under actual concurrent load — not just synthetic tests.

Your channel's already set up on the backend. Head to <b>pnptv.app/studio/stream</b> to get your stream key, connect OBS, and go live whenever works for you today.

We'll have eyes on the server metrics the whole time you're streaming. Thank you for being part of this. 🙏`,

  // J (kobton1)
  '5951629484': `📡 <b>J — quick one: can you go live today for a platform stress test?</b>

The Go Live feature is done and working. We just need real simultaneous streams hitting the platform to confirm it scales.

Your stream key is at <b>pnptv.app/studio/stream</b>. OBS → connect → go. That's all we're asking. Even a short stream helps us gather the metrics we need.

We're monitoring server performance live while creators are streaming. Thanks for being in the mix. 💪`,

  // LAtinobb43
  '8192241178': `🔥 <b>LAtinobb43 — Go Live stress test. We need you on today.</b>

Everything's been built and tested — RTMP ingest, HLS output, adaptive bitrate streaming. The final piece is real concurrent load from actual creators.

Your channel is provisioned and ready. Visit <b>pnptv.app/studio/stream</b>, get your stream key, fire up OBS, and go live. We'll take it from there monitoring the platform in real time.

Can't do this without real creators. Appreciate you stepping up. 🙌`,

  // Leon VancityAladdin
  '7205636669': `🦁 <b>Leon — final live test before we open Go Live to everyone. You in?</b>

PNP Live is production-ready. What we need now is a coordinated stress test — multiple creators streaming simultaneously — to validate the infrastructure under real load.

Your stream key is in Studio: <b>pnptv.app/studio/stream</b>. OBS, plug in the key, start streaming. We're watching CPU, bandwidth, and HLS delivery the entire time.

This is the last gate before we roll it out fully. Your stream matters. 🙏`,

  // Mac
  '7879412085': `🎙️ <b>Mac — we're running a Go Live stress test today and want you in it.</b>

The feature's ready. RTMP pipeline working, HLS player delivering, viewer counts live. Last box to check: real simultaneous streams.

You're set up and enabled. Swing by <b>pnptv.app/studio/stream</b>, copy your stream key into OBS, and go live for a bit. We're watching the metrics in real time.

No complicated content needed — just your stream live on the platform. Thanks Mac. 🤝`,

  // Miguel
  '8173329279': `🎬 <b>Miguel — platform stress test. Can you go live today?</b>

Go Live is fully operational. We've spent the week hardening the RTMP → HLS pipeline and now it's time to put it through its paces with real creators streaming at the same time.

Your stream is configured — details at <b>pnptv.app/studio/stream</b>. OBS + your stream key + go live. We'll be watching server performance on our end while you stream.

Real appreciate you helping us nail this before the full rollout. 💪`,

  // Minh (vi → EN)
  '6044736811': `📡 <b>Minh — we're doing a Go Live stress test today. Hope you can join.</b>

PNP Live is ready to go. The streaming infrastructure is built and tested — now we need real creators going live at the same time to verify it handles concurrent load.

Your stream key is at <b>pnptv.app/studio/stream</b>. If you have OBS, connect it and go live for a bit. We'll be watching the platform performance in real time.

Every stream helps us see how the system performs. Thank you! 🙏`,

  // Naravudh (th → EN)
  '7226864388': `🌟 <b>Naravudh — Go Live stress test today. We'd love to have you stream.</b>

The live streaming feature is production-ready. We're asking creators to go live simultaneously so we can monitor how the platform handles real concurrent load.

Your channel is set up. Visit <b>pnptv.app/studio/stream</b> for your stream key, connect OBS, and go live. Even a short session is incredibly helpful for our testing.

We appreciate you being part of the PNP Live launch. Thank you! 🙌`,

  // Nocturnal
  '7926587506': `🌙 <b>Nocturnal — night shift is over, time to go live. Stress test today.</b>

PNP Live is up and running. We've ironed out the streaming pipeline and now need real concurrent streams to confirm the infrastructure scales under actual load.

Your channel's provisioned. Head to <b>pnptv.app/studio/stream</b>, grab the stream key, plug it into OBS, and stream for a bit. We'll be watching server metrics in real time.

Can't properly stress test without real creators. Thanks for being in this. 🙏`,

  // PERVDF
  '1215151270': `🔴 <b>PERVDF — we're stress testing Go Live today. You're on the list.</b>

The platform's live streaming feature is production-ready. We've tested it in isolation but need real simultaneous streams to validate the infrastructure at scale.

Your stream is configured and enabled. Check <b>pnptv.app/studio/stream</b> for your stream key, fire up OBS, and go live. We're monitoring everything on our end in real time.

The more creators who stream simultaneously, the better our test data. Appreciate you. 🤝`,

  // Rickie
  '7250101394': `🎯 <b>Rickie — Go Live is ready. We need a stress test and you're in.</b>

We've built the full streaming pipeline: RTMP ingest, HLS adaptive output, live viewer counts, all of it. Tested it in isolation. Now we need real concurrent traffic.

Your stream key is waiting at <b>pnptv.app/studio/stream</b>. OBS + key + go. We'll monitor platform performance while you stream.

You've been enabled from the start — now let's see what the platform does with real load. Let's go Rickie. 🚀`,

  // S (professor395)
  '7742875708': `📊 <b>S — we're running a real-time platform load test. Can you go live?</b>

PNP Live is fully operational. The infrastructure's been hardened — RTMP → HLS → adaptive delivery → viewer counts. What we haven't tested is real simultaneous streams.

Your setup is ready at <b>pnptv.app/studio/stream</b>. OBS, stream key, go. We'll be watching CPU load, stream latency, and HLS segment delivery in real time.

This is the data we need before full rollout. Your stream is part of it. Thank you. 🙏`,

  // S F (sfo2u)
  '8312901004': `🌊 <b>S F — stress test day. We need Go Live creators online simultaneously.</b>

The feature is ready. We've verified RTMP, HLS, adaptive bitrate, viewer counts — everything works in testing. What's left is real-world concurrent load.

Your channel is configured. Open <b>pnptv.app/studio/stream</b>, copy your stream key into OBS, and go live for however long you can today. We're watching platform metrics the whole time.

Your stream directly helps us validate the rollout is safe. Appreciate it. 💙`,

  // Sexy one (rextonyton)
  '7581552455': `💫 <b>Sexy one — PNP Live is ready and we're doing a final stress test today.</b>

The streaming pipeline is fully operational: RTMP ingest, HLS delivery, adaptive bitrate, live viewer counts. Everything's working. Now we need real simultaneous streams.

Your channel's been set up since you were enabled. Head to <b>pnptv.app/studio/stream</b>, get your stream key, connect OBS, and go live. We're monitoring in real time.

The more creators live simultaneously, the better our test. Thank you for being part of this launch. 🚀`,

  // SpunQueeR
  '6385726840': `⚡ <b>SpunQueeR — we're stress testing Go Live right now. You in?</b>

PNP Live is production-ready. The tech is built and tested. What we need today is real creators streaming at the same time so we can see how the platform handles concurrent load.

Your stream is enabled and configured. Grab your key at <b>pnptv.app/studio/stream</b>, load it into OBS, and go live. Doesn't matter how long — even 10 minutes gives us useful data.

We'll be watching the infrastructure the whole time you're on. Thank you, SpunQueeR. 🙌`,

  // SrFalconPR
  '8666563080': `🦅 <b>SrFalconPR — Go Live stress test. We need you streaming today.</b>

The platform's live streaming feature is fully built and operational. Final step before full rollout: real concurrent streams from actual creators.

Your channel's been provisioned since you were enabled. Visit <b>pnptv.app/studio/stream</b>, copy the stream key into OBS, and go live. We're monitoring server performance in real time.

Puerto Rico in the mix would make this test even better. 🇵🇷 Appreciate you stepping up.`,

  // The Jurong
  '661173078': `🦦 <b>The Jurong — PNP Live stress test. We want you streaming today.</b>

The live feature is production-ready. We've built, tested, and fixed the RTMP → HLS pipeline. Now we need real creators going live simultaneously to validate it handles the load.

Your channel is configured. Head to <b>pnptv.app/studio/stream</b> for your stream key, connect OBS, and go live for a bit. We'll be watching the whole time.

Every concurrent stream helps us see what the platform can handle before full launch. Thanks, Jurong. 🙏`,

  // ── ES ──────────────────────────────────────────────────────────────────────

  // @juansito311
  '8668655116': `🔴 <b>Hey Juansito — prueba de estrés de Go Live hoy. Te necesitamos online.</b>

PNP Live está listo. Hemos arreglado todo el pipeline — RTMP, HLS, bitrate adaptativo, conteos de espectadores en tiempo real. Lo que nos falta es probarlo con creadores reales transmitiendo al mismo tiempo.

Tu canal ya está configurado. Entra a <b>pnptv.app/studio/stream</b>, copia tu stream key en OBS y empieza a transmitir. Estaremos monitoreando el servidor en tiempo real mientras estás en vivo.

Cualquier rato que puedas hoy nos sirve muchísimo. Gracias Juansi. 🙌`,

  // ErnMadrid🐒
  '7489239467': `🐒 <b>Ern — prueba de carga de Go Live hoy. ¿Puedes salir en vivo?</b>

La función está lista para producción. Hemos construido todo desde cero — ingesta RTMP, entrega HLS adaptativa, conteos de espectadores, todo funciona. Lo que nos falta: carga real simultánea.

Tu stream está activo. Pásate por <b>pnptv.app/studio/stream</b>, agarra tu stream key, conéctala en OBS y sal en vivo un rato. Estaremos mirando las métricas del servidor mientras transmites.

Madrid en el test sería un lujo. 🇪🇸 Te lo agradecemos Ern.`,

  // Franciscano
  '7454293437': `✝️ <b>Franciscano — necesitamos que salgas en vivo hoy para la prueba final.</b>

PNP Live está operativo. Todo el pipeline técnico está construido y probado por separado. Lo que necesitamos ahora es que varios creadores transmitan al mismo tiempo para ver cómo responde la plataforma bajo carga real.

Tu canal está habilitado y listo. Entra a <b>pnptv.app/studio/stream</b>, copia el stream key en OBS y empieza a transmitir. No importa el contenido — solo necesitamos el stream activo.

Estaremos viendo todo en tiempo real. Gracias por estar en esto. 🙏`,

  // Gabo BB
  '5994313923': `🎸 <b>Gabo — prueba de estrés de Go Live. Te necesitamos en vivo hoy.</b>

PNP Live ya funciona. Hemos ajustado la entrega de segmentos HLS, arreglado el pipeline y validado bitrate adaptativo. Lo que nos falta es carga real: creadores transmitiendo al mismo tiempo.

Tu canal ya tiene todo configurado. Entra a <b>pnptv.app/studio/stream</b>, copia tu stream key en OBS y dale. Cuanto más tiempo puedas estar en vivo, mejor para el test.

Estaremos monitoreando CPU, latencia y entrega HLS mientras transmites. Gracias Gabo BB. 🤝`,

  // Jacks
  '1002190052': `🃏 <b>Jacks — Go Live está listo y necesitamos una prueba real. ¿Entras?</b>

Hemos construido y probado todo el pipeline de streaming: RTMP → HLS → bitrate adaptativo → conteos en vivo. Funciona en aislamiento. Lo que nos falta es carga concurrente real.

Tu canal está configurado desde que te habilitamos. Pásate por <b>pnptv.app/studio/stream</b>, agarra tu stream key, conecta OBS y empieza a transmitir cuando puedas hoy.

Estaremos mirando las métricas del servidor en tiempo real. Cualquier rato ayuda. Gracias Jacks. 🙌`,

  // Jhon
  '8853192145': `📡 <b>Jhon — prueba de plataforma en tiempo real. Necesitamos que transmitas hoy.</b>

PNP Live está operativo. El pipeline RTMP → HLS está funcionando, el bitrate adaptativo está activo, los conteos de espectadores se actualizan en tiempo real. Lo que no hemos probado aún: múltiples creadores en vivo simultáneamente.

Tu canal está listo. Entra a <b>pnptv.app/studio/stream</b>, copia tu clave de stream en OBS y sal en vivo. Estaremos monitoreando todo mientras transmites.

Tu transmisión cuenta para el test. Te lo agradecemos Jhon. 🙏`,

  // Lex (pnplatinoboy)
  '7246621722': `🌟 <b>Lex — prueba de estrés Go Live. Necesitamos creadores en vivo hoy.</b>

La función de transmisión en vivo está lista para producción. Hemos validado cada parte del sistema — ahora necesitamos la prueba final: varios creadores transmitiendo al mismo tiempo.

Tu stream ya está configurado en el backend. Pásate por <b>pnptv.app/studio/stream</b>, copia el stream key en OBS y transmite lo que quieras. Estaremos mirando el rendimiento del servidor en tiempo real.

El Latino boy en el mix haría esta prueba aún mejor 😄 Gracias Lex. 🙌`,

  // Maikel
  '7894585080': `🎤 <b>Maikel — prueba de Go Live hoy. ¿Puedes salir en vivo un rato?</b>

PNP Live está construido y funcionando. Necesitamos la prueba final antes del lanzamiento completo: varios creadores transmitiendo en simultáneo para ver cómo aguanta la infraestructura.

Tu canal está habilitado y listo. Entra a <b>pnptv.app/studio/stream</b>, copia tu stream key en OBS y empieza a transmitir. Cualquier rato que puedas hoy es de mucha ayuda.

Estaremos monitoreando el servidor en tiempo real mientras transmites. Te lo agradecemos Maikel. 💪`,

  // Milo
  '6158016962': `🌊 <b>Milo — prueba de carga de Go Live. Queremos verte en vivo hoy.</b>

PNP Live está operativo. El pipeline completo — RTMP, HLS, bitrate adaptativo — está construido y validado. Lo que nos falta es carga real de creadores transmitiendo al mismo tiempo.

Tu canal ya está configurado desde que te habilitamos. Entra a <b>pnptv.app/studio/stream</b>, agarra tu stream key, conéctala en OBS y sal en vivo. Estaremos viendo las métricas del servidor mientras estás en vivo.

Milo en el test es todo para nosotros. Gracias. 🙌`,

  // Oz (oznycpnp)
  '8114296685': `🗽 <b>Oz — Go Live está listo. Necesitamos tu stream para la prueba final.</b>

Hemos pasado la semana afinando el pipeline de streaming. RTMP → HLS → bitrate adaptativo → conteos en vivo, todo funcionando. La última prueba: carga concurrente real.

Tu canal está configurado y activo. Pásate por <b>pnptv.app/studio/stream</b>, copia tu stream key en OBS y transmite. No importa el contenido — necesitamos el stream activo para monitorear el servidor.

NYC en el test sería ideal 🗽 Gracias Oz. 💙`,

  // Saggitterna
  '721644409': `🏹 <b>Saggitterna — prueba de estrés Go Live hoy. Queremos tu stream.</b>

PNP Live ya está operativo. Hemos arreglado el pipeline, optimizado la entrega HLS y validado el sistema completo. Lo que falta es la prueba real: creadores transmitiendo en simultáneo.

Tu canal está habilitado. Entra a <b>pnptv.app/studio/stream</b>, copia tu clave de stream en OBS y empieza a transmitir cuando puedas hoy. Estaremos monitoreando todo en tiempo real.

Tu participación hace que el test sea más valioso. Gracias Saggitterna. 🙏`,

  // Santino
  '8599671840': `✨ <b>Santino — prueba de Go Live hoy. Te necesitamos en vivo.</b>

PNP Live está listo para producción. El pipeline técnico está validado — ahora necesitamos la prueba final con creadores reales transmitiendo al mismo tiempo para verificar que la infraestructura aguanta la carga.

Tu canal ya está configurado desde que te habilitamos. Entra a <b>pnptv.app/studio/stream</b>, copia el stream key en OBS y sal en vivo. Estaremos mirando el servidor en tiempo real mientras transmites.

Santino en el stream sería el toque perfecto para esta prueba 😊 Gracias. 🙌`,

  // TeIegerm
  '5867063315': `📺 <b>Hey — prueba de plataforma en vivo hoy. ¿Puedes transmitir un rato?</b>

PNP Live está completamente operativo. Hemos construido y probado todo el pipeline de streaming. Lo que nos falta es ver cómo responde la plataforma con creadores reales transmitiendo en simultáneo.

Tu canal está listo y configurado. Entra a <b>pnptv.app/studio/stream</b>, agarra tu stream key, conéctala en OBS y transmite. Cualquier duración ayuda para el test.

Estaremos monitoreando el rendimiento del servidor mientras estés en vivo. Te lo agradecemos. 🙏`,
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' Go Live Stress Test Broadcast — July 2026');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN) console.log(' MODE: DRY RUN — nothing will be sent\n');

  // Only target creators who have Go Live enabled AND have a Telegram ID
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
  console.log(`\n   Creators in custom message map: ${Object.keys(MESSAGES).length}`);

  // Show any creators NOT in the messages map
  const unmapped = targets.filter(u => !MESSAGES[String(u.telegram)]);
  if (unmapped.length) {
    console.log(`\n   ⚠️  No custom message for:`);
    unmapped.forEach(u => console.log(`      - ${u.first_name || u.username} (TG: ${u.telegram})`));
  }

  if (DRY_RUN) {
    console.log('\n── Sample messages ──\n');
    for (const u of targets.slice(0, 3)) {
      const msg = MESSAGES[String(u.telegram)];
      if (msg) {
        console.log(`--- ${u.first_name || u.username} (${u.telegram}) ---`);
        console.log(msg);
        console.log();
      }
    }
    console.log('═══════════════════════════════════════════════════');
    console.log(' DRY RUN COMPLETE — nothing sent');
    console.log('═══════════════════════════════════════════════════\n');
    process.exit(0);
  }

  if (unmapped.length) {
    console.error(`\nABORTED: ${unmapped.length} creator(s) have no custom message. Add them to MESSAGES before sending.`);
    process.exit(1);
  }

  const tg = new Telegram(process.env.BOT_TOKEN);
  let sent = 0, failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const u = targets[i];
    const msg = MESSAGES[String(u.telegram)];

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

    // Record for dedup — non-fatal if this fails
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
        '🔴 Go Live stress test — connect OBS and stream today so we can monitor the platform in real time.',
        JSON.stringify({ studioUrl: URL_STUDIO, liveChannel: u.live_channel }),
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
