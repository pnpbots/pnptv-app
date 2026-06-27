#!/usr/bin/env node
'use strict';

/**
 * broadcast-creator-hold-update-2026-06.js
 *
 * Platform-status update for all active creators (except Santino + Lex, who
 * are QA-testing creator tools). Apologizes for the delay, explains the
 * card-processor → crypto migration, signals creator tools turning on within
 * a few days. Telegram-only, bilingual (EN/ES).
 *
 * Usage:
 *   docker exec pnptv-bot node /app/apps/backend/scripts/broadcast-creator-hold-update-2026-06.js --dry-run
 *   docker exec pnptv-bot node /app/apps/backend/scripts/broadcast-creator-hold-update-2026-06.js
 *   docker exec pnptv-bot node /app/apps/backend/scripts/broadcast-creator-hold-update-2026-06.js --force
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }    = require(path.join(BACKEND, 'config/postgres'));
const { Telegram } = require('telegraf');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');

const ENTITY_ID = 'creator-hold-update-2026-06';
const EXCLUDED_USERNAMES = ['santinofurioso', 'pnplatinoboy']; // QA testers — skip them
const TG_DELAY_MS = 80;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

const TG = {
  en: (name) =>
`🖤 <b>Hey ${name} — quick update from the PNPtv team.</b>

We apologize for the delay and we know some of you are frustrated. Here's where we are.

━━━━━━━━━━━━━━━
💳 <b>WHY THE WAIT</b>
━━━━━━━━━━━━━━━

We tried to enable card payments through several providers, but Visa and Mastercard make it very hard for adult creators. Even after paying a specialist firm to set us up, the integration didn't hold — and we won't risk your funds being frozen or held by a card processor.

So we're migrating to crypto, with automations so that:
  • Clients get what they paid for immediately
  • Creators receive their money as fast as possible

This can't be done with plain crypto transactions — we had to build the tooling ourselves (plus educate users, which is ongoing).

━━━━━━━━━━━━━━━
✅ <b>WHAT'S NEXT</b>
━━━━━━━━━━━━━━━

Everything else is almost ready (PNP Live — our Cam4/Chaturbate-style webcam product — is the only piece still being finished). Your creator tools will be enabled in the next few days so you can start monetizing.

<b>P.S.</b> Fingers crossed we get approved for a service that lets clients pay with cards while we still receive crypto — no wallet needed on their side. That'll make it much easier for users who don't want to switch payment methods.

— The PNPtv! team 🖤`,

  es: (name) =>
`🖤 <b>Hola ${name} — actualización rápida del equipo de PNPtv.</b>

Pedimos disculpas por la demora y sabemos que algunos de ustedes están frustrados. Aquí va dónde estamos.

━━━━━━━━━━━━━━━
💳 <b>POR QUÉ LA DEMORA</b>
━━━━━━━━━━━━━━━

Intentamos habilitar pagos con tarjeta a través de varios proveedores, pero Visa y Mastercard lo hacen muy difícil para creadores de contenido adulto. Incluso después de pagarle a una empresa especialista para configurarnos, la integración no funcionó — y no vamos a arriesgarnos a que un procesador de tarjetas les congele o retenga sus fondos.

Por eso estamos migrando a cripto, con automatizaciones para que:
  • Los clientes reciban lo que pagaron de inmediato
  • Los creadores reciban su dinero lo más rápido posible

Esto no se puede hacer con transacciones cripto normales — tuvimos que construir las herramientas nosotros mismos (además de educar a los usuarios, que es un trabajo continuo).

━━━━━━━━━━━━━━━
✅ <b>QUÉ SIGUE</b>
━━━━━━━━━━━━━━━

Todo lo demás está casi listo (PNP Live — nuestro producto estilo webcam tipo Cam4/Chaturbate — es la única pieza que todavía estamos terminando). Tus herramientas de creador se van a activar en los próximos días para que puedas empezar a monetizar.

<b>P.D.</b> Cruzamos los dedos para que nos aprueben un servicio que permita a los clientes pagar con tarjeta mientras nosotros seguimos recibiendo cripto — sin que ellos necesiten wallet. Eso va a hacer mucho más fácil la vida de los usuarios que no quieren cambiarse a pagos con cripto.

— El equipo de PNPtv! 🖤`,
};

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' Creator Hold Update — June 2026');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN) console.log(' MODE: DRY RUN — nothing will be sent\n');

  const { rows: creators } = await query(`
    SELECT id, first_name, username, telegram, language
    FROM users
    WHERE creator_status = 'active'
      AND COALESCE(is_deleted, false) = false
      AND telegram IS NOT NULL
      AND LOWER(username) <> ALL($1::text[])
    ORDER BY id
  `, [EXCLUDED_USERNAMES]);

  let alreadySent = new Set();
  if (!FORCE) {
    const { rows: alreadyRows } = await query(`
      SELECT target_user_id FROM notifications
      WHERE entity_id = $1 AND entity_type = 'system' AND actor_id IS NULL
    `, [ENTITY_ID]);
    alreadySent = new Set(alreadyRows.map(r => r.target_user_id));
  }

  const targets = creators.filter(u => !alreadySent.has(u.id));

  console.log(`\n   Cohort (active creators):  ${creators.length}`);
  console.log(`   Excluded:                  ${EXCLUDED_USERNAMES.join(', ')}`);
  console.log(`   Already notified:          ${alreadySent.size}`);
  console.log(`   To send:                   ${targets.length}`);

  if (DRY_RUN) {
    const sample = targets[0];
    if (sample) {
      const lang = isEn(sample.language) ? 'en' : 'es';
      const name = sample.first_name || sample.username || (lang === 'en' ? 'there' : 'amigo');
      console.log(`\n── Sample message (${lang.toUpperCase()}, for ${sample.username}) ──\n`);
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
          ? '🖤 PNPtv update: we apologize for the delay. Your creator tools will be enabled in the next few days.'
          : '🖤 Actualización PNPtv: pedimos disculpas por la demora. Tus herramientas de creador se activarán en los próximos días.',
         JSON.stringify({})]);

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
