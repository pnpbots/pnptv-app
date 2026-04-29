#!/usr/bin/env node
/**
 * santino-saturday-slots-outreach.js
 *
 * One-shot bilingual outreach to active creators offering 3 open coaching
 * slots with Santino on Saturday May 2, 2026 (11am / 2pm / 5pm COT).
 *
 * Sends Telegram DM + email to every creator who has a numeric Telegram ID
 * (or just email for the one UUID-only creator). Bilingual based on
 * users.language. Mirrors the 2026-04-23 outreach pattern.
 *
 * Usage: node apps/backend/scripts/santino-saturday-slots-outreach.js
 */

const path = require('path');
const backendPath = path.join(__dirname, '..');
const { query } = require(path.join(backendPath, 'config/postgres'));
const { Telegram } = require('telegraf');
const emailService = require(path.join(backendPath, 'services/emailService'));

const SLOT_URL_11 = 'https://www.notion.so/351b66dc11ff813b9d27e5f3e696497d';
const SLOT_URL_14 = 'https://www.notion.so/351b66dc11ff81d7b53dc8c07a29fd87';
const SLOT_URL_17 = 'https://www.notion.so/351b66dc11ff81f8a4ffcc699deee661';

// Active creators + models with deliverable contact (pulled from DB,
// frozen at script-write time so a re-run targets the same audience).
const RECIPIENTS = [
  { userId: '8039520242', firstName: 'Clay',         language: 'en', email: 'nickdouglas94@live.com' },
  { userId: '7166356500', firstName: 'D',            language: 'en', email: 'littlecloudypig@yahoo.com' },
  { userId: '7489239467', firstName: 'Ern',          language: 'es', email: 'brjr0804@gmail.com' },
  { userId: '5643392748', firstName: 'Fair',         language: 'en', email: 'fernandoza@gmail.com' },
  { userId: '1071160931', firstName: 'Fedorius',     language: 'en', email: 'koelndream@gmail.com' },
  { userId: '8192241178', firstName: 'LAtinobb43',   language: 'en', email: 'dllatino82@gmail.com' },
  { userId: '5935084902', firstName: 'Carlos',       language: 'en', email: null }, // model, no email on file
  { userId: 'f562df56-91ff-4c79-876c-2f3e15f9146e',
                          firstName: 'chasetheclouds', language: 'en', email: 'ratty_button.7v@icloud.com' }, // UUID, email-only
];

const TG_TEMPLATE = {
  en: (name) => [
    `Hey ${name} 👋 — Santino opened <b>3 coaching slots this Saturday (May 2)</b>.`,
    '',
    'Each one is 30 minutes and unlocks your full Creator Dashboard, Hangouts, PNP Live, and Cristina AI after the call.',
    '',
    'Pick whichever works and tap to claim:',
    `🟢 11:00 AM COT → ${SLOT_URL_11}`,
    `🟢  2:00 PM COT → ${SLOT_URL_14}`,
    `🟢  5:00 PM COT → ${SLOT_URL_17}`,
    '',
    'Open the page, edit the row, and add your name, email, and topic. Santino will follow up to confirm.',
    '',
    '— PNPtv Team',
  ].join('\n'),
  es: (name) => [
    `Hola ${name} 👋 — Santino abrió <b>3 horarios este sábado (2 de mayo)</b> para coaching de creator.`,
    '',
    'Cada uno es de 30 min y te desbloquea Creator Dashboard completo, Hangouts, PNP Live y Cristina AI después de la llamada.',
    '',
    'Elige el que te sirva y toca para reservar:',
    `🟢 11:00 AM (Hora Colombia) → ${SLOT_URL_11}`,
    `🟢  2:00 PM (Hora Colombia) → ${SLOT_URL_14}`,
    `🟢  5:00 PM (Hora Colombia) → ${SLOT_URL_17}`,
    '',
    'Abre la página, edita la fila y añade tu nombre, email y tema. Santino te confirmará después.',
    '',
    '— Equipo PNPtv',
  ].join('\n'),
};

