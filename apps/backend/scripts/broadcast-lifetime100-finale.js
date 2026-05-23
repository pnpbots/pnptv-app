#!/usr/bin/env node
'use strict';

/**
 * broadcast-lifetime100-finale.js
 *
 * Lifetime100 closing broadcast — last 12 hours.
 *
 * Actions:
 *   1. Grant "founder" badge (slug='founder') to all lifetime pnp-member holders who lack it.
 *   2. Add 20 tokens to every lifetime pnp-member holder's wallet (UPSERT).
 *   3. Broadcast the finale message to ALL active users:
 *      - In-app notification bell
 *      - Web push
 *      - Telegram bot message
 *      - Email
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-lifetime100-finale.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-lifetime100-finale.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-lifetime100-finale.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-lifetime100-finale.js --skip-grants
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
const SKIP_GRANTS   = process.argv.includes('--skip-grants');
const EMAIL_ONLY    = process.argv.includes('--email-only');

const ENTITY_ID    = 'lifetime100-finale-2026-05-23';
const CHECKOUT_URL = 'https://pnptv.app/lifetime100';
const TG_DELAY_MS  = 80;
const EMAIL_DELAY_MS = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Step 1+2: Badge + token grants for lifetime holders ──────────────────────

async function runGrants() {
  console.log('\n── Grants: fetching lifetime pnp-member holders...');
  const { rows: holders } = await query(`
    SELECT DISTINCT ue.user_id
    FROM user_entitlements ue
    WHERE ue.add_on_id = 'pnp-member'
      AND ue.is_lifetime = true
  `);
  console.log(`   Found ${holders.length} lifetime holders`);

  const userIds = holders.map(r => r.user_id);

  // Badge grant
  const { rows: badgeRows } = await query(`SELECT id FROM gamification_badges WHERE slug = 'founder' LIMIT 1`);
  if (!badgeRows.length) { console.error('   ERROR: founder badge not found'); } else {
    const badgeId = badgeRows[0].id;
    if (DRY_RUN) {
      console.log(`   [DRY] Would upsert founder badge for ${userIds.length} users`);
    } else {
      let badgeGranted = 0;
      for (const uid of userIds) {
        const r = await query(
          `INSERT INTO user_badges (user_id, badge_id, awarded_by, note)
           VALUES ($1, $2, NULL, 'Lifetime100 founding member')
           ON CONFLICT (user_id, badge_id) DO NOTHING`,
          [uid, badgeId]
        );
        if (r.rowCount > 0) badgeGranted++;
      }
      console.log(`   ✓ Founder badge granted to ${badgeGranted} new holders (${userIds.length - badgeGranted} already had it)`);
    }
  }

  // Token grant — 20 tokens per holder
  if (DRY_RUN) {
    console.log(`   [DRY] Would add 20 tokens to ${userIds.length} wallets`);
  } else {
    let tokensGranted = 0;
    for (const uid of userIds) {
      await query(
        `INSERT INTO user_token_wallets (user_id, balance_tokens, updated_at)
         VALUES ($1, 20, NOW())
         ON CONFLICT (user_id) DO UPDATE
           SET balance_tokens = user_token_wallets.balance_tokens + 20,
               updated_at = NOW()`,
        [uid]
      );
      tokensGranted++;
    }
    console.log(`   ✓ 20 tokens added to ${tokensGranted} wallets`);
  }
}

// ── Messages ─────────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `🔥 Last 12 hours — Lifetime Founder pass closes tonight. Pay with Dash and save 20% ($79.99). All existing Founders just got 20 PNP Tokens + Founder badge. →`,
  es: `🔥 Últimas 12 horas — El pase Lifetime Founder cierra esta noche. Paga con Dash y ahorra 20% ($79.99). Los Fundadores ya recibieron 20 tokens PNP + medalla Fundador. →`,
};

const PUSH = {
  en: { title: '🔥 Last 12 hours — Lifetime Founder pass closes tonight', body: 'Pay with Dash and save 20% — $79.99. Existing founders: 20 tokens + badge in your wallet.' },
  es: { title: '🔥 Últimas 12 horas — El pase Lifetime Founder cierra esta noche', body: 'Paga con Dash y ahorra 20% — $79.99. Fundadores: 20 tokens + medalla en tu wallet.' },
};

const TG = {
  en:
`🔥 <b>Last 12 hours — Lifetime100 closes tonight</b>

This is it. Tonight is the last chance to grab a Lifetime Founder pass.

<b>🎉 Thank you for building PNPtv! with us.</b> You trusted us when this was just an idea, and we're still here — live, growing, and getting better every week.

Here's what's happening:

💳 <b>Stripe (card payments) is coming back.</b> You helped us fund the platform. We're restoring Visa/Mastercard this week.

⚡ <b>Pay with Dash tonight and save 20%</b> — only <b>$79.99</b> instead of $99.99. Anonymous, instant, no bank required.

🏅 <b>If you already bought Lifetime100</b> — you've just been awarded the <b>Founder badge</b> and <b>20 PNP Tokens</b> ($20 value) for PNP Live sessions. Check your wallet!

🎬 <b>Santino is creating new exclusive content for PRIME members.</b> Stay tuned.

👉 <a href="${CHECKOUT_URL}">${CHECKOUT_URL}</a>`,

  es:
`🔥 <b>Últimas 12 horas — Lifetime100 cierra esta noche</b>

Esto es. Esta noche es la última oportunidad para obtener un pase Lifetime Founder.

<b>🎉 Gracias por construir PNPtv! con nosotros.</b> Confiaste en nosotros cuando esto era solo una idea, y aquí seguimos — en vivo, creciendo y mejorando cada semana.

Lo que está pasando:

💳 <b>Stripe (pagos con tarjeta) vuelve.</b> Nos ayudaste a financiar la plataforma. Estamos restaurando Visa/Mastercard esta semana.

⚡ <b>Paga con Dash esta noche y ahorra 20%</b> — solo <b>$79.99</b> en lugar de $99.99. Anónimo, instantáneo, sin banco.

🏅 <b>Si ya compraste Lifetime100</b> — acabas de recibir la <b>medalla Fundador</b> y <b>20 PNP Tokens</b> (valor $20) para sesiones PNP Live. ¡Revisa tu wallet!

🎬 <b>Santino está creando contenido exclusivo nuevo para miembros PRIME.</b> Muy pronto.

👉 <a href="${CHECKOUT_URL}">${CHECKOUT_URL}</a>`,
};

const EMAIL_SUBJECT = {
  en: '🔥 Last 12 hours — Lifetime Founder pass closes tonight',
  es: '🔥 Últimas 12 horas — El pase Lifetime Founder cierra esta noche',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  const greeting = en ? `Hey ${name}!` : `¡Hola ${name}!`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${en ? 'Last 12 hours — Lifetime100 closes tonight' : 'Últimas 12 horas — Lifetime100 cierra esta noche'}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(255,180,84,0.2);">
        <tr><td style="height:4px;background:linear-gradient(90deg,#ff3377,#ff9933);"></td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <img src="https://pnptv.app/logo-header.png" alt="PNPtv!" height="32" style="display:block;">
        </td></tr>
        <tr><td style="padding:16px 32px 32px;">
          <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${greeting}</p>
          <h1 style="margin:0 0 16px;font-size:22px;font-weight:900;color:#ff9933;line-height:1.2;">
            🔥 ${en ? 'Last 12 hours — Lifetime100 closes tonight' : 'Últimas 12 horas — Lifetime100 cierra esta noche'}
          </h1>
          <p style="margin:0 0 20px;font-size:15px;color:#d1d5db;line-height:1.6;">
            ${en
              ? 'Tonight is the last chance to grab a Lifetime Founder pass. Thank you for building PNPtv! with us.'
              : 'Esta noche es la última oportunidad para obtener un pase Lifetime Founder. Gracias por construir PNPtv! con nosotros.'}
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:16px;background:rgba(0,141,228,0.10);border:1px solid rgba(0,141,228,0.30);border-radius:12px;">
              <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#008DE4;">
                ⚡ ${en ? 'Pay with Dash and save 20%' : 'Paga con Dash y ahorra 20%'}
              </p>
              <p style="margin:0;font-size:13px;color:#d1d5db;">
                ${en
                  ? '<b style="color:#fff;">$79.99</b> instead of $99.99 — anonymous, instant, no bank required.'
                  : '<b style="color:#fff;">$79.99</b> en lugar de $99.99 — anónimo, instantáneo, sin banco.'}
              </p>
            </td></tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:16px;background:rgba(255,180,84,0.08);border:1px solid rgba(255,180,84,0.25);border-radius:12px;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#ff9933;">
                🏅 ${en ? 'Already a Founder? You just received:' : '¿Ya eres Fundador? Acabas de recibir:'}
              </p>
              <p style="margin:0 0 4px;font-size:13px;color:#d1d5db;">✅ ${en ? 'Founder badge on your profile' : 'Medalla Fundador en tu perfil'}</p>
              <p style="margin:0;font-size:13px;color:#d1d5db;">✅ ${en ? '20 PNP Tokens ($20 value) for Live sessions' : '20 PNP Tokens (valor $20) para sesiones Live'}</p>
            </td></tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:16px;background:rgba(255,51,119,0.08);border:1px solid rgba(255,51,119,0.25);border-radius:12px;">
              <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#ff3377;">
                💳 ${en ? 'Stripe is coming back' : 'Stripe vuelve'}
              </p>
              <p style="margin:0;font-size:13px;color:#d1d5db;">
                ${en
                  ? 'We\'re restoring Visa/Mastercard payments this week. You helped us get here.'
                  : 'Estamos restaurando Visa/Mastercard esta semana. Nos ayudaste a llegar hasta aquí.'}
              </p>
            </td></tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td align="center">
              <a href="${CHECKOUT_URL}" style="display:inline-block;padding:16px 40px;background:linear-gradient(90deg,#ff3377,#ff9933);color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;border-radius:12px;letter-spacing:0.05em;">
                ${en ? 'Get Lifetime Access →' : 'Obtener Acceso de por Vida →'}
              </a>
            </td></tr>
          </table>

        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.08);">
          <p style="margin:0;font-size:11px;color:#6b7280;line-height:1.5;">
            ${en
              ? 'You received this as a member of PNPtv!. This is the final notification for the Lifetime100 Founder offer.'
              : 'Recibiste esto por ser miembro de PNPtv!. Esta es la notificación final para la oferta Lifetime100 Founder.'}
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
  console.log(' Lifetime100 Finale Broadcast + Grants');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN)    console.log(' MODE: DRY RUN — nothing will be sent or granted\n');
  if (SKIP_EMAIL) console.log(' --skip-email: email channel will be skipped\n');
  if (SKIP_GRANTS) console.log(' --skip-grants: badge/token grants will be skipped\n');

  // Step 1+2: Badge + token grants
  if (!SKIP_GRANTS) {
    await runGrants();
  } else {
    console.log('\n── Grants skipped (--skip-grants)\n');
  }

  // Step 3: Broadcast to all active users
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
  } else {
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
  } else {
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
