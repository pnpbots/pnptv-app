#!/usr/bin/env node
'use strict';

/**
 * broadcast-mainstage-live.js
 *
 * Announces that Main Stage is working. Clears the PWA cache on click
 * via the ?update=1 param in the notification URL.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-mainstage-live.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-mainstage-live.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-mainstage-live.js --skip-telegram
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query } = require(path.join(BACKEND, 'config/postgres'));
const PushNotificationService = require(path.join(BACKEND, 'services/pushNotificationService'));
const { Telegram } = require('telegraf');

const DRY_RUN       = process.argv.includes('--dry-run');
const SKIP_TELEGRAM = process.argv.includes('--skip-telegram');
const SKIP_PUSH     = process.argv.includes('--skip-push');
const TG_DELAY_MS   = 80;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');
const getLang = (user) => isEn(user.language) ? 'en' : 'es';

const MAIN_STAGE_URL = 'https://pnptv.app/main-stage?update=1';

const PUSH = {
  en: {
    title: '🎬 Main Stage is live!',
    body:  'The PNPtv! Main Stage is working. Tap to join now.',
  },
  es: {
    title: '🎬 ¡El Main Stage está activo!',
    body:  'El Main Stage de PNPtv! ya funciona. Toca para unirte.',
  },
};

const TG_MSG = {
  en:
`🎬 <b>Main Stage is live!</b>

The PNPtv! Main Stage is now working. Come join the fun!

👉 <a href="${MAIN_STAGE_URL}">pnptv.app/main-stage</a>`,

  es:
`🎬 <b>¡El Main Stage está activo!</b>

El Main Stage de PNPtv! ya está funcionando. ¡Ven a unirte!

👉 <a href="${MAIN_STAGE_URL}">pnptv.app/main-stage</a>`,
};

async function main() {
  console.log(`[broadcast-mainstage-live] DRY_RUN=${DRY_RUN} SKIP_TELEGRAM=${SKIP_TELEGRAM}`);

  // ── 1. Web push ──────────────────────────────────────────────────────────────
  if (SKIP_PUSH) { console.log('[push] skipped'); }
  if (!SKIP_PUSH) PushNotificationService.initialize();
  let pushSent = 0;
  if (!SKIP_PUSH) {
    try {
      pushSent = await PushNotificationService.sendToAll({
        title: PUSH.es.title,
        body:  PUSH.es.body,
        url:   MAIN_STAGE_URL,
        dryRun: DRY_RUN,
      });
      console.log(`[push] sent=${pushSent}`);
    } catch (err) {
      console.error('[push] error:', err.message);
    }
  }

  // ── 2. Telegram DMs ──────────────────────────────────────────────────────────
  if (!SKIP_TELEGRAM) {
    const tg = new Telegram(process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN);
    const { rows } = await query(
      `SELECT id, telegram AS telegram_id, language
         FROM users
        WHERE telegram IS NOT NULL
          AND telegram ~ '^[0-9]+$'
        ORDER BY id`
    );
    console.log(`[telegram] targeting ${rows.length} users`);

    let tgSent = 0, tgFailed = 0;
    for (const user of rows) {
      const lang = getLang(user);
      const msg  = TG_MSG[lang];
      if (DRY_RUN) { tgSent++; continue; }
      try {
        await tg.sendMessage(user.telegram_id, msg, { parse_mode: 'HTML' });
        tgSent++;
      } catch (err) {
        tgFailed++;
        if (tgFailed <= 3) console.warn(`[telegram] failed uid=${user.id}: ${err.message}`);
      }
      await sleep(TG_DELAY_MS);
    }
    console.log(`[telegram] sent=${tgSent} failed=${tgFailed}`);
  }

  console.log('[broadcast-mainstage-live] done.');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
