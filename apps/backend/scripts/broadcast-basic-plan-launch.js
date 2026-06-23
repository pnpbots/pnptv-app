#!/usr/bin/env node
'use strict';

/**
 * broadcast-basic-plan-launch.js
 *
 * Announce the PNP Stans Basic Plan ($9.99/mo), explain the difference
 * vs PRIME, and tease upcoming live streaming + new content drops.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-basic-plan-launch.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-basic-plan-launch.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-basic-plan-launch.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-basic-plan-launch.js --skip-telegram
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }               = require(path.join(BACKEND, 'config/postgres'));
const PushNotificationService = require(path.join(BACKEND, 'services/pushNotificationService'));
const nodemailer              = require('nodemailer');
const { Telegram }            = require('telegraf');

const DRY_RUN       = process.argv.includes('--dry-run');
const SKIP_EMAIL    = process.argv.includes('--skip-email');
const SKIP_TELEGRAM = process.argv.includes('--skip-telegram');
const FORCE         = process.argv.includes('--force');

const ENTITY_ID          = 'basic-plan-launch-june-2026';
const APP_URL            = 'https://pnptv.app';
const SUBSCRIBE_URL      = 'https://pnptv.app/subscribe';
const TG_DELAY_MS        = 80;
const EMAIL_RATE_PER_SEC = 0.25; // 1 email per 4s — stays under Hostinger bulk limits

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `🆕 PNPtv! now has a Basic Plan at $9.99/mo — social, streams, radio & more. PRIME unlocks exclusive content. Live streaming coming soon!`,
  es: `🆕 PNPtv! ahora tiene un Plan Básico a $9.99/mes — social, streams, radio y más. PRIME desbloquea contenido exclusivo. ¡Streaming en vivo muy pronto!`,
};

const PUSH = {
  en: { title: '🆕 PNPtv! Basic Plan is here — $9.99/mo', body: 'Social, streams, radio & hangouts. Upgrade to PRIME for the exclusive channel. Live streaming coming soon!' },
  es: { title: '🆕 Plan Básico PNPtv! — $9.99/mes', body: 'Social, streams, radio y hangouts. Mejora a PRIME para el canal exclusivo. ¡Streaming en vivo próximamente!' },
};

const TG = {
  en: (name) =>
`🆕 <b>PNPtv! now has a Basic Plan — and big things are coming, ${name}.</b>

Here's the full picture:

<b>🟣 Basic Plan — $9.99 / month</b>
✅ Social feed, posts &amp; reactions
✅ DMs &amp; messaging
✅ Hangouts — free group video rooms
✅ PNP Live — watch streams for free
✅ PNP Radio — music &amp; audio
✅ Nearby — map, places &amp; people
➕ Exclusive channels &amp; creator profiles — available as add-ons
➕ Private 1-on-1 calls — available as add-ons

<b>⭐ PRIME — $24.99 / month</b>
Everything in Basic, plus:
🎬 PNPtv! PRIME channel — exclusive shows &amp; content drops

<b>🔜 Coming soon</b>
📡 Live streaming — broadcast yourself, not just watch
🎞️ More exclusive content from your favorite creators

Ready to join or upgrade? 👉 <a href="${SUBSCRIBE_URL}">${SUBSCRIBE_URL}</a>`,

  es: (name) =>
`🆕 <b>¡PNPtv! ya tiene Plan Básico — y vienen cosas grandes, ${name}.</b>

Aquí el resumen completo:

<b>🟣 Plan Básico — $9.99 / mes</b>
✅ Feed social, publicaciones y reacciones
✅ DMs y mensajería
✅ Hangouts — salas de video grupales gratis
✅ PNP Live — ve los streams gratis
✅ PNP Radio — música y audio
✅ Nearby — mapa, lugares y personas
➕ Canales exclusivos y perfiles de creadores — disponibles como complementos
➕ Llamadas privadas 1-a-1 — disponibles como complementos

<b>⭐ PRIME — $24.99 / mes</b>
Todo lo del Básico, más:
🎬 Canal PNPtv! PRIME — shows y contenido exclusivo

<b>🔜 Próximamente</b>
📡 Streaming en vivo — transmite tú mismo, no solo mira
🎞️ Más contenido exclusivo de tus creadores favoritos

¿Listo para unirte o mejorar tu plan? 👉 <a href="${SUBSCRIBE_URL}">${SUBSCRIBE_URL}</a>`,
};

const EMAIL_SUBJECT = {
  en: '🆕 PNPtv! Basic Plan — what\'s included, PRIME differences & what\'s coming',
  es: '🆕 Plan Básico PNPtv! — qué incluye, diferencias con PRIME y lo que viene',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${en ? 'PNPtv! Basic Plan — what\'s included' : 'PNPtv! Plan Básico — qué incluye'}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.10);">
        <tr><td style="height:4px;background:linear-gradient(90deg,#D4007A,#7B61FF);"></td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <img src="https://pnptv.app/logo-header.png" alt="PNPtv!" height="32" style="display:block;">
        </td></tr>
        <tr><td style="padding:16px 32px 32px;">

          <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${en ? `Hey ${name}!` : `¡Hola ${name}!`}</p>
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:900;color:#ffffff;line-height:1.2;">
            🆕 ${en ? 'PNPtv! now has a Basic Plan.' : '¡PNPtv! ya tiene Plan Básico.'}
          </h1>
          <p style="margin:0 0 28px;font-size:14px;color:#d1d5db;line-height:1.6;">
            ${en
              ? 'Here\'s the full breakdown — what each plan includes, how they differ, and what\'s coming next.'
              : 'Aquí el resumen completo — qué incluye cada plan, en qué se diferencian y qué viene próximamente.'}
          </p>

          <!-- Basic Plan -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
            <tr><td style="padding:20px;background:rgba(123,97,255,0.08);border:1px solid rgba(123,97,255,0.30);border-radius:14px;">
              <p style="margin:0 0 4px;font-size:11px;font-weight:800;letter-spacing:1px;color:#7B61FF;text-transform:uppercase;">${en ? 'New' : 'Nuevo'}</p>
              <p style="margin:0 0 14px;font-size:18px;font-weight:900;color:#ffffff;">🟣 ${en ? 'Basic Plan' : 'Plan Básico'} — <span style="color:#7B61FF;">$9.99 / ${en ? 'month' : 'mes'}</span></p>
              <table width="100%" cellpadding="0" cellspacing="0">
                ${[
                  en ? '✅ Social feed, posts &amp; reactions' : '✅ Feed social, publicaciones y reacciones',
                  en ? '✅ DMs &amp; messaging' : '✅ DMs y mensajería',
                  en ? '✅ Hangouts — free group video rooms' : '✅ Hangouts — salas de video grupales gratis',
                  en ? '✅ PNP Live — watch all streams for free' : '✅ PNP Live — mira todos los streams gratis',
                  en ? '✅ PNP Radio — music &amp; audio' : '✅ PNP Radio — música y audio',
                  en ? '✅ Nearby — map, places &amp; people' : '✅ Nearby — mapa, lugares y personas',
                  en ? '➕ Exclusive channels &amp; creator profiles — add-ons' : '➕ Canales exclusivos y perfiles de creadores — complementos',
                  en ? '➕ Private 1-on-1 calls — add-on' : '➕ Llamadas privadas 1-a-1 — complemento',
                ].map(item => `
                <tr><td style="padding:3px 0;font-size:14px;color:#d1d5db;line-height:1.6;">${item}</td></tr>`).join('')}
              </table>
            </td></tr>
          </table>

          <!-- PRIME Plan -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
            <tr><td style="padding:20px;background:rgba(212,0,122,0.08);border:1px solid rgba(212,0,122,0.30);border-radius:14px;">
              <p style="margin:0 0 14px;font-size:18px;font-weight:900;color:#ffffff;">⭐ PRIME — <span style="color:#D4007A;">$24.99 / ${en ? 'month' : 'mes'}</span></p>
              <p style="margin:0 0 10px;font-size:14px;color:#d1d5db;line-height:1.6;">
                ${en ? 'Everything in Basic, plus:' : 'Todo lo del Básico, más:'}
              </p>
              <p style="margin:0;font-size:14px;color:#ffffff;font-weight:700;">
                🎬 ${en ? 'PNPtv! PRIME channel — exclusive shows &amp; content drops, only for PRIME members.' : 'Canal PNPtv! PRIME — shows y drops de contenido exclusivos, solo para miembros PRIME.'}
              </p>
              <p style="margin:10px 0 0;font-size:13px;color:#9ca3af;">
                ${en ? 'Also available: PRIME Week Pass ($15), Diamond Pass ($99.99/yr), and Lifetime.' : 'También disponibles: Pase Semanal PRIME ($15), Pase Diamante ($99.99/año) y Vitalicio.'}
              </p>
            </td></tr>
          </table>

          <!-- Coming Soon -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="padding:20px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);border-radius:14px;">
              <p style="margin:0 0 12px;font-size:16px;font-weight:900;color:#ffffff;">🔜 ${en ? 'Coming soon' : 'Próximamente'}</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="padding:4px 0;font-size:14px;color:#d1d5db;line-height:1.6;">
                  📡 ${en ? '<b>Live streaming</b> — broadcast yourself, not just watch.' : '<b>Streaming en vivo</b> — transmite tú mismo, no solo mira.'}
                </td></tr>
                <tr><td style="padding:4px 0;font-size:14px;color:#d1d5db;line-height:1.6;">
                  🎞️ ${en ? '<b>More exclusive content</b> — new drops from your favorite creators.' : '<b>Más contenido exclusivo</b> — nuevos drops de tus creadores favoritos.'}
                </td></tr>
              </table>
            </td></tr>
          </table>

          <div style="text-align:center;margin-bottom:28px;">
            <a href="${SUBSCRIBE_URL}" style="display:inline-block;padding:14px 36px;background:linear-gradient(90deg,#D4007A,#7B61FF);color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;border-radius:12px;">
              ${en ? 'View Plans &amp; Subscribe →' : 'Ver planes y suscribirse →'}
            </a>
          </div>

          <p style="margin:0;font-size:13px;color:#6b7280;text-align:center;">
            ${en ? 'You received this as a member of PNPtv!.' : 'Recibiste esto por ser miembro de PNPtv!.'}
            🔒 pnptv.app
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' Basic Plan Launch Broadcast — June 2026');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN)       console.log(' MODE: DRY RUN — nothing will be sent\n');
  if (SKIP_EMAIL)    console.log(' --skip-email\n');
  if (SKIP_TELEGRAM) console.log(' --skip-telegram\n');

  const { rows: users } = await query(`
    SELECT u.id, u.first_name, u.username, u.email, u.telegram, u.language
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
  const withEmail    = users.filter(u => u.email && !u.email.includes('@telegram.pnptv.app') && isNew(u));

  console.log(`\n   Total users:      ${users.length}`);
  console.log(`   Already notified: ${alreadySent.size}`);
  console.log(`   New targets:      ${users.length - alreadySent.size}`);
  console.log(`   With Telegram:    ${withTelegram.length}`);
  console.log(`   With real email:  ${withEmail.length}`);

  const stats = { inApp: 0, push: 0, telegram: 0, telegramFailed: 0, email: 0, emailFailed: 0 };

  // 1. In-app bell notification
  console.log('\n1/4  In-app notifications...');
  if (!DRY_RUN) {
    try {
      const enIds = users.filter(u =>  isEn(u.language) && isNew(u)).map(u => u.id);
      const esIds = users.filter(u => !isEn(u.language) && isNew(u)).map(u => u.id);
      for (const [ids, msg] of [[enIds, NOTIFICATION_MSG.en], [esIds, NOTIFICATION_MSG.es]]) {
        if (!ids.length) continue;
        await query(`
          INSERT INTO notifications
            (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message, metadata)
          SELECT 'announcement', 'system', 'normal', NULL,
            t.id, 'system', $2, $3, $4::jsonb
          FROM unnest($1::text[]) AS t(id)
          ON CONFLICT (type, target_user_id, entity_type, entity_id) WHERE actor_id IS NULL
          DO UPDATE SET is_read = FALSE, created_at = NOW(), message = EXCLUDED.message
        `, [ids, ENTITY_ID, msg, JSON.stringify({ url: SUBSCRIBE_URL })]);
        stats.inApp += ids.length;
      }
      console.log(`     ✓ ${stats.inApp} inserted/upserted`);
    } catch (err) { console.error(`     ✗ ${err.message}`); }
  } else {
    console.log(`     [DRY] Would notify ${users.filter(isNew).length} users`);
  }

  // 2. Web push
  console.log('2/4  Web push...');
  if (!DRY_RUN) {
    try {
      PushNotificationService.initialize();
      const enIds = users.filter(u =>  isEn(u.language) && isNew(u)).map(u => u.id);
      const esIds = users.filter(u => !isEn(u.language) && isNew(u)).map(u => u.id);
      let pushSent = 0;
      if (enIds.length) pushSent += await PushNotificationService.sendToUsers(enIds, { ...PUSH.en, url: SUBSCRIBE_URL, tag: ENTITY_ID });
      if (esIds.length) pushSent += await PushNotificationService.sendToUsers(esIds, { ...PUSH.es, url: SUBSCRIBE_URL, tag: ENTITY_ID });
      stats.push = pushSent;
      console.log(`     ✓ ${pushSent} push sent`);
    } catch (err) { console.error(`     ✗ ${err.message}`); }
  } else {
    console.log(`     [DRY] Would push to subscribed users`);
  }

  // 3. Telegram
  console.log(`3/4  Telegram to ${withTelegram.length} users...`);
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
    console.log(`     ✓ TG: ${stats.telegram} sent / ${stats.telegramFailed} failed`);
  } else if (DRY_RUN) {
    console.log(`     [DRY] Would send to ${withTelegram.length} users`);
    console.log('\n── Sample TG message (ES) ──\n');
    console.log(TG.es('Amigo'));
    console.log('\n── Sample TG message (EN) ──\n');
    console.log(TG.en('there'));
  } else {
    console.log('     [SKIPPED] --skip-telegram');
  }

  // 4. Email
  console.log(`4/4  Email to ${withEmail.length} users...`);
  if (SKIP_EMAIL) {
    console.log('     [SKIPPED] --skip-email');
  } else if (!DRY_RUN) {
    const transporter = nodemailer.createTransport({
      host:           process.env.PNPTV_SMTP_HOST,
      port:           parseInt(process.env.PNPTV_SMTP_SECURE === 'true' ? '465' : process.env.PNPTV_SMTP_PORT || '587', 10),
      secure:         process.env.PNPTV_SMTP_SECURE === 'true',
      auth:           { user: process.env.PNPTV_SMTP_USER, pass: process.env.PNPTV_SMTP_PASS },
      pool:           true,
      maxConnections: 1,
      maxMessages:    Infinity,
      rateDelta:      Math.floor(1000 / EMAIL_RATE_PER_SEC),
      rateLimit:      EMAIL_RATE_PER_SEC,
    });
    await new Promise((resolveAll) => {
      let sent = 0, failed = 0, completed = 0;
      if (!withEmail.length) { resolveAll(); return; }
      for (let i = 0; i < withEmail.length; i++) {
        const u = withEmail[i];
        const lang = isEn(u.language) ? 'en' : 'es';
        const name = u.first_name || u.username || (lang === 'en' ? 'Member' : 'Miembro');
        transporter.sendMail({
          from: '"PNPtv!" <support@pnptv.app>', to: u.email,
          subject: EMAIL_SUBJECT[lang], html: buildEmailHtml(lang, name),
        }, (err) => {
          completed++;
          if (err) {
            failed++;
            if (failed <= 5 || failed % 50 === 0) console.warn(`     Email err [${u.email}]: ${err.message}`);
          } else { sent++; }
          if (completed % 100 === 0) console.log(`     Email progress: ${completed}/${withEmail.length}`);
          if (completed === withEmail.length) { stats.email = sent; stats.emailFailed = failed; transporter.close(); resolveAll(); }
        });
      }
    });
    console.log(`     ✓ Email: ${stats.email} sent / ${stats.emailFailed} failed`);
  } else {
    console.log(`     [DRY] Would send to ${withEmail.length} users`);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(` BROADCAST ${DRY_RUN ? 'DRY RUN' : 'COMPLETE'}`);
  console.log('═══════════════════════════════════════════════════');
  if (!DRY_RUN) {
    console.log(` In-app:   ${stats.inApp}`);
    console.log(` Push:     ${stats.push}`);
    console.log(` Telegram: ${stats.telegram} sent / ${stats.telegramFailed} failed`);
    console.log(` Email:    ${stats.email} sent / ${stats.emailFailed} failed`);
  }
  console.log('═══════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
