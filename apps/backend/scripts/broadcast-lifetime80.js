#!/usr/bin/env node
'use strict';

/**
 * broadcast-lifetime80.js
 *
 * Lifetime PRIME launch broadcast — $80 crypto-only offer.
 * Announces the /lifetime80 page to all active members.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-lifetime80.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-lifetime80.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-lifetime80.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-lifetime80.js --skip-telegram
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }                  = require(path.join(BACKEND, 'config/postgres'));
const PushNotificationService    = require(path.join(BACKEND, 'services/pushNotificationService'));
const nodemailer                 = require('nodemailer');
const { Telegram }               = require('telegraf');

const DRY_RUN       = process.argv.includes('--dry-run');
const SKIP_EMAIL    = process.argv.includes('--skip-email');
const SKIP_TELEGRAM = process.argv.includes('--skip-telegram');
const EMAIL_ONLY    = process.argv.includes('--email-only');
const FORCE         = process.argv.includes('--force');

const ENTITY_ID     = 'lifetime80-launch-2026-05';
const PAGE_URL      = 'https://pnptv.app/lifetime80';
const SUBSCRIBE_URL = 'https://pnptv.app/subscribe';
const TG_DELAY_MS   = 80;
const EMAIL_RATE_PER_SEC = 1; // 1 email/second — stays within Hostinger's hourly limits

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `🔥 Lifetime PRIME — $80 one-time. Pay with card, Dash, or USDC. Full PRIME forever. No renewals, ever. Also: monthly & yearly plans at pnptv.app/subscribe →`,
  es: `🔥 Lifetime PRIME — $80 pago único. Paga con tarjeta, Dash o USDC. PRIME completo para siempre. Sin renovaciones. También: planes mensuales y anuales en pnptv.app/subscribe →`,
};

const PUSH = {
  en: {
    title: '🔥 Lifetime PRIME — $80 one-time',
    body:  'Pay with card, Dash, or USDC. Full PRIME forever. No renewals, ever. Monthly & yearly plans also available.',
  },
  es: {
    title: '🔥 Lifetime PRIME — $80 único pago',
    body:  'Paga con tarjeta, Dash o USDC. PRIME completo para siempre. Sin renovaciones. También hay planes mensuales y anuales.',
  },
};

const TG = {
  en:
`🔥 <b>Lifetime PRIME — $80. One payment. Forever.</b>

An exclusive offer for the community:

<b>Lifetime PRIME for $80</b> — pay once, access forever.

No monthly fees. No renewals. <b>Just $80 and it's yours for life.</b>

<b>What you get:</b>
💎 Full PRIME access — permanently
🔴 Exclusive live shows & streams
🎬 PRIME-only content & creator sessions
📣 Full feed, DMs, Hangouts, Nearby — everything
🛡️ Priority support, always

<b>Three ways to pay — all $80 flat:</b>
💳 <b>Card</b> — Visa or Mastercard via ePayco. Safe &amp; discreet checkout.
🥷 <b>Dash</b> — from your Dash wallet. Anonymous. No name, no bank.
🪙 <b>USDC</b> — stable digital dollar. Easy checkout via NOWPayments.

👉 <a href="${PAGE_URL}">${PAGE_URL}</a>

💡 <b>Not ready for a lifetime deal?</b> We also offer monthly and yearly plans:
👉 <a href="${SUBSCRIBE_URL}">${SUBSCRIBE_URL}</a>`,

  es:
`🔥 <b>Lifetime PRIME — $80. Un pago. Para siempre.</b>

Una oferta exclusiva para la comunidad:

<b>Lifetime PRIME por $80</b> — paga una vez, acceso para siempre.

Sin cuotas mensuales. Sin renovaciones. <b>Solo $80 y es tuyo de por vida.</b>

<b>Lo que obtienes:</b>
💎 Acceso PRIME completo — permanente
🔴 Shows en vivo y transmisiones exclusivas
🎬 Contenido exclusivo PRIME y sesiones con creadores
📣 Feed completo, DMs, Hangouts, Nearby — todo
🛡️ Soporte prioritario, siempre

<b>Tres formas de pagar — todas a $80 fijo:</b>
💳 <b>Tarjeta</b> — Visa o Mastercard vía ePayco. Checkout seguro y discreto.
🥷 <b>Dash</b> — desde tu wallet Dash. Anónimo. Sin nombre, sin banco.
🪙 <b>USDC</b> — dólar digital estable. Checkout fácil vía NOWPayments.

👉 <a href="${PAGE_URL}">${PAGE_URL}</a>

💡 <b>¿No estás listo para el lifetime?</b> También tenemos planes mensuales y anuales:
👉 <a href="${SUBSCRIBE_URL}">${SUBSCRIBE_URL}</a>`,
};

const EMAIL_SUBJECT = {
  en: '🔥 Lifetime PRIME — $80 one-time — pay with card, Dash, or USDC. Yours forever.',
  es: '🔥 Lifetime PRIME — $80 pago único — paga con tarjeta, Dash o USDC. Tuyo para siempre.',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  const greeting = en ? `Hey ${name}!` : `¡Hola ${name}!`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${en ? 'Lifetime PRIME — $80 One-Time' : 'Lifetime PRIME — $80 Pago Único'}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(38,161,123,0.30);">
        <!-- Top accent bar -->
        <tr><td style="height:4px;background:linear-gradient(90deg,#26a17b,#008DE4);"></td></tr>

        <!-- Logo -->
        <tr><td style="padding:28px 32px 8px;">
          <img src="https://pnptv.app/logo-header.png" alt="PNPtv!" height="32" style="display:block;">
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:16px 32px 32px;">
          <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${greeting}</p>

          <!-- Hero headline -->
          <h1 style="margin:0 0 8px;font-size:26px;font-weight:900;color:#ffffff;line-height:1.15;">
            🔥 ${en ? 'Lifetime PRIME — $80. One payment. Forever.' : 'Lifetime PRIME — $80. Un pago. Para siempre.'}
          </h1>
          <p style="margin:0 0 24px;font-size:15px;color:#9ca3af;line-height:1.5;">
            ${en
              ? 'No renewals. No monthly fees. Pay once with card, Dash, or USDC — and PRIME is yours for life.'
              : 'Sin renovaciones. Sin cuotas mensuales. Paga una vez con tarjeta, Dash o USDC — y PRIME es tuyo de por vida.'}
          </p>

          <!-- Price block -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:24px;background:rgba(38,161,123,0.08);border:1px solid rgba(38,161,123,0.30);border-radius:16px;text-align:center;">
              <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#26a17b;">
                ${en ? 'EXCLUSIVE OFFER · ONE-TIME PAYMENT' : 'OFERTA EXCLUSIVA · PAGO ÚNICO'}
              </p>
              <p style="margin:0 0 2px;font-size:16px;color:#636366;text-decoration:line-through;font-weight:600;">$250</p>
              <p style="margin:0;font-size:56px;font-weight:900;color:#26a17b;line-height:1;text-shadow:0 0 30px rgba(38,161,123,0.4);">$80</p>
              <p style="margin:8px 0 0;font-size:13px;color:#9ca3af;">${en ? 'Pay once — Full PRIME, forever' : 'Paga una vez — PRIME completo, para siempre'}</p>
            </td></tr>
          </table>

          <!-- Benefits -->
          <p style="margin:0 0 12px;font-size:15px;font-weight:800;color:#ffffff;">
            ${en ? "What's included:" : 'Qué incluye:'}
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            ${[
              en ? ['💎', 'Full PRIME access — permanently', 'Every exclusive feature, no expiry'] : ['💎', 'Acceso PRIME completo — permanente', 'Cada función exclusiva, sin expiración'],
              en ? ['🔴', 'Exclusive live shows & streams', 'PRIME-only broadcasts from creators'] : ['🔴', 'Shows en vivo exclusivos', 'Transmisiones solo para PRIME'],
              en ? ['🎬', 'All exclusive content', 'Creator sessions, locked posts, everything'] : ['🎬', 'Todo el contenido exclusivo', 'Sesiones de creadores, posts privados, todo'],
              en ? ['📣', 'Full platform access', 'Feed, DMs, Hangouts, Nearby and more'] : ['📣', 'Acceso completo a la plataforma', 'Feed, DMs, Hangouts, Nearby y más'],
              en ? ['🛡️', 'Priority support, always', 'Get help first, always'] : ['🛡️', 'Soporte prioritario, siempre', 'Atención preferencial, siempre'],
            ].map(([emoji, title, sub]) => `
            <tr><td style="padding:0 0 8px;">
              <div style="display:flex;align-items:flex-start;padding:12px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;">
                <span style="font-size:18px;flex-shrink:0;margin-right:12px;margin-top:1px;">${emoji}</span>
                <div>
                  <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#ffffff;">${title}</p>
                  <p style="margin:0;font-size:12px;color:#9ca3af;">${sub}</p>
                </div>
              </div>
            </td></tr>`).join('')}
          </table>

          <!-- Payment methods -->
          <p style="margin:0 0 12px;font-size:15px;font-weight:800;color:#ffffff;">
            ${en ? 'Three ways to pay — all $80 flat:' : 'Tres formas de pagar — todas a $80 fijo:'}
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr>
              <td width="33%" style="padding:0 4px 0 0;">
                <div style="padding:14px 10px;background:rgba(212,0,122,0.08);border:1px solid rgba(212,0,122,0.30);border-radius:12px;text-align:center;">
                  <p style="margin:0 0 6px;font-size:22px;">💳</p>
                  <p style="margin:0 0 3px;font-size:12px;font-weight:800;color:#D4007A;">${en ? 'Card' : 'Tarjeta'}</p>
                  <p style="margin:0;font-size:10px;color:#9ca3af;line-height:1.4;">${en ? 'Visa or Mastercard via ePayco. Safe &amp; discreet.' : 'Visa o Mastercard vía ePayco. Seguro y discreto.'}</p>
                </div>
              </td>
              <td width="33%" style="padding:0 2px;">
                <div style="padding:14px 10px;background:rgba(0,141,228,0.08);border:1px solid rgba(0,141,228,0.30);border-radius:12px;text-align:center;">
                  <p style="margin:0 0 6px;font-size:22px;">🥷</p>
                  <p style="margin:0 0 3px;font-size:12px;font-weight:800;color:#008DE4;">Dash</p>
                  <p style="margin:0;font-size:10px;color:#9ca3af;line-height:1.4;">${en ? 'Anonymous. No name, no bank.' : 'Anónimo. Sin nombre, sin banco.'}</p>
                </div>
              </td>
              <td width="33%" style="padding:0 0 0 4px;">
                <div style="padding:14px 10px;background:rgba(38,161,123,0.08);border:1px solid rgba(38,161,123,0.30);border-radius:12px;text-align:center;">
                  <p style="margin:0 0 6px;font-size:22px;">🪙</p>
                  <p style="margin:0 0 3px;font-size:12px;font-weight:800;color:#26a17b;">USDC</p>
                  <p style="margin:0;font-size:10px;color:#9ca3af;line-height:1.4;">${en ? 'Stable digital dollar via NowPayments.' : 'Dólar digital estable vía NowPayments.'}</p>
                </div>
              </td>
            </tr>
          </table>

          <!-- CTA -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
            <tr><td align="center">
              <a href="${PAGE_URL}" style="display:inline-block;padding:18px 48px;background:linear-gradient(90deg,#26a17b,#008DE4);color:#ffffff;font-size:16px;font-weight:800;text-decoration:none;border-radius:14px;letter-spacing:0.05em;text-transform:uppercase;">
                ${en ? 'Claim Lifetime PRIME →' : 'Obtén Lifetime PRIME →'}
              </a>
            </td></tr>
            <tr><td align="center" style="padding-top:10px;">
              <a href="${PAGE_URL}" style="font-size:12px;color:#6b7280;text-decoration:underline;">${PAGE_URL}</a>
            </td></tr>
          </table>

          <!-- Other plans -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="padding:16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;text-align:center;">
              <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#ffffff;">
                💡 ${en ? 'Not ready for a lifetime deal?' : '¿No estás listo para el lifetime?'}
              </p>
              <p style="margin:0 0 10px;font-size:12px;color:#9ca3af;">
                ${en ? 'We also offer monthly and yearly subscription plans.' : 'También tenemos planes mensuales y anuales.'}
              </p>
              <a href="${SUBSCRIBE_URL}" style="display:inline-block;padding:10px 28px;background:rgba(255,255,255,0.08);color:#ffffff;font-size:13px;font-weight:700;text-decoration:none;border-radius:8px;border:1px solid rgba(255,255,255,0.15);">
                ${en ? 'View all plans →' : 'Ver todos los planes →'}
              </a>
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
  console.log(' Lifetime PRIME $80 Launch Broadcast');
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

  // Dedup: only send TG/email to users who haven't received this broadcast yet.
  // In-app and push always refresh for everyone. Pass --force to override.
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
      // Resend API — 5 req/sec hard limit; send one at a time with 220ms gap
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
      // Fallback: Hostinger SMTP (pooled, rate-limited — subject to ~300/hr cap)
      console.warn('     RESEND_API_KEY not set — falling back to Hostinger SMTP (rate-limited)');
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
