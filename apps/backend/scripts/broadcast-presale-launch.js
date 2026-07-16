'use strict';

/**
 * Presale + Grand Launch announcement
 * Run at exactly 6 PM Colombia (23:00 UTC Jul 16):
 *   docker exec pnptv-bot node /app/apps/backend/scripts/broadcast-presale-launch.js
 *
 * Channels: hangouts (general, prime, hangout:118), DMs, Telegram
 */

const { Pool } = require('pg');
const https = require('https');

const SYSTEM_USER_ID = '8552451957';
const SYSTEM_USERNAME = 'pnptv';
const SYSTEM_NAME = 'PNPtv! News';
const SYSTEM_PHOTO = '/uploads/avatars/8552451957-pnptv-logo.png';
const BOT_TOKEN = process.env.BOT_TOKEN;

const MSG = `🔥 PREVENTA ACTIVA — 10% de descuento en Tokens (6 horas)

Las Tokens ya están en venta y por las próximas 6 horas (hasta las 12 AM hora Colombia) tienes un 10% de descuento en todos los paquetes.

👉 pnptv.app → Billetera → Comprar Tokens

━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 GRAN LANZAMIENTO — Sábado 18 de julio a las 12 AM

Este fin de semana es el lanzamiento oficial. Los creadores que se conecten ganan 10% más en propinas y compras del viernes 18 al lunes 21 a las 6 AM.

Si eres creador: conéctate, haz shows en vivo, interactúa. El bono va directo a tu billetera.

━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔥 PRESALE ACTIVE — 10% off Tokens (6 hours only)

Tokens are now on sale and for the next 6 hours (until midnight Colombia time) you get 10% off all packages.

👉 pnptv.app → Wallet → Buy Tokens

🚀 GRAND LAUNCH — Saturday July 18 at midnight

This weekend is the official launch. Creators who go live earn 10% more on tips and purchases from Saturday July 18 through Monday July 21 at 6 AM Colombia.`;

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'pg-pnptv',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DATABASE || 'pnptvbot',
  user: process.env.POSTGRES_USER || 'pnptvbot',
  password: process.env.POSTGRES_PASSWORD,
  max: 3,
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function tgSend(chatId, text) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 10000,
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ ok: false }); } });
    });
    req.on('error', () => resolve({ ok: false }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
    req.write(payload); req.end();
  });
}

async function main() {
  console.log('=== Presale + Grand Launch Broadcast ===');
  console.log(new Date().toISOString(), '\n');
  const client = await pool.connect();
  try {
    // Hangout rooms
    console.log('── Hangouts ──');
    for (const room of ['general', 'prime', 'hangout:118']) {
      await client.query(
        `INSERT INTO chat_messages (room, user_id, username, first_name, photo_url, content)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [room, SYSTEM_USER_ID, SYSTEM_USERNAME, SYSTEM_NAME, SYSTEM_PHOTO, MSG]
      );
      console.log(`  ✓ ${room}`);
    }

    // In-app DMs
    console.log('\n── In-app DMs ──');
    const { rows: dmUsers } = await client.query(
      `SELECT id FROM users WHERE username NOT LIKE 'deleted_%' AND id != $1`,
      [SYSTEM_USER_ID]
    );
    console.log(`  Sending to ${dmUsers.length} users...`);
    let dmSent = 0, dmFailed = 0;
    for (const u of dmUsers) {
      try {
        await client.query(
          `INSERT INTO direct_messages (sender_id, recipient_id, content) VALUES ($1,$2,$3)`,
          [SYSTEM_USER_ID, u.id, MSG]
        );
        dmSent++;
      } catch { dmFailed++; }
      if (dmSent % 500 === 0) console.log(`  DM ${dmSent}/${dmUsers.length}`);
    }
    console.log(`  ✓ DMs: ${dmSent} sent, ${dmFailed} failed`);

    // Telegram
    if (!BOT_TOKEN) { console.log('\n── Telegram: SKIPPED (no BOT_TOKEN) ──'); }
    else {
      console.log('\n── Telegram ──');
      const { rows: tgUsers } = await client.query(
        `SELECT id FROM users WHERE id ~ '^[0-9]+$' AND username NOT LIKE 'deleted_%' AND id != $1`,
        [SYSTEM_USER_ID]
      );
      console.log(`  Sending to ${tgUsers.length} users...`);
      let tgSent = 0, tgFailed = 0;
      for (const u of tgUsers) {
        const r = await tgSend(parseInt(u.id), MSG);
        if (r.ok) tgSent++; else tgFailed++;
        if ((tgSent + tgFailed) % 25 === 0) {
          await sleep(1000);
          console.log(`  TG ${tgSent} sent, ${tgFailed} failed / ${tgUsers.length}`);
        }
      }
      console.log(`  ✓ Telegram: ${tgSent} sent, ${tgFailed} failed`);
    }

    console.log('\n=== Done ===');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
