#!/usr/bin/env node
'use strict';

/**
 * broadcast-lifetime100-pulse.js
 *
 * Recurring urgency nudge for the Lifetime Prime deal. Designed to run on cron
 * every 2 hours. Sends push + in-app to all users who do NOT already hold a
 * lifetime pnp-member entitlement.
 *
 * The in-app notification uses a stable entity_id so ON CONFLICT refreshes
 * the same bell entry (is_read reset, created_at bumped) instead of stacking
 * duplicate rows.
 *
 * Channels:
 *   1. In-app notification bell  — all target users
 *   2. Web push                  — users with active push subscriptions
 *   3. Telegram bot DM           — users with telegram ID (opt-in via flag)
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-lifetime100-pulse.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-lifetime100-pulse.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-lifetime100-pulse.js --with-telegram
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }               = require(path.join(BACKEND, 'config/postgres'));
const PushNotificationService = require(path.join(BACKEND, 'services/pushNotificationService'));
const { Telegram }            = require('telegraf');

const DRY_RUN        = process.argv.includes('--dry-run');
const WITH_TELEGRAM  = process.argv.includes('--with-telegram');

const ENTITY_ID   = 'lifetime100-pulse';          // stable — ON CONFLICT refreshes in-app entry
const CHECKOUT_URL = 'https://pnptv.app/lifetime100';
const TG_DELAY_MS  = 80;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Message copy ──────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `⏰ Only 1 hour left — Lifetime Prime is almost gone! Get lifetime PRIME for $99.99. Tap to grab yours →`,
  es: `⏰ ¡Solo 1 hora! — Lifetime Prime está a punto de cerrar. PRIME de por vida por $99.99. Toca aquí →`,
};

const PUSH = {
  en: {
    title: '⏰ 1 hour left — Lifetime Prime closes soon!',
    body:  'Lifetime PRIME access for $99.99 — one payment, forever. Don\'t miss out.',
  },
  es: {
    title: '⏰ ¡1 hora! — ¡Lifetime Prime cierra pronto!',
    body:  'Acceso PRIME de por vida por $99.99 — un pago, para siempre. No te lo pierdas.',
  },
};

const TG = {
  en:
`⏰ <b>Only 1 hour left — Lifetime Prime is almost gone</b>

Grab lifetime PRIME access to PNPtv! for just $99.99.

✅ One payment — no renewals, ever
✅ Unlimited Hangouts & PNP Live
✅ All exclusive content
✅ Live sessions with Santino

👉 <a href="${CHECKOUT_URL}">${CHECKOUT_URL}</a>`,

  es:
`⏰ <b>¡Solo 1 hora! — Lifetime Prime está a punto de cerrar</b>

Obtén acceso PRIME de por vida a PNPtv! por solo $99.99.

✅ Un pago — sin renovaciones, nunca
✅ Hangouts ilimitados y PNP Live
✅ Todo el contenido exclusivo
✅ Sesiones en vivo con Santino

👉 <a href="${CHECKOUT_URL}">${CHECKOUT_URL}</a>`,
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(' Lifetime Prime Pulse Broadcast — Urgency Push');
  console.log('═══════════════════════════════════════════════════════════════');
  if (DRY_RUN)       console.log(' MODE: DRY RUN — nothing will be sent or written\n');
  if (!DRY_RUN)      console.log(' MODE: LIVE — will send real messages\n');
  if (WITH_TELEGRAM) console.log(' --with-telegram: Telegram channel enabled');

  // ── Fetch target users (exclude those who already have lifetime access) ────
  console.log('Fetching target users...');
  const { rows: users } = await query(`
    SELECT u.id, u.first_name, u.username, u.email, u.telegram, u.language
    FROM users u
    WHERE COALESCE(u.is_deleted, false) = false
      AND u.role != 'banned'
      AND NOT EXISTS (
        SELECT 1 FROM user_entitlements ue
        WHERE ue.user_id    = u.id
          AND ue.add_on_id  = 'pnp-member'
          AND ue.is_lifetime = true
          AND ue.is_consumed = false
      )
    ORDER BY u.id
  `);

  const withTelegram = users.filter((u) => u.telegram);
  const userIds      = users.map((u) => u.id);

  console.log(`  Target users:    ${users.length}`);
  console.log(`  With Telegram:   ${withTelegram.length}`);
  console.log();

  if (!users.length) {
    console.log('No target users found. Exiting.');
    process.exit(0);
  }

  const stats = { inApp: 0, push: 0, telegram: 0, telegramFailed: 0 };

  // ── 1. In-app notification bell ───────────────────────────────────────────
  console.log('1/3  In-app notifications...');
  if (!DRY_RUN) {
    try {
      const enIds = users.filter((u) =>  isEn(u.language)).map((u) => u.id);
      const esIds = users.filter((u) => !isEn(u.language)).map((u) => u.id);

      for (const [ids, msg] of [[enIds, NOTIFICATION_MSG.en], [esIds, NOTIFICATION_MSG.es]]) {
        if (!ids.length) continue;
        await query(`
          INSERT INTO notifications
            (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message, metadata)
          SELECT
            'announcement', 'system', 'high', NULL,
            t.id, 'system', $2, $3, $4::jsonb
          FROM unnest($1::text[]) AS t(id)
          ON CONFLICT (type, target_user_id, entity_type, entity_id) WHERE actor_id IS NULL
          DO UPDATE SET
            is_read    = FALSE,
            created_at = NOW(),
            message    = EXCLUDED.message
        `, [ids, ENTITY_ID, msg, JSON.stringify({ url: CHECKOUT_URL })]);
        stats.inApp += ids.length;
      }
      console.log(`     ✓ Upserted: ${stats.inApp}`);
    } catch (err) {
      console.error(`     ✗ Error: ${err.message}`);
    }
  } else {
    console.log(`     [DRY] Would upsert in-app notifications for ${users.length} users`);
  }

  // ── 2. Web push ───────────────────────────────────────────────────────────
  console.log('2/3  Web push notifications...');
  if (!DRY_RUN) {
    try {
      PushNotificationService.initialize();
      const enIds = users.filter((u) =>  isEn(u.language)).map((u) => u.id);
      const esIds = users.filter((u) => !isEn(u.language)).map((u) => u.id);
      let pushSent = 0;
      if (enIds.length) {
        pushSent += await PushNotificationService.sendToUsers(enIds, { ...PUSH.en, url: CHECKOUT_URL, tag: ENTITY_ID });
      }
      if (esIds.length) {
        pushSent += await PushNotificationService.sendToUsers(esIds, { ...PUSH.es, url: CHECKOUT_URL, tag: ENTITY_ID });
      }
      stats.push = pushSent;
      console.log(`     ✓ Push sent: ${pushSent}`);
    } catch (err) {
      console.error(`     ✗ Error: ${err.message}`);
    }
  } else {
    console.log(`     [DRY] Would push to subscribed users out of ${users.length}`);
  }

  // ── 3. Telegram (opt-in — pass --with-telegram to enable) ─────────────────
  console.log(`3/3  Telegram (${WITH_TELEGRAM ? 'ENABLED' : 'skipped — pass --with-telegram to enable'})...`);
  if (WITH_TELEGRAM && !DRY_RUN) {
    const tg = new Telegram(process.env.BOT_TOKEN);
    for (let i = 0; i < withTelegram.length; i++) {
      const u   = withTelegram[i];
      const msg = isEn(u.language) ? TG.en : TG.es;
      try {
        await tg.sendMessage(u.telegram, msg, { parse_mode: 'HTML', disable_web_page_preview: false });
        stats.telegram++;
      } catch (err) {
        stats.telegramFailed++;
        if (stats.telegramFailed <= 5 || stats.telegramFailed % 50 === 0) {
          console.warn(`     TG err [${u.telegram}]: ${err.message}`);
        }
      }
      await sleep(TG_DELAY_MS);
      if ((i + 1) % 50 === 0) {
        console.log(`     TG progress: ${i + 1}/${withTelegram.length}`);
      }
    }
    console.log(`     ✓ Telegram sent: ${stats.telegram}, failed: ${stats.telegramFailed}`);
  } else if (WITH_TELEGRAM && DRY_RUN) {
    console.log(`     [DRY] Would send Telegram messages to ${withTelegram.length} users`);
  } else {
    console.log('     [SKIPPED]');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(` BROADCAST ${DRY_RUN ? 'DRY RUN' : 'COMPLETE'}`);
  console.log('═══════════════════════════════════════════════════════════════');
  if (DRY_RUN) {
    console.log(` Target users:  ${users.length}`);
    console.log(` Telegram:      ${withTelegram.length} (disabled by default)`);
    console.log(` Checkout URL:  ${CHECKOUT_URL}`);
  } else {
    console.log(` In-app:   ${stats.inApp} notified`);
    console.log(` Push:     ${stats.push} delivered`);
    if (WITH_TELEGRAM) console.log(` Telegram: ${stats.telegram} sent / ${stats.telegramFailed} failed`);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
