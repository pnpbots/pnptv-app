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

const TARGETS = [
  {
    username: 'MRRIGHT_GUY',
    telegram: '7516451470',
    dm: `Hey! Your creator subscription renewal has been trying to process via BTCPay for the past few days but the invoices are expiring unpaid — so your subscription has lapsed.

To renew, just go to pnptv.app/plans, select Creator Subscription ($15/month) and complete the BTCPay payment within 15 minutes of generating the invoice.

💡 BTCPay tips:
• Send the *exact* amount shown — even a few cents off will not confirm
• The invoice expires in 15 minutes — generate a fresh one if yours expired
• Works with Dash, Bitcoin, and other supported coins
• Check your wallet has enough to cover network fees too

Reply here if you need help. 🙏`,
    tg: `Hey! Your creator subscription renewal has been failing via BTCPay — the invoices keep expiring unpaid and your subscription has lapsed.

To fix it, go to *pnptv.app/plans* → Creator Subscription ($15/month) and complete the payment within 15 minutes.

💡 *BTCPay tips:*
• Send the *exact* amount — even a few cents off won't confirm
• Expires in 15 min — generate fresh if yours timed out
• Works with Dash, Bitcoin & more
• Make sure your wallet covers network fees

Reply here if you need help 🙏`,
  },
  {
    username: 'KOBTON1',
    telegram: '5951629484',
    dm: `Hey! I noticed you've been trying to book a call session with Dash several times and the invoices kept expiring before payment — sorry about that!

Here's how to get it done smoothly:

₿ PAYING WITH DASH (or other crypto via BTCPay)
• Go to pnptv.app and book your session
• At checkout select "Pay with Crypto"
• A BTCPay invoice appears with a QR code and wallet address
• Send the *exact* amount shown — the invoice expires in 15 minutes
• Make sure your wallet has enough to cover the network fee
• Once the transaction confirms, your booking will be activated automatically

If the 15-minute window is too tight, generate the invoice right before you're ready to send — don't open it until you're at your wallet.

Reply here if you need help booking. 🙏`,
    tg: `Hey! I saw you've been trying to book a call session with Dash several times but the invoices kept expiring — sorry about that!

Here's how to do it:

₿ *Paying with Dash / Crypto (BTCPay)*
• Book your session at pnptv.app
• Select "Pay with Crypto" at checkout
• Send the *exact* amount on the invoice — expires in 15 min
• Make sure your wallet covers the network fee too
• Booking activates automatically once confirmed

Tip: only open the invoice when you're ready to send from your wallet.

Reply here if you want to book — happy to help 🙏`,
  },
  {
    username: 'BBSLAM505',
    telegram: '5899228122',
    dm: `Hey! Your creator subscription ran into a technical issue with our BTCPay auto-renewal — the invoices were generated with an incorrect amount due to a bug on our end (now fixed). Your subscription expired as a result, which wasn't your fault.

To renew, go to pnptv.app/plans → Creator Subscription ($15/month) and complete a fresh BTCPay payment.

💡 BTCPay tips:
• Send the exact amount shown on the invoice
• The invoice expires in 15 minutes — generate fresh if needed
• Works with Dash, Bitcoin & more
• Make sure your wallet covers the network fee

Sorry for the trouble — the bug is fixed now. Reply if you need help. 🙏`,
    tg: `Hey! Your creator subscription hit a bug with our BTCPay auto-renewal — invoices were generated with a wrong amount (our fault, now fixed) and your subscription lapsed.

To renew: go to *pnptv.app/plans* → Creator Subscription ($15/mo) and complete a fresh BTCPay payment.

💡 *BTCPay tips:*
• Send the exact amount — expires in 15 min
• Works with Dash, Bitcoin & more
• Cover network fees in your wallet

Sorry for the trouble — all fixed now 🙏`,
  },
];

async function main() {
  const senderRow = await query('SELECT id FROM users WHERE username = $1', [SENDER_USERNAME]);
  if (!senderRow.rows.length) throw new Error(`Sender ${SENDER_USERNAME} not found`);
  const senderId = senderRow.rows[0].id;

  for (const target of TARGETS) {
    const userRow = await query('SELECT id FROM users WHERE username = $1', [target.username]);
    if (!userRow.rows.length) { console.warn(`[SKIP] ${target.username} not found`); continue; }
    const recipientId = userRow.rows[0].id;

    console.log(`\n--- ${target.username} ---`);
    if (DRY_RUN) { console.log(`[DRY-RUN] Would contact ${target.username}`); continue; }

    try {
      await DmService.sendMessage(senderId, recipientId, { content: target.dm }, { isAdmin: true });
      console.log(`[OK] Webapp DM → ${target.username}`);
    } catch (err) {
      console.error(`[ERROR] DM → ${target.username}: ${err.message}`);
    }

    try {
      await telegram.sendMessage(target.telegram, target.tg, { parse_mode: 'Markdown' });
      console.log(`[OK] Telegram → ${target.username}`);
    } catch (err) {
      console.error(`[ERROR] Telegram → ${target.username}: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 400));
  }

  console.log('\nDone.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
