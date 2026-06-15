#!/usr/bin/env node
'use strict';

/**
 * broadcast-magic-link-fixed.js
 *
 * Notifies all users that magic-link email login has been restored.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-magic-link-fixed.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-magic-link-fixed.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-magic-link-fixed.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-magic-link-fixed.js --skip-telegram
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

const ENTITY_ID          = 'magic-link-fix-2026-06';
const APP_URL            = 'https://pnptv.app';
const TG_DELAY_MS        = 80;
const EMAIL_RATE_PER_SEC = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `✅ Magic link login is fixed! If you had trouble signing in with your email, try again now — it works.`,
  es: `✅ ¡El enlace mágico ya funciona! Si tuviste problemas para entrar con tu correo, inténtalo de nuevo ahora.`,
};

const PUSH = {
  en: { title: '✅ Magic link login is fixed', body: 'Email sign-in is working again. Tap to log in.' },
  es: { title: '✅ El enlace mágico funciona', body: 'El inicio de sesión por correo ya funciona. Toca para entrar.' },
};

const TG = {
  en: (name) =>
`✅ <b>Hey ${name} — magic link login is working again!</b>

If you ever had trouble signing in with your email, that's now fixed.

To log in:
1. Go to <a href="${APP_URL}">${APP_URL}</a>
2. Enter your email
3. Check your inbox for the magic link and tap it

That's it — no password needed. 🖤

If you run into any issues, reply here and we'll help.`,

  es: (name) =>
`✅ <b>¡Hola ${name}! El inicio de sesión por enlace mágico ya funciona.</b>

Si en algún momento tuviste problemas para entrar con tu correo, eso ya está resuelto.

Para entrar:
1. Ve a <a href="${APP_URL}">${APP_URL}</a>
2. Escribe tu correo
3. Revisa tu bandeja de entrada y toca el enlace mágico

Sin contraseña, sin complicaciones. 🖤

Si tienes algún problema, responde aquí y te ayudamos.`,
};

const EMAIL_SUBJECT = {
  en: '✅ Magic link login is fixed — try signing in again',
  es: '✅ El enlace mágico ya funciona — intenta entrar de nuevo',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  const greeting = en ? `Hey ${name}!` : `¡Hola ${name}!`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${en ? 'Magic link login is fixed' : 'El enlace mágico ya funciona'}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.10);">
        <tr><td style="height:4px;background:linear-gradient(90deg,#26a17b,#8b5cf6);"></td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <p style="margin:0;font-size:24px;font-weight:900;color:#ffffff;">PNPtv!</p>
        </td></tr>
        <tr><td style="padding:16px 32px 32px;">
          <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${greeting}</p>
          <h1 style="margin:0 0 16px;font-size:22px;font-weight:900;color:#ffffff;line-height:1.2;">
            ✅ ${en ? 'Magic link login is fixed.' : 'El enlace mágico ya funciona.'}
          </h1>
          <p style="margin:0 0 20px;font-size:15px;color:#d1d5db;line-height:1.6;">
            ${en
              ? 'If you had trouble signing in with your email, that problem is now resolved. Email sign-in is working again.'
              : 'Si tuviste problemas para iniciar sesión con tu correo, ese problema ya fue resuelto. El inicio de sesión por correo está funcionando de nuevo.'}
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:20px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:12px;">
              <p style="margin:0 0 12px;font-size:14px;font-weight:800;color:#ffffff;">
                ${en ? 'How to sign in:' : 'Cómo entrar:'}
              </p>
              <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">1. ${en ? 'Go to pnptv.app' : 'Ve a pnptv.app'}</p>
              <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">2. ${en ? 'Enter your email address' : 'Escribe tu correo'}</p>
              <p style="margin:0;font-size:14px;color:#9ca3af;">3. ${en ? 'Tap the magic link in your inbox' : 'Toca el enlace mágico en tu correo'}</p>
            </td></tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
            <tr><td align="center">
              <a href="${APP_URL}/login" style="display:inline-block;padding:16px 44px;background:linear-gradient(90deg,#26a17b,#8b5cf6);color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;border-radius:12px;letter-spacing:0.04em;">
                ${en ? 'Sign in to PNPtv! →' : 'Entrar a PNPtv! →'}
              </a>
            </td></tr>
          </table>

          <p style="margin:24px 0 0;font-size:13px;color:#6b7280;text-align:center;line-height:1.6;">
            ${en
              ? 'Sorry for the inconvenience. Thank you for your patience. 🖤'
              : 'Disculpa las molestias. Gracias por tu paciencia. 🖤'}
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
  console.log(' Magic Link Fix Broadcast — June 2026');
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
        `, [ids, ENTITY_ID, msg, JSON.stringify({ url: `${APP_URL}/login` })]);
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
      if (enIds.length) pushSent += await PushNotificationService.sendToUsers(enIds, { ...PUSH.en, url: `${APP_URL}/login`, tag: ENTITY_ID });
      if (esIds.length) pushSent += await PushNotificationService.sendToUsers(esIds, { ...PUSH.es, url: `${APP_URL}/login`, tag: ENTITY_ID });
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
          from: `"PNPtv!" <${process.env.PNPTV_SMTP_USER}>`,
          to: u.email,
          subject: EMAIL_SUBJECT[lang],
          html: buildEmailHtml(lang, name),
        }, (err) => {
          completed++;
          if (err) {
            failed++;
            if (failed <= 5 || failed % 50 === 0) console.warn(`     Email err [${u.email}]: ${err.message}`);
          } else { sent++; }
          if (completed % 100 === 0) console.log(`     Email progress: ${completed}/${withEmail.length}`);
          if (completed === withEmail.length) {
            stats.email = sent;
            stats.emailFailed = failed;
            transporter.close();
            resolveAll();
          }
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
