#!/usr/bin/env node
'use strict';

/**
 * broadcast-referral-growth-june-2026.js
 *
 * Invites all active members to share their referral link.
 * Each user receives a personalized message with their own link
 * plus suggested copy-paste text to forward to friends.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-referral-growth-june-2026.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-referral-growth-june-2026.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-referral-growth-june-2026.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-referral-growth-june-2026.js --skip-telegram
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

const ENTITY_ID          = 'referral-growth-june-2026';
const APP_URL            = 'https://pnptv.app';
const REFERRALS_URL      = `${APP_URL}/referrals`;
const TG_DELAY_MS        = 80;
const EMAIL_RATE_PER_SEC = 0.25;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');
const refUrl = (code) => `${APP_URL}/join?ref=${code}`;

// ── Messages ──────────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: '🎁 Grow the community — share your referral link. You both get 24h of PRIME free every time someone signs up.',
  es: '🎁 Haz crecer la comunidad — comparte tu enlace. Ambos obtienen 24h de PRIME gratis cada vez que alguien se registra.',
};

const PUSH = {
  en: { title: '🎁 Share your link, earn PRIME', body: 'Every time someone signs up with your link, you both get 24h of PRIME free.' },
  es: { title: '🎁 Comparte tu enlace, gana PRIME', body: 'Cada vez que alguien se registra con tu enlace, ambos reciben 24h de PRIME gratis.' },
};

const TG = {
  en: (name, code) => {
    const url = refUrl(code);
    return `🎁 <b>Help PNPtv! grow, ${name} — and earn PRIME while you do it:</b>

Every time someone signs up using your personal referral link, <b>both of you get 24 hours of PRIME free</b> — instantly, no payment needed. Plus, when they buy their first plan, you earn <b>PNP Live tokens</b>.

🔗 <b>Your referral link:</b>
<code>${url}</code>

📋 <b>Suggested text to share</b> (copy &amp; paste to WhatsApp, Instagram, Telegram, anywhere):

<i>Join me on PNPtv! 🔥 The queer PNP community app — exclusive content, live shows, video calls &amp; more. Sign up with my link and we both get 24 hours of PRIME free 👇
${url}</i>

Share it — the community grows with you 🏳️‍🌈`;
  },

  es: (name, code) => {
    const url = refUrl(code);
    return `🎁 <b>Ayuda a que PNPtv! crezca, ${name} — y gana PRIME mientras lo haces:</b>

Cada vez que alguien se registra con tu enlace personal, <b>ambos reciben 24 horas de PRIME gratis</b> — automáticamente, sin pagar nada. Y cuando esa persona compre su primer plan, tú ganas <b>tokens PNP Live</b>.

🔗 <b>Tu enlace de referido:</b>
<code>${url}</code>

📋 <b>Texto sugerido para compartir</b> (cópialo y pégalo en WhatsApp, Instagram, Telegram, donde quieras):

<i>¡Únete a PNPtv! 🔥 La app de la comunidad PNP queer — contenido exclusivo, shows en vivo, videollamadas y más. Regístrate con mi enlace y los dos recibimos 24 horas de PRIME gratis 👇
${url}</i>

Comparte — la comunidad crece contigo 🏳️‍🌈`;
  },
};

const EMAIL_SUBJECT = {
  en: '🎁 Share your link — you both get 24h of PRIME free',
  es: '🎁 Comparte tu enlace — ambos reciben 24h de PRIME gratis',
};

function buildEmailHtml(lang, name, code) {
  const en  = lang === 'en';
  const url = refUrl(code);
  const suggestedText = en
    ? `Join me on PNPtv! 🔥 The queer PNP community app — exclusive content, live shows, video calls &amp; more. Sign up with my link and we both get 24 hours of PRIME free 👇\n${url}`
    : `¡Únete a PNPtv! 🔥 La app de la comunidad PNP queer — contenido exclusivo, shows en vivo, videollamadas y más. Regístrate con mi enlace y los dos recibimos 24 horas de PRIME gratis 👇\n${url}`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${en ? 'Share your referral link — PNPtv!' : 'Comparte tu enlace — PNPtv!'}</title>
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
            🎁 ${en ? 'Help PNPtv! grow — and earn PRIME doing it.' : 'Haz crecer PNPtv! — y gana PRIME haciéndolo.'}
          </h1>
          <p style="margin:0 0 24px;font-size:14px;color:#9ca3af;line-height:1.6;">
            ${en
              ? 'Every time someone signs up using your referral link, <strong style="color:#fff;">both of you get 24 hours of PRIME free</strong> — instantly, no payment needed. When they buy their first plan, you also earn <strong style="color:#D4007A;">PNP Live tokens</strong>.'
              : 'Cada vez que alguien se registra con tu enlace, <strong style="color:#fff;">ambos reciben 24 horas de PRIME gratis</strong> — automáticamente, sin pagar nada. Cuando compren su primer plan, tú además ganas <strong style="color:#D4007A;">tokens PNP Live</strong>.'}
          </p>

          <!-- Referral link box -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:20px;background:rgba(212,0,122,0.08);border:1px solid rgba(212,0,122,0.30);border-radius:14px;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#D4007A;text-transform:uppercase;letter-spacing:0.05em;">
                🔗 ${en ? 'Your referral link' : 'Tu enlace de referido'}
              </p>
              <p style="margin:0;font-family:monospace;font-size:13px;color:#ffffff;word-break:break-all;">${url}</p>
            </td></tr>
          </table>

          <!-- Suggested text box -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="padding:20px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:14px;">
              <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#ffffff;text-transform:uppercase;letter-spacing:0.05em;">
                📋 ${en ? 'Suggested text to share' : 'Texto sugerido para compartir'}
              </p>
              <p style="margin:0 0 6px;font-size:12px;color:#6b7280;">
                ${en ? 'Copy & paste to WhatsApp, Instagram, Telegram — wherever:' : 'Cópialo y pégalo en WhatsApp, Instagram, Telegram — donde quieras:'}
              </p>
              <p style="margin:0;font-size:13px;color:#d1d5db;line-height:1.7;white-space:pre-line;">${suggestedText}</p>
            </td></tr>
          </table>

          <div style="text-align:center;margin-bottom:28px;">
            <a href="${REFERRALS_URL}" style="display:inline-block;padding:14px 36px;background:linear-gradient(90deg,#D4007A,#7B61FF);color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;border-radius:12px;">
              ${en ? 'See my referral stats →' : 'Ver mis estadísticas de referidos →'}
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
  console.log(' Referral Growth Broadcast — June 2026');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN)       console.log(' MODE: DRY RUN — nothing will be sent\n');
  if (SKIP_EMAIL)    console.log(' --skip-email\n');
  if (SKIP_TELEGRAM) console.log(' --skip-telegram\n');

  // Ensure all users have a ref_code (generate if missing using same MD5 algorithm)
  await query(`
    UPDATE users
    SET ref_code = UPPER(SUBSTRING(md5(id::text || 'pnptv2026ref'), 1, 8))
    WHERE ref_code IS NULL
      AND COALESCE(is_deleted, false) = false
      AND role != 'banned'
  `);

  const { rows: users } = await query(`
    SELECT u.id, u.first_name, u.username, u.email, u.telegram, u.language, u.ref_code
    FROM users u
    WHERE COALESCE(u.is_deleted, false) = false
      AND u.role != 'banned'
      AND u.ref_code IS NOT NULL
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
  console.log(`   New targets:      ${users.filter(isNew).length}`);
  console.log(`   With Telegram:    ${withTelegram.length}`);
  console.log(`   With real email:  ${withEmail.length}`);

  const stats = { inApp: 0, push: 0, telegram: 0, telegramFailed: 0, email: 0, emailFailed: 0 };

  // 1. In-app bell notification (non-personalized, links to Referral Center)
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
        `, [ids, ENTITY_ID, msg, JSON.stringify({ url: REFERRALS_URL })]);
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
      if (enIds.length) pushSent += await PushNotificationService.sendToUsers(enIds, { ...PUSH.en, url: REFERRALS_URL, tag: ENTITY_ID });
      if (esIds.length) pushSent += await PushNotificationService.sendToUsers(esIds, { ...PUSH.es, url: REFERRALS_URL, tag: ENTITY_ID });
      stats.push = pushSent;
      console.log(`     ✓ ${pushSent} push sent`);
    } catch (err) { console.error(`     ✗ ${err.message}`); }
  } else {
    console.log(`     [DRY] Would push to subscribed users`);
  }

  // 3. Telegram (personalized with each user's link + suggested text)
  console.log(`3/4  Telegram to ${withTelegram.length} users...`);
  if (!DRY_RUN && !SKIP_TELEGRAM) {
    const tg = new Telegram(process.env.BOT_TOKEN);
    for (let i = 0; i < withTelegram.length; i++) {
      const u = withTelegram[i];
      const lang = isEn(u.language) ? 'en' : 'es';
      const name = u.first_name || u.username || (lang === 'en' ? 'there' : 'amigo');
      try {
        await tg.sendMessage(u.telegram, TG[lang](name, u.ref_code), { parse_mode: 'HTML', disable_web_page_preview: true });
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
    console.log(TG.es('Amigo', 'XXXXXXXX'));
    console.log('\n── Sample TG message (EN) ──\n');
    console.log(TG.en('there', 'XXXXXXXX'));
  } else {
    console.log('     [SKIPPED] --skip-telegram');
  }

  // 4. Email (personalized with each user's link + suggested text)
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
          subject: EMAIL_SUBJECT[lang],
          html: buildEmailHtml(lang, name, u.ref_code),
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
