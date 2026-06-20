#!/usr/bin/env node
'use strict';

/**
 * broadcast-creator-calls-setup.js
 *
 * Notifies all active/eligible creators that private video calls are live on
 * their profile and walks them through setting up availability + call packages.
 * Telegram-only, bilingual (EN/ES).
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-creator-calls-setup.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-creator-calls-setup.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-creator-calls-setup.js --force
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }    = require(path.join(BACKEND, 'config/postgres'));
const { Telegram } = require('telegraf');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');

const ENTITY_ID       = 'creator-calls-setup-2026-06';
const URL_AVAILABILITY = 'https://pnptv.app/creators/availability';
const TG_DELAY_MS     = 80;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Telegram messages ─────────────────────────────────────────────────────────

const TG = {
  en: (name) =>
`📞 <b>Hey ${name} — private video calls are now live on your PNPtv profile.</b>

Members can now book a private 1-on-1 encrypted video session directly with you. All you need to do is set your schedule and your prices.

━━━━━━━━━━━━━━━
⚙️ <b>HOW TO SET UP</b>
━━━━━━━━━━━━━━━

<b>1. Set your availability</b>
Go to your Creator Studio and add the days and times you're available each week.

<b>2. Create your call packages</b>
Add at least one package with your duration and price. Suggested rates:

⏱ 30 min — <b>$60</b>
⏱ 60 min — <b>$100</b>

You're free to set your own price — these are just what works best on the platform.

<b>3. Go live</b>
Once you publish, a <b>Book a call</b> button will appear on your public profile.

━━━━━━━━━━━━━━━

👉 <a href="${URL_AVAILABILITY}">Set up your availability now</a>

━━━━━━━━━━━━━━━

Sessions are private, encrypted, and paid upfront. Members receive a direct join link after payment. You'll be notified when a session is booked. 🖤

— The PNPtv! team`,

  es: (name) =>
`📞 <b>Hola ${name} — las videollamadas privadas ya están activas en tu perfil de PNPtv.</b>

Los miembros ya pueden reservar una sesión de video privada y encriptada directamente contigo. Solo necesitas configurar tu horario y tus precios.

━━━━━━━━━━━━━━━
⚙️ <b>CÓMO CONFIGURARLO</b>
━━━━━━━━━━━━━━━

<b>1. Configura tu disponibilidad</b>
Ve a tu Creator Studio y agrega los días y horarios en que estás disponible cada semana.

<b>2. Crea tus paquetes de llamada</b>
Agrega al menos un paquete con duración y precio. Tarifas sugeridas:

⏱ 30 min — <b>$60</b>
⏱ 60 min — <b>$100</b>

Puedes poner el precio que quieras — estas son solo las tarifas que mejor funcionan en la plataforma.

<b>3. Publícalo</b>
Una vez que lo guardes, aparecerá el botón <b>Reservar una llamada</b> en tu perfil público.

━━━━━━━━━━━━━━━

👉 <a href="${URL_AVAILABILITY}">Configura tu disponibilidad ahora</a>

━━━━━━━━━━━━━━━

Las sesiones son privadas, encriptadas y se pagan por adelantado. Los miembros reciben un enlace directo tras el pago. Recibirás una notificación cuando se reserve una sesión. 🖤

— El equipo de PNPtv!`,
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' Creator Calls Setup Broadcast — June 2026');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN) console.log(' MODE: DRY RUN — nothing will be sent\n');

  const { rows: creators } = await query(`
    SELECT id, first_name, username, telegram, language
    FROM users
    WHERE creator_status IN ('active', 'eligible')
      AND COALESCE(is_deleted, false) = false
      AND telegram IS NOT NULL
    ORDER BY id
  `);

  let alreadySent = new Set();
  if (!FORCE) {
    const { rows: alreadyRows } = await query(`
      SELECT target_user_id FROM notifications
      WHERE entity_id = $1 AND entity_type = 'system' AND actor_id IS NULL
    `, [ENTITY_ID]);
    alreadySent = new Set(alreadyRows.map(r => r.target_user_id));
  }

  const targets = creators.filter(u => !alreadySent.has(u.id));

  console.log(`\n   Total creators:   ${creators.length}`);
  console.log(`   Already notified: ${alreadySent.size}`);
  console.log(`   To send:          ${targets.length}`);

  if (DRY_RUN) {
    const sample = targets[0];
    if (sample) {
      const lang = isEn(sample.language) ? 'en' : 'es';
      const name = sample.first_name || sample.username || (lang === 'en' ? 'there' : 'amigo');
      console.log('\n── Sample message ──\n');
      console.log(TG[lang](name));
    }
    console.log('\n═══════════════════════════════════════════════════');
    console.log(' DRY RUN COMPLETE — nothing sent');
    console.log('═══════════════════════════════════════════════════\n');
    process.exit(0);
  }

  const tg = new Telegram(process.env.BOT_TOKEN);
  let sent = 0, failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const u = targets[i];
    const lang = isEn(u.language) ? 'en' : 'es';
    const name = u.first_name || u.username || (lang === 'en' ? 'there' : 'amigo');
    const msg  = TG[lang](name);

    try {
      await tg.sendMessage(u.telegram, msg, { parse_mode: 'HTML', disable_web_page_preview: true });

      await query(`
        INSERT INTO notifications
          (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message, metadata)
        VALUES ('announcement', 'system', 'normal', NULL, $1, 'system', $2, $3, $4::jsonb)
        ON CONFLICT (type, target_user_id, entity_type, entity_id) WHERE actor_id IS NULL
        DO UPDATE SET is_read = FALSE, created_at = NOW(), message = EXCLUDED.message
      `, [u.id, ENTITY_ID, lang === 'en'
          ? '📞 Private video calls are now live on your profile. Set up your availability to start accepting bookings.'
          : '📞 Las videollamadas privadas ya están activas en tu perfil. Configura tu disponibilidad para empezar a recibir reservas.',
         JSON.stringify({ url: URL_AVAILABILITY })]);

      sent++;
    } catch (err) {
      failed++;
      if (failed <= 5 || failed % 10 === 0) {
        console.warn(`     TG err [${u.telegram} / ${u.username}]: ${err.message}`);
      }
    }

    await sleep(TG_DELAY_MS);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(' BROADCAST COMPLETE');
  console.log('═══════════════════════════════════════════════════');
  console.log(` Sent:   ${sent}`);
  console.log(` Failed: ${failed}`);
  console.log('═══════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
