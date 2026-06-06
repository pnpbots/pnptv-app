#!/usr/bin/env node
'use strict';

/**
 * Targeted outreach to users with repeated failed payments — offer lifetime100.
 * Sends webapp DM + Telegram message from SantinoFurioso.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/outreach-failed-payments-lifetime100.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/outreach-failed-payments-lifetime100.js
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }   = require(path.join(BACKEND, 'config/postgres'));
const DmService   = require(path.join(BACKEND, 'services/dmService'));
const { Telegram } = require('telegraf');

const DRY_RUN = process.argv.includes('--dry-run');

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const telegram  = new Telegram(BOT_TOKEN);

const SENDER_USERNAME = 'SantinoFurioso';

const TARGETS = [
  { username: 'BATECRAZED',   telegram: '5050199917' },
  { username: 'KINGCHAOS095', telegram: '7322348287' },
];

const DM_TEXT = `Hey! I noticed you've been trying to get the Lifetime membership and running into payment issues. Really sorry about that — our payment processor can be tricky sometimes.

I wanted to reach out personally: if you're still interested, we have the Lifetime100 plan ($100 one-time, includes everything — lifetime Prime access + exclusive perks). Happy to help you get it sorted.

Just reply here or go to pnptv.app/plans and try again. If it keeps failing, let me know and we'll find another way. 🙏`;

const TG_TEXT = `Hey! It's Santino from PNPtv 👋

I noticed you've been trying to get the Lifetime membership but running into payment issues — really sorry about that.

If you're still interested, we have the *Lifetime100* plan ($100 one-time) — lifetime Prime access + all exclusive perks included.

Try it at: https://pnptv.app/plans

If it keeps failing, just reply here and I'll help you get it sorted personally. 🙏`;

async function main() {
  const senderRow = await query('SELECT id FROM users WHERE username = $1', [SENDER_USERNAME]);
  if (!senderRow.rows.length) throw new Error(`Sender ${SENDER_USERNAME} not found`);
  const senderId = senderRow.rows[0].id;

  for (const target of TARGETS) {
    const userRow = await query('SELECT id, username FROM users WHERE username = $1', [target.username]);
    if (!userRow.rows.length) {
      console.warn(`[SKIP] ${target.username} not found`);
      continue;
    }
    const recipientId = userRow.rows[0].id;

    console.log(`\n--- ${target.username} (id: ${recipientId}) ---`);

    // Webapp DM
    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would send webapp DM to ${target.username}`);
    } else {
      try {
        await DmService.sendMessage(senderId, recipientId, { content: DM_TEXT }, { isAdmin: true });
        console.log(`[OK] Webapp DM sent to ${target.username}`);
      } catch (err) {
        console.error(`[ERROR] Webapp DM to ${target.username}: ${err.message}`);
      }
    }

    // Telegram message
    if (process.argv.includes('--skip-telegram')) {
      console.log(`[SKIP] Telegram skipped for ${target.username}`);
    } else if (DRY_RUN) {
      console.log(`[DRY-RUN] Would send Telegram message to ${target.username} (tg: ${target.telegram})`);
    } else {
      try {
        await telegram.sendMessage(target.telegram, TG_TEXT, { parse_mode: 'Markdown' });
        console.log(`[OK] Telegram message sent to ${target.username}`);
      } catch (err) {
        console.error(`[ERROR] Telegram to ${target.username}: ${err.message}`);
      }
    }
  }

  console.log('\nDone.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