const EMAIL_TEMPLATE = {
  en: {
    subject: 'Santino has 3 coaching slots open this Saturday — pick one',
    html: (name) => `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1c1c1e;max-width:560px;margin:0 auto;padding:24px;">
        <p>Hey ${name} 👋,</p>
        <p>Santino opened <strong>3 coaching slots this Saturday (May 2)</strong>. Each is 30 minutes and unlocks your full Creator Dashboard, Hangouts, PNP Live, and Cristina AI after the call.</p>
        <p>Pick whichever works and click to claim it:</p>
        <ul style="line-height:1.9;font-size:15px;list-style:none;padding-left:0;">
          <li>🟢 <a href="${SLOT_URL_11}" style="color:#D4007A;text-decoration:none;font-weight:600;">11:00 AM COT — claim this slot</a></li>
          <li>🟢 <a href="${SLOT_URL_14}" style="color:#D4007A;text-decoration:none;font-weight:600;">2:00 PM COT — claim this slot</a></li>
          <li>🟢 <a href="${SLOT_URL_17}" style="color:#D4007A;text-decoration:none;font-weight:600;">5:00 PM COT — claim this slot</a></li>
        </ul>
        <p>Open the page, edit the row, and fill in your name, email, and topic. Santino will follow up to confirm.</p>
        <p style="margin-top:24px;color:#636366;font-size:13px;">— The PNPtv Team</p>
      </div>`,
  },
  es: {
    subject: 'Santino tiene 3 horarios abiertos este sábado — elige uno',
    html: (name) => `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1c1c1e;max-width:560px;margin:0 auto;padding:24px;">
        <p>Hola ${name} 👋,</p>
        <p>Santino abrió <strong>3 horarios este sábado (2 de mayo)</strong> para coaching de creator. Cada uno es de 30 min y te desbloquea Creator Dashboard completo, Hangouts, PNP Live y Cristina AI después de la llamada.</p>
        <p>Elige el que te sirva y haz clic para reservar:</p>
        <ul style="line-height:1.9;font-size:15px;list-style:none;padding-left:0;">
          <li>🟢 <a href="${SLOT_URL_11}" style="color:#D4007A;text-decoration:none;font-weight:600;">11:00 AM (Hora Colombia) — reservar este horario</a></li>
          <li>🟢 <a href="${SLOT_URL_14}" style="color:#D4007A;text-decoration:none;font-weight:600;">2:00 PM (Hora Colombia) — reservar este horario</a></li>
          <li>🟢 <a href="${SLOT_URL_17}" style="color:#D4007A;text-decoration:none;font-weight:600;">5:00 PM (Hora Colombia) — reservar este horario</a></li>
        </ul>
        <p>Abre la página, edita la fila y añade tu nombre, email y tema. Santino te confirmará después.</p>
        <p style="margin-top:24px;color:#636366;font-size:13px;">— Equipo PNPtv</p>
      </div>`,
  },
};

async function main() {
  const token = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('BOT_TOKEN not set in env');
    process.exit(1);
  }
  const tg = new Telegram(token);

  console.log(`\n=== Santino Saturday-slots outreach to ${RECIPIENTS.length} creators ===\n`);
  const summary = { tgSent: 0, tgFailed: 0, tgSkipped: 0, emailSent: 0, emailFailed: 0, emailSkipped: 0 };

  for (const r of RECIPIENTS) {
    // Telegram DM — only if userId is numeric (real Telegram ID).
    const numericId = /^\d+$/.test(r.userId) ? r.userId : null;
    if (numericId) {
      const tgBody = TG_TEMPLATE[r.language === 'es' ? 'es' : 'en'](r.firstName);
      try {
        await tg.sendMessage(numericId, tgBody, { parse_mode: 'HTML', disable_web_page_preview: false });
        console.log(`[${r.firstName}/${numericId}] TG sent (${r.language})`);
        summary.tgSent++;
      } catch (err) {
        console.log(`[${r.firstName}/${numericId}] TG FAILED — ${err.description || err.message}`);
        summary.tgFailed++;
      }
    } else {
      console.log(`[${r.firstName}/${r.userId}] TG skipped — UUID, no Telegram link`);
      summary.tgSkipped++;
    }

    // Email — only if email on file.
    if (r.email) {
      const tpl = EMAIL_TEMPLATE[r.language === 'es' ? 'es' : 'en'];
      try {
        await emailService.send({
          to: r.email,
          subject: tpl.subject,
          html: tpl.html(r.firstName),
        });
        console.log(`[${r.firstName}/${r.email}] email sent (${r.language})`);
        summary.emailSent++;
      } catch (err) {
        console.log(`[${r.firstName}/${r.email}] email FAILED — ${err.message}`);
        summary.emailFailed++;
      }
    } else {
      console.log(`[${r.firstName}/${r.userId}] email skipped — no address on file`);
      summary.emailSkipped++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`  Telegram sent:    ${summary.tgSent}`);
  console.log(`  Telegram failed:  ${summary.tgFailed}`);
  console.log(`  Telegram skipped: ${summary.tgSkipped}`);
  console.log(`  Email sent:       ${summary.emailSent}`);
  console.log(`  Email failed:     ${summary.emailFailed}`);
  console.log(`  Email skipped:    ${summary.emailSkipped}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Outreach script failed:', err);
  process.exit(1);
});
