#!/usr/bin/env node
'use strict';

/**
 * broadcast-mainstage-invite-links.js
 *
 * Teaches members how to generate and share Main Stage invite links.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-mainstage-invite-links.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-mainstage-invite-links.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-mainstage-invite-links.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-mainstage-invite-links.js --skip-telegram
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

const ENTITY_ID          = 'mainstage-invite-links-2026-06';
const APP_URL            = 'https://pnptv.app/main-stage';
const TG_DELAY_MS        = 80;
const EMAIL_RATE_PER_SEC = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `🔗 Did you know? You can invite anyone to Main Stage — no PNPtv account needed. Tap Settings on the stage to generate your link.`,
  es: `🔗 ¿Sabías que puedes invitar a cualquiera al Main Stage? No necesitan cuenta PNPtv. Abre Ajustes en el stage para generar tu enlace.`,
};

const PUSH = {
  en: { title: '🔗 Invite anyone to Main Stage', body: 'Generate a personal invite link right from the stage. No PNPtv account needed for your guests.' },
  es: { title: '🔗 Invita a cualquiera al Main Stage', body: 'Genera un enlace de invitación desde el stage. Tus invitados no necesitan cuenta PNPtv.' },
};

const TG = {
  en: (name) =>
`🔗 <b>Hey ${name} — you can now invite anyone to Main Stage.</b>

No PNPtv account required for your guests. Here's how it works:

━━━━━━━━━━━━━━━
<b>How to generate your invite link</b>
━━━━━━━━━━━━━━━

1️⃣  Go to <a href="${APP_URL}">Main Stage</a>
2️⃣  Tap the <b>Settings</b> button at the bottom of the screen
3️⃣  Scroll down to <b>"Generate invite link"</b>
4️⃣  Copy the link and share it — anywhere

━━━━━━━━━━━━━━━
<b>What your guest gets</b>
━━━━━━━━━━━━━━━

When someone opens your link, they join the stage as a guest — <b>no account needed.</b> They just enter a name and email. After the session, we send them a free PNPtv invite so they can come back anytime.

The link you share on X (Twitter) looks like this 👇

🖼 Full image card · "Bye Zoom. Join Main Stage." · "Hottest PNP Streaming Party. By PNPtv!"

━━━━━━━━━━━━━━━

👉 <a href="${APP_URL}">Go to Main Stage</a>`,

  es: (name) =>
`🔗 <b>¡Hola ${name}! Ahora puedes invitar a cualquiera al Main Stage.</b>

Tus invitados no necesitan cuenta PNPtv. Así funciona:

━━━━━━━━━━━━━━━
<b>Cómo generar tu enlace de invitación</b>
━━━━━━━━━━━━━━━

1️⃣  Ve al <a href="${APP_URL}">Main Stage</a>
2️⃣  Toca el botón <b>Ajustes</b> en la parte inferior de la pantalla
3️⃣  Baja hasta <b>"Generar enlace de invitación"</b>
4️⃣  Copia el enlace y compártelo donde quieras

━━━━━━━━━━━━━━━
<b>Qué recibe tu invitado</b>
━━━━━━━━━━━━━━━

Cuando alguien abre tu enlace, entra al stage como invitado — <b>sin necesitar cuenta.</b> Solo escribe su nombre y correo. Después de la sesión, le enviamos una invitación gratis a PNPtv para que pueda volver cuando quiera.

El enlace que compartes en X (Twitter) se ve así 👇

🖼 Imagen grande · "Bye Zoom. Join Main Stage." · "Hottest PNP Streaming Party. By PNPtv!"

━━━━━━━━━━━━━━━

👉 <a href="${APP_URL}">Ir al Main Stage</a>`,
};

const EMAIL_SUBJECT = {
  en: '🔗 Invite anyone to Main Stage — no account needed',
  es: '🔗 Invita a cualquiera al Main Stage — sin cuenta necesaria',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  const greeting = en ? `Hey ${name}!` : `¡Hola ${name}!`;

  const steps = en ? [
    ['1️⃣', 'Go to Main Stage', `Open <a href="${APP_URL}" style="color:#D4007A;">pnptv.app/main-stage</a>`],
    ['2️⃣', 'Tap Settings', 'Find the Settings button at the bottom of the screen.'],
    ['3️⃣', 'Generate your link', 'Scroll to "Generate invite link" and tap it.'],
    ['4️⃣', 'Share it anywhere', 'Copy the link and send it — X, WhatsApp, Telegram, wherever.'],
  ] : [
    ['1️⃣', 'Ve al Main Stage', `Abre <a href="${APP_URL}" style="color:#D4007A;">pnptv.app/main-stage</a>`],
    ['2️⃣', 'Toca Ajustes', 'Encuentra el botón Ajustes en la parte inferior de la pantalla.'],
    ['3️⃣', 'Genera tu enlace', 'Baja hasta "Generar enlace de invitación" y tócalo.'],
    ['4️⃣', 'Compártelo donde quieras', 'Copia el enlace y envíalo — X, WhatsApp, Telegram, donde sea.'],
  ];

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${en ? 'Invite anyone to Main Stage' : 'Invita a cualquiera al Main Stage'}</title>
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
            🔗 ${en ? 'Invite anyone to Main Stage.' : 'Invita a cualquiera al Main Stage.'}
          </h1>
          <p style="margin:0 0 28px;font-size:15px;color:#9ca3af;line-height:1.6;">
            ${en
              ? 'Your guests don\'t need a PNPtv account to join. Just share a link — they\'re in.'
              : 'Tus invitados no necesitan cuenta PNPtv para unirse. Solo comparte un enlace — y ya están adentro.'}
          </p>

          ${steps.map(([num, title, body]) => `
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
            <tr><td style="padding:14px 18px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;">
              <p style="margin:0 0 3px;font-size:15px;font-weight:800;color:#ffffff;">${num} ${title}</p>
              <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.55;">${body}</p>
            </td></tr>
          </table>`).join('')}

          <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 24px;border-radius:12px;overflow:hidden;border:1px solid rgba(212,0,122,0.25);">
            <tr><td style="padding:16px 18px;background:rgba(212,0,122,0.07);">
              <p style="margin:0 0 4px;font-size:13px;font-weight:800;color:#D4007A;">
                ${en ? '🖼 When you share on X (Twitter)' : '🖼 Cuando lo compartes en X (Twitter)'}
              </p>
              <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.55;">
                ${en
                  ? 'Your link shows a full image card — your name in the title, the stage photo, and the text <em>"Bye Zoom. Join Main Stage. Hottest PNP Streaming Party."</em>'
                  : 'Tu enlace muestra una tarjeta con imagen — tu nombre en el título, la foto del stage y el texto <em>"Bye Zoom. Join Main Stage. Hottest PNP Streaming Party."</em>'}
              </p>
            </td></tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
            <tr><td align="center">
              <a href="${APP_URL}" style="display:inline-block;padding:16px 44px;background:linear-gradient(90deg,#D4007A,#7B61FF);color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;border-radius:12px;letter-spacing:0.04em;">
                ${en ? 'Go to Main Stage →' : 'Ir al Main Stage →'}
              </a>
            </td></tr>
          </table>

          <p style="margin:24px 0 0;font-size:13px;color:#6b7280;text-align:center;line-height:1.6;">
            ${en
              ? 'Guests get a free PNPtv invite after their first session. 🖤'
              : 'Los invitados reciben una invitación gratis a PNPtv después de su primera sesión. 🖤'}
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
  console.log(' Main Stage Invite Links Broadcast — June 2026');
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
    console.log('\n── Sample TG message (EN) ──\n');
    console.log(TG.en('Carlos'));
    console.log('\n── Sample TG message (ES) ──\n');
    console.log(TG.es('Carlos'));
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
