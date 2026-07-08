#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: '/app/.env' });
require('dotenv').config({ path: '/app/.env.production' });

const path = require('path');
const { Pool } = require('pg');

const BACKEND = path.resolve(__dirname, '..');
const sendSystemDM = require(path.join(BACKEND, 'services/sendSystemDM'));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SYSTEM_SENDER = '8552451957';
const DRY_RUN = process.argv.includes('--dry-run');

// Ordered by attempt count (highest intent first)
const ASSIGNMENTS = [
  { username: 'SDHBBCV',         userId: '5924133816',                              tg: '5924133816',  meruCode: 'fllJfg' },
  { username: 'FLLBETASUB',      userId: '8418763546',                              tg: '8418763546',  meruCode: '1Y-EVJ' },
  { username: 'CHRISTOPHERCITO', userId: 'd6d34495-925a-4859-8ce9-bd2a837a7712',   tg: null,          meruCode: '1PvAdB' },
  { username: 'MANU3332',        userId: '5606645380',                              tg: '5606645380',  meruCode: 'fl5sem' },
  { username: 'SINPERV',         userId: '8476554567',                              tg: '8476554567',  meruCode: 'rHL1tb' },
  { username: 'TMJ',             userId: '8226876856',                              tg: '8226876856',  meruCode: '_bI8-t' },
  { username: 'Dacior',          userId: '7454293437',                              tg: '7454293437',  meruCode: 'qSeYDH' },
  { username: 'GANGSHIT1111',    userId: '8c1ff5ff-cb47-4464-b15e-fb7388c5d794',   tg: '7970273563',  meruCode: '5INg4b' },
  { username: 'EVERF3NIX',       userId: 'b7996610-be8a-4788-8624-8629ad718d91',   tg: '1451561946',  meruCode: 'RKdls4' },
  { username: 'MRHANS1987',      userId: '1820431237',                              tg: '1820431237',  meruCode: 'Pq5S1P' },
  { username: 'BOTHMAN10',       userId: '5873016135',                              tg: '5873016135',  meruCode: '73dJRp' },
];

function buildMessage(username, meruLink) {
  const name = username || 'amigo';
  return `🔥 ${name}, tenemos algo especial para ti.

Vimos que intentaste unirte a PNPtv! Lifetime100 — y queremos que lo logres.

Te reservamos un link personal de pago por tarjeta:
👉 ${meruLink}

Paga ahí y luego regresa a https://pnptv.app/lifetime100 para activar tu acceso.

¿Prefieres cripto o tarjeta directa? También en: https://pnptv.app/lifetime100

¡Te esperamos adentro! 🏳️‍🌈`;
}

async function sendTelegram(tgId, text) {
  if (DRY_RUN) {
    console.log(`  [DRY] TG → ${tgId}`);
    return true;
  }
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: tgId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      }),
    });
    const json = await res.json();
    if (!json.ok) {
      console.warn(`  TG error for ${tgId}: ${json.description}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`  TG exception for ${tgId}: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log(`\n=== Meru Links Send (${DRY_RUN ? 'DRY RUN' : 'LIVE'}) — ${new Date().toISOString()} ===\n`);

  const client = await pool.connect();
  const pgQuery = (sql, params) => client.query(sql, params);

  const results = [];

  for (const user of ASSIGNMENTS) {
    console.log(`\n→ ${user.username} (${user.userId})`);
    let meruLink;
    try {
      if (DRY_RUN) {
        meruLink = `https://pay.getmeru.com/${user.meruCode}`;
        console.log(`  [DRY] Would reserve ${meruLink}`);
      } else {
        // Meru link should already be reserved from previous attempt — fetch it
        const res = await client.query(
          `SELECT meru_link FROM meru_payment_links WHERE code = $1`,
          [user.meruCode]
        );
        meruLink = res.rows[0]?.meru_link;
        if (!meruLink) throw new Error(`Meru link ${user.meruCode} not found`);
        console.log(`  Link: ${meruLink}`);
      }

      const msg = buildMessage(user.username, meruLink);

      // In-app DM via sendSystemDM
      if (DRY_RUN) {
        console.log(`  [DRY] In-app DM → ${user.userId}`);
      } else {
        await sendSystemDM(SYSTEM_SENDER, user.userId, msg, pgQuery);
        console.log(`  ✓ In-app DM sent`);
      }

      // Telegram
      let tgSent = false;
      if (user.tg) {
        tgSent = await sendTelegram(user.tg, msg);
        if (tgSent) console.log(`  ✓ TG sent to ${user.tg}`);
      } else {
        console.log(`  — No TG, in-app only`);
      }

      results.push({ ...user, meruLink, inApp: true, tgSent });
    } catch (e) {
      console.error(`  ✗ FAILED: ${e.message}`);
      results.push({ ...user, meruLink, error: e.message });
    }

    if (!DRY_RUN) await new Promise(r => setTimeout(r, 700));
  }

  client.release();

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    const status = r.error ? `✗ ${r.error}` : `✓ in-app + ${r.tgSent ? 'TG' : 'no TG'}`;
    console.log(`  ${r.username}: ${status}`);
  }

  const ok = results.filter(r => !r.error).length;
  console.log(`\nDone: ${ok}/${ASSIGNMENTS.length} sent\n`);
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
