#!/usr/bin/env node
'use strict';

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }    = require(path.join(BACKEND, 'config/postgres'));
const DmService    = require(path.join(BACKEND, 'services/dmService'));
const { Telegram } = require('telegraf');

const DRY_RUN  = process.argv.includes('--dry-run');
const telegram = new Telegram(process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN);
const SENDER_USERNAME = 'SantinoFurioso';

// Already contacted in batch 1: THEJURONGOTTER_2, KINGCHAOS095, BI6B0Y, DCSWISS
const TARGETS = [
  { username: 'MIMILANOX',       telegram: '2099221007' },
  { username: 'TULSACUMDUMP',    telegram: '7941347263' },
  { username: 'ALGORITHMS10',    telegram: '8286393334' },
  { username: 'BRANT1973',       telegram: '7064343976' },
  { username: 'TML_1987',        telegram: '5267486369' },
  { username: 'SUIRODEF',        telegram: '1071160931' },
  { username: 'THEISRAMX',       telegram: '5936882032' },
  { username: 'PIGYDIK',         telegram: '7803545833' },
  { username: 'GABS2026NA',      telegram: '5994313923' },
  { username: 'bennitravi',      telegram: '8553652686' },
  { username: 'PUFFCYCLIST9966', telegram: '7801300544' },
  { username: 'MEZTIZOO',        telegram: '6620259017' },
  { username: 'WESTSIDEBORN71',  telegram: '7293683718' },
  { username: 'DADA81RA',        telegram: '8788272617' },
  { username: 'JOSHUAPAULLL',    telegram: '8229666359' },
  { username: 'INCHAOS247',      telegram: '5867486581' },
  { username: 'BT01MEDIA',       telegram: '5883044775' },
];

const DM_TEXT = `Hey! I noticed you've been trying to complete a payment on PNPtv! Here's how to get it done:

💳 CARD (Visa / Mastercard)
• Make sure international online transactions are enabled on your card
• Complete the 3D Secure step if it pops up — it's your bank verifying the charge
• If declined, try a different card or contact your bank

₿ CRYPTO (Bitcoin, Dash & more via BTCPay)
• Select "Pay with Crypto" at checkout
• A BTCPay invoice appears with a wallet address and QR code
• Send the exact amount — invoice expires in 15 minutes
• No account needed, works from any crypto wallet

👉 pnptv.app/plans

Reply here if you need help and I'll sort it out personally. 🙏`;

const TG_TEXT = `Hey! It's Santino from PNPtv 👋

I saw you had some trouble completing a payment. Here's how to do it:

💳 *Card (Visa/Mastercard)*
• Enable international online transactions on your card
• Complete 3D Secure if it appears
• If declined, try another card

₿ *Crypto (Bitcoin, Dash & more)*
• Choose "Pay with Crypto" at checkout
• Scan the QR code or copy the wallet address
• Send the exact amount — expires in 15 min

👉 pnptv.app/plans

Reply here if you need help 🙏`;

async function main() {
  const senderRow = await query('SELECT id FROM users WHERE username = $1', [SENDER_USERNAME]);
  if (!senderRow.rows.length) throw new Error(`Sender ${SENDER_USERNAME} not found`);
  const senderId = senderRow.rows[0].id;

  let ok = 0, failed = 0;

  for (const target of TARGETS) {
    const userRow = await query('SELECT id FROM users WHERE username = $1', [target.username]);
    if (!userRow.rows.length) { console.warn(`[SKIP] ${target.username} not found`); continue; }
    const recipientId = userRow.rows[0].id;

    console.log(`\n--- ${target.username} ---`);
    if (DRY_RUN) { console.log(`[DRY-RUN] Would contact ${target.username}`); continue; }

    try {
      await DmService.sendMessage(senderId, recipientId, { content: DM_TEXT }, { isAdmin: true });
      console.log(`[OK] Webapp DM → ${target.username}`);
    } catch (err) {
      console.error(`[ERROR] DM → ${target.username}: ${err.message}`); failed++;
    }

    try {
      await telegram.sendMessage(target.telegram, TG_TEXT, { parse_mode: 'Markdown' });
      console.log(`[OK] Telegram → ${target.username}`);
      ok++;
    } catch (err) {
      console.error(`[ERROR] Telegram → ${target.username}: ${err.message}`); failed++;
    }

    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\nDone. Sent: ${ok}, Errors: ${failed}`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
