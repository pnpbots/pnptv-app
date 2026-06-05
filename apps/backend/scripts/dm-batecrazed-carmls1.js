#!/usr/bin/env node
'use strict';

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }    = require(path.join(BACKEND, 'config/postgres'));
const sendSystemDM = require(path.join(BACKEND, 'services/sendSystemDM'));
const { Telegram } = require('telegraf');

const DRY_RUN   = process.argv.includes('--dry-run');
const SENDER_ID = '8552451957';

const TARGETS = [
  {
    label:  'CARMLS1 — prime diamond Wompi link (es)',
    userId: '8545519508',
    tgId:   '8545519508',
    msg: `👋 ¡Hola! Vimos que intentaste completar tu pago en PNPtv.

Tu banco está bloqueando la transacción, pero puedes pagar fácil desde tu cuenta bancaria o Nequi con este link:

💎 PRIME Diamond Pass — $100 (12 meses):
https://checkout.nequi.wompi.co/l/b04EoQ

Sin tarjeta, sin complicaciones. Responde aquí si necesitas ayuda. 🙌`,
  },
  {
    label:  'BATECRAZED — crypto options (en)',
    userId: '5050199917',
    tgId:   '5050199917',
    msg: `👋 Hey! Your card keeps getting declined at the bank level — not on our end.

The easiest fix: pay with crypto. No bank, no declines, completely private.

🥷 HOW TO PAY WITH DASH OR BITCOIN:

1️⃣ Download Coinbase, Kraken, or Binance (free)
2️⃣ Create an account with your email
3️⃣ Buy the amount you need
4️⃣ Go to pnptv.app/subscribe → pick your plan → tap "Pay with Dash" or "Pay with Bitcoin"
5️⃣ Send to the address shown — your membership activates automatically

→ https://pnptv.app/subscribe

Reply here if you need any help walking through it. 🙌`,
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('\n══════════════════════════════════════');
  console.log(' DM → BATECRAZED + CARMLS1');
  console.log('══════════════════════════════════════');
  if (DRY_RUN) console.log(' MODE: DRY RUN\n');

  const tg = new Telegram(process.env.BOT_TOKEN);

  for (const t of TARGETS) {
    console.log(`\n── ${t.label}`);
    if (DRY_RUN) { console.log(t.msg); continue; }

    try {
      await sendSystemDM(SENDER_ID, t.userId, t.msg, query);
      console.log(' ✓ In-app DM sent');
    } catch (err) {
      console.warn(' ✗ In-app DM failed:', err.message);
    }

    try {
      await tg.sendMessage(t.tgId, t.msg);
      console.log(' ✓ Telegram DM sent');
    } catch (err) {
      console.warn(' ✗ Telegram DM failed:', err.message);
    }

    await sleep(500);
  }

  console.log('\n══════════════════════════════════════');
  console.log(' DONE');
  console.log('══════════════════════════════════════\n');
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
