#!/usr/bin/env node
'use strict';

/**
 * dm-thankyou-broadcast-2026-06-23.js
 *
 * Sends a thank-you DM from Santino to every active user + web push to all subscribers.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/dm-thankyou-broadcast-2026-06-23.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/dm-thankyou-broadcast-2026-06-23.js
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }               = require(path.join(BACKEND, 'config/postgres'));
const DmService               = require(path.join(BACKEND, 'services/dmService'));
const PushNotificationService = require(path.join(BACKEND, 'services/pushNotificationService'));

const DRY_RUN      = process.argv.includes('--dry-run');
const SENDER_USERNAME = 'SantinoFurioso';
const DM_DELAY_MS     = 80;

const DM_TEXT = `ey papi, hope you are doing well. Just wanted to thank you for supporting and your patience. The app is fully operational by the exception of PNP Live so please go ahead and explore and let me know if you have any questions.`;

const PUSH_PAYLOAD = {
  title: 'Message from Santino 🙏',
  body:  'ey papi, hope you are doing well. The app is fully operational (except PNP Live) — go explore and let me know if you have questions!',
  url:   'https://pnptv.app/messages',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`\n=== Santino Thank-You Broadcast ${DRY_RUN ? '[DRY RUN]' : '[LIVE]'} ===\n`);

  const senderRow = await query('SELECT id FROM users WHERE username = $1', [SENDER_USERNAME]);
  if (!senderRow.rows.length) throw new Error(`Sender not found: ${SENDER_USERNAME}`);
  const senderId = senderRow.rows[0].id;
  console.log(`Sender: ${SENDER_USERNAME} (id=${senderId})`);

  const { rows: users } = await query(`
    SELECT id, username, first_name
    FROM users
    WHERE COALESCE(is_deleted, false) = false
      AND id != $1
    ORDER BY id
  `, [senderId]);
  console.log(`Recipients: ${users.length} users\n`);

  const stats = { dmOk: 0, dmErr: 0, pushSent: 0 };

  // 1. DMs
  console.log('1/2  Sending DMs...');
  if (DRY_RUN) {
    console.log(`     [DRY] Would DM ${users.length} users`);
  } else {
    for (const user of users) {
      try {
        await DmService.sendMessage(senderId, user.id, { content: DM_TEXT }, { isAdmin: true });
        stats.dmOk++;
        if (stats.dmOk % 50 === 0) console.log(`     ... ${stats.dmOk} sent`);
      } catch (err) {
        stats.dmErr++;
        console.error(`     [ERR] ${user.username || user.id}: ${err.message}`);
      }
      await sleep(DM_DELAY_MS);
    }
    console.log(`     ✓ ${stats.dmOk} sent, ${stats.dmErr} errors`);
  }

  // 2. Push notifications
  console.log('\n2/2  Sending push notifications...');
  if (DRY_RUN) {
    console.log('     [DRY] Would sendToAll push subscribers');
  } else {
    PushNotificationService.initialize();
    stats.pushSent = await PushNotificationService.sendToAll(PUSH_PAYLOAD);
    console.log(`     ✓ ${stats.pushSent} push sent`);
  }

  console.log('\n=== Done ===');
  console.log(`   DMs sent:  ${DRY_RUN ? '[dry]' : stats.dmOk}`);
  console.log(`   DM errors: ${DRY_RUN ? '[dry]' : stats.dmErr}`);
  console.log(`   Push sent: ${DRY_RUN ? '[dry]' : stats.pushSent}`);
  process.exit(0);
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });
