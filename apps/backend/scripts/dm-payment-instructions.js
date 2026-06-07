#!/usr/bin/env node
'use strict';

/**
 * dm-payment-instructions.js
 *
 * Sends an in-app DM from PNPtv! to every user who attempted a payment
 * in the last 7 days (ePayco, NOWPayments, BTCPay/Dash, Meru).
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/dm-payment-instructions.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/dm-payment-instructions.js
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }      = require(path.join(BACKEND, 'config/postgres'));
const sendSystemDM   = require(path.join(BACKEND, 'services/sendSystemDM'));

const DRY_RUN   = process.argv.includes('--dry-run');
const SENDER_ID = '8552451957'; // PNPtv! / PNPTVADMIN
const DELAY_MS  = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

const MSG = {
  en: `👋 Hey! We noticed you tried to subscribe or make a payment on PNPtv recently.

Here's everything you need to complete it:

💳 Credit/Debit Card — pay instantly with Visa or Mastercard. After entering your card, wait 20–30 seconds for your bank's 3D Secure screen — don't close the tab.

🪙 USDC — stable digital dollar, works from any country without card declines.

🥷 Dash — most private option, no bank needed.

📖 Full step-by-step guide:
https://pnptv.app/how-to-pay

🔗 Subscribe:
https://pnptv.app/subscribe

⭐ Lifetime PRIME $100 (one-time):
https://pnptv.app/lifetime100

Any issues? Just reply here and we'll sort it out. 🙌`,

  es: `👋 ¡Hola! Notamos que intentaste suscribirte o hacer un pago en PNPtv recientemente.

Aquí tienes todo lo que necesitas para completarlo:

💳 Tarjeta de Crédito/Débito — paga al instante con Visa o Mastercard. Después de ingresar tu tarjeta, espera 20–30 segundos a que aparezca la pantalla 3D Secure de tu banco — no cierres la pestaña.

🪙 USDC — dólar digital estable, funciona desde cualquier país sin rechazos de tarjeta.

🥷 Dash — la opción más privada, sin banco.

📖 Guía paso a paso completa:
https://pnptv.app/how-to-pay

🔗 Suscripciones:
https://pnptv.app/subscribe

⭐ Lifetime PRIME $100 (pago único):
https://pnptv.app/lifetime100

¿Algún problema? Responde aquí y lo resolvemos. 🙌`,
};

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' DM — Payment Instructions (last 7 days attemptees)');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN) console.log(' MODE: DRY RUN\n');

  const { rows: users } = await query(`
    SELECT DISTINCT ON (u.id) u.id, u.first_name, u.username, u.language
    FROM users u
    WHERE u.id IN (
      SELECT user_id FROM payments        WHERE created_at > NOW() - INTERVAL '7 days'
      UNION
      SELECT user_id FROM dash_subscription_orders WHERE created_at > NOW() - INTERVAL '7 days'
      UNION
      SELECT reserved_for_user_id FROM meru_payment_links
        WHERE reserved_for_user_id IS NOT NULL AND created_at > NOW() - INTERVAL '7 days'
    )
    AND u.id != $1
    AND COALESCE(u.is_deleted, false) = false
    AND u.role != 'banned'
    ORDER BY u.id
  `, [SENDER_ID]);

  console.log(`   Targets: ${users.length}`);
  if (DRY_RUN) {
    console.log('\n   Sample targets:');
    users.slice(0, 5).forEach(u => console.log(`     ${u.id} — ${u.first_name || u.username} (${u.language || 'es'})`));
    console.log('\n═══════════════════════════════════════════════════');
    console.log(' DRY RUN COMPLETE — nothing sent');
    console.log('═══════════════════════════════════════════════════\n');
    process.exit(0);
  }

  let sent = 0, failed = 0;

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const msg = isEn(u.language) ? MSG.en : MSG.es;
    try {
      await sendSystemDM(SENDER_ID, u.id, msg, query);
      sent++;
    } catch (err) {
      failed++;
      console.warn(`   ✗ [${u.id}] ${err.message}`);
    }
    await sleep(DELAY_MS);
    if ((i + 1) % 25 === 0) console.log(`   Progress: ${i + 1}/${users.length}`);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(` DONE — ${sent} sent / ${failed} failed`);
  console.log('═══════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
