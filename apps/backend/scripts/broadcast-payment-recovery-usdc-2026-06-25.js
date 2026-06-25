#!/usr/bin/env node
'use strict';

/**
 * broadcast-payment-recovery-usdc-2026-06-25.js
 *
 * Daily recovery outreach to users who attempted a payment in the last 90 days,
 * never completed it, and have no active entitlement.
 *
 * Anti-spam: 30-day per-user cooldown — users already contacted are skipped.
 * Daily runs only reach genuinely new abandonments.
 *
 * Channels:
 *   1. In-app DM from pnptv-official (system sender)
 *   2. Telegram direct bot message (users with telegram linked)
 *   3. Email via Hostinger SMTP (non-placeholder emails only)
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-payment-recovery-usdc-2026-06-25.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-payment-recovery-usdc-2026-06-25.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-payment-recovery-usdc-2026-06-25.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-payment-recovery-usdc-2026-06-25.js --skip-telegram
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-payment-recovery-usdc-2026-06-25.js --skip-dm
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-payment-recovery-usdc-2026-06-25.js --force
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }    = require(path.join(BACKEND, 'config/postgres'));
const sendSystemDM = require(path.join(BACKEND, 'services/sendSystemDM'));
const nodemailer   = require('nodemailer');
const { Telegram } = require('telegraf');

const DRY_RUN       = process.argv.includes('--dry-run');
const SKIP_EMAIL    = process.argv.includes('--skip-email');
const SKIP_DM       = process.argv.includes('--skip-dm');
const SKIP_TELEGRAM = process.argv.includes('--skip-telegram');
const FORCE         = process.argv.includes('--force');

const SYSTEM_SENDER  = 'pnptv-official';
const ENTITY_TYPE    = 'broadcast';
const ENTITY_PREFIX  = 'payment-recovery-usdc';
const COOLDOWN_DAYS  = 30;
const DM_DELAY_MS    = 80;
const MAIL_DELAY_MS  = 120;
const TG_DELAY_MS    = 150;
const ADMIN_EMAIL    = 'CARLOSJIMENEZMANRIQUE@gmail.com';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

const DM = {
  en: `👋 Hi — this is PNPtv.

We noticed you started a subscription but the payment didn't go through. No worries — it happens.

The easiest way to pay right now is with **USDC** (a crypto dollar, always worth $1):

1. Download **Trust Wallet** (free, Android & iOS)
2. Inside the app, buy USDC on the Solana network (cheapest fees — under $0.01)
3. Go to https://pnptv.app/subscribe, pick your plan, choose USDC, and scan the QR code or copy the address

That's it. No bank, no middlemen, no risk of getting blocked.

If you need help with any step, just reply here — we'll walk you through it. 🖤

— PNPtv`,

  es: `👋 Hola — te escribe PNPtv.

Notamos que intentaste suscribirte pero el pago no se completó. Sin problema, pasa seguido.

La forma más fácil de pagar ahora mismo es con **USDC** (un dólar cripto, siempre vale $1):

1. Descarga **Trust Wallet** (gratis, Android & iOS)
2. Dentro de la app, compra USDC en la red Solana (las comisiones más baratas — menos de $0.01)
3. Ve a https://pnptv.app/subscribe, elige tu plan, selecciona USDC y escanea el QR o copia la dirección

Listo. Sin banco, sin intermediarios, sin riesgo de bloqueos.

Si necesitas ayuda con algún paso, responde aquí — te guiamos. 🖤

— PNPtv`,
};

const TG_MESSAGE = {
  en: (name) =>
    `👋 Hi ${name} — PNPtv here.\n\nWe noticed your payment didn't go through. Easiest fix: pay with USDC via Trust Wallet.\n\n1. Download Trust Wallet (free)\n2. Buy USDC on Solana (fees < $0.01)\n3. Go to https://pnptv.app/subscribe → pick your plan → choose USDC\n\nReply if you need help 🖤`,
  es: (name) =>
    `👋 Hola ${name} — te escribe PNPtv.\n\nNotamos que tu pago no se completó. La solución más fácil: paga con USDC desde Trust Wallet.\n\n1. Descarga Trust Wallet (gratis)\n2. Compra USDC en Solana (comisiones < $0.01)\n3. Ve a https://pnptv.app/subscribe → elige tu plan → selecciona USDC\n\nResponde si necesitas ayuda 🖤`,
};

const EMAIL_SUBJECT = {
  en: 'Your PNPtv payment — here\'s the easiest way to complete it',
  es: 'Tu pago en PNPtv — la forma más fácil de completarlo',
};

const EMAIL_BODY = {
  en: ({ name }) => `Hi ${name},

We noticed you tried to subscribe to PNPtv but the payment didn't go through.

The easiest way to complete your subscription right now is with USDC — a crypto dollar that's always worth $1.

Here's how in 3 steps:

  1. Download Trust Wallet (free on Android and iOS — https://trustwallet.com)
  2. Inside the app, buy USDC on the Solana network. Solana fees are under $0.01 — the cheapest option.
  3. Go to https://pnptv.app/subscribe, pick your plan, select USDC at checkout, and send the amount to the address shown (QR code or copy/paste).

Once your payment confirms (usually under a minute), your membership activates automatically.

No bank, no middlemen, no risk of getting blocked.

If you need help with any step, reply to this email or send a message on the app — we'll walk you through it personally.

— The PNPtv team
support@pnptv.app
`,

  es: ({ name }) => `Hola ${name},

Notamos que intentaste suscribirte a PNPtv pero el pago no se completó.

La forma más fácil de completar tu suscripción ahora mismo es con USDC — un dólar cripto que siempre vale $1.

Cómo hacerlo en 3 pasos:

  1. Descarga Trust Wallet (gratis en Android e iOS — https://trustwallet.com)
  2. Dentro de la app, compra USDC en la red Solana. Las comisiones de Solana son menos de $0.01 — la opción más barata.
  3. Ve a https://pnptv.app/subscribe, elige tu plan, selecciona USDC en el pago y envía el monto a la dirección que aparece (código QR o copia y pega).

Una vez que se confirme tu pago (normalmente en menos de un minuto), tu membresía se activa automáticamente.

Sin banco, sin intermediarios, sin riesgo de bloqueos.

Si necesitas ayuda con algún paso, responde a este correo o escríbenos en la app — te guiamos personalmente.

— El equipo de PNPtv
support@pnptv.app
`,
};

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const runDate = new Date().toISOString();
  console.log('═══════════════════════════════════════════════════════');
  console.log(' PNPtv payment recovery — USDC / NowPayments / Trust Wallet');
  console.log(`  Run date: ${runDate}`);
  console.log('═══════════════════════════════════════════════════════');
  if (DRY_RUN)       console.log(' MODE: DRY RUN — nothing will be sent');
  if (SKIP_DM)       console.log(' --skip-dm');
  if (SKIP_TELEGRAM) console.log(' --skip-telegram');
  if (SKIP_EMAIL)    console.log(' --skip-email');
  if (FORCE)         console.log(` --force (ignoring ${COOLDOWN_DAYS}-day cooldown)`);
  console.log('');

  // 1. Users with abandoned payments, no active entitlement
  const { rows: users } = await query(`
    SELECT DISTINCT ON (p.user_id)
      u.id,
      u.first_name,
      u.username,
      u.email,
      u.telegram,
      u.language,
      p.amount,
      p.provider,
      p.created_at AS last_attempt
    FROM payments p
    JOIN users u ON u.id = p.user_id
    WHERE p.status IN ('pending', 'abandoned', 'failed')
      AND p.created_at > NOW() - INTERVAL '90 days'
      AND COALESCE(u.is_active, true) = true
      AND COALESCE(u.tier, 'free') <> 'banned'
      AND u.username NOT LIKE 'deleted_%'
      AND (
        u.telegram IS NOT NULL
        OR (u.email IS NOT NULL AND u.email NOT LIKE '%@telegram.pnptv.app')
      )
      AND NOT EXISTS (
        SELECT 1 FROM user_entitlements ue
        WHERE ue.user_id = p.user_id
          AND ue.is_consumed = false
          AND (ue.is_lifetime = true OR ue.expires_at > NOW())
      )
    ORDER BY p.user_id, p.created_at DESC
  `);

  // 2. Per-user 30-day cooldown — skip anyone already notified recently
  let recentlySent = new Set();
  if (!FORCE) {
    const { rows: recentRows } = await query(`
      SELECT DISTINCT target_user_id
      FROM notifications
      WHERE entity_type = $1
        AND entity_id LIKE $2
        AND created_at > NOW() - INTERVAL '${COOLDOWN_DAYS} days'
    `, [ENTITY_TYPE, ENTITY_PREFIX + '%']);
    recentlySent = new Set(recentRows.map(r => r.target_user_id));
  }

  const targets      = users.filter(u => !recentlySent.has(u.id));
  const isRealEmail  = (e) => e && typeof e === 'string' && !e.endsWith('@telegram.pnptv.app');
  const dmTargets    = targets;
  const tgTargets    = targets.filter(u => u.telegram);
  const emailTargets = targets.filter(u => isRealEmail(u.email));

  console.log(`   Abandoned payments (90d): ${users.length}`);
  console.log(`   Already notified (${COOLDOWN_DAYS}d):  ${recentlySent.size}`);
  console.log(`   New targets:              ${targets.length}`);
  console.log(`     → in-app DM:            ${dmTargets.length}`);
  console.log(`     → Telegram:             ${tgTargets.length}`);
  console.log(`     → email:                ${emailTargets.length}`);

  if (targets.length === 0) {
    console.log('\n   No new targets — done.\n');
    process.exit(0);
  }

  const stats    = { dm: 0, dmFailed: 0, tg: 0, tgFailed: 0, email: 0, emailFailed: 0 };
  const entityId = `${ENTITY_PREFIX}-${runDate.slice(0, 10)}`;

  // ── 1. In-app DM from pnptv-official ────────────────────────────────────────
  console.log(`\n1/3  In-app DM (pnptv-official) → ${dmTargets.length} users...`);
  if (!DRY_RUN && !SKIP_DM) {
    for (let i = 0; i < dmTargets.length; i++) {
      const u    = dmTargets[i];
      const lang = isEn(u.language) ? 'en' : 'es';
      const text = DM[lang];

      try {
        await sendSystemDM(SYSTEM_SENDER, u.id, text, query);
        stats.dm++;

        // Record for cooldown tracking
        await query(`
          INSERT INTO notifications
            (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message)
          VALUES ('broadcast', 'system', 'normal', $1, $2, $3, $4, $5)
          ON CONFLICT DO NOTHING
        `, [SYSTEM_SENDER, u.id, ENTITY_TYPE, entityId, text.slice(0, 200)]);
      } catch (err) {
        stats.dmFailed++;
        if (stats.dmFailed <= 5 || stats.dmFailed % 100 === 0) {
          console.warn(`     DM err [${u.id}]: ${err.message}`);
        }
      }

      await sleep(DM_DELAY_MS);
      if ((i + 1) % 200 === 0) {
        console.log(`     progress ${i + 1}/${dmTargets.length}  sent=${stats.dm}`);
      }
    }
    console.log(`     ✓ sent=${stats.dm} failed=${stats.dmFailed}`);
  } else if (SKIP_DM) {
    console.log('     skipped');
  } else {
    console.log(`     [DRY] Would DM ${dmTargets.length} users`);
  }

  // ── 2. Telegram direct bot message ──────────────────────────────────────────
  console.log(`\n2/3  Telegram direct → ${tgTargets.length} users...`);
  if (!DRY_RUN && !SKIP_TELEGRAM) {
    const tg = new Telegram(process.env.BOT_TOKEN);

    for (let i = 0; i < tgTargets.length; i++) {
      const u    = tgTargets[i];
      const lang = isEn(u.language) ? 'en' : 'es';
      const name = u.first_name || u.username || (lang === 'en' ? 'there' : 'amigo');
      const text = TG_MESSAGE[lang](name);

      try {
        await tg.sendMessage(u.telegram, text, { parse_mode: 'Markdown' });
        stats.tg++;
      } catch (err) {
        stats.tgFailed++;
        if (stats.tgFailed <= 5 || stats.tgFailed % 100 === 0) {
          console.warn(`     TG err [${u.telegram}]: ${err.message}`);
        }
      }

      await sleep(TG_DELAY_MS);
      if ((i + 1) % 100 === 0) {
        console.log(`     progress ${i + 1}/${tgTargets.length}  sent=${stats.tg}`);
      }
    }
    console.log(`     ✓ sent=${stats.tg} failed=${stats.tgFailed}`);
  } else if (SKIP_TELEGRAM) {
    console.log('     skipped');
  } else {
    console.log(`     [DRY] Would TG-message ${tgTargets.length} users`);
  }

  // ── 3. Email via Hostinger SMTP ──────────────────────────────────────────────
  console.log(`\n3/3  Email → ${emailTargets.length} users (Hostinger SMTP)...`);
  if (!DRY_RUN && !SKIP_EMAIL) {
    const transporter = nodemailer.createTransport({
      host:   process.env.PNPTV_SMTP_HOST,
      port:   parseInt(process.env.PNPTV_SMTP_PORT || '587', 10),
      secure: process.env.PNPTV_SMTP_SECURE === 'true',
      auth: { user: process.env.PNPTV_SMTP_USER, pass: process.env.PNPTV_SMTP_PASS },
    });
    const FROM = `"PNPtv" <${process.env.PNPTV_SMTP_USER || 'noreply@pnptv.app'}>`;

    for (let i = 0; i < emailTargets.length; i++) {
      const u    = emailTargets[i];
      const lang = isEn(u.language) ? 'en' : 'es';
      const name = u.first_name || u.username || (lang === 'en' ? 'there' : 'amigo');

      try {
        await transporter.sendMail({
          from:    FROM,
          to:      u.email,
          subject: EMAIL_SUBJECT[lang],
          text:    EMAIL_BODY[lang]({ name }),
        });
        stats.email++;
      } catch (err) {
        stats.emailFailed++;
        if (stats.emailFailed <= 5 || stats.emailFailed % 100 === 0) {
          console.warn(`     Mail err [${u.email}]: ${err.message}`);
        }
      }

      await sleep(MAIL_DELAY_MS);
      if ((i + 1) % 50 === 0) {
        console.log(`     progress ${i + 1}/${emailTargets.length}  sent=${stats.email}`);
      }
    }
    console.log(`     ✓ sent=${stats.email} failed=${stats.emailFailed}`);
  } else if (SKIP_EMAIL) {
    console.log('     skipped');
  } else {
    console.log(`     [DRY] Would email ${emailTargets.length} users`);
  }

  const totalFailed = stats.dmFailed + stats.tgFailed + stats.emailFailed;
  const totalSent   = stats.dm + stats.tg + stats.email;

  console.log('\n── Summary ─────────────────────────────────────────────');
  console.log(`   In-app DM: ${DRY_RUN ? '[dry]' : stats.dm}  (failed ${stats.dmFailed})`);
  console.log(`   Telegram:  ${DRY_RUN ? '[dry]' : stats.tg}  (failed ${stats.tgFailed})`);
  console.log(`   Email:     ${DRY_RUN ? '[dry]' : stats.email}  (failed ${stats.emailFailed})`);
  console.log('────────────────────────────────────────────────────────\n');

  // ── Admin summary email ────────────────────────────────────────────────────
  if (!DRY_RUN) {
    try {
      const adminTransporter = nodemailer.createTransport({
        host:   process.env.PNPTV_SMTP_HOST,
        port:   parseInt(process.env.PNPTV_SMTP_PORT || '587', 10),
        secure: process.env.PNPTV_SMTP_SECURE === 'true',
        auth: { user: process.env.PNPTV_SMTP_USER, pass: process.env.PNPTV_SMTP_PASS },
      });
      const status  = totalFailed > 0 ? `⚠️ ${totalFailed} failures` : '✅ Clean run';
      const subject = `[PNPtv] Payment recovery run ${runDate.slice(0, 10)} — ${status}`;
      const body    = `Payment recovery broadcast completed.\n\nRun date: ${runDate}\n\nTargets this run: ${targets.length} (${users.length} abandoned total, ${recentlySent.size} already notified)\n\nResults:\n  In-app DM : sent ${stats.dm}  failed ${stats.dmFailed}\n  Telegram  : sent ${stats.tg}  failed ${stats.tgFailed}\n  Email     : sent ${stats.email}  failed ${stats.emailFailed}\n\nTotal sent: ${totalSent}  Total failed: ${totalFailed}\n`;
      await adminTransporter.sendMail({
        from:    `"PNPtv Bot" <${process.env.PNPTV_SMTP_USER || 'noreply@pnptv.app'}>`,
        to:      ADMIN_EMAIL,
        subject,
        text:    body,
      });
      console.log(`   Admin summary sent to ${ADMIN_EMAIL}`);
    } catch (reportErr) {
      console.warn(`   Admin summary email failed: ${reportErr.message}`);
    }
  }

  process.exit(0);
})().catch((err) => {
  // Fatal error — still try to notify admin
  console.error('Fatal:', err);
  try {
    const nodemailerFatal = require('nodemailer');
    const t = nodemailerFatal.createTransport({
      host:   process.env.PNPTV_SMTP_HOST,
      port:   parseInt(process.env.PNPTV_SMTP_PORT || '587', 10),
      secure: process.env.PNPTV_SMTP_SECURE === 'true',
      auth: { user: process.env.PNPTV_SMTP_USER, pass: process.env.PNPTV_SMTP_PASS },
    });
    t.sendMail({
      from:    `"PNPtv Bot" <${process.env.PNPTV_SMTP_USER || 'noreply@pnptv.app'}>`,
      to:      ADMIN_EMAIL,
      subject: `[PNPtv] ❌ Payment recovery CRASHED — ${new Date().toISOString().slice(0, 10)}`,
      text:    `The payment recovery script crashed with a fatal error.\n\nError: ${err.message}\n\nStack:\n${err.stack}`,
    }).catch(() => {});
  } catch {}
  process.exit(1);
});
