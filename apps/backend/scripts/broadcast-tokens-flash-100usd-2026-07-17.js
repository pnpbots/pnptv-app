#!/usr/bin/env node
'use strict';

/**
 * broadcast-tokens-flash-100usd-2026-07-17.js
 *
 * Weekend flash sale: 11,000 PNP Tokens for $100 (10,000 base + 1,000 bonus)
 * via EFIPay Credit Card link. Tokens credited manually within 6 hours.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-tokens-flash-100usd-2026-07-17.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-tokens-flash-100usd-2026-07-17.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-tokens-flash-100usd-2026-07-17.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-tokens-flash-100usd-2026-07-17.js --skip-telegram
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

const ENTITY_ID          = 'tokens-flash-100usd-2026-07-17';
const APP_URL            = 'https://pnptv.app';
const LIVE_URL           = 'https://pnptv.app/live';
const PAY_URL            = 'https://sag.efipay.co/checkout/payment-gateway/019f6f60-c199-7251-8037-0984721ecf07?signature=4da2e181a4fc39ff198baa8fb67b2aa401b045381293ca9cfe59e82c86286c3b';
const SUPPORT_EMAIL      = 'support@pnptv.app';
const TG_DELAY_MS        = 80;
const EMAIL_RATE_PER_SEC = 0.25;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `⚡ Weekend flash: 11,000 PNP Tokens for $100 (+10% bonus). Credit Card, tokens active in ≤6h. Tap to pay.`,
  es: `⚡ Flash de fin de semana: 11,000 Tokens PNP por $100 (+10% de bono). Tarjeta de Crédito, tokens en ≤6h. Toca para pagar.`,
};

const PUSH = {
  en: {
    title: '⚡ 11,000 Tokens for $100 — this weekend only',
    body: 'Credit card checkout, +10% bonus, tokens active within 6 hours.',
  },
  es: {
    title: '⚡ 11,000 Tokens por $100 — solo este fin de semana',
    body: 'Pago con tarjeta, +10% de bono, tokens activos en 6 horas.',
  },
};

const TG = {
  en: (name) =>
`⚡ <b>WEEKEND FLASH — 11,000 PNP Tokens for $100</b>

Hey ${name}, this weekend only: $100 = <b>11,000 PNP Tokens</b> (10,000 base + 1,000 bonus, +10% extra).

<b>💳 Pay with Credit Card:</b>
👉 <a href="${PAY_URL}">Open secure checkout</a>

<b>📋 How it works:</b>
1️⃣ Tap the link and pay $100 by credit/debit card via our secure processor (EFIPay).
2️⃣ Copy your <b>payment receipt / transaction ID</b> and email it to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> with the subject "Tokens 100 USD" and your PNPtv username.
3️⃣ Your <b>11,000 tokens</b> land in your wallet within <b>6 hours</b>. You'll get a confirmation email.

<b>🎁 What are PNP Tokens?</b>
Tokens are your all-access chip on PNP Live — our 24/7 queer creator streaming platform:
• <b>Watch adult creators live</b> — pay-per-minute streams from real performers on cam.
• <b>Tip your favorites</b> — send tokens directly to creators mid-stream.
• <b>Buy private time</b> — book 1-on-1 video calls with creators.
• <b>Unlock exclusive channels</b> — some creators have token-gated content.
• <b>Send gifts</b> — visible on stream, boost your creator, get recognition.

<b>🔴 PNP Live</b> is where the platform comes alive: multiple creators streaming at once, chat rooms, tip goals, DJ Main Stage with skip voting, and PRIME-only front-of-queue perks. Come see: 👉 <a href="${LIVE_URL}">${LIVE_URL}</a>

<b>⏰ Bonus expires this weekend.</b> After Sunday you'll pay $100 for 10,000 tokens flat — no extra 1,000.

Questions? Reply to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>. We answer fast.

— PNPtv! team`,

  es: (name) =>
`⚡ <b>FLASH FIN DE SEMANA — 11,000 Tokens PNP por $100</b>

Hey ${name}, solo este fin de semana: $100 = <b>11,000 Tokens PNP</b> (10,000 base + 1,000 de bono, +10% extra).

<b>💳 Paga con Tarjeta de Crédito:</b>
👉 <a href="${PAY_URL}">Abrir checkout seguro</a>

<b>📋 Cómo funciona:</b>
1️⃣ Toca el enlace y paga $100 con tarjeta de crédito/débito por nuestro procesador seguro (EFIPay).
2️⃣ Copia tu <b>recibo / ID de transacción</b> y envíalo por email a <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> con el asunto "Tokens 100 USD" e incluye tu usuario de PNPtv.
3️⃣ Tus <b>11,000 tokens</b> aparecen en tu wallet en máximo <b>6 horas</b>. Recibirás un correo de confirmación.

<b>🎁 ¿Qué son los Tokens PNP?</b>
Los Tokens son tu ficha de acceso total a PNP Live — nuestra plataforma queer 24/7 de streaming con creadores:
• <b>Mira creadores adultos en vivo</b> — streams pay-per-minute de performers reales frente a la cámara.
• <b>Dale propina a tus favoritos</b> — envía tokens directo al creador durante el stream.
• <b>Compra tiempo privado</b> — reserva videollamadas 1 a 1 con los creadores.
• <b>Desbloquea canales exclusivos</b> — algunos creadores tienen contenido gated con tokens.
• <b>Envía regalos</b> — se ven en el stream, apoyan al creador y te dan reconocimiento.

<b>🔴 PNP Live</b> es donde la plataforma cobra vida: varios creadores transmitiendo a la vez, salas de chat, metas de propina, DJ Main Stage con votación para saltar canción, y perks PRIME al frente de la fila. Ven: 👉 <a href="${LIVE_URL}">${LIVE_URL}</a>

<b>⏰ El bono vence este fin de semana.</b> Después del domingo pagas $100 por 10,000 tokens exactos — sin los 1,000 extra.

¿Preguntas? Responde a <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>. Contestamos rápido.

— El equipo de PNPtv!`,
};

const EMAIL_SUBJECT = {
  en: '⚡ Weekend flash — 11,000 PNP Tokens for $100 (+10% bonus)',
  es: '⚡ Flash fin de semana — 11,000 Tokens PNP por $100 (+10% bono)',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${en ? 'PNPtv! — Weekend Flash' : 'PNPtv! — Flash Fin de Semana'}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.10);">
        <tr><td style="height:4px;background:linear-gradient(90deg,#D4007A,#7B61FF);"></td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <img src="${APP_URL}/logo-header.png" alt="PNPtv!" height="32" style="display:block;">
        </td></tr>
        <tr><td style="padding:16px 32px 32px;">
          <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${en ? `Hey ${name},` : `¡Hola ${name}!`}</p>
          <h1 style="margin:0 0 8px;font-size:26px;font-weight:900;color:#ffffff;line-height:1.15;">
            ⚡ ${en ? 'Weekend Flash — 11,000 Tokens for $100' : 'Flash Fin de Semana — 11,000 Tokens por $100'}
          </h1>
          <p style="margin:0 0 22px;font-size:15px;color:#d1d5db;line-height:1.55;">
            ${en
              ? 'This weekend only: get <b>11,000 PNP Tokens</b> for $100 — 10,000 base + 1,000 bonus (+10% extra), payable by credit card.'
              : 'Solo este fin de semana: obtén <b>11,000 Tokens PNP</b> por $100 — 10,000 base + 1,000 de bono (+10% extra), pagable con tarjeta de crédito.'}
          </p>

          <div style="text-align:center;margin:0 0 28px;">
            <a href="${PAY_URL}" style="display:inline-block;padding:16px 40px;background:linear-gradient(90deg,#D4007A,#7B61FF);color:#ffffff;font-size:17px;font-weight:900;text-decoration:none;border-radius:12px;">
              💳 ${en ? 'Pay $100 with Credit Card →' : 'Pagar $100 con Tarjeta →'}
            </a>
            <p style="margin:10px 0 0;font-size:12px;color:#9ca3af;">
              ${en ? 'Secure checkout via EFIPay' : 'Checkout seguro con EFIPay'}
            </p>
          </div>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:20px;background:rgba(123,97,255,0.08);border:1px solid rgba(123,97,255,0.25);border-radius:14px;">
              <p style="margin:0 0 12px;font-size:16px;font-weight:900;color:#ffffff;">📋 ${en ? 'How it works' : 'Cómo funciona'}</p>
              <ol style="margin:0;padding-left:20px;color:#d1d5db;font-size:14px;line-height:1.8;">
                <li>${en
                  ? 'Tap the button above and pay $100 with your credit/debit card.'
                  : 'Toca el botón de arriba y paga $100 con tu tarjeta.'}</li>
                <li>${en
                  ? `Copy your <b>transaction ID</b> from the confirmation page and email it to <a href="mailto:${SUPPORT_EMAIL}" style="color:#ff4d9d;">${SUPPORT_EMAIL}</a> with the subject <b>"Tokens 100 USD"</b> and your PNPtv username.`
                  : `Copia tu <b>ID de transacción</b> de la página de confirmación y envíala por email a <a href="mailto:${SUPPORT_EMAIL}" style="color:#ff4d9d;">${SUPPORT_EMAIL}</a> con el asunto <b>"Tokens 100 USD"</b> y tu usuario de PNPtv.`}</li>
                <li>${en
                  ? 'Your <b>11,000 tokens</b> land in your wallet within <b>6 hours</b> and you get a confirmation email.'
                  : 'Tus <b>11,000 tokens</b> aparecen en tu wallet en máximo <b>6 horas</b> y recibirás un correo de confirmación.'}</li>
              </ol>
            </td></tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:20px;background:rgba(212,0,122,0.08);border:1px solid rgba(212,0,122,0.25);border-radius:14px;">
              <p style="margin:0 0 12px;font-size:16px;font-weight:900;color:#ffffff;">🎁 ${en ? 'What are PNP Tokens?' : '¿Qué son los Tokens PNP?'}</p>
              <p style="margin:0 0 10px;font-size:14px;color:#d1d5db;line-height:1.6;">
                ${en
                  ? 'Tokens are your all-access chip across PNP Live — our 24/7 queer creator streaming platform.'
                  : 'Los Tokens son tu ficha de acceso total en PNP Live — nuestra plataforma queer 24/7 de streaming con creadores.'}
              </p>
              <ul style="margin:0;padding-left:18px;color:#d1d5db;font-size:14px;line-height:1.8;">
                <li>${en ? '🔴 <b>Watch adult creators live</b> — pay-per-minute streams' : '🔴 <b>Mira creadores adultos en vivo</b> — streams pay-per-minute'}</li>
                <li>${en ? '💸 <b>Tip your favorites</b> — direct token tips during streams' : '💸 <b>Dale propina a tus favoritos</b> — tokens directos durante el stream'}</li>
                <li>${en ? '📞 <b>Book private time</b> — 1-on-1 video calls with creators' : '📞 <b>Reserva tiempo privado</b> — videollamadas 1 a 1 con creadores'}</li>
                <li>${en ? '🔓 <b>Unlock exclusive channels</b> — token-gated creator content' : '🔓 <b>Desbloquea canales exclusivos</b> — contenido gated con tokens'}</li>
                <li>${en ? '🎁 <b>Send visible gifts</b> — boost your creator on stream' : '🎁 <b>Envía regalos visibles</b> — apoya al creador en el stream'}</li>
              </ul>
            </td></tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:20px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:14px;">
              <p style="margin:0 0 10px;font-size:16px;font-weight:900;color:#ffffff;">🔴 ${en ? 'PNP Live — where it happens' : 'PNP Live — donde pasa todo'}</p>
              <p style="margin:0;color:#d1d5db;font-size:14px;line-height:1.6;">
                ${en
                  ? 'Multiple creators streaming at once, live chat rooms, tip goals, DJ Main Stage with skip voting, and PRIME-only perks. Come see it live.'
                  : 'Varios creadores transmitiendo al mismo tiempo, salas de chat en vivo, metas de propina, DJ Main Stage con votación para saltar canción, y perks exclusivos de PRIME. Ven a verlo en vivo.'}
              </p>
              <div style="text-align:center;margin-top:14px;">
                <a href="${LIVE_URL}" style="display:inline-block;padding:12px 28px;background:rgba(255,255,255,0.10);color:#ffffff;font-size:14px;font-weight:800;text-decoration:none;border-radius:10px;border:1px solid rgba(255,255,255,0.20);">
                  ${en ? 'Explore PNP Live →' : 'Explorar PNP Live →'}
                </a>
              </div>
            </td></tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:16px 20px;background:rgba(255,193,7,0.08);border:1px solid rgba(255,193,7,0.25);border-radius:14px;">
              <p style="margin:0;font-size:14px;color:#ffd54f;line-height:1.6;">
                ⏰ <b>${en ? 'Bonus expires this weekend.' : 'El bono vence este fin de semana.'}</b>
                ${en
                  ? 'After Sunday: $100 for 10,000 tokens flat — no +1,000 bonus.'
                  : 'Después del domingo son $100 por 10,000 tokens exactos — sin los 1,000 extra.'}
              </p>
            </td></tr>
          </table>

          <p style="margin:0 0 8px;font-size:13px;color:#9ca3af;text-align:center;">
            ${en ? 'Questions?' : '¿Preguntas?'}
            <a href="mailto:${SUPPORT_EMAIL}" style="color:#ff4d9d;">${SUPPORT_EMAIL}</a>
          </p>
          <p style="margin:0;font-size:12px;color:#6b7280;text-align:center;">
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
  console.log(' Weekend Flash Broadcast — $100 → 11,000 Tokens');
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
      const enIds = users.filter(u =>  isEn(u.language) && isNew(u)).map(u => u.id);
      const esIds = users.filter(u => !isEn(u.language) && isNew(u)).map(u => u.id);
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
        `, [ids, ENTITY_ID, msg, JSON.stringify({ url: PAY_URL })]);
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
      if (enIds.length) pushSent += await PushNotificationService.sendToUsers(enIds, { ...PUSH.en, url: PAY_URL, tag: ENTITY_ID });
      if (esIds.length) pushSent += await PushNotificationService.sendToUsers(esIds, { ...PUSH.es, url: PAY_URL, tag: ENTITY_ID });
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
