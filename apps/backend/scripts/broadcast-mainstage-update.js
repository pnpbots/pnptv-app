#!/usr/bin/env node
'use strict';

/**
 * broadcast-mainstage-update.js
 *
 * Announces the Main Stage upgrade: skip voting, PRIME play-next,
 * mic for members, and fair video rotation.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-mainstage-update.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-mainstage-update.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-mainstage-update.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-mainstage-update.js --skip-telegram
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

const ENTITY_ID          = 'mainstage-features-2026-06';
const APP_URL            = 'https://pnptv.app/main-stage';
const TG_DELAY_MS        = 80;
const EMAIL_RATE_PER_SEC = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `🎬 Main Stage just got a big upgrade — skip voting, PRIME play-next, and more. Come check it out.`,
  es: `🎬 El Main Stage acaba de tener una gran actualización — voto para skip, play-next PRIME y más. Ven a verlo.`,
};

const PUSH = {
  en: { title: '🎬 Main Stage upgraded', body: 'Skip voting, PRIME play-next, mic for Members, and fair video rotation. Check it out.' },
  es: { title: '🎬 Main Stage actualizado', body: 'Voto para skip, play-next PRIME, micrófono para Miembros y rotación justa de videos. Échale un ojo.' },
};

const TG = {
  en: (name) =>
`🎬 <b>Hey ${name} — Main Stage just got a major upgrade.</b>

Here's what's new, in plain English:

━━━━━━━━━━━━━━━
🗳️ <b>SKIP VOTING (Members & PRIME)</b>
━━━━━━━━━━━━━━━
If a video is playing and you're not feeling it, you can now vote to skip it. Once enough people vote, the video automatically changes — no admin needed. One vote per video.

━━━━━━━━━━━━━━━
⚡ <b>PLAY NEXT (PRIME only)</b>
━━━━━━━━━━━━━━━
PRIME members can force the video to skip immediately without waiting for a vote. One use every 5 minutes — it's yours to use.

━━━━━━━━━━━━━━━
🎙️ <b>MICROPHONE FOR MEMBERS</b>
━━━━━━━━━━━━━━━
Members now have their mic unlocked on the Main Stage. Free accounts are camera-only. Upgrade to Member to be heard, not just seen.

━━━━━━━━━━━━━━━
🔄 <b>FAIRER VIDEO ROTATION</b>
━━━━━━━━━━━━━━━
The stage no longer replays the same video over and over. Every PRIME video gets its turn, in order — so you'll always see something fresh.

━━━━━━━━━━━━━━━

Come see it for yourself. The stage is live now. 🖤

👉 <a href="${APP_URL}">pnptv.app/main-stage</a>`,

  es: (name) =>
`🎬 <b>¡Hola ${name}! El Main Stage acaba de tener una gran actualización.</b>

Esto es lo que hay nuevo, en palabras simples:

━━━━━━━━━━━━━━━
🗳️ <b>VOTO PARA SKIP (Miembros y PRIME)</b>
━━━━━━━━━━━━━━━
Si hay un video sonando y no te convence, ahora puedes votar para cambiarlo. Cuando suficientes personas votan, el video cambia solo — sin necesitar al admin. Un voto por video.

━━━━━━━━━━━━━━━
⚡ <b>PLAY NEXT (solo PRIME)</b>
━━━━━━━━━━━━━━━
Los miembros PRIME pueden cambiar el video al instante sin esperar votos. Un uso cada 5 minutos — es tuyo para usar.

━━━━━━━━━━━━━━━
🎙️ <b>MICRÓFONO PARA MIEMBROS</b>
━━━━━━━━━━━━━━━
Los Miembros ahora tienen el micrófono desbloqueado en el Main Stage. Las cuentas gratuitas son solo cámara. Hazte Miembro para que te escuchen, no solo que te vean.

━━━━━━━━━━━━━━━
🔄 <b>ROTACIÓN DE VIDEOS MÁS JUSTA</b>
━━━━━━━━━━━━━━━
El stage ya no repite el mismo video una y otra vez. Cada video PRIME tiene su turno, en orden — así siempre verás algo nuevo.

━━━━━━━━━━━━━━━

Ven a verlo tú mismo. El stage está en vivo ahora. 🖤

👉 <a href="${APP_URL}">pnptv.app/main-stage</a>`,
};

const EMAIL_SUBJECT = {
  en: '🎬 Main Stage just got a major upgrade',
  es: '🎬 El Main Stage acaba de tener una gran actualización',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  const greeting = en ? `Hey ${name}!` : `¡Hola ${name}!`;

  const items = en ? [
    ['🗳️', 'Skip voting — Members & PRIME', "Not feeling the current video? Vote to skip it. When enough people agree, it changes automatically. No admin required. One vote per video."],
    ['⚡', 'Play Next — PRIME only', "PRIME members can force the video to change immediately — no vote needed. Available once every 5 minutes, whenever you want it."],
    ['🎙️', 'Mic unlocked for Members', "Members now have full microphone access on the Main Stage. Free accounts can show their face but not speak. Upgrade to Member to be heard."],
    ['🔄', 'Fairer video rotation', "Videos now play in round-robin order — the same video won't repeat until every other one has had a turn. Always something fresh."],
  ] : [
    ['🗳️', 'Voto para skip — Miembros y PRIME', "¿No te convence el video? Vota para cambiarlo. Cuando suficientes personas votan, cambia solo. Sin necesitar al admin. Un voto por video."],
    ['⚡', 'Play Next — solo PRIME', "Los miembros PRIME pueden cambiar el video al instante — sin esperar votos. Disponible una vez cada 5 minutos, cuando quieras."],
    ['🎙️', 'Micrófono desbloqueado para Miembros', "Los Miembros ahora tienen acceso completo al micrófono en el Main Stage. Las cuentas gratuitas pueden mostrar la cara pero no hablar. Hazte Miembro para que te escuchen."],
    ['🔄', 'Rotación de videos más justa', "Los videos ahora rotan en orden — el mismo video no se repite hasta que todos los demás hayan tenido su turno. Siempre algo nuevo."],
  ];

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${en ? 'Main Stage just got a major upgrade' : 'El Main Stage acaba de actualizarse'}</title>
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
          <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${greeting}</p>
          <h1 style="margin:0 0 8px;font-size:24px;font-weight:900;color:#ffffff;line-height:1.2;">
            🎬 ${en ? 'Main Stage just got a major upgrade.' : 'El Main Stage acaba de tener una gran actualización.'}
          </h1>
          <p style="margin:0 0 28px;font-size:15px;color:#9ca3af;line-height:1.6;">
            ${en
              ? 'The stage is more interactive than ever. Here\'s everything that\'s new, in plain language.'
              : 'El stage es más interactivo que nunca. Esto es todo lo que hay nuevo, en palabras simples.'}
          </p>

          ${items.map(([emoji, title, body]) => `
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
            <tr><td style="padding:16px 18px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;">
              <p style="margin:0 0 4px;font-size:15px;font-weight:800;color:#ffffff;">${emoji} ${title}</p>
              <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.55;">${body}</p>
            </td></tr>
          </table>`).join('')}

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;margin-bottom:8px;">
            <tr><td align="center">
              <a href="${APP_URL}" style="display:inline-block;padding:16px 44px;background:linear-gradient(90deg,#D4007A,#7B61FF);color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;border-radius:12px;letter-spacing:0.04em;">
                ${en ? 'Join the Stage →' : 'Entrar al Stage →'}
              </a>
            </td></tr>
          </table>

          <p style="margin:24px 0 0;font-size:13px;color:#6b7280;text-align:center;line-height:1.6;">
            ${en
              ? 'The stage is live now. Come see what\'s playing. 🖤'
              : 'El stage está en vivo ahora. Ven a ver qué está pasando. 🖤'}
          </p>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.08);">
          <p style="margin:0;font-size:11px;color:#6b7280;">
            ${en ? 'You received this as a member of PNPtv!.' : 'Recibiste esto por ser miembro de PNPtv!.'}
            🔒 Encrypted · Discreet · pnptv.app
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
  console.log(' Main Stage Upgrade Broadcast — June 2026');
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
      const enIds = users.filter(u =>  isEn(u.language)).map(u => u.id);
      const esIds = users.filter(u => !isEn(u.language)).map(u => u.id);
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
        `, [ids, ENTITY_ID, msg, JSON.stringify({ url: APP_URL })]);
        stats.inApp += ids.length;
      }
      console.log(`     ✓ ${stats.inApp} inserted/upserted`);
    } catch (err) { console.error(`     ✗ ${err.message}`); }
  } else {
    console.log(`     [DRY] Would notify ${users.length} users`);
  }

  // 2. Web push
  console.log('2/4  Web push...');
  if (!DRY_RUN) {
    try {
      PushNotificationService.initialize();
      const enIds = users.filter(u =>  isEn(u.language)).map(u => u.id);
      const esIds = users.filter(u => !isEn(u.language)).map(u => u.id);
      let pushSent = 0;
      if (enIds.length) pushSent += await PushNotificationService.sendToUsers(enIds, { ...PUSH.en, url: APP_URL, tag: ENTITY_ID });
      if (esIds.length) pushSent += await PushNotificationService.sendToUsers(esIds, { ...PUSH.es, url: APP_URL, tag: ENTITY_ID });
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
      const msg = TG[lang](name);
      try {
        await tg.sendMessage(u.telegram, msg, { parse_mode: 'HTML', disable_web_page_preview: true });
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
      port:           parseInt(process.env.PNPTV_SMTP_PORT || '587', 10),
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
