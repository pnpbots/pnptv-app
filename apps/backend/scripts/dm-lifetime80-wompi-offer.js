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

const MSG = `👋 Hey! We noticed you tried to complete your Lifetime membership payment.

We have an exclusive one-time opportunity for you to get the PNPtv Lifetime membership at $80 USD — pay directly from your bank account or card via Wompi:

🔗 https://checkout.nequi.wompi.co/l/lbNzFX

⚠️ The amount shown is in Colombian pesos (COP) — that's normal. It equals exactly $80 USD.

This link works with Wompi only (bank transfer or card). This offer won't be available again after today.

Reply here if you need any help. 🙌`;

const TARGETS = [
  {
    label:  'BATECRAZED — sdk_error on lifetime80',
    userId: '5050199917',
    tgId:   '5050199917',
  },
  {
    label:  'GLEE76CY — sdk_error on lifetime80',
    userId: '6805750392',
    tgId:   '6805750392',
  },
  {
    label:  'HKBRONYC — 2 pending lifetime80 attempts',
    userId: '6014119773',
    tgId:   '6014119773',
  },
  {
    label:  'hkslutboi — Abandonada x2 on lifetime80 (no TG, in-app only)',
    userId: '42de6fda-b997-421b-8a8e-001df004182d',
    tgId:   null,
  },
  {
    label:  'scrufflvratx — 2 pending lifetime80 attempts (no TG, in-app only)',
    userId: '8949742002',
    tgId:   null,
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('\n══════════════════════════════════════════════════');
  console.log(' DM → Lifetime80 Wompi offer (exclusive one-time)');
  console.log('══════════════════════════════════════════════════');
  if (DRY_RUN) console.log(' MODE: DRY RUN\n');

  const tg = new Telegram(process.env.BOT_TOKEN);

  for (const t of TARGETS) {
    console.log(`\n── ${t.label}`);
    if (DRY_RUN) { console.log(MSG); continue; }

    // In-app DM
    try {
      await sendSystemDM(SENDER_ID, t.userId, MSG, query);
      console.log(' ✓ In-app DM sent');
    } catch (err) {
      console.warn(' ✗ In-app DM failed:', err.message);
    }

    // Telegram DM (only for users with a TG ID)
    if (t.tgId) {
      try {
        await tg.sendMessage(t.tgId, MSG);
        console.log(' ✓ Telegram DM sent');
      } catch (err) {
        console.warn(' ✗ Telegram DM failed:', err.message);
      }
    } else {
      console.log(' — Telegram skipped (no TG account)');
    }

    await sleep(1200);
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(' Done.');
  console.log('══════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
