#!/usr/bin/env node
'use strict';

/**
 * dm-pigydik-payment-options.js
 *
 * One-off DM to PIGYDIK with Wompi/Nequi + crypto payment options.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/dm-pigydik-payment-options.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/dm-pigydik-payment-options.js
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }    = require(path.join(BACKEND, 'config/postgres'));
const sendSystemDM = require(path.join(BACKEND, 'services/sendSystemDM'));
const { Telegram } = require('telegraf');

const DRY_RUN     = process.argv.includes('--dry-run');
const SENDER_ID   = '8552451957'; // PNPtv! / PNPTVADMIN
const TARGET_ID   = 'b830c679-b651-417a-adc5-f7df3b084d10'; // PIGYDIK
const TARGET_TG   = '7803545833'; // PIGYDIK Telegram ID

const MSG = `👋 Hey! We see you've been trying to complete your payment — thanks for the patience, we want to make sure you can join.

Your card is being declined by your bank (not on our end). Here are two options that will definitely work:

━━━━━━━━━━━━━━━
🏦 PAY WITH NEQUI / BANK TRANSFER
━━━━━━━━━━━━━━━

⭐ Lifetime PRIME — $250 (one payment, forever):
https://checkout.nequi.wompi.co/l/hakdMS

💎 Yearly PRIME — $100 (12 months):
https://checkout.nequi.wompi.co/l/b04EoQ

Pay from your bank account or Nequi — no card needed.

━━━━━━━━━━━━━━━
🥷 PAY WITH CRYPTO (Dash or Bitcoin)
━━━━━━━━━━━━━━━

Never used crypto? It's easier than it sounds:

1️⃣ Download Coinbase, Kraken, or Binance (free)
2️⃣ Create an account with your email
3️⃣ Buy the amount you need
4️⃣ Go to pnptv.app/subscribe → pick your plan → tap "Pay with Dash" or "Pay with Bitcoin"
5️⃣ Send to the address shown — your membership activates automatically

No bank. No statement. Completely private.

→ https://pnptv.app/subscribe

Reply here if you need any help — we'll walk you through it. 🙌`;

async function main() {
  console.log('\n══════════════════════════════════════');
  console.log(' DM → PIGYDIK — Payment Options');
  console.log('══════════════════════════════════════');
  if (DRY_RUN) {
    console.log(' MODE: DRY RUN\n');
    console.log(' Target:', TARGET_ID);
    console.log(' TG ID:', TARGET_TG);
    console.log('\n── Message preview ──\n');
    console.log(MSG);
    console.log('\n══════════════════════════════════════');
    console.log(' DRY RUN COMPLETE — nothing sent');
    console.log('══════════════════════════════════════\n');
    process.exit(0);
  }

  // In-app DM
  try {
    await sendSystemDM(SENDER_ID, TARGET_ID, MSG, query);
    console.log(' ✓ In-app DM sent');
  } catch (err) {
    console.warn(' ✗ In-app DM failed:', err.message);
  }

  // Telegram DM
  try {
    const tg = new Telegram(process.env.BOT_TOKEN);
    await tg.sendMessage(TARGET_TG, MSG, { parse_mode: 'HTML' });
    console.log(' ✓ Telegram DM sent');
  } catch (err) {
    console.warn(' ✗ Telegram DM failed:', err.message);
  }

  console.log('\n══════════════════════════════════════');
  console.log(' DONE');
  console.log('══════════════════════════════════════\n');
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
