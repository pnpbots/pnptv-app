#!/usr/bin/env node
'use strict';

/**
 * broadcast-2257-grace-blocked.js
 *
 * One-shot nudge for ACTIVE creators currently blocked by the 2257 gate:
 *   - identity_verified=false AND
 *   - identity_verification_required_by IS NULL OR < NOW()
 *
 * These creators silently fail every post / upload / go-live with a 403 and
 * may not realize ID verification is the cause. This Telegram DM tells them
 * exactly what to do and links to /creators/apply.
 *
 * Telegram-only, bilingual (EN/ES). Uses notifications.entity_id dedupe so
 * re-runs are safe (no double-send unless --force).
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-2257-grace-blocked.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-2257-grace-blocked.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-2257-grace-blocked.js --force
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }    = require(path.join(BACKEND, 'config/postgres'));
const { Telegram } = require('telegraf');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');

// --only=username1,username2  — bypass the default WHERE filter and target a
// specific allowlist of usernames. Used when operator wants to nudge a few
// creators early and hold the rest. Case-insensitive.
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const ONLY_USERNAMES = onlyArg
  ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  : null;

const ENTITY_ID = '2257-grace-blocked-2026-06';
const URL_APPLY = 'https://pnptv.app/creators/apply';
const TG_DELAY_MS = 80;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

const TG = {
  en: (name) =>
`🛑 <b>Hey ${name} — your creator tools are paused.</b>

We need your government-issued ID to keep your account compliant with 18 U.S.C. § 2257 (US adult-content recordkeeping law).

Until your ID is uploaded and approved, you can't post, upload videos, or go live on PNPtv.

━━━━━━━━━━━━━━━
✅ <b>HOW TO FIX IT (5 MIN)</b>
━━━━━━━━━━━━━━━

<b>1.</b> Open your Creator Studio
<b>2.</b> Upload a photo of your government ID (passport, driver's licence, or national ID)
<b>3.</b> Wait for admin approval (usually under 24 hours)

Once approved, all your tools unlock automatically — no other action needed.

━━━━━━━━━━━━━━━

👉 <a href="${URL_APPLY}">Upload your ID now</a>

━━━━━━━━━━━━━━━

Your ID is stored privately and only viewable by our compliance admin. We're sorry for the inconvenience — this is a legal requirement we can't skip. 🖤

— The PNPtv! team`,

  es: (name) =>
`🛑 <b>Hola ${name} — tus herramientas de creador están pausadas.</b>

Necesitamos una foto de tu identificación oficial para mantener tu cuenta en cumplimiento con la ley 18 U.S.C. § 2257 (ley de registros de contenido adulto en EE.UU.).

Hasta que tu ID esté cargada y aprobada, no puedes publicar, subir videos ni transmitir en vivo en PNPtv.

━━━━━━━━━━━━━━━
✅ <b>CÓMO RESOLVERLO (5 MIN)</b>
━━━━━━━━━━━━━━━

<b>1.</b> Abre tu Creator Studio
<b>2.</b> Sube una foto de tu identificación oficial (pasaporte, cédula o licencia de conducir)
<b>3.</b> Espera la aprobación del administrador (normalmente menos de 24 horas)

Una vez aprobada, todas tus herramientas se desbloquean automáticamente — no necesitas hacer nada más.

━━━━━━━━━━━━━━━

👉 <a href="${URL_APPLY}">Sube tu ID ahora</a>

━━━━━━━━━━━━━━━

Tu ID se guarda de forma privada y solo la puede ver nuestro administrador de cumplimiento. Lamentamos la molestia — es un requisito legal que no podemos saltarnos. 🖤

— El equipo de PNPtv!`,
};

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' 2257 Grace-Blocked Creator Nudge — June 2026');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN) console.log(' MODE: DRY RUN — nothing will be sent\n');

  // Default target: active creators silently blocked by 2257 gate.
  // - identity_verified = false (haven't been approved)
  // - deadline NULL (never set) OR deadline in the past (expired grace)
  // With --only=, bypass that filter and target the username allowlist instead
  // (still requires active creator + telegram).
  let creators;
  if (ONLY_USERNAMES && ONLY_USERNAMES.length) {
    console.log(`   --only override: targeting usernames [${ONLY_USERNAMES.join(', ')}]`);
    const { rows } = await query(`
      SELECT id, first_name, username, telegram, language,
             identity_verification_required_by
      FROM users
      WHERE creator_status = 'active'
        AND LOWER(username) = ANY($1::text[])
        AND COALESCE(is_deleted, false) = false
        AND telegram IS NOT NULL
      ORDER BY id
    `, [ONLY_USERNAMES]);
    creators = rows;
  } else {
    const { rows } = await query(`
      SELECT id, first_name, username, telegram, language,
             identity_verification_required_by
      FROM users
      WHERE creator_status = 'active'
        AND identity_verified = false
        AND (identity_verification_required_by IS NULL
             OR identity_verification_required_by < NOW())
        AND COALESCE(is_deleted, false) = false
        AND telegram IS NOT NULL
      ORDER BY id
    `);
    creators = rows;
  }

  let alreadySent = new Set();
  if (!FORCE) {
    const { rows: alreadyRows } = await query(`
      SELECT target_user_id FROM notifications
      WHERE entity_id = $1 AND entity_type = 'system' AND actor_id IS NULL
    `, [ENTITY_ID]);
    alreadySent = new Set(alreadyRows.map(r => r.target_user_id));
  }

  const targets = creators.filter(u => !alreadySent.has(u.id));

  console.log(`\n   Total blocked creators: ${creators.length}`);
  console.log(`   Already notified:       ${alreadySent.size}`);
  console.log(`   To send:                ${targets.length}`);

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
        VALUES ('announcement', 'system', 'high', NULL, $1, 'system', $2, $3, $4::jsonb)
        ON CONFLICT (type, target_user_id, entity_type, entity_id) WHERE actor_id IS NULL
        DO UPDATE SET is_read = FALSE, created_at = NOW(), message = EXCLUDED.message
      `, [u.id, ENTITY_ID, lang === 'en'
          ? '🛑 Your creator tools are paused — upload your ID to unlock posting, uploads, and Go Live.'
          : '🛑 Tus herramientas de creador están pausadas — sube tu ID para desbloquear publicación, uploads y Go Live.',
         JSON.stringify({ url: URL_APPLY })]);

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
  console.log(' NUDGE COMPLETE');
  console.log('═══════════════════════════════════════════════════');
  console.log(` Sent:   ${sent}`);
  console.log(` Failed: ${failed}`);
  console.log('═══════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
