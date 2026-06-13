#!/usr/bin/env node
'use strict';

/**
 * notify-mrright-guy-renewal.js
 *
 * One-shot: notifies MRRIGHT_GUY (user 7516451470) that his SantinoFurioso
 * creator subscription expired and sends the newest live BTCPay invoice URL.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/notify-mrright-guy-renewal.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/notify-mrright-guy-renewal.js
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query, initializePostgres } = require(path.join(BACKEND, 'config/postgres'));
const { Telegram } = require('telegraf');

const DRY_RUN = process.argv.includes('--dry-run');

const USER_ID    = '7516451470';
const CREATOR    = 'SantinoFurioso';
// Newest live BTCPay invoice (June 4)
const INVOICE_URL = 'https://btcpay.pnptv.app/i/KE3cyRy4rjdRLRZDLeuygp';

async function main() {
  await initializePostgres();

  const { rows } = await query(
    `SELECT id, username, telegram, language FROM users WHERE id = $1`,
    [USER_ID]
  );
  const user = rows[0];
  if (!user) { console.error('User not found'); process.exit(1); }
  if (!user.telegram) { console.error('No Telegram ID on user'); process.exit(1); }

  const lang = user.language || 'en';
  const name = user.username || 'there';
  const es = typeof lang === 'string' && lang.toLowerCase().startsWith('es');

  const msg = es
    ? `<b>PNPtv!</b> — Tu suscripción a ${CREATOR} expiró\n\n` +
      `Hola ${name}, tu suscripción mensual a <b>${CREATOR}</b> venció el 4 de junio.\n\n` +
      `¡Tenemos una factura abierta lista para que renueves al instante!\n\n` +
      `👉 <a href="${INVOICE_URL}">Pagar con Dash — $15</a>\n\n` +
      `Abre el link, escanea el QR con tu wallet y listo — tu acceso se activa automáticamente.`
    : `<b>PNPtv!</b> — Your ${CREATOR} subscription expired\n\n` +
      `Hi ${name}, your monthly subscription to <b>${CREATOR}</b> expired on June 4.\n\n` +
      `We have an open invoice ready — renew in seconds with Dash:\n\n` +
      `👉 <a href="${INVOICE_URL}">Pay with Dash — $15</a>\n\n` +
      `Open the link, scan the QR with your Dash wallet, and your access reactivates automatically.`;

  console.log(`User: @${user.username} (TG: ${user.telegram})`);
  console.log(`Message:\n${msg}`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] — not sent');
    process.exit(0);
  }

  const tg = new Telegram(process.env.BOT_TOKEN);
  await tg.sendMessage(user.telegram, msg, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });

  await query(
    `INSERT INTO payment_recovery_log (payment_id, action, status, result, created_by)
     SELECT id, 'creator_sub_renewal_nudge', 'success',
            $2::jsonb, 'manual_script'
     FROM payments
     WHERE user_id = $1 AND status = 'pending'
       AND provider IN ('dash','btcpay')
       AND payment_url = $3
     LIMIT 1`,
    [
      USER_ID,
      JSON.stringify({ telegram: user.telegram, invoiceUrl: INVOICE_URL }),
      INVOICE_URL,
    ]
  );

  console.log('✓ Sent and logged');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
