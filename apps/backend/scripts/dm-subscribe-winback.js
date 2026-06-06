#!/usr/bin/env node
'use strict';

/**
 * dm-subscribe-winback.js
 *
 * In-app + Telegram DM to all users who attempted a payment in the last 24h
 * but never completed it — inviting them to join via /lifetime100 or /subscribe.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/dm-subscribe-winback.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/dm-subscribe-winback.js
 *   docker exec pnptv-bot node apps/backend/scripts/dm-subscribe-winback.js --skip-telegram
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }    = require(path.join(BACKEND, 'config/postgres'));
const sendSystemDM = require(path.join(BACKEND, 'services/sendSystemDM'));
const { Telegram } = require('telegraf');

const DRY_RUN       = process.argv.includes('--dry-run');
const SKIP_TELEGRAM = process.argv.includes('--skip-telegram');

const SENDER_ID      = '8552451957'; // PNPtv! admin account
const LIFETIME_URL   = 'https://pnptv.app/lifetime100';
const SUBSCRIBE_URL  = 'https://pnptv.app/subscribe';
const TG_DELAY_MS    = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

const MSG = {
  en: (name) =>
`👋 Hey ${name}! We noticed you were trying to subscribe — we don't want you to miss out.

Here are the easiest ways to join PNPtv! right now:

━━━━━━━━━━━━━━━
🔥 LIFETIME PRIME — $100 one-time
━━━━━━━━━━━━━━━
Pay once. PRIME access forever. No renewals.

💳 Card (Visa / Mastercard)
🥷 Dash (anonymous, no bank)
🪙 USDC (stable digital dollar)

👉 ${LIFETIME_URL}

━━━━━━━━━━━━━━━
💎 MONTHLY & YEARLY PLANS
━━━━━━━━━━━━━━━
Flexible options starting at $15.00/week.

👉 ${SUBSCRIBE_URL}

━━━━━━━━━━━━━━━
❓ HOW TO PAY WITH CRYPTO
━━━━━━━━━━━━━━━
Never used crypto? Easy:
1️⃣ Download Coinbase, Kraken, or Binance (free)
2️⃣ Buy the amount you need
3️⃣ Go to ${SUBSCRIBE_URL} → choose plan → tap "Pay with Dash" or "Pay with USDC"
4️⃣ Send to the address shown — access activates automatically

No bank. No name. Completely private.

Reply here if you have any questions — we'll help you through it. 🙌`,

  es: (name) =>
`👋 ¡Hola ${name}! Vimos que intentaste suscribirte — no queremos que te quedes sin acceso.

Estas son las formas más fáciles de unirte a PNPtv! ahora mismo:

━━━━━━━━━━━━━━━
🔥 LIFETIME PRIME — $100 pago único
━━━━━━━━━━━━━━━
Pagas una vez. Acceso PRIME para siempre. Sin renovaciones.

💳 Tarjeta (Visa / Mastercard)
🥷 Dash (anónimo, sin banco)
🪙 USDC (dólar digital estable)

👉 ${LIFETIME_URL}

━━━━━━━━━━━━━━━
💎 PLANES MENSUALES Y ANUALES
━━━━━━━━━━━━━━━
Opciones flexibles desde $15.00/semana.

👉 ${SUBSCRIBE_URL}

━━━━━━━━━━━━━━━
❓ CÓMO PAGAR CON CRIPTO
━━━━━━━━━━━━━━━
¿Nunca usaste cripto? Es fácil:
1️⃣ Descarga Coinbase, Kraken o Binance (gratis)
2️⃣ Compra la cantidad que necesitas
3️⃣ Ve a ${SUBSCRIBE_URL} → elige tu plan → toca "Pagar con Dash" o "Pagar con USDC"
4️⃣ Envía al address que aparece — el acceso se activa automáticamente

Sin banco. Sin nombre. Completamente privado.

Escríbenos aquí si tienes dudas — te ayudamos. 🙌`,
};

async function main() {
  console.log('\n══════════════════════════════════════════════════');
  console.log(' Winback DM — Failed/Pending Payment Users');
  console.log('══════════════════════════════════════════════════');
  if (DRY_RUN)       console.log(' MODE: DRY RUN — nothing will be sent\n');
  if (SKIP_TELEGRAM) console.log(' --skip-telegram\n');

  const { rows: users } = await query(`
    SELECT DISTINCT ON (u.id)
      u.id, u.first_name, u.username, u.telegram, u.language
    FROM payments p
    JOIN users u ON u.id = p.user_id
    WHERE p.created_at > NOW() - INTERVAL '24 hours'
      AND p.status IN ('pending', 'failed', 'abandoned')
      AND p.provider = 'epayco'
      AND COALESCE(u.is_deleted, false) = false
      AND u.role != 'banned'
    ORDER BY u.id
  `);

  console.log(`\n Target users: ${users.length}`);
  if (!users.length) { console.log(' No targets found.\n'); process.exit(0); }

  if (DRY_RUN) {
    console.log('\n── Users ──');
    users.forEach(u => console.log(`   ${u.username || u.id} (${u.language || 'es'}) TG:${u.telegram || 'none'}`));
    console.log('\n── Sample message (EN) ──\n');
    console.log(MSG.en('Member'));
    console.log('\n══════════════════════════════════════════════════');
    console.log(' DRY RUN COMPLETE — nothing sent');
    console.log('══════════════════════════════════════════════════\n');
    process.exit(0);
  }

  const tg = new Telegram(process.env.BOT_TOKEN);
  const stats = { inApp: 0, inAppFailed: 0, telegram: 0, telegramFailed: 0 };

  for (const u of users) {
    const lang = isEn(u.language) ? 'en' : 'es';
    const name = u.first_name || u.username || (lang === 'en' ? 'there' : 'amigo');
    const msg  = MSG[lang](name);

    // In-app DM
    try {
      await sendSystemDM(SENDER_ID, u.id, msg, query);
      stats.inApp++;
      console.log(` ✓ In-app DM → ${u.username || u.id}`);
    } catch (err) {
      stats.inAppFailed++;
      console.warn(` ✗ In-app DM failed [${u.id}]: ${err.message}`);
    }

    // Telegram DM
    if (!SKIP_TELEGRAM && u.telegram) {
      try {
        await tg.sendMessage(u.telegram, msg, { parse_mode: 'HTML' });
        stats.telegram++;
      } catch (err) {
        stats.telegramFailed++;
        console.warn(` ✗ TG DM failed [${u.telegram}]: ${err.message}`);
      }
      await sleep(TG_DELAY_MS);
    }
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(' WINBACK DM COMPLETE');
  console.log('══════════════════════════════════════════════════');
  console.log(` In-app:   ${stats.inApp} sent / ${stats.inAppFailed} failed`);
  console.log(` Telegram: ${stats.telegram} sent / ${stats.telegramFailed} failed`);
  console.log('══════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
