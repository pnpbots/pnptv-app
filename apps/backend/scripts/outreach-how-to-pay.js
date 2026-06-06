#!/usr/bin/env node
'use strict';

/**
 * Targeted outreach to users with stuck/failed payments — send "how to pay" guide.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/outreach-how-to-pay.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/outreach-how-to-pay.js
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }    = require(path.join(BACKEND, 'config/postgres'));
const DmService    = require(path.join(BACKEND, 'services/dmService'));
const { Telegram } = require('telegraf');

const DRY_RUN = process.argv.includes('--dry-run');
const telegram = new Telegram(process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN);
const SENDER_USERNAME = 'SantinoFurioso';

const TARGETS = [
  { username: 'THEJURONGOTTER_2', telegram: '661173078'  },
  { username: 'KINGCHAOS095',     telegram: '7322348287' },
  { username: 'BI6B0Y',           telegram: '7517300968' },
  { username: 'DCSWISS',          telegram: '6251760542' },
];

const DM_TEXT = `Hey! I noticed you've been trying to complete a payment on PNPtv! and running into some trouble. Here's how to get it done smoothly:

💳 CARD PAYMENT (ePayco)
• Use Visa or Mastercard (credit or debit)
• Make sure your bank allows international online transactions
• If 3D Secure pops up, complete it — it's your bank verifying the charge
• If your card gets declined, try a different card or contact your bank

₿ CRYPTO (Bitcoin, Dash & more via BTCPay)
• On the checkout page, select "Pay with Crypto"
• A BTCPay invoice will appear with a wallet address and QR code
• Send the exact amount shown — the invoice expires in 15 minutes
• No account needed, works from any crypto wallet

👉 Go to: pnptv.app/plans

If you keep having trouble, just reply here and I'll help you personally. 🙏`;

const TG_TEXT = `Hey! It's Santino from PNPtv 👋

I saw you've been trying to complete a payment — here's how to get it done:

💳 *Card (Visa/Mastercard)*
• Make sure international online transactions are enabled on your card
• Complete the 3D Secure verification if it appears
• If declined, try a different card

₿ *Crypto (Bitcoin, Dash & more)*
• Select "Pay with Crypto" at checkout
• A BTCPay invoice appears with a QR code — send the exact amount
• Invoice expires in 15 min, no account needed

👉 pnptv.app/plans

Reply here if you need help — I'll sort it out personally 🙏`;

async function main() {
  const senderRow = await query('SELECT id FROM users WHERE username = $1', [SENDER_USERNAME]);
  if (!senderRow.rows.length) throw new Error(`Sender ${SENDER_USERNAME} not found`);
  const senderId = senderRow.rows[0].id;

  for (const target of TARGETS) {
    const userRow = await query('SELECT id FROM users WHERE username = $1', [target.username]);
    if (!userRow.rows.length) { console.warn(`[SKIP] ${target.username} not found`); continue; }
    const recipientId = userRow.rows[0].id;

    console.log(`\n--- ${target.username} ---`);

    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would send webapp DM + Telegram to ${target.username}`);
      continue;
    }

    try {
      await DmService.sendMessage(senderId, recipientId, { content: DM_TEXT }, { isAdmin: true });
      console.log(`[OK] Webapp DM → ${target.username}`);
    } catch (err) {
      console.error(`[ERROR] Webapp DM → ${target.username}: ${err.message}`);
    }

    try {
      await telegram.sendMessage(target.telegram, TG_TEXT, { parse_mode: 'Markdown' });
      console.log(`[OK] Telegram → ${target.username}`);
    } catch (err) {
      console.error(`[ERROR] Telegram → ${target.username}: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\nDone.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
