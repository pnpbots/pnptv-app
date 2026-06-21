#!/usr/bin/env node
'use strict';

/**
 * broadcast-stripe-community.js
 *
 * Community message about Stripe Atlas account block.
 * Sends bilingual message (EN/ES) with screenshots via Telegram (photo group),
 * in-app notification, web push, and email.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-stripe-community.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-stripe-community.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-stripe-community.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-stripe-community.js --skip-telegram
 */

const path = require('path');
const fs   = require('fs');
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

const ENTITY_ID  = 'stripe-community-2026-06';
const DONATE_URL = 'https://pnptv.app/donate';
const TG_DELAY_MS = 120; // slightly slower — photos are heavier

const SCREENSHOT_1 = '/tmp/screenshots/Screenshot_20260621-063713_Chrome.jpg'; // Stripe Atlas receipt $500
const SCREENSHOT_2 = '/tmp/screenshots/Screenshot_20260621-063825_Chrome.jpg'; // cancelled payout $1,149.22

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Notification bell (short) ────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `📢 A message from the PNPtv! team — Stripe blocked our account and froze $1,649 in funds. Read how you can help. pnptv.app/donate →`,
  es: `📢 Un mensaje del equipo de PNPtv! — Stripe bloqueó nuestra cuenta y retuvo $1,649 en fondos. Lee cómo puedes ayudar. pnptv.app/donate →`,
};

const PUSH = {
  en: { title: '📢 A message from PNPtv!', body: 'Stripe blocked our account and froze our funds. Read how you can help the community.' },
  es: { title: '📢 Un mensaje de PNPtv!',  body: 'Stripe bloqueó nuestra cuenta y retuvo nuestros fondos. Lee cómo puedes ayudar a la comunidad.' },
};

// ── Telegram message (long, HTML) ────────────────────────────────────────────

const TG = {
  en:
`📢 <b>A message from the PNPtv! team</b>

We need to be transparent about something that has directly impacted the platform over the past weeks.

<b>What happened with Stripe</b>

Because adult platforms are systematically banned from mainstream payment processors, we created a proxy company called <b>Códigos de Mujeres</b> (Women Coding, LLC) and used it to apply for a <b>Stripe Atlas</b> account — a workaround common across the adult content industry.

On April 29, 2026 we paid <b>$500.00</b> to register the company via Stripe Atlas (receipt attached). The account processed member payments for several weeks.

Then Stripe blocked the account without warning:
— Denied our appeal
— Did <b>not</b> return the $500 signup fee
— Cancelled a <b>$1,149.22</b> payout that was already ours (transfer ID: po_1TdK8VHObVVNoB7Q7I0UA935)

<b>Total frozen/lost: $1,649.22</b>

<b>How this affected you</b>

If you subscribed or made a purchase through a Stripe-powered link (via codigosdemujeres.com), Stripe may have issued you a refund. <b>Please check your card statement.</b> If you lost access without receiving a refund, contact us at support@pnptv.app immediately.

This also delayed development — funds we had budgeted for infrastructure and the creator onboarding tools that will let us bring new performers onto the platform properly.

<b>Three ways you can help</b>

<b>1. Re-subscribe if you were refunded</b>
Use any of our working payment methods: crypto (NowPayments), Bitcoin/Lightning, or card via ePayco (Latin America).
👉 <a href="https://pnptv.app/subscribe">pnptv.app/subscribe</a>

<b>2. Contact Stripe support</b>
If you made a legitimate purchase on codigosdemujeres.com (an ebook or digital service), write to <a href="https://support.stripe.com">support.stripe.com</a> and confirm the charge was valid and that you received what you paid for. Real customer testimonials carry weight in disputes.

<b>3. Make a donation if you can</b>
Any amount helps. Crypto, BTC/Lightning, or LATAM card — all accepted.
❤️ <a href="${DONATE_URL}">${DONATE_URL}</a>

We're not going anywhere. We're building, and this community is why.

— The PNPtv! Team`,

  es:
`📢 <b>Un mensaje del equipo de PNPtv!</b>

Necesitamos ser transparentes sobre algo que ha impactado directamente la plataforma en las últimas semanas.

<b>Lo que pasó con Stripe</b>

Porque las plataformas de contenido adulto son sistemáticamente bloqueadas por los procesadores de pago convencionales, creamos una empresa proxy llamada <b>Códigos de Mujeres</b> (Women Coding, LLC) y la usamos para solicitar una cuenta de <b>Stripe Atlas</b> — una solución común en la industria de contenido adulto.

El 29 de abril de 2026 pagamos <b>$500.00</b> para registrar la empresa a través de Stripe Atlas (recibo adjunto). La cuenta procesó pagos de miembros durante varias semanas.

Luego Stripe bloqueó la cuenta sin previo aviso:
— Denegó nuestra apelación
— No devolvió los $500 de registro
— Canceló un pago de <b>$1,149.22</b> que ya nos correspondía (ID: po_1TdK8VHObVVNoB7Q7I0UA935)

<b>Total retenido/perdido: $1,649.22</b>

<b>Cómo te afectó esto</b>

Si te suscribiste o hiciste una compra a través de un enlace de Stripe (vía codigosdemujeres.com), es posible que Stripe te haya hecho un reembolso. <b>Por favor revisa tu estado de cuenta.</b> Si perdiste acceso sin recibir reembolso, escríbenos a support@pnptv.app de inmediato.

Esto también retrasó el desarrollo — fondos que teníamos presupuestados para infraestructura y las herramientas de incorporación de creadores que nos permiten traer nuevos performers a la plataforma correctamente.

<b>Tres formas en que puedes ayudar</b>

<b>1. Vuelve a suscribirte si recibiste un reembolso</b>
Usa cualquiera de nuestros métodos de pago activos: cripto (NowPayments), Bitcoin/Lightning, o tarjeta vía ePayco (América Latina).
👉 <a href="https://pnptv.app/subscribe">pnptv.app/subscribe</a>

<b>2. Contacta al soporte de Stripe</b>
Si hiciste una compra legítima en codigosdemujeres.com (un ebook o servicio digital), escribe a <a href="https://support.stripe.com">support.stripe.com</a> y confirma que el cargo fue válido y que recibiste lo que pagaste. Los testimonios reales de clientes pesan en las disputas.

<b>3. Haz una donación si puedes</b>
Cualquier monto ayuda. Cripto, BTC/Lightning o tarjeta LATAM — todos aceptados.
❤️ <a href="${DONATE_URL}">${DONATE_URL}</a>

No nos vamos a ningún lado. Seguimos construyendo, y esta comunidad es la razón.

— El equipo de PNPtv!`,
};

