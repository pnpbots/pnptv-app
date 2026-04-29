#!/usr/bin/env node
/**
 * apology-dm-stuck-payments.js
 *
 * One-shot apology DM to users whose ePayco payments were stuck due to the
 * normalizePlanId bug (fixed in commit c96f935d, healed 2026-04-28).
 *
 * Bilingual based on users.language. Acknowledges the delay, confirms access
 * is now active, mentions the 24h goodwill extension for week-pass holders.
 *
 * Usage: node apps/backend/scripts/apology-dm-stuck-payments.js
 */

const path = require('path');
const backendPath = path.join(__dirname, '..');
const { query } = require(path.join(backendPath, 'config/postgres'));
const { Telegram } = require('telegraf');

// Distinct user IDs from the heal, with which plan(s) they had healed.
const RECIPIENTS = [
  { userId: '7581552455', getsExtension: true },
  { userId: '8494821405', getsExtension: true },
  { userId: '10edc448-4809-45f7-a721-82956504f049', getsExtension: false },
  { userId: '6940976962', getsExtension: true },
  { userId: '7084537579', getsExtension: true },
  { userId: '1100099683', getsExtension: true },
  { userId: '5433088200', getsExtension: false },
  { userId: '7997044536', getsExtension: true },
  { userId: '3ef5d079-b325-4d5d-ae36-e1b0bf48f734', getsExtension: false },
  { userId: '8418763546', getsExtension: true },
  { userId: '2a7024a4-8ed6-4ae6-99ee-6b68b25e599d', getsExtension: true },
  { userId: '8044016766', getsExtension: true },
  { userId: '8162905422', getsExtension: true },
];

const MSG = {
  es: {
    base: ['👋 Hola — disculpa la demora.',
      '',
      'Tu pago en ePayco quedó atrapado en una validación interna durante unas horas. Ya lo arreglamos: tu membresía está <b>activa</b> ahora mismo, con la duración completa que pagaste.',
      '',
      'Si tienes preguntas o algo no funciona, escríbenos a <b>support@pnptv.app</b>.',
      '',
      'Gracias por la paciencia 🙏',
      '— El equipo de PNPtv'],
    extension: ['',
      '<b>🎁 Como gesto de disculpa por la espera, hemos extendido tu pase 24 horas extra.</b>',
      ''],
  },
  en: {
    base: ['👋 Hi — sorry for the delay.',
      '',
      "Your ePayco payment got stuck in an internal validation for a few hours. We've fixed it: your membership is <b>active right now</b>, with the full duration you paid for.",
      '',
      'If anything is not working or you have questions, please write to <b>support@pnptv.app</b>.',
      '',
      'Thanks for your patience 🙏',
      '— The PNPtv team'],
    extension: ['',
      '<b>🎁 As a small apology for the wait, we have extended your pass by an extra 24 hours.</b>',
      ''],
  },
};

function buildMessage(lang, getsExtension) {
  const t = MSG[lang === 'es' ? 'es' : 'en'];
  if (getsExtension) {
    // Splice the extension block before the support-email line (index 4 in base array).
    return [...t.base.slice(0, 4), ...t.extension, ...t.base.slice(4)].join('\n');
  }
  return t.base.join('\n');
}

async function main() {
  const token = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('BOT_TOKEN not set in env');
    process.exit(1);
  }
  const tg = new Telegram(token);

  console.log(`\n=== Apology DM dispatch to ${RECIPIENTS.length} users ===\n`);
  const summary = { sent: 0, failed: 0, noTelegram: 0 };

  for (const r of RECIPIENTS) {
    // Resolve telegram id (numeric ids are the telegram id; UUIDs need a lookup).
    let telegramId = r.userId;
    let language = 'es';
    try {
      const { rows } = await query(
        'SELECT id, telegram, language FROM users WHERE id = $1 LIMIT 1',
        [r.userId]
      );
      if (rows[0]) {
        telegramId = /^\d+$/.test(rows[0].id) ? rows[0].id : (rows[0].telegram || null);
        language = rows[0].language || 'es';
      }
    } catch (lookupErr) {
      console.log(`[${r.userId}] LOOKUP FAILED — ${lookupErr.message}`);
    }

    if (!telegramId) {
      console.log(`[${r.userId}] SKIP — no telegram id linked`);
      summary.noTelegram++;
      continue;
    }

    const message = buildMessage(language, r.getsExtension);
    try {
      await tg.sendMessage(telegramId, message, { parse_mode: 'HTML' });
      console.log(`[${r.userId} → ${telegramId}] sent (${language}, ext=${r.getsExtension})`);
      summary.sent++;
    } catch (err) {
      console.log(`[${r.userId} → ${telegramId}] FAILED — ${err.description || err.message}`);
      summary.failed++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`  Sent:        ${summary.sent}`);
  console.log(`  Failed:      ${summary.failed}`);
  console.log(`  No Telegram: ${summary.noTelegram}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Apology DM script failed:', err);
  process.exit(1);
});
