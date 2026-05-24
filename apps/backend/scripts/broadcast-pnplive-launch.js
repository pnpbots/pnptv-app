#!/usr/bin/env node
'use strict';

/**
 * broadcast-pnplive-launch.js
 *
 * PNP Live launch broadcast — June 1st announcement + Lifetime $100 + $20 tokens offer.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-pnplive-launch.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-pnplive-launch.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-pnplive-launch.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-pnplive-launch.js --skip-telegram
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-pnplive-launch.js --email-only
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query } = require(path.join(BACKEND, 'config/postgres'));
const PushNotificationService = require(path.join(BACKEND, 'services/pushNotificationService'));
const nodemailer = require('nodemailer');
const { Telegram } = require('telegraf');

const DRY_RUN       = process.argv.includes('--dry-run');
const SKIP_EMAIL    = process.argv.includes('--skip-email');
const SKIP_TELEGRAM = process.argv.includes('--skip-telegram');
const EMAIL_ONLY    = process.argv.includes('--email-only');

const ENTITY_ID    = 'pnplive-launch-june1-2026';
const CHECKOUT_URL = 'https://pnptv.app/lifetime100';
const TG_DELAY_MS  = 80;
const EMAIL_DELAY_MS = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ─────────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `⚠️ LAST CHANCE — Prime Lifetime for just $100! Promo ends in 15 minutes FOREVER. Access + Founder badge + $20 tokens for June 1st Live launch. →`,
  es: `⚠️ ÚLTIMA OPORTUNIDAD — Lifetime PRIME por solo $100! La promo termina en 15 minutos PARA SIEMPRE. Acceso + medalla Fundador + $20 tokens para el lanzamiento Live del 1 de junio. →`,
};

const PUSH = {
  en: {
    title: '⚠️ LAST CHANCE — Prime Lifetime $100 — 15 min left',
    body:  'Promo ends FOREVER. Get access + Founder badge + $20 tokens for June 1st Live launch.',
  },
  es: {
    title: '⚠️ ÚLTIMA OPORTUNIDAD — Lifetime PRIME $100 — 15 min',
    body:  'La promo termina PARA SIEMPRE. Acceso + medalla Fundador + $20 tokens para Live el 1 de junio.',
  },
};

const TG = {
  en:
`⚠️ <b>LAST CHANCE — Prime Lifetime for just $100</b>

This promo ends in <b>15 minutes — forever.</b> Once it's gone, it's gone.

Buy now and you get:

🏆 <b>Full PRIME membership — for life.</b> Every feature, every creator, no monthly fee ever.
🏅 <b>Founder badge</b> on your profile — forever.
🪙 <b>$20 PNP Tokens</b> credited to your wallet — ready to spend on <b>June 1st when PNP Live launches.</b>

One payment. Everything. Forever.

👉 <a href="${CHECKOUT_URL}">${CHECKOUT_URL}</a>`,

  es:
`⚠️ <b>ÚLTIMA OPORTUNIDAD — Lifetime PRIME por solo $100</b>

Esta promo termina en <b>15 minutos — para siempre.</b> Cuando se acaba, se acaba.

Compra ahora y obtienes:

🏆 <b>Membresía PRIME completa — de por vida.</b> Todas las funciones, todos los creadores, sin mensualidad jamás.
🏅 <b>Medalla Fundador</b> en tu perfil — para siempre.
🪙 <b>$20 PNP Tokens</b> acreditados en tu wallet — listos para gastar el <b>1 de junio cuando PNP Live lanza.</b>

Un solo pago. Todo. Para siempre.

👉 <a href="${CHECKOUT_URL}">${CHECKOUT_URL}</a>`,
};

const EMAIL_SUBJECT = {
  en: '⚠️ LAST CHANCE — Prime Lifetime $100 — promo ends in 15 min forever',
  es: '⚠️ ÚLTIMA OPORTUNIDAD — Lifetime PRIME $100 — la promo termina en 15 min para siempre',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  const greeting = en ? `Hey ${name}!` : `¡Hola ${name}!`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${en ? 'LAST CHANCE — Prime Lifetime $100' : 'ÚLTIMA OPORTUNIDAD — Lifetime PRIME $100'}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(255,51,51,0.25);">
        <tr><td style="height:4px;background:linear-gradient(90deg,#ff3333,#ff3377,#ff9933);"></td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <img src="https://pnptv.app/logo-header.png" alt="PNPtv!" height="32" style="display:block;">
        </td></tr>
        <tr><td style="padding:16px 32px 32px;">
          <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${greeting}</p>
          <h1 style="margin:0 0 8px;font-size:24px;font-weight:900;color:#ff3333;line-height:1.2;">
            ⚠️ ${en ? 'LAST CHANCE — Prime Lifetime for just $100' : 'ÚLTIMA OPORTUNIDAD — Lifetime PRIME por solo $100'}
          </h1>

          <!-- Countdown banner -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
            <tr><td style="padding:14px 16px;background:#ff3333;border-radius:10px;text-align:center;">
              <p style="margin:0;font-size:15px;font-weight:900;color:#ffffff;letter-spacing:0.04em;">
                ⏱ ${en ? 'PROMO ENDS IN 15 MINUTES — FOREVER' : 'LA PROMO TERMINA EN 15 MINUTOS — PARA SIEMPRE'}
              </p>
            </td></tr>
          </table>

          <!-- What you get -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:20px;background:rgba(255,51,51,0.10);border:1px solid rgba(255,51,51,0.35);border-radius:12px;">
              <p style="margin:0 0 12px;font-size:14px;color:#d1d5db;line-height:1.6;">
                ${en ? 'One payment of <b style="color:#fff;font-size:20px;">$100</b>. Everything. Forever.' : 'Un pago de <b style="color:#fff;font-size:20px;">$100</b>. Todo. Para siempre.'}
              </p>
              <p style="margin:0 0 6px;font-size:13px;color:#d1d5db;">🏆 ${en ? '<b style="color:#fff;">Full PRIME membership</b> — for life, no monthly fee ever' : '<b style="color:#fff;">Membresía PRIME completa</b> — de por vida, sin mensualidad jamás'}</p>
              <p style="margin:0 0 6px;font-size:13px;color:#d1d5db;">🏅 ${en ? '<b style="color:#fff;">Founder badge</b> on your profile — forever' : '<b style="color:#fff;">Medalla Fundador</b> en tu perfil — para siempre'}</p>
              <p style="margin:0;font-size:13px;color:#d1d5db;">🪙 ${en ? '<b style="color:#fff;">$20 PNP Tokens</b> in your wallet — ready for <b style="color:#fff;">June 1st when PNP Live launches</b>' : '<b style="color:#fff;">$20 PNP Tokens</b> en tu wallet — listos para el <b style="color:#fff;">1 de junio cuando PNP Live lanza</b>'}</p>
            </td></tr>
          </table>

          <!-- CTA -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td align="center">
              <a href="${CHECKOUT_URL}" style="display:inline-block;padding:18px 44px;background:#ff3333;color:#ffffff;font-size:16px;font-weight:900;text-decoration:none;border-radius:12px;letter-spacing:0.05em;text-transform:uppercase;">
                ${en ? 'Get Lifetime Now — $100 →' : 'Obtener Lifetime Ahora — $100 →'}
              </a>
            </td></tr>
          </table>

        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.08);">
          <p style="margin:0;font-size:11px;color:#6b7280;line-height:1.5;">
            ${en
              ? 'You received this as a member of PNPtv!.'
              : 'Recibiste esto por ser miembro de PNPtv!.'}
          </p>
          <p style="margin:4px 0 0;font-size:11px;color:#6b7280;">🔒 Encrypted · Discreet billing · pnptv.app</p>
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
  console.log(' PNP Live Launch — Broadcast');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN)    console.log(' MODE: DRY RUN — nothing will be sent\n');
  if (SKIP_EMAIL) console.log(' --skip-email: email channel will be skipped\n');
  if (SKIP_TELEGRAM) console.log(' --skip-telegram: Telegram channel will be skipped\n');

  console.log('\n── Fetching broadcast targets...');
  const { rows: users } = await query(`
    SELECT u.id, u.first_name, u.username, u.email, u.telegram, u.language
    FROM users u
    WHERE COALESCE(u.is_deleted, false) = false
      AND u.role != 'banned'
    ORDER BY u.id
  `);

  const withTelegram = users.filter(u => u.telegram);
  const withEmail    = users.filter(u => u.email && !u.email.includes('@telegram.pnptv.app'));

  console.log(`   Total target users:  ${users.length}`);
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
        `, [ids, ENTITY_ID, msg, JSON.stringify({ url: CHECKOUT_URL })]);
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
      if (enIds.length) pushSent += await PushNotificationService.sendToUsers(enIds, { ...PUSH.en, url: CHECKOUT_URL, tag: ENTITY_ID });
      if (esIds.length) pushSent += await PushNotificationService.sendToUsers(esIds, { ...PUSH.es, url: CHECKOUT_URL, tag: ENTITY_ID });
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
    const transporter = nodemailer.createTransport({
      host:   process.env.PNPTV_SMTP_HOST,
      port:   parseInt(process.env.PNPTV_SMTP_PORT || '587', 10),
      secure: process.env.PNPTV_SMTP_SECURE === 'true',
      auth:   { user: process.env.PNPTV_SMTP_USER, pass: process.env.PNPTV_SMTP_PASS },
    });
    for (let i = 0; i < withEmail.length; i++) {
      const u = withEmail[i];
      const lang = isEn(u.language) ? 'en' : 'es';
      const name = u.first_name || u.username || (lang === 'en' ? 'Member' : 'Miembro');
      try {
        await transporter.sendMail({
          from: '"PNPtv!" <support@pnptv.app>',
          to:   u.email,
          subject: EMAIL_SUBJECT[lang],
          html: buildEmailHtml(lang, name),
        });
        stats.email++;
      } catch (err) {
        stats.emailFailed++;
        if (stats.emailFailed <= 5 || stats.emailFailed % 50 === 0) {
          console.warn(`     Email err [${u.email}]: ${err.message}`);
        }
      }
      await sleep(EMAIL_DELAY_MS);
      if ((i + 1) % 100 === 0) console.log(`     Email progress: ${i + 1}/${withEmail.length}`);
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