const EMAIL_SUBJECT = {
  en: '📢 An important message from the PNPtv! team',
  es: '📢 Un mensaje importante del equipo de PNPtv!',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  const greeting = en ? `Hey ${name}!` : `¡Hola ${name}!`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${en ? 'A message from PNPtv!' : 'Un mensaje de PNPtv!'}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(212,0,122,0.30);">
        <tr><td style="height:4px;background:linear-gradient(90deg,#D4007A,#E69138);"></td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <img src="https://pnptv.app/logo-header.png" alt="PNPtv!" height="32" style="display:block;">
        </td></tr>
        <tr><td style="padding:16px 32px 32px;">
          <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${greeting}</p>
          <h1 style="margin:0 0 16px;font-size:22px;font-weight:900;color:#ffffff;line-height:1.2;">
            📢 ${en ? 'An important message from our team.' : 'Un mensaje importante de nuestro equipo.'}
          </h1>

          <!-- What happened -->
          <p style="margin:0 0 8px;font-size:15px;font-weight:800;color:#ffffff;">${en ? 'What happened with Stripe' : 'Lo que pasó con Stripe'}</p>
          <p style="margin:0 0 16px;font-size:14px;color:#9ca3af;line-height:1.6;">
            ${en
              ? 'Adult platforms are systematically banned by mainstream payment processors. We created a proxy company (<b style="color:#fff">Códigos de Mujeres / Women Coding, LLC</b>) to apply for a Stripe Atlas account — a workaround common across our industry. On April 29, 2026 we paid <b style="color:#fff">$500</b> to register it. The account processed member payments for several weeks, then Stripe blocked it without warning.'
              : 'Las plataformas de contenido adulto son sistemáticamente bloqueadas por los procesadores de pago convencionales. Creamos una empresa proxy (<b style="color:#fff">Códigos de Mujeres / Women Coding, LLC</b>) para solicitar una cuenta de Stripe Atlas — una solución común en nuestra industria. El 29 de abril de 2026 pagamos <b style="color:#fff">$500</b> para registrarla. La cuenta procesó pagos de miembros varias semanas, luego Stripe la bloqueó sin previo aviso.'}
          </p>

          <!-- Amounts box -->
          <div style="padding:16px 20px;background:rgba(212,0,122,0.06);border:1px solid rgba(212,0,122,0.25);border-radius:12px;margin-bottom:20px;">
            <p style="margin:0 0 8px;font-size:12px;font-weight:800;color:#D4007A;text-transform:uppercase;letter-spacing:0.05em;">
              ${en ? 'Total frozen / lost' : 'Total retenido / perdido'}
            </p>
            <p style="margin:0 0 4px;font-size:13px;color:#9ca3af;">
              ${en ? '→ $500 Stripe Atlas signup fee — not refunded' : '→ $500 tarifa de registro Stripe Atlas — no reembolsada'}
            </p>
            <p style="margin:0 0 8px;font-size:13px;color:#9ca3af;">
              ${en ? '→ $1,149.22 payout cancelled (ID: po_1TdK8VHObVVNoB7Q7I0UA935)' : '→ $1,149.22 pago cancelado (ID: po_1TdK8VHObVVNoB7Q7I0UA935)'}
            </p>
            <p style="margin:0;font-size:22px;font-weight:900;color:#ffffff;">$1,649.22 ${en ? 'total' : 'en total'}</p>
          </div>

          <!-- How it affected you -->
          <p style="margin:0 0 8px;font-size:15px;font-weight:800;color:#ffffff;">${en ? 'How this affected you' : 'Cómo te afectó'}</p>
          <p style="margin:0 0 20px;font-size:14px;color:#9ca3af;line-height:1.6;">
            ${en
              ? 'If you subscribed via a Stripe link (codigosdemujeres.com), Stripe may have refunded your payment. <b style="color:#fff">Please check your card statement.</b> If you lost access without a refund, email us at support@pnptv.app. This situation also delayed key features and creator onboarding tools.'
              : 'Si te suscribiste vía un enlace Stripe (codigosdemujeres.com), es posible que Stripe haya reembolsado tu pago. <b style="color:#fff">Por favor revisa tu estado de cuenta.</b> Si perdiste acceso sin reembolso, escríbenos a support@pnptv.app. Esto también retrasó funciones clave y herramientas de incorporación de creadores.'}
          </p>

          <!-- 3 ways -->
          <p style="margin:0 0 12px;font-size:15px;font-weight:800;color:#ffffff;">${en ? 'Three ways you can help' : 'Tres formas en que puedes ayudar'}</p>

          <div style="padding:14px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;margin-bottom:10px;">
            <p style="margin:0 0 4px;font-size:13px;font-weight:800;color:#ffffff;">1. ${en ? 'Re-subscribe if you were refunded' : 'Vuelve a suscribirte si te devolvieron el dinero'}</p>
            <p style="margin:0;font-size:12px;color:#9ca3af;">${en ? 'Use crypto, Bitcoin/Lightning, or ePayco card (LATAM).' : 'Usa cripto, Bitcoin/Lightning o tarjeta ePayco (LATAM).'} <a href="https://pnptv.app/subscribe" style="color:#D4007A;">pnptv.app/subscribe</a></p>
          </div>
          <div style="padding:14px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;margin-bottom:10px;">
            <p style="margin:0 0 4px;font-size:13px;font-weight:800;color:#ffffff;">2. ${en ? 'Contact Stripe support' : 'Contacta al soporte de Stripe'}</p>
            <p style="margin:0;font-size:12px;color:#9ca3af;">${en ? 'If you bought from codigosdemujeres.com, write to' : 'Si compraste en codigosdemujeres.com, escribe a'} <a href="https://support.stripe.com" style="color:#D4007A;">support.stripe.com</a> ${en ? 'and confirm the purchase was legitimate.' : 'y confirma que la compra fue legítima.'}</p>
          </div>
          <div style="padding:14px 16px;background:rgba(212,0,122,0.08);border:1px solid rgba(212,0,122,0.30);border-radius:10px;margin-bottom:24px;">
            <p style="margin:0 0 4px;font-size:13px;font-weight:800;color:#ffffff;">3. ❤️ ${en ? 'Make a donation' : 'Haz una donación'}</p>
            <p style="margin:0;font-size:12px;color:#9ca3af;">${en ? 'Any amount helps — crypto, BTC/Lightning, or card.' : 'Cualquier monto ayuda — cripto, BTC/Lightning o tarjeta.'} <a href="${DONATE_URL}" style="color:#D4007A;">${DONATE_URL}</a></p>
          </div>

          <!-- CTA -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
            <tr><td align="center">
              <a href="${DONATE_URL}" style="display:inline-block;padding:16px 40px;background:linear-gradient(90deg,#D4007A,#E69138);color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;border-radius:12px;">
                ❤️ ${en ? 'Donate & Support PNPtv!' : 'Donar y apoyar PNPtv!'}
              </a>
            </td></tr>
          </table>

          <p style="margin:0 0 4px;font-size:13px;color:#9ca3af;line-height:1.6;">
            ${en ? "We're not going anywhere. We're building, and this community is why." : 'No nos vamos a ningún lado. Seguimos construyendo, y esta comunidad es la razón.'}
          </p>
          <p style="margin:8px 0 0;font-size:13px;color:#9ca3af;">— ${en ? 'The PNPtv! Team' : 'El equipo de PNPtv!'}</p>
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
  console.log(' Stripe Community Message Broadcast');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN)       console.log(' MODE: DRY RUN — nothing will be sent\n');
  if (SKIP_EMAIL)    console.log(' --skip-email: email channel skipped\n');
  if (SKIP_TELEGRAM) console.log(' --skip-telegram: Telegram channel skipped\n');

  // Verify screenshots exist
  const s1Exists = fs.existsSync(SCREENSHOT_1);
  const s2Exists = fs.existsSync(SCREENSHOT_2);
  console.log(`\n Screenshots: ${s1Exists ? '✓' : '✗'} receipt  |  ${s2Exists ? '✓' : '✗'} payout`);
  if (!s1Exists || !s2Exists) {
    console.warn(' WARNING: One or both screenshot files missing — Telegram will send text only\n');
  }

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
  const isNew = (u) => !alreadySent.has(u.id);

  const withTelegram = users.filter(u => u.telegram && isNew(u));
  const withEmail    = users.filter(u => u.email && !u.email.includes('@telegram.pnptv.app') && isNew(u));

  console.log(`   Total users:      ${users.length}`);
  console.log(`   Already sent:     ${alreadySent.size}`);
  console.log(`   With Telegram:    ${withTelegram.length}`);
  console.log(`   With real email:  ${withEmail.length}`);

  const stats = { inApp: 0, push: 0, telegram: 0, telegramFailed: 0, email: 0, emailFailed: 0 };

  // ── 1. In-app bell ──
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
          SELECT 'announcement', 'system', 'high', NULL,
            t.id, 'system', $2, $3, $4::jsonb
          FROM unnest($1::text[]) AS t(id)
          ON CONFLICT (type, target_user_id, entity_type, entity_id) WHERE actor_id IS NULL
          DO UPDATE SET is_read = FALSE, created_at = NOW(), message = EXCLUDED.message
        `, [ids, ENTITY_ID, msg, JSON.stringify({ url: DONATE_URL })]);
        stats.inApp += ids.length;
      }
      console.log(`     ✓ Inserted: ${stats.inApp}`);
    } catch (err) { console.error(`     ✗ Error: ${err.message}`); }
  } else {
    console.log(`     [DRY] Would insert for ${users.length} users`);
  }

  // ── 2. Web push ──
  console.log('2/4  Web push...');
  if (!DRY_RUN) {
    try {
      PushNotificationService.initialize();
      const enIds = users.filter(u =>  isEn(u.language)).map(u => u.id);
      const esIds = users.filter(u => !isEn(u.language)).map(u => u.id);
      let pushSent = 0;
      if (enIds.length) pushSent += await PushNotificationService.sendToUsers(enIds, { ...PUSH.en, url: DONATE_URL, tag: ENTITY_ID });
      if (esIds.length) pushSent += await PushNotificationService.sendToUsers(esIds, { ...PUSH.es, url: DONATE_URL, tag: ENTITY_ID });
      stats.push = pushSent;
      console.log(`     ✓ Push sent: ${pushSent}`);
    } catch (err) { console.error(`     ✗ Error: ${err.message}`); }
  } else {
    console.log(`     [DRY] Would push to subscribed users`);
  }

  // ── 3. Telegram ──
  console.log(`3/4  Telegram to ${withTelegram.length} users...`);
  if (!SKIP_TELEGRAM && !DRY_RUN) {
    const tg = new Telegram(process.env.BOT_TOKEN);
    for (let i = 0; i < withTelegram.length; i++) {
      const u = withTelegram[i];
      const msg = isEn(u.language) ? TG.en : TG.es;
      try {
        // Send screenshots as a media group first (if available), then the text message
        if (s1Exists && s2Exists) {
          await tg.sendMediaGroup(u.telegram, [
            {
              type: 'photo',
              media: { source: fs.createReadStream(SCREENSHOT_1) },
              caption: isEn(u.language) ? 'Stripe Atlas receipt — $500 paid Apr 29, 2026' : 'Recibo Stripe Atlas — $500 pagados el 29 de abril de 2026',
            },
            {
              type: 'photo',
              media: { source: fs.createReadStream(SCREENSHOT_2) },
              caption: isEn(u.language) ? 'Cancelled payout — $1,149.22 frozen by Stripe' : 'Pago cancelado — $1,149.22 retenidos por Stripe',
            },
          ]);
          await sleep(300); // brief pause between media group and text
        }
        await tg.sendMessage(u.telegram, msg, { parse_mode: 'HTML', disable_web_page_preview: true });
        stats.telegram++;
      } catch (err) {
        stats.telegramFailed++;
        if (stats.telegramFailed <= 5 || stats.telegramFailed % 100 === 0) {
          console.warn(`     TG err [${u.telegram}]: ${err.message}`);
        }
      }
      await sleep(TG_DELAY_MS);
      if ((i + 1) % 100 === 0) console.log(`     TG progress: ${i + 1}/${withTelegram.length}`);
    }
    console.log(`     ✓ Telegram: ${stats.telegram} sent / ${stats.telegramFailed} failed`);
  } else if (DRY_RUN) {
    console.log(`     [DRY] Would send to ${withTelegram.length} users (with photos if available)`);
  } else {
    console.log('     [SKIPPED]');
  }

  // ── 4. Email ──
  console.log(`4/4  Email to ${withEmail.length} users...`);
  if (SKIP_EMAIL) {
    console.log('     [SKIPPED] --skip-email');
  } else if (!DRY_RUN) {
    const transporter = nodemailer.createTransport({
      host:           process.env.PNPTV_SMTP_HOST || process.env.SMTP_HOST,
      port:           parseInt(process.env.PNPTV_SMTP_PORT || process.env.SMTP_PORT || '587', 10),
      secure:         (process.env.PNPTV_SMTP_SECURE || process.env.SMTP_SECURE) === 'true',
      auth:           {
        user: process.env.PNPTV_SMTP_USER || process.env.SMTP_USER,
        pass: process.env.PNPTV_SMTP_PASS || process.env.SMTP_PASS,
      },
      pool:           true,
      maxConnections: 1,
      maxMessages:    Infinity,
      rateDelta:      1000,
      rateLimit:      1,
    });

    const attachments = [];
    if (s1Exists) attachments.push({ filename: 'stripe-atlas-receipt.jpg',  path: SCREENSHOT_1, cid: 'stripe-receipt' });
    if (s2Exists) attachments.push({ filename: 'stripe-payout-cancelled.jpg', path: SCREENSHOT_2, cid: 'stripe-payout' });

    await new Promise((resolveAll) => {
      let sent = 0, failed = 0, completed = 0;
      if (!withEmail.length) { resolveAll(); return; }
      for (let i = 0; i < withEmail.length; i++) {
        const u = withEmail[i];
        const lang = isEn(u.language) ? 'en' : 'es';
        const name = u.first_name || u.username || (lang === 'en' ? 'Member' : 'Miembro');
        transporter.sendMail({
          from:        '"PNPtv!" <support@pnptv.app>',
          to:          u.email,
          subject:     EMAIL_SUBJECT[lang],
          html:        buildEmailHtml(lang, name),
          attachments,
        }, (err) => {
          completed++;
          if (err) {
            failed++;
            if (failed <= 5 || failed % 50 === 0) console.warn(`     Email err [${u.email}]: ${err.message}`);
          } else { sent++; }
          if (completed % 100 === 0 || completed === withEmail.length) {
            console.log(`     Email progress: ${completed}/${withEmail.length} (${sent} ok / ${failed} failed)`);
          }
          if (completed === withEmail.length) { stats.email = sent; stats.emailFailed = failed; transporter.close(); resolveAll(); }
        });
      }
    });
    console.log(`     ✓ Email: ${stats.email} sent / ${stats.emailFailed} failed`);
  } else {
    console.log(`     [DRY] Would email ${withEmail.length} users`);
  }

  console.log('\n══════════════════════════════════════════════');
  console.log(' BROADCAST COMPLETE');
  console.log(`  In-app: ${stats.inApp} | Push: ${stats.push} | TG: ${stats.telegram} (${stats.telegramFailed} failed) | Email: ${stats.email} (${stats.emailFailed} failed)`);
  console.log('══════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
