#!/usr/bin/env node
'use strict';

/**
 * broadcast-crypto-only-2026-06-25.js
 *
 * Announces PNPtv is now 100% crypto. Variation of the pinned feed post.
 *
 * Channels:
 *   1. In-app DM from SantinoFurioso (insert direct_messages row → bridges to Telegram)
 *   2. Email via Hostinger SMTP (only users with real, non-placeholder emails)
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-crypto-only-2026-06-25.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-crypto-only-2026-06-25.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-crypto-only-2026-06-25.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-crypto-only-2026-06-25.js --skip-dm
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }    = require(path.join(BACKEND, 'config/postgres'));
const sendSystemDM = require(path.join(BACKEND, 'services/sendSystemDM'));
const DmService    = require(path.join(BACKEND, 'services/dmService'));
const nodemailer   = require('nodemailer');

const DRY_RUN    = process.argv.includes('--dry-run');
const SKIP_EMAIL = process.argv.includes('--skip-email');
const SKIP_DM    = process.argv.includes('--skip-dm');
const FORCE      = process.argv.includes('--force');

const ENTITY_ID    = 'crypto-only-2026-06-25';
const SANTINO_ID   = '8599671840';
const DM_DELAY_MS  = 80;   // throttle so bridge doesn't FloodWait Telegram
const MAIL_DELAY_MS = 120; // matches precedent in other broadcast-*.js scripts

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

// In-app DM (from Santino, casual first-person)
const DM = {
  en: `hey 👋 santino here.

just so you know — PNPtv is 100% crypto now. ePayco, Stripe and PayPal kept freezing our funds and silencing the community, so we're done with them.

your membership keeps working as is. when you renew, use crypto: Dash Wallet or Trust Wallet works great, we accept BTC, ETH, USDC and 100+ more coins. no bank, no censorship.

if you need help paying with crypto, reply to this DM — I'll walk you through it personally. 🖤

— santino`,

  es: `hola 👋 soy santino.

para que sepas — PNPtv ya es 100% cripto. ePayco, Stripe y PayPal nos congelaban los fondos y censuraban a la comunidad, así que se acabó.

tu membresía sigue funcionando igual. cuando renueves, paga con cripto: Dash Wallet o Trust Wallet funcionan, aceptamos BTC, ETH, USDC y más de 100 monedas. sin banco, sin censura.

si necesitas ayuda pagando con cripto, responde a este DM — yo mismo te ayudo. 🖤

— santino`,
};

// Email subject + body
const EMAIL_SUBJECT = {
  en: 'PNPtv is now 100% crypto — here\'s how to pay',
  es: 'PNPtv ahora es 100% cripto — cómo pagar',
};

const EMAIL_BODY = {
  en: ({ name }) => `Hi ${name},

PNPtv is now 100% crypto.

We've had too many bad experiences with ePayco, Stripe, and PayPal — blocked accounts, frozen funds, and censorship of our community with zero recourse. Crypto is different. No one can freeze a transaction, ban our community, or decide what we can or can't do. Privacy, freedom, and full control — that's what crypto gives us, and that's perfectly aligned with PNP values.

🌱 New to crypto? It's easier than you think.

Three steps:
  1. Download Dash Wallet or Trust Wallet (both free, on Android/iOS)
  2. Set up your account and buy the coin of your preference at the in-app exchange
  3. Pay at https://pnptv.app/subscribe — we accept BTC, ETH, USDC and 100+ more coins

No bank needed. No middlemen. No risk of getting blocked.

Your existing membership keeps working as is — this only applies to new payments and renewals.

If you need help paying with crypto, reply to this email or DM @SantinoFurioso on the app.

— PNPtv team
support@pnptv.app
`,

  es: ({ name }) => `Hola ${name},

PNPtv ya es 100% cripto.

Tuvimos demasiadas malas experiencias con ePayco, Stripe y PayPal — cuentas bloqueadas, fondos congelados, y censura a nuestra comunidad sin posibilidad de apelación. La cripto es diferente. Nadie puede congelar una transacción, banear nuestra comunidad, ni decidir lo que podemos o no podemos hacer. Privacidad, libertad y control total — eso es exactamente lo que la cripto nos da, y eso está perfectamente alineado con los valores PNP.

🌱 ¿No sabes cómo usar cripto? Es más fácil de lo que crees.

Tres pasos:
  1. Descarga Dash Wallet o Trust Wallet (ambas gratis, en Android/iOS)
  2. Crea tu cuenta y compra la moneda de tu preferencia desde el exchange dentro de la app
  3. Paga en https://pnptv.app/subscribe — aceptamos BTC, ETH, USDC y más de 100 monedas

Sin banco, sin intermediarios, sin riesgo de que te bloqueen.

Tu membresía actual sigue funcionando — esto solo aplica a pagos nuevos y renovaciones.

Si necesitas ayuda pagando con cripto, responde a este correo o envía un DM a @SantinoFurioso en la app.

— El equipo de PNPtv
support@pnptv.app
`,
};

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log('═══════════════════════════════════════════════════');
  console.log(' PNPtv crypto-only broadcast 2026-06-25');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN)    console.log(' MODE: DRY RUN — nothing will be sent\n');
  if (SKIP_DM)    console.log(' --skip-dm\n');
  if (SKIP_EMAIL) console.log(' --skip-email\n');

  const { rows: users } = await query(`
    SELECT u.id, u.first_name, u.username, u.telegram, u.language, u.email
    FROM users u
    WHERE COALESCE(u.is_active, true) = true
      AND COALESCE(u.tier, 'free') <> 'banned'
      AND u.id <> $1
    ORDER BY u.id
  `, [SANTINO_ID]);

  // Idempotency: skip users we already DMed for this entity
  let alreadySent = new Set();
  if (!FORCE) {
    const { rows: alreadyRows } = await query(`
      SELECT target_user_id FROM notifications
      WHERE entity_type = 'broadcast' AND entity_id = $1
    `, [ENTITY_ID]);
    alreadySent = new Set(alreadyRows.map(r => r.target_user_id));
  }
  const isNew = (u) => !alreadySent.has(u.id);

  const isRealEmail = (e) => e && typeof e === 'string' && !e.endsWith('@telegram.pnptv.app');
  const dmTargets   = users.filter(isNew);
  const emailTargets = users.filter(u => isNew(u) && isRealEmail(u.email));

  console.log(`\n   Total users:      ${users.length}`);
  console.log(`   Already broadcast: ${alreadySent.size}`);
  console.log(`   DM targets:        ${dmTargets.length}`);
  console.log(`   Email targets:     ${emailTargets.length}`);

  const stats = { dm: 0, dmFailed: 0, bridge: 0, bridgeFailed: 0, email: 0, emailFailed: 0 };

  // ── 1. In-app DM from Santino + Telegram bridge ─────────────────────────────
  console.log(`\n1/2  In-app DM from SantinoFurioso to ${dmTargets.length} users (+ TG bridge)...`);
  if (!DRY_RUN && !SKIP_DM) {
    for (let i = 0; i < dmTargets.length; i++) {
      const u = dmTargets[i];
      const lang = isEn(u.language) ? 'en' : 'es';
      const text = DM[lang];

      try {
        await sendSystemDM(SANTINO_ID, u.id, text, query);
        stats.dm++;

        // Mark broadcast as sent for idempotency
        await query(`
          INSERT INTO notifications
            (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message)
          VALUES ('broadcast', 'system', 'normal', $1, $2, 'broadcast', $3, $4)
          ON CONFLICT DO NOTHING
        `, [SANTINO_ID, u.id, ENTITY_ID, text.slice(0, 200)]);

        // Telegram bridge (only if user has Telegram linked)
        if (u.telegram) {
          try {
            // bridgeToTelegram expects (senderId, recipientId, messageObj)
            await DmService.bridgeToTelegram(SANTINO_ID, u.id, { content: text });
            stats.bridge++;
          } catch (bridgeErr) {
            stats.bridgeFailed++;
            if (stats.bridgeFailed <= 5 || stats.bridgeFailed % 100 === 0) {
              console.warn(`     Bridge err [${u.id} tg=${u.telegram}]: ${bridgeErr.message}`);
            }
          }
        }
      } catch (err) {
        stats.dmFailed++;
        if (stats.dmFailed <= 5 || stats.dmFailed % 100 === 0) {
          console.warn(`     DM err [${u.id}]: ${err.message}`);
        }
      }

      await sleep(DM_DELAY_MS);
      if ((i + 1) % 200 === 0) {
        console.log(`     progress ${i + 1}/${dmTargets.length}  dm=${stats.dm} bridge=${stats.bridge}`);
      }
    }
    console.log(`     ✓ DM sent=${stats.dm} failed=${stats.dmFailed}  bridge sent=${stats.bridge} failed=${stats.bridgeFailed}`);
  } else if (SKIP_DM) {
    console.log('     skipped');
  } else {
    console.log(`     [DRY] Would DM ${dmTargets.length}; bridge ${dmTargets.filter(u => u.telegram).length} with Telegram`);
  }

  // ── 2. Email via Hostinger SMTP ─────────────────────────────────────────────
  console.log(`\n2/2  Email to ${emailTargets.length} users (Hostinger SMTP)...`);
  if (!DRY_RUN && !SKIP_EMAIL) {
    const transporter = nodemailer.createTransport({
      host: process.env.PNPTV_SMTP_HOST,
      port: parseInt(process.env.PNPTV_SMTP_PORT || '587', 10),
      secure: process.env.PNPTV_SMTP_SECURE === 'true',
      auth: { user: process.env.PNPTV_SMTP_USER, pass: process.env.PNPTV_SMTP_PASS },
    });
    const FROM = `"PNPtv" <${process.env.PNPTV_SMTP_USER || 'noreply@pnptv.app'}>`;

    for (let i = 0; i < emailTargets.length; i++) {
      const u = emailTargets[i];
      const lang = isEn(u.language) ? 'en' : 'es';
      const name = u.first_name || u.username || (lang === 'en' ? 'there' : 'amigo');

      try {
        await transporter.sendMail({
          from: FROM,
          to: u.email,
          subject: EMAIL_SUBJECT[lang],
          text: EMAIL_BODY[lang]({ name }),
        });
        stats.email++;
      } catch (err) {
        stats.emailFailed++;
        if (stats.emailFailed <= 5 || stats.emailFailed % 100 === 0) {
          console.warn(`     Mail err [${u.email}]: ${err.message}`);
        }
      }

      await sleep(MAIL_DELAY_MS);
      if ((i + 1) % 50 === 0) {
        console.log(`     progress ${i + 1}/${emailTargets.length}  sent=${stats.email} failed=${stats.emailFailed}`);
      }
    }
    console.log(`     ✓ email sent=${stats.email} failed=${stats.emailFailed}`);
  } else if (SKIP_EMAIL) {
    console.log('     skipped');
  } else {
    console.log(`     [DRY] Would email ${emailTargets.length} users`);
  }

  console.log('\n── Summary ──────────────────────────────────────────');
  console.log(`   DM:      ${DRY_RUN ? '[dry]' : stats.dm}  (failed ${stats.dmFailed})`);
  console.log(`   Bridge:  ${DRY_RUN ? '[dry]' : stats.bridge}  (failed ${stats.bridgeFailed})`);
  console.log(`   Email:   ${DRY_RUN ? '[dry]' : stats.email}  (failed ${stats.emailFailed})`);
  console.log('─────────────────────────────────────────────────────\n');
  process.exit(0);
})().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
