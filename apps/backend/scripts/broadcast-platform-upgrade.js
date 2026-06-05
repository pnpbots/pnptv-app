#!/usr/bin/env node
'use strict';

/**
 * broadcast-platform-upgrade.js
 *
 * Community update — plain-language announcement of the June 2026
 * stability, security, and payment improvements shipped this week.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-platform-upgrade.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-platform-upgrade.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-platform-upgrade.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-platform-upgrade.js --skip-telegram
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

const ENTITY_ID          = 'platform-upgrade-2026-06';
const APP_URL            = 'https://pnptv.app';
const TG_DELAY_MS        = 80;
const EMAIL_RATE_PER_SEC = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `🛠️ PNPtv got better this week — smarter payments, tighter content protection, and a bunch of under-the-hood improvements. Tap to see what changed.`,
  es: `🛠️ PNPtv mejoró esta semana — pagos más inteligentes, contenido más protegido y un montón de mejoras internas. Toca para ver qué cambió.`,
};

const PUSH = {
  en: { title: '🛠️ PNPtv just got better', body: 'Smarter payments, tighter protection, better all around. See what changed.' },
  es: { title: '🛠️ PNPtv acaba de mejorar', body: 'Pagos más inteligentes, más protección, mejor en todo. Ve qué cambió.' },
};

const TG = {
  en: (name) =>
`🛠️ <b>Hey ${name} — we've been busy making PNPtv better for you.</b>

Here's what we just shipped this week, in plain English:

━━━━━━━━━━━━━━━
💳 <b>PAYMENTS GOT SMARTER</b>
━━━━━━━━━━━━━━━
If your payment doesn't go through, you'll now see a clear, specific message telling you exactly what went wrong — not a confusing generic error.

We also added a safety check so you can't accidentally get charged twice for the same plan.

━━━━━━━━━━━━━━━
🔒 <b>YOUR CONTENT IS BETTER PROTECTED</b>
━━━━━━━━━━━━━━━
Exclusive posts, PRIME videos, and creator content now have stronger access controls — only the right people see what they're supposed to see.

━━━━━━━━━━━━━━━
🗺️ <b>NEARBY IS CLEANER</b>
━━━━━━━━━━━━━━━
People you've blocked (or who blocked you) no longer appear in your Nearby list. Your space, your rules.

━━━━━━━━━━━━━━━
🛡️ <b>FASTER ACCOUNT PROTECTION</b>
━━━━━━━━━━━━━━━
If an account is suspended for any reason, it's now locked out across the entire platform instantly — not just on the next page load.

━━━━━━━━━━━━━━━

We're always working to make this the best platform for our community. More updates coming soon. 🖤

👉 <a href="${APP_URL}">${APP_URL}</a>`,

  es: (name) =>
`🛠️ <b>¡Hola ${name}! Estuvimos trabajando para mejorar PNPtv.</b>

Esto es lo que lanzamos esta semana, en palabras simples:

━━━━━━━━━━━━━━━
💳 <b>LOS PAGOS SON MÁS INTELIGENTES</b>
━━━━━━━━━━━━━━━
Si tu pago no se procesa, ahora verás un mensaje claro y específico que te dice exactamente qué pasó — sin errores genéricos confusos.

También agregamos una protección para que no puedas ser cobrado dos veces por el mismo plan sin querer.

━━━━━━━━━━━━━━━
🔒 <b>TU CONTENIDO ESTÁ MÁS PROTEGIDO</b>
━━━━━━━━━━━━━━━
Los posts exclusivos, videos PRIME y contenido de creadores ahora tienen controles de acceso más fuertes — solo ven lo que deben ver quienes tienen acceso.

━━━━━━━━━━━━━━━
🗺️ <b>NEARBY ESTÁ MÁS LIMPIO</b>
━━━━━━━━━━━━━━━
Las personas que bloqueaste (o que te bloquearon) ya no aparecen en tu lista de Nearby. Tu espacio, tus reglas.

━━━━━━━━━━━━━━━
🛡️ <b>PROTECCIÓN DE CUENTA MÁS RÁPIDA</b>
━━━━━━━━━━━━━━━
Si una cuenta es suspendida por cualquier razón, ahora queda bloqueada en toda la plataforma al instante — no en la próxima carga de página.

━━━━━━━━━━━━━━━

Siempre trabajando para hacer de esta la mejor plataforma para nuestra comunidad. Más novedades pronto. 🖤

👉 <a href="${APP_URL}">${APP_URL}</a>`,
};

const EMAIL_SUBJECT = {
  en: '🛠️ PNPtv just got better — here\'s what changed this week',
  es: '🛠️ PNPtv acaba de mejorar — esto es lo que cambió esta semana',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  const greeting = en ? `Hey ${name}!` : `¡Hola ${name}!`;

  const items = en ? [
    ['💳', 'Payments got smarter', "If something goes wrong at checkout, you'll see a clear, specific message — not a confusing generic error. We also added a safeguard so you can't be double-charged for the same plan."],
    ['🔒', 'Exclusive content is better protected', 'PRIME videos, exclusive posts, and creator content now have tighter access controls. The right content goes to the right people, every time.'],
    ['🗺️', 'Nearby is cleaner', "People you've blocked — or who blocked you — no longer appear in your Nearby list. Your space, your rules."],
    ['🛡️', 'Faster account protection', 'Suspended accounts are now locked out instantly across the whole platform, not just on the next page load.'],
    ['⚡', 'Better all around', 'Rate limiting, upload verification, and a bunch of under-the-hood improvements to keep the app fast and safe even under heavy traffic.'],
  ] : [
    ['💳', 'Pagos más inteligentes', 'Si algo falla en el pago, ahora verás un mensaje claro y específico — sin errores genéricos confusos. También hay una protección para evitar cobros dobles por el mismo plan.'],
    ['🔒', 'Contenido exclusivo más protegido', 'Los videos PRIME, posts exclusivos y contenido de creadores tienen controles de acceso más fuertes. El contenido correcto llega a las personas correctas, siempre.'],
    ['🗺️', 'Nearby más limpio', 'Las personas que bloqueaste — o que te bloquearon — ya no aparecen en Nearby. Tu espacio, tus reglas.'],
    ['🛡️', 'Protección de cuenta más rápida', 'Las cuentas suspendidas ahora quedan bloqueadas en toda la plataforma al instante — sin esperar a la próxima carga de página.'],
    ['⚡', 'Mejor en todo', 'Límites de velocidad, verificación de archivos y muchas mejoras internas para mantener la app rápida y segura incluso con mucho tráfico.'],
  ];

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${en ? 'PNPtv just got better' : 'PNPtv acaba de mejorar'}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.10);">
        <tr><td style="height:4px;background:linear-gradient(90deg,#26a17b,#8b5cf6);"></td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <img src="https://pnptv.app/logo-header.png" alt="PNPtv!" height="32" style="display:block;">
        </td></tr>
        <tr><td style="padding:16px 32px 32px;">
          <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${greeting}</p>
          <h1 style="margin:0 0 8px;font-size:24px;font-weight:900;color:#ffffff;line-height:1.2;">
            🛠️ ${en ? 'We\'ve been building.' : 'Estuvimos construyendo.'}
          </h1>
          <p style="margin:0 0 28px;font-size:15px;color:#9ca3af;line-height:1.6;">
            ${en
              ? 'Here\'s everything we shipped this week to make PNPtv better, safer, and smoother for you — in plain language.'
              : 'Esto es todo lo que lanzamos esta semana para hacer PNPtv mejor, más seguro y más fluido — en palabras simples.'}
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
              <a href="${APP_URL}" style="display:inline-block;padding:16px 44px;background:linear-gradient(90deg,#26a17b,#8b5cf6);color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;border-radius:12px;letter-spacing:0.04em;">
                ${en ? 'Go to PNPtv →' : 'Ir a PNPtv →'}
              </a>
            </td></tr>
          </table>

          <p style="margin:24px 0 0;font-size:13px;color:#6b7280;text-align:center;line-height:1.6;">
            ${en
              ? 'More updates coming soon. Thank you for being part of this community. 🖤'
              : 'Más novedades pronto. Gracias por ser parte de esta comunidad. 🖤'}
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
  console.log(' Platform Upgrade Broadcast — June 2026');
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
