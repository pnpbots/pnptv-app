#!/usr/bin/env node
'use strict';

/**
 * broadcast-santino-referral-dm-june-2026.js
 *
 * Sends an in-app DM from Santino (8599671840) to all non-Spanish-speaking
 * users asking them to share their referral link.
 * Uses meta.broadcastId for idempotency — safe to re-run.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-santino-referral-dm-june-2026.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-santino-referral-dm-june-2026.js
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query } = require(path.join(BACKEND, 'config/postgres'));

const DRY_RUN      = process.argv.includes('--dry-run');
const SENDER_ID    = '8599671840'; // SantinoFurioso
const BROADCAST_ID = 'santino-referral-dm-june-2026';
const BATCH_SIZE   = 200;

const MESSAGE =
`Ey papo, sorry to bother again! As you know we are back to business and trying to get new users to the app, would you please share your referral link with your friends on Telegram and X? You get 1 day of PRIME for free for every new user who joins through your link (they also get it!) You can find it here https://pnptv.app/referrals`;

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' Santino Referral DM — in-app only — June 2026');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN) console.log(' MODE: DRY RUN — nothing will be written\n');

  // Non-Spanish users (null language treated as non-Spanish), excluding Santino himself
  const { rows: users } = await query(`
    SELECT id
    FROM users
    WHERE COALESCE(is_deleted, false) = false
      AND role != 'banned'
      AND id != $1
      AND COALESCE(language, 'en') NOT LIKE 'es%'
    ORDER BY id
  `, [SENDER_ID]);

  // Already sent (idempotency via meta.broadcastId)
  const { rows: alreadyRows } = await query(`
    SELECT recipient_id
    FROM direct_messages
    WHERE sender_id = $1
      AND meta->>'broadcastId' = $2
  `, [SENDER_ID, BROADCAST_ID]);
  const alreadySent = new Set(alreadyRows.map(r => r.recipient_id));

  const targets = users.filter(u => !alreadySent.has(u.id));

  console.log(`\n   Non-Spanish users: ${users.length}`);
  console.log(`   Already sent:      ${alreadySent.size}`);
  console.log(`   New targets:       ${targets.length}`);

  if (DRY_RUN) {
    console.log('\n── Sample DM ──\n');
    console.log(MESSAGE);
    console.log('\n═══════════════════════════════════════════════════');
    console.log(' DRY RUN COMPLETE');
    console.log('═══════════════════════════════════════════════════\n');
    process.exit(0);
  }

  if (!targets.length) {
    console.log('\n   Nothing to send.\n');
    process.exit(0);
  }

  const meta = JSON.stringify({ broadcastId: BROADCAST_ID });
  let inserted = 0;
  let failed   = 0;

  // Insert in batches using unnest
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    const ids   = batch.map(u => u.id);
    try {
      const result = await query(`
        INSERT INTO direct_messages (sender_id, recipient_id, content, meta)
        SELECT $1, t.id, $2, $3::jsonb
        FROM unnest($4::text[]) AS t(id)
        ON CONFLICT DO NOTHING
      `, [SENDER_ID, MESSAGE, meta, ids]);
      inserted += result.rowCount ?? batch.length;
    } catch (err) {
      failed += batch.length;
      console.error(`   ✗ Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${err.message}`);
    }
    if ((i + BATCH_SIZE) % 1000 === 0 || i + BATCH_SIZE >= targets.length) {
      console.log(`   Progress: ${Math.min(i + BATCH_SIZE, targets.length)}/${targets.length}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(' DONE');
  console.log('═══════════════════════════════════════════════════');
  console.log(` DMs inserted: ${inserted}`);
  if (failed) console.log(` Failed:       ${failed}`);
  console.log('═══════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
