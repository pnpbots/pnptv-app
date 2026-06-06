#!/usr/bin/env node
'use strict';

/**
 * broadcast-subscribe-card.js
 *
 * Announces card (ePayco) payment on the subscription page to all active members.
 * Covers monthly ($25.00), weekly ($15.00), and yearly ($99.99) plans.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-subscribe-card.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-subscribe-card.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-subscribe-card.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-subscribe-card.js --skip-telegram
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
const EMAIL_ONLY    = process.argv.includes('--email-only');
const FORCE         = process.argv.includes('--force');

const ENTITY_ID     = 'subscribe-card-launch-2026-05';
const PAGE_URL      = 'https://pnptv.app/subscribe';
const TG_DELAY_MS   = 80;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `💳 Now you can subscribe with your credit or debit card — plans from $15.00/week. Full PRIME access, no crypto needed. pnptv.app/subscribe →`,
  es: `💳 Ahora puedes suscribirte con tarjeta de crédito o débito — planes desde $15.00/semana. Acceso PRIME completo, sin cripto. pnptv.app/subscribe →`,
};

const PUSH = {
  en: {
    title: '💳 Subscribe with your card — from $15.00',
    body:  'Full PRIME access. Week ($15.00), Month ($25.00), or Year ($99.99). Pay now with any credit or debit card.',
  },
  es: {
    title: '💳 Suscríbete con tu tarjeta — desde $15.00',
    body:  'Acceso PRIME completo. Semana ($15.00), Mes ($25.00) o Año ($99.99). Paga ahora con cualquier tarjeta.',
  },
};

const TG = {
  en:
`💳 <b>Now you can subscribe with your card.</b>

Full PRIME access — no crypto, no Telegram bot, no tricks. Just your card and you're in.

<b>Choose what works for you:</b>
🗓️ <b>Week Pass</b> — $15.00 / 7 days
📅 <b>Monthly Pass</b> — $25.00 / 30 days
💎 <b>Diamond (Yearly)</b> — $99.99 / 365 days — best value

<b>What PRIME gets you:</b>
🔴 Exclusive live shows & streams
🎬 PRIME-only content & creator sessions
📣 Full feed, DMs, Hangouts, Nearby
🛡️ Priority support, always

👉 <a href="${PAGE_URL}">${PAGE_URL}</a>

<i>Safe, discreet checkout — your card info never touches our servers.</i>`,

  es:
`💳 <b>Ahora puedes suscribirte con tu tarjeta.</b>

Acceso PRIME completo — sin cripto, sin bot de Telegram, sin complicaciones. Solo tu tarjeta y ya estás adentro.

<b>Elige el plan que te convenga:</b>
🗓️ <b>Week Pass</b> — $15.00 / 7 días
📅 <b>Monthly Pass</b> — $25.00 / 30 días
💎 <b>Diamond (Anual)</b> — $99.99 / 365 días — mejor valor

<b>Lo que tienes con PRIME:</b>
🔴 Shows en vivo y transmisiones exclusivas
🎬 Contenido exclusivo PRIME y sesiones con creadores
📣 Feed completo, DMs, Hangouts, Nearby
🛡️ Soporte prioritario, siempre

👉 <a href="${PAGE_URL}">${PAGE_URL}</a>

<i>Checkout seguro y discreto — tu info de tarjeta nunca toca nuestros servidores.</i>`,
};

const EMAIL_SUBJECT = {
  en: '💳 Subscribe with your card — PRIME from $15.00/week',
  es: '💳 Suscríbete con tu tarjeta — PRIME desde $15.00/semana',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  const greeting = en ? `Hey ${name}!` : `¡Hola ${name}!`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${en ? 'Subscribe with Your Card — PNPtv!' : 'Suscríbete con tu Tarjeta — PNPtv!'}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(212,0,122,0.30);">
        <!-- Top accent bar -->
        <tr><td style="height:4px;background:linear-gradient(90deg,#D4007A,#8B00FF);"></td></tr>

        <!-- Logo -->
        <tr><td style="padding:28px 32px 8px;">
          <img src="https://pnptv.app/logo-header.png" alt="PNPtv!" height="32" style="display:block;">
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:16px 32px 32px;">
          <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${greeting}</p>

          <!-- Hero headline -->
          <h1 style="margin:0 0 8px;font-size:26px;font-weight:900;color:#ffffff;line-height:1.15;">
            💳 ${en ? 'Subscribe with your card.' : 'Suscríbete con tu tarjeta.'}
          </h1>
          <p style="margin:0 0 24px;font-size:15px;color:#9ca3af;line-height:1.5;">
            ${en
              ? 'Full PRIME access. No crypto required. Just your credit or debit card — safe, discreet checkout.'
              : 'Acceso PRIME completo. Sin cripto. Solo tu tarjeta de crédito o débito — checkout seguro y discreto.'}
          </p>

          <!-- Plans -->
          <p style="margin:0 0 12px;font-size:15px;font-weight:800;color:#ffffff;">
            ${en ? 'Choose your plan:' : 'Elige tu plan:'}
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border-spacing:0;">
            <!-- Week -->
            <tr><td style="padding:0 0 8px;">
              <div style="padding:16px 20px;background:rgba(212,0,122,0.06);border:1px solid rgba(212,0,122,0.20);border-radius:12px;display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <p style="margin:0 0 2px;font-size:14px;font-weight:800;color:#ffffff;">🗓️ ${en ? 'Week Pass' : 'Week Pass'}</p>
                  <p style="margin:0;font-size:12px;color:#9ca3af;">${en ? '7 days of full PRIME access' : '7 días de acceso PRIME completo'}</p>
                </div>
                <p style="margin:0;font-size:22px;font-weight:900;color:#D4007A;">$15.00</p>
              </div>
            </td></tr>
            <!-- Monthly -->
            <tr><td style="padding:0 0 8px;">
              <div style="padding:16px 20px;background:rgba(212,0,122,0.08);border:2px solid rgba(212,0,122,0.40);border-radius:12px;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <div>
                    <p style="margin:0 0 2px;font-size:14px;font-weight:800;color:#ffffff;">📅 ${en ? 'Monthly Pass' : 'Monthly Pass'}</p>
                    <p style="margin:0;font-size:12px;color:#9ca3af;">${en ? '30 days of full PRIME access' : '30 días de acceso PRIME completo'}</p>
                  </div>
                  <p style="margin:0;font-size:22px;font-weight:900;color:#D4007A;">$25.00</p>
                </div>
              </div>
            </td></tr>
            <!-- Yearly -->
            <tr><td style="padding:0 0 8px;">
              <div style="padding:16px 20px;background:rgba(139,0,255,0.08);border:1px solid rgba(139,0,255,0.30);border-radius:12px;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <div>
                    <p style="margin:0 0 2px;font-size:14px;font-weight:800;color:#ffffff;">💎 ${en ? 'Diamond (Yearly)' : 'Diamond (Anual)'} <span style="display:inline-block;padding:2px 8px;background:#8B00FF;color:#fff;font-size:10px;font-weight:800;border-radius:20px;margin-left:6px;">${en ? 'BEST VALUE' : 'MEJOR PRECIO'}</span></p>
                    <p style="margin:0;font-size:12px;color:#9ca3af;">${en ? '365 days — only $8.33/month' : '365 días — solo $8.33/mes'}</p>
                  </div>
                  <p style="margin:0;font-size:22px;font-weight:900;color:#8B00FF;">$99.99</p>
                </div>
              </div>
            </td></tr>
          </table>

          <!-- Benefits -->
          <p style="margin:0 0 12px;font-size:15px;font-weight:800;color:#ffffff;">
            ${en ? "What's included with PRIME:" : 'Qué incluye PRIME:'}
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            ${[
              en ? ['🔴', 'Exclusive live shows & streams', 'PRIME-only broadcasts from creators'] : ['🔴', 'Shows en vivo exclusivos', 'Transmisiones solo para PRIME'],
              en ? ['🎬', 'All exclusive content', 'Creator sessions, locked posts, everything'] : ['🎬', 'Todo el contenido exclusivo', 'Sesiones de creadores, posts privados, todo'],
              en ? ['📣', 'Full platform access', 'Feed, DMs, Hangouts, Nearby and more'] : ['📣', 'Acceso completo a la plataforma', 'Feed, DMs, Hangouts, Nearby y más'],
              en ? ['🛡️', 'Priority support, always', 'Get help first, always'] : ['🛡️', 'Soporte prioritario, siempre', 'Atención preferencial, siempre'],
            ].map(([emoji, title, sub]) => `
            <tr><td style="padding:0 0 8px;">
              <div style="padding:12px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;">
                <span style="font-size:18px;margin-right:10px;">${emoji}</span>
                <span style="font-size:13px;font-weight:700;color:#ffffff;">${title}</span>
                <p style="margin:4px 0 0 28px;font-size:12px;color:#9ca3af;">${sub}</p>
              </div>
            </td></tr>`).join('')}
          </table>

          <!-- CTA -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
            <tr><td align="center">
              <a href="${PAGE_URL}" style="display:inline-block;padding:18px 48px;background:linear-gradient(90deg,#D4007A,#8B00FF);color:#ffffff;font-size:16px;font-weight:800;text-decoration:none;border-radius:14px;letter-spacing:0.05em;text-transform:uppercase;">
                ${en ? 'Subscribe Now →' : 'Suscribirme Ahora →'}
              </a>
            </td></tr>
            <tr><td align="center" style="padding-top:10px;">
              <a href="${PAGE_URL}" style="font-size:12px;color:#6b7280;text-decoration:underline;">${PAGE_URL}</a>
            </td></tr>
          </table>

        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.08);">
          <p style="margin:0;font-size:11px;color:#6b7280;line-height:1.5;">
            ${en ? 'You received this as a member of PNPtv!.' : 'Recibiste esto por ser miembro de PNPtv!.'}
          </p>
          <p style="margin:4px 0 0;font-size:11px;color:#6b7280;">🔒 Encrypted · Discreet · pnptv.app</p>
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
  console.log(' Subscribe with Card — Launch Broadcast');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN)       console.log(' MODE: DRY RUN — nothing will be sent\n');
  if (SKIP_EMAIL)    console.log(' --skip-email: email channel will be skipped\n');
  if (SKIP_TELEGRAM) console.log(' --skip-telegram: Telegram channel will be skipped\n');

  console.log('\n── Fetching broadcast targets...');
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
  const newUsersOnly = (u) => !alreadySent.has(u.id);

  const withTelegram = users.filter(u => u.telegram && newUsersOnly(u));
  const withEmail    = users.filter(u => u.email && !u.email.includes('@telegram.pnptv.app') && newUsersOnly(u));

  console.log(`   Total target users:  ${users.length}`);
  console.log(`   Already notified:    ${alreadySent.size}`);
  console.log(`   New (TG/email):      ${users.length - alreadySent.size}`);
  console.log(`   With Telegram:       ${withTelegram.length}`);
  console.log(`   With real email:     ${withEmail.length}`);

  const stats = { inApp: 0, push: 0, telegram: 0, telegramFailed: 0, email: 0, emailFailed: 0 };

  // 1. In-app bell
  console.log('\n1/4  In-app notifications...');
  if (EMAIL_ONLY) { console.log('     [SKIPPED] --email-only'); }
  if (!DRY_RUN && !EMAIL_ONLY) {
    try {
      const enIds = users.filter(u =>  isEn(u.language)).map(u => u.id);
      const esIds = users.filter(u => !isEn(u.language)).map(u => u.id);
      for (const [ids, msg] of [[enIds, NOTIFICATION_MSG.en], [esIds, NOTIFICATION_MSG.es]]) {
        if (!ids.length) continue;
        await query(`
          INSERT INTO notifications
            (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message, metadata)
          SELECT 'announcement', 'system', 'high', NULL,
            t.id, 'system', $2, $3, $4::jsonb
          FROM unnest($1::text[]) AS t(id)
          ON CONFLICT (type, target_user_id, entity_type, entity_id) WHERE actor_id IS NULL
          DO UPDATE SET is_read = FALSE, created_at = NOW(), message = EXCLUDED.message
        `, [ids, ENTITY_ID, msg, JSON.stringify({ url: PAGE_URL })]);
        stats.inApp += ids.length;
      }
      console.log(`     ✓ Inserted/upserted: ${stats.inApp}`);
    } catch (err) { console.error(`     ✗ Error: ${err.message}`); }
  } else if (DRY_RUN) {
    console.log(`     [DRY] Would insert for ${users.length} users`);
  }

  // 2. Web push
  console.log('2/4  Web push...');
  if (EMAIL_ONLY) { console.log('     [SKIPPED] --email-only'); }
  if (!DRY_RUN && !EMAIL_ONLY) {
    try {
      PushNotificationService.initialize();
      const enIds = users.filter(u =>  isEn(u.language)).map(u => u.id);
      const esIds = users.filter(u => !isEn(u.language)).map(u => u.id);
      let pushSent = 0;
      if (enIds.length) pushSent += await PushNotificationService.sendToUsers(enIds, { ...PUSH.en, url: PAGE_URL, tag: ENTITY_ID });
      if (esIds.length) pushSent += await PushNotificationService.sendToUsers(esIds, { ...PUSH.es, url: PAGE_URL, tag: ENTITY_ID });
      stats.push = pushSent;
      console.log(`     ✓ Push sent: ${pushSent}`);
    } catch (err) { console.error(`     ✗ Error: ${err.message}`); }
  } else if (DRY_RUN) {
    console.log(`     [DRY] Would push to subscribed users`);
  }

  // 3. Telegram
  console.log(`3/4  Telegram to ${withTelegram.length} users...`);
  if (EMAIL_ONLY || SKIP_TELEGRAM) { console.log('     [SKIPPED]'); }
  if (!DRY_RUN && !EMAIL_ONLY && !SKIP_TELEGRAM) {
    const tg = new Telegram(process.env.BOT_TOKEN);
    for (let i = 0; i < withTelegram.length; i++) {
      const u = withTelegram[i];
      const msg = isEn(u.language) ? TG.en : TG.es;
      try {
        await tg.sendMessage(u.telegram, msg, { parse_mode: 'HTML', disable_web_page_preview: false });
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
    console.log(`     ✓ Telegram: ${stats.telegram} sent / ${stats.telegramFailed} failed`);
  } else if (DRY_RUN) {
    console.log(`     [DRY] Would send to ${withTelegram.length} users`);
  }

  // 4. Email
  console.log(`4/4  Email to ${withEmail.length} users...`);
  if (SKIP_EMAIL) {
    console.log('     [SKIPPED] --skip-email');
  } else if (!DRY_RUN) {
    if (process.env.RESEND_API_KEY) {
      console.log('     Using Resend API (1/220ms)...');
      for (let i = 0; i < withEmail.length; i++) {
        const u = withEmail[i];
        const lang = isEn(u.language) ? 'en' : 'es';
        const name = u.first_name || u.username || (lang === 'en' ? 'Member' : 'Miembro');
        try {
          const res = await fetch('https://api.resend.com/emails', {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ from: 'PNPtv! <support@pnptv.app>', to: [u.email], subject: EMAIL_SUBJECT[lang], html: buildEmailHtml(lang, name) }),
          });
          if (!res.ok) { const t = await res.text(); throw new Error(`${res.status} ${t}`); }
          stats.email++;
        } catch (err) {
          stats.emailFailed++;
          if (stats.emailFailed <= 5 || stats.emailFailed % 50 === 0) {
            console.warn(`     Email err [${u.email}]: ${err.message}`);
          }
        }
        await sleep(220);
        const done = i + 1;
        if (done % 100 === 0 || done === withEmail.length) console.log(`     Email progress: ${done}/${withEmail.length}`);
      }
    } else {
      console.warn('     RESEND_API_KEY not set — falling back to Hostinger SMTP (rate-limited)');
      const transporter = nodemailer.createTransport({
        host:           process.env.PNPTV_SMTP_HOST,
        port:           parseInt(process.env.PNPTV_SMTP_PORT || '587', 10),
        secure:         process.env.PNPTV_SMTP_SECURE === 'true',
        auth:           { user: process.env.PNPTV_SMTP_USER, pass: process.env.PNPTV_SMTP_PASS },
        pool:           true,
        maxConnections: 1,
        maxMessages:    Infinity,
        rateDelta:      1000,
        rateLimit:      1,
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
    }
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
